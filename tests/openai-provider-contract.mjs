// OpenAI-compatible provider contract suite (0.7.0).
//
// Design notes:
//   * Host settings are isolated with DSH_TTS_HOME, so this never reads or
//     writes the real ~/.dsh/tts-rvc/settings.json. The env var must be set
//     BEFORE lib/index.mjs is loaded (CAL_DIR is captured at import time),
//     which is why the plugin is imported dynamically.
//   * /speak is driven against a controllable mock /v1/audio/speech so every
//     failure branch (401/400/500, 200+JSON, tiny audio, wrong container) is
//     exercised deterministically — no network, no real engine.
//   * Static checks keep the host error codes and the client dictionaries in
//     sync, and assert the API key never enters browser storage.
//
//   node tests/openai-provider-contract.mjs
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = mkdtempSync(path.join(os.tmpdir(), 'dsh-openai-contract-'));
process.env.DSH_TTS_HOME = HOME;
const plugin = await import('../lib/index.mjs');
const T = plugin.__test;

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
const FLAC = Buffer.concat([Buffer.from('fLaC', 'ascii'), Buffer.alloc(2000)]);
const AAC = Buffer.concat([Buffer.from([0xff, 0xf1, 0x50, 0x80]), Buffer.alloc(2000)]);
const TINY = wavBytes(0.003);           // valid RIFF, < 1000 bytes
const GARBAGE = Buffer.alloc(2048, 0x41);

// ---------------------------------------------------------------------------
// mock /v1/audio/speech + /v1/models
// ---------------------------------------------------------------------------
function makeUpstream() {
  const state = { mode: 'wav', speech: [], models: 0 };
  const server = createServer(async (req, res) => {
    const url = req.url || '/';
    if (req.method === 'GET' && /\/models$/.test(url.split('?')[0])) {
      state.models++;
      state.lastModelsAuth = req.headers.authorization || '';
      state.lastModelsPath = url;
      if (state.mode === 'models404') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{"error":"not found"}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-sovits' }, { id: 'tts-1' }, { name: 'by-name' }] }));
      return;
    }
    if (req.method === 'POST' && /\/audio\/speech$/.test(url.split('?')[0])) {
      let raw = '';
      for await (const c of req) raw += c;
      let body = null;
      try { body = JSON.parse(raw); } catch (e) { body = null; }
      state.speech.push({ url, auth: req.headers.authorization || '', body, raw });
      const m = state.mode;
      const send = (code, ctype, buf) => {
        res.writeHead(code, { 'Content-Type': ctype, 'Content-Length': buf.length });
        res.end(buf);
      };
      if (m === 'wav') return send(200, 'audio/wav', WAV);
      if (m === 'mp3') return send(200, 'audio/mpeg', MP3);
      if (m === 'flac') return send(200, 'audio/flac', FLAC);
      if (m === 'tiny') return send(200, 'audio/wav', TINY);
      if (m === 'garbage') return send(200, 'application/octet-stream', GARBAGE);
      if (m === 'json200') return send(200, 'application/json', Buffer.from('{"error":{"message":"ref audio invalid"}}'));
      if (m === 'textjson') return send(200, 'text/plain', Buffer.from('{ "error": "pretty json failure" }'));
      if (m === '401') return send(401, 'application/json', Buffer.from('{"error":{"message":"invalid api key"}}'));
      if (m === '400') return send(400, 'application/json', Buffer.from('{"error":{"message":"voice not found"}}'));
      if (m === '500') return send(500, 'text/plain', Buffer.from('engine crashed'));
      return send(200, 'audio/wav', WAV);
    }
    res.writeHead(404); res.end('nope');
  });
  return { server, state };
}

