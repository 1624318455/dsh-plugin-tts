// End-to-end: plugin /speak (provider 'gpt-sovits') -> local api_v2.py /tts
// -> WAV -> /dsh-tts-audio/<id>, including the chunked long-text job.
//
// The upstream is a real Node HTTP server that mimics api_v2.py, so the whole
// chain is exercised without Python, a gateway process or a GPU model. The
// point of this suite is that the plugin speaks the engine's NATIVE protocol:
// no /v1/audio/speech hop, no OpenAI-shaped fields anywhere.
//
//   node tests/e2e-gpt-sovits.mjs
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// CAL_DIR is captured when lib/index.mjs is evaluated, so isolate it first.
const HOME = mkdtempSync(path.join(os.tmpdir(), 'dsh-gsv-e2e-home-'));
process.env.DSH_TTS_HOME = HOME;
const plugin = await import('../lib/index.mjs');

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS  ' + name + (extra ? ' — ' + String(extra).slice(0, 160) : '')); }
  else { fail++; failures.push(name); console.log('FAIL  ' + name + (extra ? ' — ' + String(extra).slice(0, 300) : '')); }
}

function wavBytes(seconds = 1, rate = 16000) {
  const dataLen = Math.floor(rate * seconds) * 2;
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
      if (name === 'webServer') return { register(route) { routes.push(route); return () => {}; } };
      return undefined;
    },
    effect(fn) { fn?.(); },
    on() { return () => {}; }
  };
}
function mockReq(url, body) {
  const chunks = body === undefined ? [] : [Buffer.from(body)];
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

const tmp = mkdtempSync(path.join(os.tmpdir(), 'dsh-gsv-e2e-audio-'));
const refWav = path.join(tmp, 'ref.wav');
writeFileSync(refWav, WAV);

const calls = [];
const upstream = createServer((req, res) => {
  if (req.method === 'POST' && (req.url || '').startsWith('/tts')) {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(raw); } catch (e) { body = null; }
      calls.push({ url: req.url, body });
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': WAV.length });
      res.end(WAV);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

try {
  plugin.apply(fakeCtx());
  const speakRoute = routes.find(r => r.kind === 'exact' && r.path === '/dsh-tts-api/speak');
  const testRoute = routes.find(r => r.kind === 'exact' && r.path === '/dsh-tts-api/gsv-test');
  const audioRoute = routes.find(r => r.kind === 'prefix' && r.path === '/dsh-tts-audio');
  check('routes registered', !!speakRoute && !!testRoute && !!audioRoute);

  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  const baseUrl = 'http://127.0.0.1:' + upstream.address().port;
  const custom = {
    baseUrl,
    refAudio: refWav,
    promptText: '这是参考音频的文字',
    promptLang: 'zh',
    textLang: 'auto',
    mediaType: 'wav',
    speed: 1,
    splitMethod: 'auto',
    extraBody: '{"top_k":9}'
  };

  // --- short text: single URL, real wav bytes through the audio route ----
  const r1 = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
    text: '你好，这是一次端到端测试。', voice: 'default', provider: 'gpt-sovits', custom
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
    const last = calls[calls.length - 1];
    check('upstream received the native /tts payload',
      !!last && last.url.startsWith('/tts') && last.body.text.includes('端到端') &&
      last.body.ref_audio_path === refWav && last.body.prompt_text === '这是参考音频的文字' &&
      last.body.text_lang === 'auto' && last.body.media_type === 'wav',
      JSON.stringify(last && last.body).slice(0, 240));
    check('advanced params reach the engine directly (no gateway mapping)',
      last && last.body.top_k === 9 && last.body.speed_factor === 1,
      JSON.stringify(last && { top_k: last.body.top_k, speed_factor: last.body.speed_factor }));
    check('no OpenAI-shaped field reaches the engine',
      last && !('input' in last.body) && !('model' in last.body) && !('response_format' in last.body));
  }

  // --- long text: chunked job (fastFirst returns chunk 0 immediately) ----
  const longText = '这是一段用来触发分块播放的较长文本。'.repeat(20);
  const r2 = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
    text: longText, voice: 'default', provider: 'gpt-sovits',
    custom: Object.assign({}, custom, { extraBody: '' })
  })), mockRes());
  const d2 = JSON.parse(r2.body);
  check('long text returns a chunked job',
    r2.head.code === 200 && !!d2.jobId && Array.isArray(d2.chunks) && d2.total > 1,
    JSON.stringify({ jobId: d2.jobId, total: d2.total, chunks: (d2.chunks || []).length }).slice(0, 160));

  // --- one-shot settings probe -------------------------------------------
  const r3 = await call(testRoute, mockReq('/dsh-tts-api/gsv-test', JSON.stringify({ custom })), mockRes());
  const d3 = JSON.parse(r3.body);
  check('gsv-test reports latency + bytes over the same /tts',
    r3.head.code === 200 && d3.ok === true && d3.bytes > 1000 && d3.ms >= 0, r3.body.slice(0, 160));

  // --- 200 + JSON must NOT be written as audio ---------------------------
  const badUpstream = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'ref audio invalid' }));
  });
  await new Promise(r => badUpstream.listen(0, '127.0.0.1', r));
  const badUrl = 'http://127.0.0.1:' + badUpstream.address().port;
  try {
    const r4 = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
      text: '短句。', voice: 'default', provider: 'gpt-sovits',
      custom: Object.assign({}, custom, { baseUrl: badUrl, extraBody: '' })
    })), mockRes());
    const d4 = JSON.parse(r4.body);
    check('upstream JSON-instead-of-audio surfaces as a readable error',
      r4.head.code === 500 && /音频|JSON/.test(d4.error || '') && d4.i18n?.code === 'host.gsvNoAudio',
      r4.body.slice(0, 200));
  } finally {
    badUpstream.close();
  }
} catch (e) {
  fail++;
  failures.push('unexpected: ' + (e && e.message));
  console.error('UNEXPECTED', e);
} finally {
  upstream.close();
  try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  try { rmSync(HOME, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('failures: ' + failures.join(' | ')); process.exit(1); }
