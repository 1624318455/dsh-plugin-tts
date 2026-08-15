// Smoke test for the Host half of @dsh-external/dsh-plugin-tts.
// Uses a fake ctx (webServer captures the two routes) and exercises the real
// Edge TTS synthesis over the network, then serves the audio back.
//   node tests/smoke.mjs
import * as plugin from '../lib/index.mjs';

const routes = [];

function fakeCtx() {
  return {
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
}

function mockReq(url, body) {
  const chunks = body === undefined ? [] : [body];
  return {
    url,
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () => {
          if (i < chunks.length) return Promise.resolve({ value: chunks[i++], done: false });
          return Promise.resolve({ done: true });
        }
      };
    }
  };
}

function mockRes() {
  return {
    headersSent: false,
    head: null,
    body: null,
    writeHead(code, headers) { this.head = { code, headers }; },
    end(body) { this.body = body; }
  };
}

async function call(route, req, res) {
  await route.handler(req, res);
  return res;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const ctx = fakeCtx();
plugin.apply(ctx);
const speakRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/speak');
const audioRoute = routes.find((r) => r.kind === 'prefix' && r.path === '/dsh-tts-audio');

check('plugin registers two routes', speakRoute !== undefined && audioRoute !== undefined);

if (speakRoute && audioRoute) {
  const res = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({ text: '你好，这是一个冒烟测试。', voice: 'zh-CN-XiaoxuanNeural' })), mockRes());
  const parsed = JSON.parse(res.body);
  check('speak returns 200 + url', res.head.code === 200 && typeof parsed.url === 'string' && parsed.url.startsWith('/dsh-tts-audio/'), parsed.url ?? res.body);

  if (parsed.url) {
    const ares = await call(audioRoute, mockReq(parsed.url), mockRes());
    const bytes = Buffer.isBuffer(ares.body) ? ares.body : Buffer.from(ares.body ?? '');
    const isMp3 = bytes.length > 1000 && bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0;
    check('audio route serves valid mp3', ares.head.code === 200 && isMp3, `code=${ares.head.code} bytes=${bytes.length}`);
  }

  const badRes = await call(audioRoute, mockReq('/dsh-tts-audio/nope'), mockRes());
  check('unknown audio id -> 404', badRes.head.code === 404);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
