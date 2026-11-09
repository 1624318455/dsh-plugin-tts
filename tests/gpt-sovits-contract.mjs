// GPT-SoVITS provider contract suite.
//
// The provider talks to a LOCAL api_v2.py /tts endpoint directly — no
// OpenAI-shaped gateway, no API key. This suite drives the real /speak route
// against a controllable mock /tts so every branch (bad params, 200 + JSON,
// tiny/unknown audio, unreachable service, missing reference audio) is
// deterministic: no network, no GPU, no real engine.
//
// Host settings are isolated with DSH_TTS_HOME, so the real
// ~/.dsh/tts-rvc/settings.json is never touched. The env var must be set
// BEFORE lib/index.mjs is imported (CAL_DIR is captured at import time).
//
//   node tests/gpt-sovits-contract.mjs
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = mkdtempSync(path.join(os.tmpdir(), 'dsh-gsv-contract-'));
process.env.DSH_TTS_HOME = HOME;
const plugin = await import('../lib/index.mjs');
const T = plugin.__test;
const clientSrc = readFileSync(path.join(HERE, '..', 'lib', 'client.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else {
    fail++; failures.push(name);
    console.log('FAIL  ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 300) : ''));
  }
}
function group(title) { console.log('\n--- ' + title + ' ---'); }

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
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
const MP3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(2000)]);
const OGG = Buffer.concat([Buffer.from('OggS', 'ascii'), Buffer.alloc(2000)]);
const AAC = Buffer.concat([Buffer.from([0xff, 0xf1, 0x50, 0x80]), Buffer.alloc(2000)]);
const TINY = wavBytes(0.003);
const GARBAGE = Buffer.alloc(2048, 0x41);

/** Mock api_v2.py: POST /tts -> audio bytes (or a scripted failure). */
function makeUpstream() {
  const state = { mode: 'wav', calls: [] };
  const server = createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];
    const send = (code, ctype, buf) => {
      res.writeHead(code, { 'Content-Type': ctype, 'Content-Length': buf.length });
      res.end(buf);
    };
    if (req.method === 'POST' && /\/tts$/i.test(url)) {
      let raw = '';
      for await (const c of req) raw += c;
      let body = null;
      try { body = JSON.parse(raw); } catch (e) { body = null; }
      state.calls.push({ url, body, raw, headers: { ...req.headers } });
      const m = state.mode;
      if (m === 'wav') return send(200, 'audio/wav', WAV);
      if (m === 'mp3') return send(200, 'audio/mpeg', MP3);
      if (m === 'ogg') return send(200, 'audio/ogg', OGG);
      if (m === 'aac') return send(200, 'audio/aac', AAC);
      if (m === 'tiny') return send(200, 'audio/wav', TINY);
      if (m === 'garbage') return send(200, 'application/octet-stream', GARBAGE);
      if (m === 'json200') return send(200, 'application/json', Buffer.from('{"detail":"ref audio invalid"}'));
      if (m === 'textjson') return send(200, 'text/plain', Buffer.from('{ "error": "pretty json failure" }'));
      if (m === '400') return send(400, 'application/json', Buffer.from('{"detail":"media_type not supported"}'));
      if (m === '500') return send(500, 'text/plain', Buffer.from('engine crashed'));
      return send(200, 'audio/wav', WAV);
    }
    // api_v2.py has no /health; any response here still proves it is alive.
    res.writeHead(404); res.end('not found');
  });
  return { server, state };
}

// ---------------------------------------------------------------------------
// route harness (same shape as smoke.mjs)
// ---------------------------------------------------------------------------
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
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  return {
    url,
    headers: {},
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
    json() { try { return JSON.parse(this.body); } catch (e) { return null; } },
    raw() { return Buffer.concat(parts); },
    writeHead(code, headers) { head.code = code; Object.assign(head.headers, headers || {}); this.headersSent = true; },
    setHeader(k, v) { head.headers[k] = v; },
    end(chunk) { if (chunk) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); }
  };
}
async function hit(route, url, body) {
  const res = mockRes();
  await route.handler(mockReq(url, body), res);
  return res;
}
function route(kind, p) { return routes.find(r => r.kind === kind && r.path === p); }
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// A. pure helpers
// ---------------------------------------------------------------------------
group('A. native /tts helpers');
check('gsvTtsUrl appends /tts',
  T.gsvTtsUrl('http://127.0.0.1:9880') === 'http://127.0.0.1:9880/tts');
