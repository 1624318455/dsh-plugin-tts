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
process.exit(bytes.length > 1000 && bytes.slice(0, 4).toString() === 'RIFF' ? 0 : 1);
