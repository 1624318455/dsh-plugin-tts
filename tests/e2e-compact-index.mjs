// One-off real end-to-end for the compact-index tool.
// Requires the local rvc-server (NEW code with /compact-index) on 4892.
//   node tests/e2e-compact-index.mjs
import { createServer } from 'node:http';

const BASE = 'http://127.0.0.1:4892';
const RVC_DIR = 'E:/AI/RVC20240604Nvidia/RVC20240604Nvidia';
const MODEL = `${RVC_DIR}/assets/weights/azusa-test.pth`;
const INDEX = `${RVC_DIR}/assets/indices/azusa-test_IVF3317_Flat_nprobe_1_azusa-test_v2.index`;
const OUT_DIR = `${RVC_DIR}/assets/indices`;

function post(route, payload, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    fetch(BASE + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    }).then(async r => {
      clearTimeout(timer);
      const data = await r.json().catch(() => null);
      if (!r.ok) reject(new Error(`HTTP ${r.status}: ${(data && (data.message || data.error)) || r.statusText}`));
      else resolve(data);
    }).catch(e => { clearTimeout(timer); reject(e); });
  });
}

function miniWav(seconds = 2, sr = 40000) {
  const n = sr * seconds;
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
  return buf;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// 1) build compact indexes
const t0 = Date.now();
const c2k = await post('/compact-index', { index: INDEX, target_vectors: 2000 });
console.log(`compact 2k -> ${c2k.path.split(/[\\/]/).pop()} ${(c2k.size / 1048576).toFixed(1)}MB (${c2k.reduction_pct}% smaller, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
check('compact 2k built', c2k.ok && c2k.vectors === 2000 && c2k.size > 1000000 && c2k.size < 10000000, `size=${c2k.size}`);
const c10k = await post('/compact-index', { index: INDEX, target_vectors: 10000 });
console.log(`compact 10k -> ${c10k.path.split(/[\\/]/).pop()} ${(c10k.size / 1048576).toFixed(1)}MB (${c10k.reduction_pct}% smaller)`);
check('compact 10k built', c10k.ok && c10k.vectors === 10000 && c10k.size > 20000000 && c10k.size < 50000000, `size=${c10k.size}`);

// 2) load the model + compact index, convert a clip -> must yield wav
await post('/load', { model: MODEL, index: c2k.path });
const cv = await post('/convert', {
  audio_base64: miniWav(2).toString('base64'),
  params: { spk_id: 0, f0_method: 'rmvpe', index_rate: 0.75, resample_sr: 40000 }
}, 180000);
const wav = Buffer.from(cv.audio_base64 || '', 'base64');
check('convert with compact index works', cv.audio_base64 && wav.length > 1000 && wav.slice(0, 4).toString() === 'RIFF', `bytes=${wav.length} sr=${cv.sample_rate}`);

// 3) restore the original index on the server
await post('/load', { model: MODEL, index: INDEX });
console.log('restored original index on server');

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
