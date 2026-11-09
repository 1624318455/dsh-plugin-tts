// End-to-end: plugin /speak (provider 'openai-compatible') -> Python gateway
// -> mock GPT-SoVITS api_v2.py -> wav -> /dsh-tts-audio/<id>.
// Proves the whole chain including range-free audio serving and chunking.
//   node tests/e2e-openai-gateway.mjs
// Requires python3.8+ on PATH (the gateway itself is stdlib-only); skips otherwise.
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY = path.join(HERE, '..', 'tools', 'gpt-sovits-openai-gateway.py');

// Never touch the real ~/.dsh/tts-rvc/settings.json: CAL_DIR is captured when
// the plugin module is evaluated, so DSH_TTS_HOME must be set before the
// dynamic import below.
const HOME = mkdtempSync(path.join(os.tmpdir(), 'dsh-openai-e2e-home-'));
process.env.DSH_TTS_HOME = HOME;
const plugin = await import('../lib/index.mjs');

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS  ' + name + (extra ? ' — ' + String(extra).slice(0, 160) : '')); }
  else { fail++; failures.push(name); console.log('FAIL  ' + name + (extra ? ' — ' + String(extra).slice(0, 300) : '')); }
}

function wavBytes(seconds = 1, rate = 16000) {
  const samples = Math.floor(rate * seconds);
  const dataLen = samples * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLen, 40);
  return buf;
}

const WAV = wavBytes(1);

const routes = [];
function fakeCtx() {
  return {
    get(name) {
      if (name === 'webServer') {
        return { register(route) { routes.push(route); return () => {}; } };
      }
      return undefined;
    },
    effect(fn) { fn?.(); },
    on() { return () => {}; }
  };
}

function mockReq(url, body) {
  const chunks = body === undefined ? [] : [body];
  return {
    url,
    [Symbol.asyncIterator]() {
      let i = 0;
      return { next: () => (i < chunks.length
        ? Promise.resolve({ value: chunks[i++], done: false })
        : Promise.resolve({ done: true })) };
    }
  };
}
function mockRes() {
  const head = { code: 0, headers: {} };
  const parts = [];
  return {
    headersSent: false,
    head,
    get body() { return Buffer.concat(parts).toString('utf8'); },
    raw() { return Buffer.concat(parts); },
    writeHead(code, headers) { head.code = code; Object.assign(head.headers, headers || {}); this.headersSent = true; },
    setHeader(k, v) { head.headers[k] = v; },
    end(chunk) { if (chunk) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); }
  };
}
async function call(route, req, res) {
  await route.handler(req, res);
  return res;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

function waitFor(url, tries = 80) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      fetch(url).then(r => resolve(true)).catch(() => {
        if (++n >= tries) reject(new Error('timeout waiting for ' + url));
        else setTimeout(tick, 100);
      });
    };
    tick();
  });
}

function hasPython() {
  for (const exe of ['python', 'python3']) {
    try {
      execFileSync(exe, ['--version'], { stdio: 'ignore' });
      return exe;
    } catch (e) { /* try next */ }
  }
  return null;
}

const PY = hasPython();
if (!PY) {
  console.log('SKIP  python not found — gateway e2e skipped');
  process.exit(0);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'dsh-openai-e2e-'));
const refWav = path.join(tmp, 'ref.wav');
writeFileSync(refWav, WAV);

// --- mock GPT-SoVITS api_v2.py: /tts returns WAV, records the payload ------
let upstreamBody = null;
const upstream = createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/tts')) {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      try { upstreamBody = JSON.parse(raw); } catch (e) { upstreamBody = null; }
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': WAV.length });
      res.end(WAV);
    });
    return;
  }
  res.writeHead(404); res.end('nope');
});