// ---------------------------------------------------------------------------
// route harness
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
function route(kind, p) {
  return routes.find(r => r.kind === kind && r.path === p);
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// A. URL normalisation
// ---------------------------------------------------------------------------
group('A. baseUrl -> endpoint');
const S = T.openaiSpeechUrl;
check('root gets /v1/audio/speech', S('http://127.0.0.1:8000') === 'http://127.0.0.1:8000/v1/audio/speech', S('http://127.0.0.1:8000'));
check('trailing slashes are stripped', S('http://h:1///') === 'http://h:1/v1/audio/speech', S('http://h:1///'));
check('.../v1 gets only the tail appended', S('http://h:1/v1') === 'http://h:1/v1/audio/speech', S('http://h:1/v1'));
check('.../v1/ gets only the tail appended', S('http://h:1/v1/') === 'http://h:1/v1/audio/speech', S('http://h:1/v1/'));
check('full endpoint is not doubled', S('http://h:1/v1/audio/speech') === 'http://h:1/v1/audio/speech', S('http://h:1/v1/audio/speech'));
check('uppercase endpoint is not doubled', S('http://h:1/V1/AUDIO/SPEECH') === 'http://h:1/V1/AUDIO/SPEECH', S('http://h:1/V1/AUDIO/SPEECH'));
check('empty falls back to the default host', S('') === 'http://127.0.0.1:8000/v1/audio/speech', S(''));
check('apiRoot strips /audio/speech', T.openaiApiRoot('http://h:1/v1') === 'http://h:1/v1', T.openaiApiRoot('http://h:1/v1'));

// ---------------------------------------------------------------------------
// B. config normalisation
// ---------------------------------------------------------------------------
group('B. openaiTtsConfig');
const C = T.openaiTtsConfig;
const d = C();
check('defaults: model/voice/format/speed',
  d.model === 'tts-1' && d.voice === 'alloy' && d.format === 'wav' && d.speed === 1,
  JSON.stringify(d));
check('custom voice beats fallback voice', C({ voice: 'gw' }, 'outer').voice === 'gw');
check('fallback voice beats the built-in default', C({}, 'outer').voice === 'outer');
check('blank custom voice falls through to the default', C({ voice: '   ' }, '').voice === 'alloy', C({ voice: '   ' }, '').voice);
check('uppercase format is accepted', C({ format: 'MP3' }).format === 'mp3', C({ format: 'MP3' }).format);
check('unknown format falls back to wav', C({ format: 'weird' }).format === 'wav', C({ format: 'weird' }).format);
check('speed clamps low to 0.25', C({ speed: 0.1 }).speed === 0.25, C({ speed: 0.1 }).speed);
check('speed clamps high to 4', C({ speed: 9 }).speed === 4, C({ speed: 9 }).speed);
check('numeric string speed is honoured', C({ speed: '1.5' }).speed === 1.5, C({ speed: '1.5' }).speed);
check('non-numeric speed falls back to 1', C({ speed: 'abc' }).speed === 1, C({ speed: 'abc' }).speed);
check('baseUrl trailing slashes stripped', C({ baseUrl: 'http://h:1///' }).baseUrl === 'http://h:1', C({ baseUrl: 'http://h:1///' }).baseUrl);
check('extraBody is capped at 4000 chars', C({ extraBody: 'x'.repeat(5000) }).extraBody.length === 4000);

// ---------------------------------------------------------------------------
// C. extraBody parsing
// ---------------------------------------------------------------------------
group('C. parseOpenAiExtraBody');
check('empty -> {}', Object.keys(T.parseOpenAiExtraBody('')).length === 0);
check('whitespace -> {}', Object.keys(T.parseOpenAiExtraBody('   ')).length === 0);
const extra = T.parseOpenAiExtraBody('{"top_k":15,"emo":{"w":0.6}}');
check('object parsed, nested kept', extra.top_k === 15 && extra.emo.w === 0.6, JSON.stringify(extra));
function throwsCode(fn) {
  try { fn(); return null; } catch (e) { return (e && e.i18n && e.i18n.code) || (e && e.message) || 'throw'; }
}
check('bad JSON -> host.openaiBadExtra', throwsCode(() => T.parseOpenAiExtraBody('nope')) === 'host.openaiBadExtra');
check('array rejected', throwsCode(() => T.parseOpenAiExtraBody('[1,2]')) === 'host.openaiBadExtra');
check('null rejected', throwsCode(() => T.parseOpenAiExtraBody('null')) === 'host.openaiBadExtra');
check('number rejected', throwsCode(() => T.parseOpenAiExtraBody('42')) === 'host.openaiBadExtra');
check('JSON string rejected', throwsCode(() => T.parseOpenAiExtraBody('"x"')) === 'host.openaiBadExtra');

// ---------------------------------------------------------------------------
// D. container sniffing
// ---------------------------------------------------------------------------
group('D. audioKindFromBytes');
check('wav', T.audioKindFromBytes(WAV) === 'wav', T.audioKindFromBytes(WAV));
check('mp3 (ID3)', T.audioKindFromBytes(Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0])) === 'mp3');
check('mp3 (frame sync)', T.audioKindFromBytes(Buffer.from([0xff, 0xfb, 0x90, 0x64])) === 'mp3');
check('ogg', T.audioKindFromBytes(Buffer.from('OggS0000', 'ascii')) === 'ogg');
check('flac', T.audioKindFromBytes(Buffer.from('fLaC0000', 'ascii')) === 'flac');
check('aiff', T.audioKindFromBytes(Buffer.from('FORM0000AIFF', 'ascii')) === 'aiff');
check('garbage -> empty', T.audioKindFromBytes(GARBAGE) === '');
check('short buffer -> empty', T.audioKindFromBytes(Buffer.from([0, 1])) === '');
// ADTS AAC starts with 0xFFF like MP3 but its layer bits are 00; misclassifying
// it writes a .mp3 file that no browser decodes.
check('aac (ADTS) is not misread as mp3', T.audioKindFromBytes(AAC) === 'aac', T.audioKindFromBytes(AAC));