check('gsvTtsUrl strips trailing slashes',
  T.gsvTtsUrl('http://h:1///') === 'http://h:1/tts');
check('gsvTtsUrl keeps a full /tts endpoint',
  T.gsvTtsUrl('http://h:1/tts/') === 'http://h:1/tts');
check('gsvTtsUrl falls back to the default host',
  T.gsvTtsUrl('') === 'http://127.0.0.1:9880/tts');

const c0 = T.gsvConfig(null);
check('gsvConfig native defaults',
  c0.baseUrl === 'http://127.0.0.1:9880' && c0.mediaType === 'wav' &&
  c0.textLang === 'auto' && c0.promptLang === 'zh' && c0.speed === 1 &&
  c0.splitMethod === 'auto' && c0.refAudio === '', JSON.stringify(c0));
const c1 = T.gsvConfig({
  baseUrl: 'http://127.0.0.1:9881/', mediaType: 'MP3', textLang: 'wat',
  promptLang: 'auto', speed: 99, splitMethod: 'cut9',
  refAudio: ' D:/refs/a.wav ', promptText: 'x'.repeat(3000)
});
check('gsvConfig clamps bad engine params',
  c1.baseUrl === 'http://127.0.0.1:9881' && c1.mediaType === 'wav' &&
  c1.textLang === 'auto' && c1.promptLang === 'zh' && c1.speed === 4 &&
  c1.splitMethod === 'auto' && c1.refAudio === 'D:/refs/a.wav' &&
  c1.promptText.length === 2000, JSON.stringify(c1));
check('pickGsvSplitMethod: single sentence -> cut0',
  T.pickGsvSplitMethod('你好。', 'auto') === 'cut0');
check('pickGsvSplitMethod: several sentences -> cut1',
  T.pickGsvSplitMethod('你好。今天天气不错。再见！', 'auto') === 'cut1');
check('pickGsvSplitMethod: >120 chars -> cut5',
  T.pickGsvSplitMethod('甲'.repeat(130), 'auto') === 'cut5');
check('pickGsvSplitMethod: forced value wins',
  T.pickGsvSplitMethod('你好。', 'cut3') === 'cut3');
let badExtra = null;
try { T.parseGsvExtraBody('{oops'); } catch (e) { badExtra = e; }
check('parseGsvExtraBody rejects bad JSON with host.gsvBadExtra',
  badExtra && badExtra.i18n?.code === 'host.gsvBadExtra');
let arrExtra = null;
try { T.parseGsvExtraBody('[1,2]'); } catch (e) { arrExtra = e; }
check('parseGsvExtraBody rejects arrays',
  arrExtra && arrExtra.i18n?.code === 'host.gsvBadExtra');
check('parseGsvExtraBody keeps an object',
  T.parseGsvExtraBody('{"top_k":9}').top_k === 9);

// ---------------------------------------------------------------------------
// B. layered Host settings (only baseUrl is service-class)
// ---------------------------------------------------------------------------
group('B. Host settings');
T.saveHostGsvSettings({ baseUrl: 'http://h:9///', apiKey: 'should-not-persist' });
let st = T.loadHostGsvSettings();
check('baseUrl persisted, trailing slash trimmed', st.baseUrl === 'http://h:9', JSON.stringify(st));
check('no credential is ever stored for a local engine',
  st.apiKey === undefined && !JSON.stringify(st).includes('should-not-persist'), JSON.stringify(st));
T.saveHostGsvSettings({ baseUrl: '' });
check('empty baseUrl clears the stored address',
  T.loadHostGsvSettings().baseUrl === undefined, JSON.stringify(T.loadHostGsvSettings()));
T.saveHostGsvSettings({ baseUrl: 'http://recovered:1' });
check('save recovers after a cleared address',
  T.loadHostGsvSettings().baseUrl === 'http://recovered:1');

// ---------------------------------------------------------------------------
// C. routes
// ---------------------------------------------------------------------------
group('C. routes');
plugin.apply(fakeCtx());
const configGet = route('exact', '/dsh-tts-api/gsv-config');
const configSave = route('exact', '/dsh-tts-api/gsv-config-save');
const testRoute = route('exact', '/dsh-tts-api/gsv-test');
const speakRoute = route('exact', '/dsh-tts-api/speak');
const audioRoute = route('prefix', '/dsh-tts-audio');
check('gsv + speak + audio routes registered',
  !!configGet && !!configSave && !!testRoute && !!speakRoute && !!audioRoute);