let gateway = null;
try {
  plugin.apply(fakeCtx());
  const speakRoute = routes.find(r => r.kind === 'exact' && r.path === '/dsh-tts-api/speak');
  const testRoute = routes.find(r => r.kind === 'exact' && r.path === '/dsh-tts-api/openai-test');
  const audioRoute = routes.find(r => r.kind === 'prefix' && r.path === '/dsh-tts-audio');
  check('routes registered', !!speakRoute && !!testRoute && !!audioRoute);

  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  const upPort = upstream.address().port;
  const gwPort = await freePort();

  gateway = spawn(PY, [
    GATEWAY,
    '--upstream', 'http://127.0.0.1:' + upPort,
    '--ref-audio', refWav,
    '--prompt-text', '这是参考音频的文字',
    '--port', String(gwPort)
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let gwErr = '';
  gateway.stderr.on('data', d => { gwErr += d.toString(); });

  await waitFor('http://127.0.0.1:' + gwPort + '/health');
  const baseUrl = 'http://127.0.0.1:' + gwPort;

  // --- short text: single URL, real wav bytes through the audio route ----
  const r1 = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
    text: '你好，这是一次端到端测试。',
    voice: 'default',
    provider: 'openai-compatible',
    custom: { baseUrl, model: 'gpt-sovits', voice: 'default', format: 'wav', speed: 1, extraBody: '{"top_k":9}' }
  })), mockRes());
  const d1 = JSON.parse(r1.body);
  check('short text returns a single audio url', r1.head.code === 200 && !!d1.url, r1.body.slice(0, 200));

  if (d1.url) {
    const audioRes = mockRes();
    const id = d1.url.split('/').pop();
    await call(audioRoute, mockReq('/dsh-tts-audio/' + id), audioRes);
    const raw = audioRes.raw();
    check('audio route serves the synthesized wav',
      audioRes.head.code === 200 && raw.slice(0, 4).toString('ascii') === 'RIFF',
      audioRes.head.headers['Content-Type'] + ' ' + raw.length + 'B');
    check('host forwarded extraBody into the gpt-sovits payload',
      upstreamBody && upstreamBody.top_k === 9, JSON.stringify(upstreamBody && { top_k: upstreamBody.top_k }));
    check('host mapped text -> payload.text / voice -> ref_audio_path',
      upstreamBody && upstreamBody.text.includes('端到端') &&
      path.basename(upstreamBody.ref_audio_path || '') === 'ref.wav',
      upstreamBody && upstreamBody.ref_audio_path);
  }

  // --- long text: chunked job (fastFirst returns chunk 0 immediately) ---
  const longText = '这是一段用来触发分块播放的较长文本。'.repeat(20);
  const r2 = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
    text: longText,
    voice: 'default',
    provider: 'openai-compatible',
    custom: { baseUrl, model: 'gpt-sovits', voice: 'default', format: 'wav', speed: 1 }
  })), mockRes());
  const d2 = JSON.parse(r2.body);
  check('long text returns a chunked job',
    r2.head.code === 200 && !!d2.jobId && Array.isArray(d2.chunks) && d2.total > 1,
    JSON.stringify({ jobId: d2.jobId, total: d2.total, chunks: (d2.chunks || []).length }).slice(0, 160));

  // --- test route returns latency + byte count -------------------------
  const r3 = await call(testRoute, mockReq('/dsh-tts-api/openai-test', JSON.stringify({
    voice: 'default',
    custom: { baseUrl, model: 'gpt-sovits', voice: 'default', format: 'wav' }
  })), mockRes());
  const d3 = JSON.parse(r3.body);
  check('openai-test reports latency + bytes',
    r3.head.code === 200 && d3.ok === true && d3.bytes > 1000 && d3.ms >= 0,
    r3.body.slice(0, 160));

  // --- upstream 200 + JSON must NOT be written as audio ----------------
  const badUpstream = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'ref audio invalid' } }));
  });
  await new Promise(r => badUpstream.listen(0, '127.0.0.1', r));
  const badPort = badUpstream.address().port;
  const badGwPort = await freePort();
  const badGw = spawn(PY, [GATEWAY, '--upstream', 'http://127.0.0.1:' + badPort,
    '--ref-audio', refWav, '--prompt-text', 'x', '--port', String(badGwPort)], { stdio: 'ignore' });
  try {
    await waitFor('http://127.0.0.1:' + badGwPort + '/health');
    const r4 = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
      text: '短句。', voice: 'default', provider: 'openai-compatible',
      custom: { baseUrl: 'http://127.0.0.1:' + badGwPort, format: 'wav' }
    })), mockRes());
    const d4 = JSON.parse(r4.body);
    check('upstream JSON-instead-of-audio surfaces as a readable error',
      r4.head.code === 500 && !!d4.error && /音频|audio/i.test(d4.error),
      r4.body.slice(0, 200));
  } finally {
    badGw.kill();
    badUpstream.close();
  }
} catch (e) {
  fail++;
  failures.push('unexpected: ' + (e && e.message));
  console.error('UNEXPECTED', e);
} finally {
  if (gateway) gateway.kill();
  upstream.close();
  try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  try { rmSync(HOME, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('failures: ' + failures.join(' | ')); process.exit(1); }
