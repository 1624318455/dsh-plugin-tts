// Smoke test for the Host half of @dsh-external/dsh-plugin-tts.
// Uses a fake ctx (webServer captures the two routes) and exercises the real
// Edge TTS synthesis over the network, plus the RVC chain against a mock
// local RVC inference server, then serves the audio back.
//   node tests/smoke.mjs
import * as plugin from '../lib/index.mjs';
import { createServer } from 'node:http';

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

// --- RVC chain against a mock local RVC server ---

function miniWav(seconds = 1, sr = 40000) {
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

function startMockRvc() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        if (req.url === '/load') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else if (req.url.startsWith('/files?kind=')) {
          const kind = req.url.slice('/files?kind='.length);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            kind,
            files: kind === 'pth'
              ? [{ name: 'demo.pth', path: 'C:/models/demo.pth', size: 55000000 }]
              : [{ name: 'demo.index', path: 'C:/models/demo.index', size: 400000000 }]
          }));
        } else if (req.url === '/convert') {
          const payload = JSON.parse(body || '{}');
          if (!payload.audio_base64) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'audio_base64 required' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ audio_base64: miniWav().toString('base64'), sample_rate: 40000 }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

if (speakRoute && audioRoute) {
  const mock = await startMockRvc();
  try {
    const res = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
      text: '这是一段 RVC 链路测试。',
      voice: 'zh-CN-XiaoxuanNeural',
      provider: 'rvc',
      custom: { baseUrl: `http://127.0.0.1:${mock.port}`, model: 'mock.pth', index: '' }
    })), mockRes());
    const parsed = JSON.parse(res.body);
    check('rvc speak returns 200 + url', res.head.code === 200 && typeof parsed.url === 'string' && parsed.url.startsWith('/dsh-tts-audio/'), parsed.url ?? res.body);
    if (parsed.url) {
      const ares = await call(audioRoute, mockReq(parsed.url), mockRes());
      const bytes = Buffer.isBuffer(ares.body) ? ares.body : Buffer.from(ares.body ?? '');
      check('rvc audio route serves wav (RIFF)', ares.head.code === 200 && bytes.length > 44 && bytes.slice(0, 4).toString() === 'RIFF', `code=${ares.head.code} bytes=${bytes.length}`);
    }

    // upload-mode base audio (skip Edge synthesis)
    const upRes = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
      text: '上传底噪链路测试。',
      voice: 'zh-CN-XiaoxuanNeural',
      provider: 'rvc',
      custom: {
        baseUrl: `http://127.0.0.1:${mock.port}`,
        model: 'mock.pth',
        index: '',
        baseSource: 'upload',
        baseAudioName: 'sample.wav',
        baseAudioBase64: miniWav(1).toString('base64')
      }
    })), mockRes());
    const upParsed = JSON.parse(upRes.body);
    check('rvc upload-base speak returns 200 + url', upRes.head.code === 200 && typeof upParsed.url === 'string', upParsed.url ?? upRes.body);

    // file-discovery proxy route
    const filesRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-files');
    const fr = await call(filesRoute, mockReq(`/dsh-tts-api/rvc-files?baseUrl=http://127.0.0.1:${mock.port}&kind=pth`), mockRes());
    const filesData = JSON.parse(fr.body);
    check('rvc-files proxy lists pth files', fr.head.code === 200 && Array.isArray(filesData.files) && filesData.files.length > 0 && filesData.files[0].name === 'demo.pth', fr.body);
    const fi = await call(filesRoute, mockReq(`/dsh-tts-api/rvc-files?baseUrl=http://127.0.0.1:${mock.port}&kind=index`), mockRes());
    const filesIdx = JSON.parse(fi.body);
    check('rvc-files proxy lists index files', fi.head.code === 200 && Array.isArray(filesIdx.files) && filesIdx.files.length > 0 && filesIdx.files[0].name === 'demo.index', fi.body);
  } finally {
    mock.server.close();
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