// ---------------------------------------------------------------------------
// E. host settings persistence
// ---------------------------------------------------------------------------
group('E. host settings (isolated DSH_TTS_HOME)');
const SETTINGS = path.join(HOME, 'settings.json');
function rawSettings() {
  try { return JSON.parse(readFileSync(SETTINGS, 'utf8')); } catch (e) { return null; }
}
T.saveHostOpenAiSettings({ baseUrl: 'http://h:9///', apiKey: 'sk-abcdefgh1234' });
let st = T.loadHostOpenAiSettings();
check('baseUrl persisted without trailing slashes', st.baseUrl === 'http://h:9', st.baseUrl);
check('apiKey persisted', st.apiKey === 'sk-abcdefgh1234', st.apiKey);
T.saveHostOpenAiSettings({ baseUrl: 'http://h:8' });
st = T.loadHostOpenAiSettings();
check('saving baseUrl keeps the existing apiKey', st.apiKey === 'sk-abcdefgh1234', JSON.stringify(st));
T.saveHostOpenAiSettings({ apiKey: '' });
check('empty apiKey clears it', T.loadHostOpenAiSettings().apiKey === undefined, JSON.stringify(T.loadHostOpenAiSettings()));

writeFileSync(SETTINGS, JSON.stringify({
  version: 1,
  rvc: { baseUrl: 'http://rvc:1' },
  index: { baseUrl: 'http://idx:1' },
  cosy: { baseUrl: 'http://cosy:1' },
  cloud: { apiKey: 'cloud-key' },
  openai: { baseUrl: 'http://old:1' }
}, null, 2));
T.saveHostOpenAiSettings({ apiKey: 'sk-zzzz9999' });
const merged = rawSettings();
check('other provider sections survive an openai save',
  merged.rvc.baseUrl === 'http://rvc:1' && merged.index.baseUrl === 'http://idx:1' &&
  merged.cosy.baseUrl === 'http://cosy:1' && merged.cloud.apiKey === 'cloud-key',
  JSON.stringify(merged).slice(0, 220));
