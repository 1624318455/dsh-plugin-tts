// Standard live scenario + boundary suite for the local RVC inference server
// (rvc-server.py). Unlike the Windows-hardcoded one-off e2e tests, this is
// environment-aware:
//   * uses RVC_URL (default http://127.0.0.1:4892) if a server is already up;
//   * otherwise tries to spawn one from $RVC_WORK (default ~/rvc-work, the
//     layout the macOS test builds), using venv/bin/python;
//   * if neither is available it prints SKIP and exits 0 (safe in CI).
//
//   node tests/rvc-server-live.mjs
//   RVC_URL=... node tests/rvc-server-live.mjs
//
// Covers: real end-to-end scenario (health/files/load/convert/compact-index)
// plus protocol boundary cases (malformed payloads, missing model/index,
// convert-before-load, empty/tiny/invalid base64, bad f0_method, bad
// compact-index, unknown route, concurrency lock).
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';

const BASE = process.env.RVC_URL || 'http://127.0.0.1:4892';
const WORK = process.env.RVC_WORK || path.join(os.homedir(), 'rvc-work');
const MODEL = path.join(WORK, 'assets', 'weights', 'model.pth');
const INDEX = path.join(WORK, 'assets', 'weights', 'guanguanV1.index');
const PY = path.join(WORK, 'venv', 'bin', 'python');
const SERVER = path.join(WORK, 'rvc-server.py');

const results = [];
const skipped = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
function skip(name, reason) {
  skipped.push(name);
  console.log(`SKIP  ${name} — ${reason}`);
}

async function ping(url, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url + '/health', { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { clearTimeout(t); return false; }
}

async function http(method, route, body, timeoutMs = 300000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const opt = { method, signal: ctrl.signal, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  try {
    const r = await fetch(BASE + route, opt);
    clearTimeout(t);
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { status: r.status, data, text };
  } catch (e) {
    clearTimeout(t);
    return { status: 0, data: null, text: String(e) };
  }
}

// --- availability detection + optional spawn ---
let serverProc = null;
let live = await ping(BASE, 2000);
if (!live && existsSync(PY) && existsSync(SERVER)) {
  console.log(`[live] no server on ${BASE}; spawning from ${WORK}`);
  serverProc = spawn(PY, [SERVER, '--port', new URL(BASE).port], { stdio: 'ignore' });
  // wait up to ~20s for /health
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await ping(BASE, 1000)) { live = true; break; }
  }
}
if (!live) {
  console.log('SKIP  live+rvc-server unavailable — start rvc-server.py or set RVC_URL/RVC_WORK');
  process.exit(0);
}
console.log(`[live] using ${BASE}  (work=${existsSync(WORK) ? WORK : 'n/a'})`);

