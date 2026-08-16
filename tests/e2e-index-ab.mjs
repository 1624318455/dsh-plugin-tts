// One-off real A/B: how much does the index actually change the output?
//
// [DEPRECATED in favor of tests/rvc-server-live.mjs] This one-off test hardcodes
// Windows paths (E:/AI/.../azusa-test.pth) and is not portable. The standard,
// environment-aware live scenario + boundary suite is `tests/rvc-server-live.mjs`
// (npm run test:live). This file is kept for Windows reference only.

// Same real Edge-TTS base audio converted under three configs on the local
// rvc-server (4892, NEW code): index-free vs full index vs compact-2k index.
//   node tests/e2e-index-ab.mjs
import * as plugin from '../lib/index.mjs';

const routes = [];
const ctx = {
  get(name) {
    if (name === 'webServer') {
      return {
        register(route) {
          routes.push(route);
          return () => {
            const i = routes.indexOf(route);
            if (i >= 0) routes.splice(i, 1);
          };
        }
      };
    }
    return undefined;
  },
  effect() {}
};
plugin.apply(ctx);
const speakRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/speak');
const audioRoute = routes.find((r) => r.kind === 'prefix' && r.path === '/dsh-tts-audio');

function mockReq(url, body) {
  const chunks = body === undefined ? [] : [body];
  return {
    url,
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () => (i < chunks.length ? Promise.resolve({ value: chunks[i++], done: false }) : Promise.resolve({ done: true }))
      };
    }
  };
}
function mockRes() {
  return { headersSent: false, head: null, body: null, writeHead(c, h) { this.head = { c, h }; }, end(b) { this.body = b; } };
}
async function call(route, req, res) { await route.handler(req, res); return res; }

const BASE = 'http://127.0.0.1:4892';
const RVC_DIR = 'E:/AI/RVC20240604Nvidia/RVC20240604Nvidia';
const MODEL = `${RVC_DIR}/assets/weights/azusa-test.pth`;
const FULL = `${RVC_DIR}/assets/indices/azusa-test_IVF3317_Flat_nprobe_1_azusa-test_v2.index`;
const COMPACT = process.env.AB_INDEX
  || `${RVC_DIR}/assets/indices/azusa-test_IVF3317_Flat_nprobe_1_azusa-test_v2_compact_2000.index`;

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

function toSamples(buf) {
  // wav -> int16 mono samples (best effort: skip 44-byte header)
  const data = buf.subarray(44);
  const n = Math.floor(data.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2);
  return out;
}
function compare(name, a, b) {
  const na = a.length, nb = b.length;
  if (na !== nb) {
    console.log(`  ${name}: LENGTH DIFFERS ${na} vs ${nb} (${Math.abs(na - nb)} samples)`);
    return;
  }
  let sum = 0, max = 0;
  for (let i = 0; i < na; i++) {
    const d = Math.abs(a[i] - b[i]);
    sum += d;
    if (d > max) max = d;
  }
  const mean = sum / na;
  let rms = 0;
  for (let i = 0; i < na; i++) rms += a[i] * a[i];
  rms = Math.sqrt(rms / na);
  console.log(`  ${name}: meanAbsDiff=${mean.toFixed(1)} (${((mean / (rms || 1)) * 100).toFixed(1)}% of RMS), max=${max}, rms=${rms.toFixed(0)}`);
}

// 1) real speech base audio via the plugin's Edge provider
const res = mockRes();
await speakRoute.handler(mockReq('/dsh-tts-api/speak', JSON.stringify({
  text: '这是一段用来测试不同索引对音色还原度影响的真实语音，请你仔细听。',
  voice: 'zh-CN-XiaoxuanNeural'
})), res);
const parsed = JSON.parse(res.body);
if (!parsed.url) { console.error('edge speak failed:', parsed); process.exit(1); }
const ares = mockRes();
await audioRoute.handler(mockReq(parsed.url), ares);
const baseMp3 = Buffer.isBuffer(ares.body) ? ares.body : Buffer.from(ares.body ?? '');
console.log(`base audio: ${(baseMp3.length / 1024).toFixed(0)} KB mp3`);

// 2) three conversions of the SAME base
await post('/load', { model: MODEL, index: FULL });
const z = await post('/convert', { audio_base64: baseMp3.toString('base64'), params: { index_rate: 0 } }, 180000);
console.log('config A (index-free): converted');
const f = await post('/convert', { audio_base64: baseMp3.toString('base64'), params: { index_rate: 0.75 } }, 180000);
console.log('config B (full index, 0.75): converted');
await post('/load', { model: MODEL, index: COMPACT });
const c = await post('/convert', { audio_base64: baseMp3.toString('base64'), params: { index_rate: 0.75 } }, 180000);
console.log('config C (compact 2k, 0.75): converted');
await post('/load', { model: MODEL, index: FULL }); // restore

const za = toSamples(Buffer.from(z.audio_base64, 'base64'));
const fa = toSamples(Buffer.from(f.audio_base64, 'base64'));
const ca = toSamples(Buffer.from(c.audio_base64, 'base64'));
console.log(`lengths: A=${za.length} B=${fa.length} C=${ca.length}`);
console.log('A vs B (index-free vs full index):');
compare('  ', za, fa);
console.log('B vs C (full index vs compact 2k):');
compare('  ', fa, ca);
console.log('A vs C (index-free vs compact 2k):');
compare('  ', za, ca);
process.exit(0);