check('no legacy openai-* route remains',
  !routes.some(r => /openai/.test(r.path || '')), routes.filter(r => /openai/.test(r.path || '')).map(r => r.path).join(','));

const up = makeUpstream();
await new Promise(r => up.server.listen(0, '127.0.0.1', r));
const UP = 'http://127.0.0.1:' + up.server.address().port;
const CUSTOM = () => ({
  baseUrl: UP,
  refAudio: 'D:/refs/voice.wav',
  promptText: '参考音频里说的那句话',
  promptLang: 'zh',
  textLang: 'auto',
  mediaType: 'wav',
  speed: 1,
  splitMethod: 'auto',
  extraBody: ''
});

T.saveHostGsvSettings({ baseUrl: '' });
let r = await hit(configGet, '/dsh-tts-api/gsv-config');
check('GET config defaults the service address',
  r.head.code === 200 && r.json().gsv.baseUrl === 'http://127.0.0.1:9880', r.body.slice(0, 160));
r = await hit(configSave, '/dsh-tts-api/gsv-config-save', { gsv: { baseUrl: 'ftp://bad' } });
check('non-http service address rejected', r.head.code === 400, r.body.slice(0, 160));
r = await hit(configSave, '/dsh-tts-api/gsv-config-save', { gsv: { baseUrl: UP + '/' } });
check('save trims and echoes the address',
  r.head.code === 200 && r.json().ok === true && r.json().gsv.baseUrl === UP, r.body.slice(0, 200));
r = await hit(configGet, '/dsh-tts-api/gsv-config');
check('GET config reflects the saved address', r.json().gsv.baseUrl === UP, r.body.slice(0, 160));

// ---------------------------------------------------------------------------
// D. /speak against mock /tts
// ---------------------------------------------------------------------------
group('D. /speak');
T.saveHostGsvSettings({ baseUrl: UP });
async function speak(text, custom, patch) {
  return hit(speakRoute, '/dsh-tts-api/speak', {
    text, voice: 'zh-CN-XiaoxuanNeural', provider: 'gpt-sovits',
    custom: Object.assign(CUSTOM(), patch || {}, custom || {})
  });
}
up.state.mode = 'wav';
let sp = await speak('第一段短句，用来验证单段返回。');
let body = sp.json();
check('short text -> single url', sp.head.code === 200 && typeof body.url === 'string', sp.body.slice(0, 200));
const firstUrl = body.url;
if (firstUrl) {
  const id = firstUrl.split('/').pop();
  const audio = await hit(audioRoute, '/dsh-tts-audio/' + id);
  check('audio route serves RIFF as audio/wav',
    audio.head.code === 200 && audio.raw().slice(0, 4).toString('ascii') === 'RIFF' &&
    audio.head.headers['Content-Type'] === 'audio/wav',
    audio.head.headers['Content-Type'] + ' ' + audio.raw().length + 'B');
}
const last = up.state.calls[up.state.calls.length - 1];
check('payload uses GPT-SoVITS native field names',
  !!last && last.body.text === '第一段短句，用来验证单段返回。' &&
  last.body.ref_audio_path === 'D:/refs/voice.wav' &&
  last.body.prompt_text === '参考音频里说的那句话' &&
  last.body.prompt_lang === 'zh' && last.body.text_lang === 'auto' &&
  last.body.media_type === 'wav' && last.body.speed_factor === 1 &&
  last.body.text_split_method === 'cut0' && last.body.top_k === 15,
  JSON.stringify(last && last.body).slice(0, 260));
check('payload carries no OpenAI-shaped fields',
  !!last && !('model' in last.body) && !('input' in last.body) &&
  !('voice' in last.body) && !('response_format' in last.body), JSON.stringify(last && last.body).slice(0, 200));
check('no Authorization header is sent to a local engine',
  !!last && !last.headers.authorization, JSON.stringify(last && last.headers).slice(0, 160));

const cached = await speak('第一段短句，用来验证单段返回。');
check('identical request hits the cache', cached.json().cached === true && cached.json().url === firstUrl,
  cached.body.slice(0, 160));
await speak('第二段，用来验证高级参数覆盖。', { extraBody: '{"top_k":9,"repetition_penalty":1.1}' });
const overridden = up.state.calls[up.state.calls.length - 1];
check('extraBody is flattened into the /tts payload',
  overridden.body.top_k === 9 && overridden.body.repetition_penalty === 1.1 &&
  overridden.body.text === '第二段，用来验证高级参数覆盖。', JSON.stringify(overridden.body).slice(0, 240));