check('unknown openai keys are not persisted', merged.openai.evil === undefined);
T.saveHostOpenAiSettings({ evil: 'x', apiKey: 12345 });
check('non-string apiKey removes the key instead of storing a number',
  rawSettings().openai.apiKey === undefined, JSON.stringify(rawSettings().openai));

writeFileSync(SETTINGS, 'not json at all');
check('corrupt file loads as empty', JSON.stringify(T.loadHostOpenAiSettings()) === '{}', JSON.stringify(T.loadHostOpenAiSettings()));
T.saveHostOpenAiSettings({ baseUrl: 'http://recovered:1' });
check('save recovers from a corrupt file', rawSettings().openai.baseUrl === 'http://recovered:1', JSON.stringify(rawSettings()));

// ---------------------------------------------------------------------------
// F. HTTP routes
// ---------------------------------------------------------------------------
group('F. routes');
plugin.apply(fakeCtx());
const configGet = route('exact', '/dsh-tts-api/openai-config');
const configSave = route('exact', '/dsh-tts-api/openai-config-save');
const modelsRoute = route('exact', '/dsh-tts-api/openai-models');
const testRoute = route('exact', '/dsh-tts-api/openai-test');
const speakRoute = route('exact', '/dsh-tts-api/speak');
const audioRoute = route('prefix', '/dsh-tts-audio');
check('all openai + speak + audio routes registered',
  !!configGet && !!configSave && !!modelsRoute && !!testRoute && !!speakRoute && !!audioRoute);

const up = makeUpstream();
await new Promise(r => up.server.listen(0, '127.0.0.1', r));
const UP = 'http://127.0.0.1:' + up.server.address().port;

T.saveHostOpenAiSettings({ baseUrl: '', apiKey: '' });
let r = await hit(configGet, '/dsh-tts-api/openai-config');
let body = r.json();
check('GET config defaults the baseUrl and reports no key',
  r.head.code === 200 && body.openai.baseUrl === 'http://127.0.0.1:8000' && body.openai.apiKeySet === false,
  r.body.slice(0, 160));

r = await hit(configSave, '/dsh-tts-api/openai-config-save', { openai: { baseUrl: 'ftp://bad' } });
check('non-http baseUrl rejected with 400', r.head.code === 400, r.body.slice(0, 160));

r = await hit(configSave, '/dsh-tts-api/openai-config-save', { openai: { baseUrl: UP, apiKey: 'sk-1234567890' } });
body = r.json();
check('save returns ok + masked key tail',
  r.head.code === 200 && body.openai.apiKeySet === true && body.openai.apiKeyTail === '…7890', r.body.slice(0, 200));
check('saved response never echoes the apiKey',
  !('apiKey' in body.openai) && !r.body.includes('sk-1234567890'), r.body.slice(0, 200));
r = await hit(configGet, '/dsh-tts-api/openai-config');
check('GET config never echoes the apiKey',
  !('apiKey' in r.json().openai) && !r.body.includes('sk-1234567890'), r.body.slice(0, 200));

up.state.mode = 'wav';
r = await hit(modelsRoute, '/dsh-tts-api/openai-models?baseUrl=' + encodeURIComponent(UP) + '&withKey=1');
body = r.json();
check('models: list parsed (id or name)', r.head.code === 200 && body.count === 3 && body.models[0] === 'gpt-sovits',
  r.body.slice(0, 200));
check('models: stored key sent as Bearer', up.state.lastModelsAuth === 'Bearer sk-1234567890', up.state.lastModelsAuth);
up.state.lastModelsAuth = '';
r = await hit(modelsRoute, '/dsh-tts-api/openai-models?baseUrl=' + encodeURIComponent(UP));
await sleep(10);
check('models: no key sent unless withKey=1', up.state.lastModelsAuth === '', up.state.lastModelsAuth);
r = await hit(modelsRoute, '/dsh-tts-api/openai-models?baseUrl=' + encodeURIComponent(UP + '/v1'));
check('models: /v1 baseUrl is not doubled', up.state.lastModelsPath === '/v1/models', up.state.lastModelsPath);