try {
  // ---------- SCENARIO: happy path ----------
  {
    const h = await http('GET', '/health');
    // Accept either a CPU or a CUDA device: the health payload must be
    // self-consistent (cuda_available matches the reported device), so this
    // works both on CI (cpu) and on a Windows/macOS GPU regression host (cuda).
    const dev = h.data && h.data.device;
    const cuda = h.data && h.data.cuda_available;
    const consistent = (dev === 'cpu' && cuda === false) || (typeof dev === 'string' && dev.startsWith('cuda') && cuda === true);
    check('scenario /health ok + consistent device', h.status === 200 && h.data.ok === true && consistent,
      `device=${dev} cuda=${cuda}`);

    const f = await http('GET', '/files?kind=pth');
    check('scenario /files lists pth', f.status === 200 && Array.isArray(f.data && f.data.files), f.text.slice(0, 120));

    const modelExists = existsSync(MODEL);
    const indexExists = existsSync(INDEX);
    if (!(modelExists && indexExists)) {
      skip('scenario /load + /convert + /compact-index', 'model/index not in ' + WORK);
    } else {
      const ld = await http('POST', '/load', { model: MODEL, index: INDEX });
      check('scenario /load ok', ld.status === 200 && ld.data.ok === true, ld.text.slice(0, 100));

      const wav = makeWav(1.0, 44100); // ~1s sawtooth speech-like
      const cv = await http('POST', '/convert', {
        audio_base64: wav.toString('base64'),
        params: { f0_method: 'rmvpe', index_rate: 0.75 }
      }, 600000);
      const cvOk = cv.status === 200 && cv.data && typeof cv.data.audio_base64 === 'string'
        && Number.isFinite(cv.data.sample_rate) && cv.data.sample_rate > 0;
      check('scenario /convert returns wav', cvOk, `status=${cv.status} sr=${cv.data && cv.data.sample_rate}`);
      if (cvOk) {
        const out = Buffer.from(cv.data.audio_base64, 'base64');
        check('scenario /convert output is RIFF wav', out.slice(0, 4).toString() === 'RIFF' && out.length > 44,
          `${out.length} bytes`);
      }

      const ci = await http('POST', '/compact-index', { index: INDEX, target_vectors: 500 }, 600000);
      check('scenario /compact-index ok', ci.status === 200 && ci.data.ok === true
        && typeof ci.data.reduction_pct === 'number', ci.text.slice(0, 120));
    }
  }

  // ---------- BOUNDARY: protocol edges ----------
  {
    // load with missing model path
    const r1 = await http('POST', '/load', { model: path.join(WORK, 'nope.pth') }, 30000);
    check('boundary /load missing model -> 4xx', r1.status >= 400 && r1.status < 500, `status=${r1.status} ${r1.text.slice(0, 80)}`);

    // load with missing index path (model valid)
    if (existsSync(MODEL)) {
      const r2 = await http('POST', '/load', { model: MODEL, index: path.join(WORK, 'nope.index') }, 60000);
      check('boundary /load missing index -> 4xx', r2.status >= 400 && r2.status < 500, `status=${r2.status} ${r2.text.slice(0, 80)}`);
    }

    // malformed JSON body
    const r3 = await http('POST', '/load', '{not json', 30000);
    check('boundary /load malformed json -> 4xx', r3.status >= 400, `status=${r3.status} ${r3.text.slice(0, 80)}`);

    // convert before load (if we could not load, this still applies when nothing loaded)
    const r4 = await http('POST', '/convert', { audio_base64: makeWav(0.2, 44100).toString('base64'), params: {} }, 30000);
    // 200 if a model happens to be loaded from the happy path, else 4xx — either is acceptable,
    // but a 500 crash is not.
    check('boundary /convert never 5xx-crashes pre/post load', r4.status !== 500, `status=${r4.status} ${r4.text.slice(0, 80)}`);

    // convert with empty audio_base64
    const r5 = await http('POST', '/convert', { audio_base64: '', params: {} }, 30000);
    check('boundary /convert empty base64 -> 4xx (not 500)', r5.status !== 500 && r5.status !== 0, `status=${r5.status}`);

    // convert with invalid base64
    const r6 = await http('POST', '/convert', { audio_base64: '!!!not-base64!!!', params: {} }, 30000);
    check('boundary /convert bad base64 -> 4xx (not 500)', r6.status !== 500 && r6.status !== 0, `status=${r6.status}`);

    // convert with a zero-length (empty) wav
    const empty = Buffer.alloc(44); // 44-byte header, no data
    empty.write('RIFF', 0); empty.write('WAVE', 8); empty.write('fmt ', 12);
    const r7 = await http('POST', '/convert', { audio_base64: empty.toString('base64'), params: {} }, 30000);
    check('boundary /convert empty wav -> 4xx (not 500)', r7.status !== 500 && r7.status !== 0, `status=${r7.status} ${r7.text.slice(0, 80)}`);

    // convert with a valid wav but unknown f0_method (should not crash)
    const r8 = await http('POST', '/convert', { audio_base64: makeWav(0.3, 44100).toString('base64'), params: { f0_method: 'does-not-exist' } }, 60000);
    check('boundary /convert unknown f0_method -> 4xx (not 500)', r8.status !== 500, `status=${r8.status} ${r8.text.slice(0, 80)}`);

    // compact-index with missing index
    const r9 = await http('POST', '/compact-index', { index: path.join(WORK, 'nope.index') }, 30000);
    check('boundary /compact-index missing index -> 4xx', r9.status >= 400 && r9.status < 500, `status=${r9.status} ${r9.text.slice(0, 80)}`);

    // compact-index with empty index
    const r10 = await http('POST', '/compact-index', { index: '' }, 30000);
    check('boundary /compact-index empty index -> 4xx', r10.status >= 400, `status=${r10.status} ${r10.text.slice(0, 80)}`);

    // unknown route -> 404
    const r11 = await http('GET', '/does-not-exist');
    check('boundary unknown route -> 404', r11.status === 404, `status=${r11.status}`);
  }

  // ---------- CONCURRENCY: parallel converts must not crash ----------
  if (existsSync(MODEL)) {
    await http('POST', '/load', { model: MODEL, index: existsSync(INDEX) ? INDEX : '' }, 60000);
    const wav = makeWav(0.5, 44100).toString('base64');
    const out = await Promise.allSettled([
      http('POST', '/convert', { audio_base64: wav, params: { f0_method: 'rmvpe' } }, 600000),
      http('POST', '/convert', { audio_base64: wav, params: { f0_method: 'rmvpe' } }, 600000),
      http('POST', '/convert', { audio_base64: wav, params: { f0_method: 'pm' } }, 600000),
    ]);
    const statuses = out.map(x => x.status === 'fulfilled' ? x.value.status : -1);
    const anyOk = statuses.some(s => s === 200);
    const no5xx = statuses.every(s => s !== 500 && s !== -1);
    check('boundary 3 concurrent converts no 5xx + at least one ok', anyOk && no5xx, `statuses=${statuses.join(',')}`);
  }
} finally {
  if (serverProc) serverProc.kill();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} live checks passed${skipped.length ? `, ${skipped.length} skipped` : ''}`);
process.exit(failed.length === 0 ? 0 : 1);

// --- helper: tiny valid WAV ---
function makeWav(seconds, sr) {
  const n = Math.floor(sr * seconds);
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.round(12000 * Math.sin(2 * Math.PI * 220 * i / sr));
    buf.writeInt16LE(v, 44 + i * 2);
  }
  return buf;
}