// failure branches
const before = up.state.calls.length;
const noRef = await speak('缺少参考音频。', { refAudio: '' });
check('missing reference audio fails before any request',
  noRef.head.code === 500 && noRef.json().i18n?.code === 'host.gsvNoRefAudio' &&
  up.state.calls.length === before, noRef.body.slice(0, 200));
const badJson = await speak('非法高级参数。', { extraBody: 'not json' });
check('bad extraBody fails before any request',
  badJson.head.code === 500 && badJson.json().i18n?.code === 'host.gsvBadExtra' &&
  up.state.calls.length === before, badJson.body.slice(0, 200));

for (const [mode, code, re] of [
  ['400', 'host.gsvBadRequest', /拒绝请求/],
  ['500', 'host.gsvHttpFail', /合成失败/],
  ['json200', 'host.gsvNoAudio', /JSON/],
  ['textjson', 'host.gsvNoAudio', /JSON/],
  ['tiny', 'host.gsvNoAudio', /过小/],
  ['garbage', 'host.gsvNoAudio', /不是可识别的音频/]
]) {
  up.state.mode = mode;
  const res = await speak('错误分支 ' + mode + ' 的文本。');
  const j = res.json();
  check(`${mode} -> ${code}`, res.head.code === 500 && j.i18n?.code === code && re.test(j.error),
    res.body.slice(0, 220));
}
up.state.mode = 'wav';
for (const [mode, mime] of [['mp3', 'audio/mpeg'], ['ogg', 'audio/ogg'], ['aac', 'audio/aac']]) {
  up.state.mode = mode;
  const res = await speak('容器嗅探 ' + mode + ' 的文本。');
  const url = res.json().url;
  if (url) {
    const audio = await hit(audioRoute, '/dsh-tts-audio/' + url.split('/').pop());
    check(`${mode} bytes are served as ${mime}`, audio.head.headers['Content-Type'] === mime,
      audio.head.headers['Content-Type']);
  } else {
    check(`${mode} bytes are served as ${mime}`, false, res.body.slice(0, 160));
  }
}
up.state.mode = 'wav';

const deadPort = await freePort();
const unreachable = await speak('服务没起来的文本。', { baseUrl: 'http://127.0.0.1:' + deadPort });
check('unreachable api_v2.py -> host.gsvUnreachable with startup hint',
  unreachable.head.code === 500 && unreachable.json().i18n?.code === 'host.gsvUnreachable' &&
  /api_v2\.py/.test(unreachable.json().error), unreachable.body.slice(0, 260));

// one-shot settings probe
r = await hit(testRoute, '/dsh-tts-api/gsv-test', { custom: CUSTOM() });
body = r.json();
check('gsv-test reports ok/ms/bytes/format/split',
  r.head.code === 200 && body.ok === true && body.bytes > 1000 && body.ms >= 0 &&
  body.mediaType === 'wav' && body.splitMethod === 'cut0', r.body.slice(0, 220));

// ---------------------------------------------------------------------------
// E. client source contract: no generic endpoint, no credential UI
// ---------------------------------------------------------------------------
group('E. client source');
check('provider dropdown offers gpt-sovits',
  /\["gpt-sovits",\s*t\("provider\.gsv"\)/.test(clientSrc));
check('no openai-compatible provider id remains', !/openai-compatible/.test(clientSrc));
check('no API key state or field remains in the gsv panel',
  !/shared\.gsv\.apiKey\b/.test(clientSrc) && !/gsv\.key\b/.test(clientSrc));
check('gsv panel reads native fields',
  /t\("gsv\.field\.refAudio"\)/.test(clientSrc) && /t\("gsv\.field\.promptText"\)/.test(clientSrc) &&
  /GSV_SPLIT_METHODS/.test(clientSrc));
check('speak sends the native config as custom',
  /useProvider === "gpt-sovits"[\s\S]{0,300}payload\.custom = Object\.assign\(\{\}, shared\.gsv\)/.test(clientSrc));
check('host error codes are the gsv family',
  /host\.gsvUnreachable/.test(clientSrc) && !/host\.openai/.test(clientSrc));

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------
up.server.close();
try { rmSync(HOME, { recursive: true, force: true }); } catch (e) { /* best effort */ }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('failures:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