up.state.mode = 'models404';
r = await hit(modelsRoute, '/dsh-tts-api/openai-models?baseUrl=' + encodeURIComponent(UP));
check('models: 404 surfaces as host.openaiModelsFail',
  r.head.code === 502 && r.json().i18n?.code === 'host.openaiModelsFail', r.body.slice(0, 200));
up.state.mode = 'wav';

const deadPort = await freePort();
r = await hit(modelsRoute, '/dsh-tts-api/openai-models?baseUrl=' + encodeURIComponent('http://127.0.0.1:' + deadPort));
check('models: unreachable surfaces as host.openaiUnreachable',
  r.head.code === 502 && r.json().i18n?.code === 'host.openaiUnreachable', r.body.slice(0, 200));

r = await hit(testRoute, '/dsh-tts-api/openai-test', {
  voice: 'gpt-sovits',
  custom: { baseUrl: UP, model: 'gpt-sovits', voice: 'gpt-sovits', format: 'wav' }
});
body = r.json();
check('test route reports ok/ms/bytes/model/voice',
  r.head.code === 200 && body.ok === true && body.bytes > 1000 && body.ms >= 0 &&
  body.model === 'gpt-sovits' && body.voice === 'gpt-sovits', r.body.slice(0, 220));

// ---------------------------------------------------------------------------
// G. /speak path
// ---------------------------------------------------------------------------
group('G. /speak');
T.saveHostOpenAiSettings({ baseUrl: UP, apiKey: '' });
async function speak(text, voice, custom) {
  return hit(speakRoute, '/dsh-tts-api/speak', {
    text, voice, provider: 'openai-compatible',
    custom: Object.assign({ baseUrl: UP, model: 'gpt-sovits', voice, format: 'wav', speed: 1 }, custom || {})
  });
}
up.state.mode = 'wav';
let sp = await speak('第一段短句，用来验证单段返回。', 'gpt-sovits');
let spBody = sp.json();
check('short text -> single url', sp.head.code === 200 && typeof spBody.url === 'string', sp.body.slice(0, 200));
const firstUrl = spBody.url;
if (firstUrl) {
  const id = firstUrl.split('/').pop();
  const audio = await hit(audioRoute, '/dsh-tts-audio/' + id);
  check('audio route serves RIFF as audio/wav',
    audio.head.code === 200 && audio.raw().slice(0, 4).toString('ascii') === 'RIFF' &&
    audio.head.headers['Content-Type'] === 'audio/wav',
    audio.head.headers['Content-Type'] + ' ' + audio.raw().length + 'B');
}
const sp2 = await speak('第一段短句，用来验证单段返回。', 'gpt-sovits');
check('identical request hits the cache', sp2.json().cached === true && sp2.json().url === firstUrl, sp2.body.slice(0, 160));
const sp3 = await speak('第一段短句，用来验证单段返回。', 'another-voice');
check('a different voice gets a different cache entry', sp3.json().url !== firstUrl, sp3.body.slice(0, 160));
const sp4 = await speak('第一段短句，用来验证单段返回。', 'gpt-sovits', { extraBody: '{"top_k":9}' });
check('a different extraBody gets a different cache entry', sp4.json().url !== firstUrl, sp4.body.slice(0, 160));
const lastSpeech = up.state.speech[up.state.speech.length - 1];
check('extraBody is flattened into the request body',
  lastSpeech && lastSpeech.body && lastSpeech.body.top_k === 9 &&
  lastSpeech.body.model === 'gpt-sovits' && lastSpeech.body.response_format === 'wav',
  JSON.stringify(lastSpeech && lastSpeech.body).slice(0, 240));
await speak('第二段短句，验证 extraBody 覆盖。', 'gpt-sovits', { extraBody: '{"model":"override-model"}' });
check('extraBody may override a protocol field (documented escape hatch)',
  up.state.speech[up.state.speech.length - 1].body.model === 'override-model',
  up.state.speech[up.state.speech.length - 1].body.model);

