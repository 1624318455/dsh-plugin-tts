// One-off real end-to-end: plugin Host -> real rvc-server (azusa-test) chain.
// Verifies Edge base synth + real RVC conversion + audio route serving.
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

const RVC_DIR = 'E:/AI/RVC20240604Nvidia/RVC20240604Nvidia';
const custom = {
  baseUrl: 'http://127.0.0.1:4892',
  model: `${RVC_DIR}/assets/weights/azusa-test.pth`,
  index: `${RVC_DIR}/assets/indices/azusa-test_IVF3317_Flat_nprobe_1_azusa-test_v2.index`,
  baseVoice: 'zh-CN-YunyangNeural',
  f0Method: 'rmvpe',
  indexRate: 0.75
};

const t0 = Date.now();
const res = mockRes();
try {
  await speakRoute.handler(
    mockReq('/dsh-tts-api/speak', JSON.stringify({ text: '这是通过插件链路转换出的 azusa 音色，用来验证端到端流程。', provider: 'rvc', custom })),
    res
  );
} catch (e) {
  console.error('speak handler threw:', e);
  process.exit(1);
}
console.log('res.head:', JSON.stringify(res.head));
console.log('res.body type:', typeof res.body, res.body === null ? 'null' : String(res.body).slice(0, 200));
if (!res.body) process.exit(1);
const parsed = JSON.parse(res.body);
console.log(`speak -> ${res.head.c} ${parsed.url ?? parsed.error}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
if (!parsed.url) process.exit(1);

const ares = mockRes();
await audioRoute.handler(mockReq(parsed.url), ares);
const bytes = Buffer.isBuffer(ares.body) ? ares.body : Buffer.from(ares.body ?? '');
console.log(`audio -> ${ares.head.c} ${bytes.length} bytes, head=${bytes.slice(0, 4).toString()}`);
if (!(bytes.length > 1000 && bytes.slice(0, 4).toString() === 'RIFF')) process.exit(1);

// ---- adaptive chunked progressive playback (long text) ----
const nextRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-next');
if (!nextRoute) {
  console.error('rvc-next route missing');
  process.exit(1);
}
const longText = '这是一段用来验证自适应分块渐进播放的长文本，每一块都会先由 Edge 合成，再交给本地 RVC 服务转换，播放的同时后台继续合成后面的段落，从而做到长文朗读不卡顿。'.repeat(3);
const t1 = Date.now();
const longRes = mockRes();
await speakRoute.handler(
  mockReq('/dsh-tts-api/speak', JSON.stringify({ text: longText, provider: 'rvc', custom })),
  longRes
);
const longParsed = JSON.parse(longRes.body);
console.log(`long speak -> ${longRes.head.c} jobId=${longParsed.jobId ?? ''} chunks=${longParsed.chunks?.length ?? 0} total=${longParsed.total ?? 0} ratio=${longParsed.ratio ?? 'n/a'} chunkSec=${longParsed.chunkSec ?? 'n/a'} (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
if (!longParsed.jobId || !Array.isArray(longParsed.chunks) || longParsed.chunks.length < 2) process.exit(1);
let fetched = longParsed.chunks.length;
let more = true;
const chunkStarts = [];
while (more) {
  const nr = mockRes();
  await nextRoute.handler(mockReq(`/dsh-tts-api/rvc-next?job=${longParsed.jobId}`), nr);
  const np = JSON.parse(nr.body);
  if (np && np.url) {
    fetched++;
    chunkStarts.push(np.url);
  }
  more = !!(np && np.more);
}
console.log(`rvc-next drained: fetched=${fetched} total=${longParsed.total} (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
if (fetched !== longParsed.total) process.exit(1);
// verify one late chunk serves wav
const lastRes = mockRes();
await audioRoute.handler(mockReq(chunkStarts[chunkStarts.length - 1]), lastRes);
const lastBytes = Buffer.isBuffer(lastRes.body) ? lastRes.body : Buffer.from(lastRes.body ?? '');
console.log(`late chunk audio -> ${lastRes.head.c} ${lastBytes.length} bytes, head=${lastBytes.slice(0, 4).toString()}`);
if (!(lastBytes.length > 1000 && lastBytes.slice(0, 4).toString() === 'RIFF')) process.exit(1);

process.exit(0);