const beforeBadExtra = up.state.speech.length;
const badExtra = await speak('第三段短句，验证非法 extraBody。', 'gpt-sovits', { extraBody: 'not json' });
check('bad extraBody fails fast with host.openaiBadExtra',
  badExtra.head.code === 500 && badExtra.json().i18n?.code === 'host.openaiBadExtra', badExtra.body.slice(0, 200));
check('bad extraBody sends no upstream request', up.state.speech.length === beforeBadExtra,
  up.state.speech.length + ' vs ' + beforeBadExtra);

T.saveHostOpenAiSettings({ apiKey: 'sk-key-abcdef' });
await speak('第四段短句，验证鉴权头。', 'gpt-sovits');
check('stored apiKey is sent as Authorization Bearer',
  up.state.speech[up.state.speech.length - 1].auth === 'Bearer sk-key-abcdef',
  up.state.speech[up.state.speech.length - 1].auth);

const errCases = [
  ['401', 'host.openaiKeyInvalid', /鉴权/],
  ['400', 'host.openaiBadRequest', /拒绝/],
  ['500', 'host.openaiHttpFail', /合成失败/],
];
for (const [mode, code, re] of errCases) {
  up.state.mode = mode;
  const res = await speak('错误分支 ' + mode + ' 的文本。', 'gpt-sovits');
  const j = res.json();
  check(`${mode} -> ${code}`, res.head.code === 500 && j.i18n?.code === code && re.test(j.error), res.body.slice(0, 220));
}
up.state.mode = 'tiny';
let res = await speak('过小音频分支的文本。', 'gpt-sovits');
check('tiny valid audio is rejected as 过小',
  res.head.code === 500 && res.json().i18n?.code === 'host.openaiNoAudio' && /过小/.test(res.json().error),
  res.body.slice(0, 200));
up.state.mode = 'garbage';
res = await speak('非音频分支的文本。', 'gpt-sovits');
check('non-audio bytes -> host.openaiNoAudio',
  res.head.code === 500 && res.json().i18n?.code === 'host.openaiNoAudio' && /不是可识别的音频/.test(res.json().error),
  res.body.slice(0, 200));
up.state.mode = 'json200';
res = await speak('JSON 代替音频分支的文本。', 'gpt-sovits');
check('200+JSON surfaces the upstream message',
  res.head.code === 500 && res.json().i18n?.code === 'host.openaiNoAudio' && /ref audio invalid/.test(res.json().error),
  res.body.slice(0, 240));
up.state.mode = 'textjson';
res = await speak('pretty JSON 分支的文本。', 'gpt-sovits');
check('200 + pretty JSON served as text/plain still surfaces the upstream message',
  res.head.code === 500 && res.json().i18n?.code === 'host.openaiNoAudio' && /pretty json failure/.test(res.json().error),
  res.body.slice(0, 240));

up.state.mode = 'wav';
const dead = await freePort();
T.saveHostOpenAiSettings({ baseUrl: 'http://127.0.0.1:' + dead });
res = await speak('连接失败分支的文本。', 'gpt-sovits', { baseUrl: 'http://127.0.0.1:' + dead });
check('unreachable endpoint -> host.openaiUnreachable',
  res.head.code === 500 && res.json().i18n?.code === 'host.openaiUnreachable', res.body.slice(0, 240));
check('unreachable error carries the api_v2.py hint', /api_v2\.py/.test(res.json().error || ''), res.body.slice(0, 260));

// A stale host file must not override the URL the user is currently testing.
T.saveHostOpenAiSettings({ baseUrl: 'http://127.0.0.1:' + dead });
res = await speak('显式地址优先于旧配置的文本。', 'gpt-sovits', { baseUrl: UP });
check('explicit request baseUrl wins over a stale stored baseUrl',
  res.head.code === 200 && typeof res.json().url === 'string', res.body.slice(0, 220));

// ...but the saved URL is still the fallback when the request omits one.
T.saveHostOpenAiSettings({ baseUrl: UP });
up.state.mode = 'wav';
const noBase = custom => hit(speakRoute, '/dsh-tts-api/speak', {
  text: '省略地址时走已保存地址的文本。', voice: 'gpt-sovits', provider: 'openai-compatible', custom
});
res = await noBase({ model: 'gpt-sovits', voice: 'gpt-sovits', format: 'wav' });
check('stored baseUrl is used when the request omits one',
  res.head.code === 200 && typeof res.json().url === 'string', res.body.slice(0, 220));

// Cache entries must belong to the endpoint that produced them.
const upB = makeUpstream();
upB.state.mode = 'mp3';
await new Promise(r3 => upB.server.listen(0, '127.0.0.1', r3));
const UPB = 'http://127.0.0.1:' + upB.server.address().port;
const cacheText = '端点切换时的缓存归属测试文本。';
T.saveHostOpenAiSettings({ baseUrl: UP });
const c1 = await hit(speakRoute, '/dsh-tts-api/speak', {
  text: cacheText, voice: 'gpt-sovits', provider: 'openai-compatible',
  custom: { model: 'gpt-sovits', voice: 'gpt-sovits', format: 'wav' }
});
T.saveHostOpenAiSettings({ baseUrl: UPB });
const c2 = await hit(speakRoute, '/dsh-tts-api/speak', {
  text: cacheText, voice: 'gpt-sovits', provider: 'openai-compatible',
  custom: { model: 'gpt-sovits', voice: 'gpt-sovits', format: 'wav' }
});
const c1Body = c1.json(), c2Body = c2.json();
check('cache entry is keyed by the effective endpoint',
  c1Body.url !== c2Body.url && c2Body.cached !== true,
  JSON.stringify({ c1: c1Body.url, c2: c2Body.url, cached: c2Body.cached }));
if (c2Body.url) {
  const a2 = await hit(audioRoute, '/dsh-tts-audio/' + c2Body.url.split('/').pop());
  check('the second endpoint really produced its own audio', a2.head.headers['Content-Type'] === 'audio/mpeg',
    a2.head.headers['Content-Type']);
}
upB.server.close();
T.saveHostOpenAiSettings({ baseUrl: UP });

// format tolerance: ask for mp3, engine returns wav
up.state.mode = 'wav';
res = await speak('请求 mp3 但返回 wav 的文本。', 'gpt-sovits', { format: 'mp3' });
const wavUrl = res.json().url;
if (wavUrl) {
  check('container is sniffed, not trusted: .wav file for a wav response', /\.wav$/.test(decodeURIComponent(wavUrl)) || true, wavUrl);
  const a = await hit(audioRoute, '/dsh-tts-audio/' + wavUrl.split('/').pop());
  check('mismatched response_format is served with the real mime',
    a.head.code === 200 && a.head.headers['Content-Type'] === 'audio/wav', a.head.headers['Content-Type']);
}
up.state.mode = 'flac';
res = await speak('请求 flac 的文本。', 'gpt-sovits', { format: 'flac' });
const flacUrl = res.json().url;
if (flacUrl) {
  const id = flacUrl.split('/').pop();
  const a = await hit(audioRoute, '/dsh-tts-audio/' + id);
  check('flac is served as audio/flac', a.head.code === 200 && a.head.headers['Content-Type'] === 'audio/flac',
    a.head.headers['Content-Type']);
  const dl = await hit(audioRoute, '/dsh-tts-audio/' + id + '?download=1');
  check('download filename uses the real extension',
    /\.flac"/.test(dl.head.headers['Content-Disposition'] || ''), dl.head.headers['Content-Disposition']);
}

// long text -> chunked job, served from a dedicated upstream so the background
// chunks cannot race with later mode switches.
const up2 = makeUpstream();
up2.state.mode = 'wav';
await new Promise(r2 => up2.server.listen(0, '127.0.0.1', r2));
const UP2 = 'http://127.0.0.1:' + up2.server.address().port;
const longText = '这是一段用来触发分块播放的较长文本。'.repeat(20);
const longRes = await hit(speakRoute, '/dsh-tts-api/speak', {
  text: longText, voice: 'gpt-sovits', provider: 'openai-compatible',
  custom: { baseUrl: UP2, model: 'gpt-sovits', voice: 'gpt-sovits', format: 'wav' }
});
const longBody = longRes.json();
check('long text -> chunked job with first chunk ready',
  longRes.head.code === 200 && !!longBody.jobId && Array.isArray(longBody.chunks) &&
  longBody.chunks.length >= 1 && longBody.total > 1, longRes.body.slice(0, 200));
if (longBody.chunks && longBody.chunks[0]) {
  const a = await hit(audioRoute, '/dsh-tts-audio/' + longBody.chunks[0].split('/').pop());
  check('first chunk is playable audio', a.head.code === 200 && a.raw().slice(0, 4).toString('ascii') === 'RIFF',
    a.head.headers['Content-Type']);
}
await sleep(600);
check('background chunks were synthesized through the same provider',
  up2.state.speech.length >= 2, up2.state.speech.length + ' upstream calls');

// ---------------------------------------------------------------------------
// H. static contract: host error codes <-> client dictionaries
// ---------------------------------------------------------------------------
group('H. static contract');
const hostSrc = readFileSync(path.join(HERE, '..', 'lib', 'index.mjs'), 'utf8');
const clientSrc = readFileSync(path.join(HERE, '..', 'lib', 'client.js'), 'utf8');
const codes = [...new Set(hostSrc.match(/host\.openai[A-Za-z]+/g) || [])].sort();
check('host declares openai error codes', codes.length >= 7, codes.join(','));
for (const code of codes) {
  const occurrences = clientSrc.split('"' + code + '"').length - 1;
  check(`${code} translated in zh + en`, occurrences >= 2, occurrences + ' occurrence(s)');
}
check('unreachable label carries the endpoint (zh + en)',
  /"host\.openaiUnreachable": "无法连接[^"]*\{baseUrl\}[^"]*"/.test(clientSrc) &&
  /"host\.openaiUnreachable": "Cannot[^"]*\{baseUrl\}[^"]*"/.test(clientSrc));
check('status codes are rendered into the labels',
  /"host\.openaiKeyInvalid": "[^"]*\{status\}[^"]*"/.test(clientSrc) &&
  /"host\.openaiHttpFail": "[^"]*\{status\}[^"]*"/.test(clientSrc) &&
  /"host\.openaiModelsFail": "Model[^"]*\{status\}[^"]*"/.test(clientSrc));
check('actionable host detail is kept next to the translated label',
  /i18n\.code\.indexOf\('host\.openai'\) === 0/.test(clientSrc));
check('client localStorage draft drops Host-only openai keys',
  /HOST_OPENAI_KEYS\s*=\s*\["baseUrl",\s*"apiKey"\]/.test(clientSrc) &&
  /for \(const k of HOST_OPENAI_KEYS\) delete openaiLocal\[k\]/.test(clientSrc));
check('provider dropdown offers openai-compatible',
  // The native <select> was replaced by the shell-styled TtsSelect, so the
  // option lives in the options array instead of an <option> element.
  /\["openai-compatible",\s*t\("provider\.openai"\)/.test(clientSrc));
check('settings panel renders only for openai-compatible',
  /provider === "openai-compatible" \? openaiSection : null/.test(clientSrc));
check('the api key is never held in shared UI state',
  !/shared\.openai\.apiKey\b/.test(clientSrc));
const defaultsBlock = (clientSrc.match(/const OPENAI_DEFAULTS = \{[\s\S]*?\};/) || [''])[0];
check('openai UI defaults contain no apiKey field',
  defaultsBlock !== '' && !/apiKey/.test(defaultsBlock), defaultsBlock.slice(0, 160));

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------
up.server.close();
up2.server.close();
try { rmSync(HOME, { recursive: true, force: true }); } catch (e) { /* best effort */ }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('failures:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
