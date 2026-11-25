// GPT-SoVITS reference-audio library + on-disk layout contract.
//
// Covers the parts that are pure Host logic and must not need a GPU:
//   · ~/.dsh/dsh-plugin-tts/{config,data,cache} layout + legacy migration
//   · voice library round-trip (name + path + transcript + language) and caps
//   · folder listing / file stat for the picker
//   · uploaded wav landing in data/refs with a content hash prefix
//   · endpoint classification: api_v2.py vs the Gradio WebUI vs nothing
//   · synthesized-wav cache pruning (the old os.tmpdir() leak)
//
// DSH_TTS_HOME isolates everything; it must be set BEFORE importing the Host.
//
//   node tests/gsv-library.mjs
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, utimesSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = mkdtempSync(path.join(os.tmpdir(), 'dsh-gsv-lib-'));
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
function group(t) { console.log('\n--- ' + t + ' ---'); }

// route harness (same shape as the other suites)
const routes = [];
function fakeCtx() {
  return {
    get(name) {
      if (name === 'webServer') return { register(r) { routes.push(r); return () => {}; } };
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
      return { next: () => (i < chunks.length ? Promise.resolve({ value: chunks[i++], done: false }) : Promise.resolve({ done: true })) };
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
    writeHead(code, headers) { head.code = code; Object.assign(head.headers, headers || {}); this.headersSent = true; },
    setHeader(k, v) { head.headers[k] = v; },
    end(chunk) { if (chunk) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); }
  };
}
async function hit(r, url, body) {
  const res = mockRes();
  await r.handler(mockReq(url, body), res);
  return res;
}
const route = (p) => routes.find((r) => r.path === p);

// Boot the plugin so routes register.
plugin.apply(fakeCtx());
check('routes registered', routes.length > 0, routes.length);

// ---------------------------------------------------------------------------
group('A. on-disk layout');
check('DSH_TTS_HOME is honoured', T.ttsHomeDir() === HOME, T.ttsHomeDir());
T.ensureHomeDirs();
for (const sub of ['config', 'data', 'cache']) {
  check(sub + '/ exists', existsSync(path.join(HOME, sub)), path.join(HOME, sub));
}
check('managed refs dir is data/refs', T.gsvRefsDir() === path.join(HOME, 'data', 'refs'), T.gsvRefsDir());
check('synth cache is cache/synth', T.synthDir() === path.join(HOME, 'cache', 'synth'), T.synthDir());

// ---------------------------------------------------------------------------
group('B. settings round-trip (voice library)');
const saved = T.saveHostGsvSettings({
  baseUrl: 'http://127.0.0.1:9881/',
  refsDir: 'D:/voices',
  activeVoiceId: 'vabc',
  recentDirs: ['D:/voices', 'D:/refs', 'D:/a', 'D:/b', 'D:/c', 'D:/d'],
  voices: [
    { name: '旁白', path: 'D:/voices/narrator.wav', promptText: '这是参考答案。', promptLang: 'zh' },
    { path: 'D:/voices/hero.wav' },
    { name: 'no-path' },
    null
  ]
});
check('baseUrl is normalized (trailing slash dropped)', saved.baseUrl === 'http://127.0.0.1:9881', saved.baseUrl);
check('recentDirs is capped at 5', saved.recentDirs.length === 5, saved.recentDirs.length);
check('entries without a path are dropped', saved.voices.length === 2, saved.voices.length);
check('voice gets a stable id', /^[0-9a-f]{12}$/.test(saved.voices[0].id), saved.voices[0].id);
check('missing name falls back to the file basename', saved.voices[1].name === 'hero.wav', saved.voices[1].name);
check('transcript + language survive', saved.voices[1].promptText === '' && saved.voices[0].promptLang === 'zh');

const reloaded = T.loadHostGsvSettings();
check('reload returns the same library', reloaded.voices.length === 2 && reloaded.refsDir === 'D:/voices', JSON.stringify(reloaded).slice(0, 120));
check('reload keeps activeVoiceId', reloaded.activeVoiceId === 'vabc', reloaded.activeVoiceId);
check('settings.json lives under config/', existsSync(path.join(HOME, 'config', 'settings.json')));

// ---------------------------------------------------------------------------
group('C. folder listing');
const audioDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-refs-'));
writeFileSync(path.join(audioDir, 'b_older.wav'), Buffer.alloc(64));
writeFileSync(path.join(audioDir, 'a_newer.wav'), Buffer.alloc(32));
writeFileSync(path.join(audioDir, 'notes.txt'), 'x');
writeFileSync(path.join(audioDir, '.hidden.wav'), Buffer.alloc(8));
mkdirSync(path.join(audioDir, 'sub'));
// b_older is made older than a_newer so the mtime sort is observable
const oldT = new Date(Date.now() - 60_000);
utimesSync(path.join(audioDir, 'b_older.wav'), oldT, oldT);

const listed = T.fsListDir(audioDir);
check('listing reports the directory', listed.ok && listed.exists && listed.dir === audioDir, JSON.stringify(listed).slice(0, 120));
check('only audio files are listed', listed.files.length === 2, listed.files.map((f) => f.name).join(','));
check('dotfiles are skipped', !listed.files.some((f) => f.name.startsWith('.')));
check('newest audio comes first', listed.files[0].name === 'a_newer.wav', listed.files[0].name);
check('subdirectories are returned separately', listed.dirs.length === 1 && listed.dirs[0] === 'sub', listed.dirs.join(','));
check('parent is reported', listed.parent === path.dirname(audioDir), listed.parent);
check('relative paths are rejected', T.fsListDir('refs').ok === false, T.fsListDir('refs').error);
check('missing dir answers exists:false instead of failing', T.fsListDir(path.join(audioDir, 'nope')).exists === false);

const statHit = T.fsStatPath(path.join(audioDir, 'a_newer.wav'));
check('fsStatPath finds a real file', statHit.exists === true && statHit.size === 32, JSON.stringify(statHit));
check('fsStatPath reports a deleted file as missing', T.fsStatPath(path.join(audioDir, 'gone.wav')).exists === false);

// ---------------------------------------------------------------------------
group('D. refs upload + route contract');
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(2000)]);
const stored = T.storeGsvRefFile('我的 参考.wav', wav);
check('stored under data/refs', stored.startsWith(T.gsvRefsDir() + path.sep), stored);
check('file name is hash-prefixed and keeps the readable name', /^[0-9a-f]{8}-我的 参考\.wav$/.test(path.basename(stored)), path.basename(stored));
check('bytes landed on disk', existsSync(stored) && readFileSync(stored).length === wav.length);

const upRoute = route('/dsh-tts-api/gsv-refs-upload');
const upRes = await hit(upRoute, '/dsh-tts-api/gsv-refs-upload', { filename: 'voice.wav', audioBase64: wav.toString('base64') });
const upBody = upRes.json();
check('upload route answers 200 with an absolute path', upRes.head.code === 200 && upBody.ok && path.isAbsolute(upBody.path), upRes.body.slice(0, 150));
check('upload route rejects an empty payload', (await hit(upRoute, '/dsh-tts-api/gsv-refs-upload', { filename: 'x.wav' })).head.code === 400);

const cfgGet = (await hit(route('/dsh-tts-api/gsv-config'), '/dsh-tts-api/gsv-config')).json();
check('gsv-config exposes the library', cfgGet.gsv.voices.length === 2 && cfgGet.gsv.refsDir === 'D:/voices', JSON.stringify(cfgGet).slice(0, 160));
check('gsv-config exposes the managed refs dir default', cfgGet.refsDirDefault === T.gsvRefsDir(), cfgGet.refsDirDefault);

const cfgPost = await hit(route('/dsh-tts-api/gsv-config-save'), '/dsh-tts-api/gsv-config-save', {
  gsv: { voices: [{ name: 'X', path: '/tmp/x.wav', promptText: 'hi' }], activeVoiceId: 'vid' }
});
const cfgPostBody = cfgPost.json();
check('gsv-config-save replaces the voice list', cfgPost.head.code === 200 && cfgPostBody.gsv.voices.length === 1, cfgPost.body.slice(0, 160));
check('gsv-config-save keeps the transcript', cfgPostBody.gsv.voices[0].promptText === 'hi');

const listRoute = route('/dsh-tts-api/gsv-fs-list');
check('fs-list route 400s on a relative dir', (await hit(listRoute, '/dsh-tts-api/gsv-fs-list?dir=refs')).head.code === 400);
const listRes = (await hit(listRoute, '/dsh-tts-api/gsv-fs-list?dir=' + encodeURIComponent(audioDir))).json();
check('fs-list route returns files + dirs', listRes.ok && listRes.files.length === 2 && listRes.dirs.length === 1);

// ---------------------------------------------------------------------------
group('E. endpoint classification');
function apiServer(withTts = true) {
  return createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/openapi.json') {
      const paths = withTts ? { '/tts': {}, '/set_gpt_weights': {} } : { '/v1/chat': {} };
      const buf = Buffer.from(JSON.stringify({ openapi: '3.0.0', paths }));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': buf.length });
      res.end(buf);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<html>nope</html>');
  });
}
function webuiServer() {
  return createServer((req, res) => {
    const buf = Buffer.from('<html><head><title>GPT-SoVITS</title></head><body><div id="root" class="gradio-app"></div></body></html>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length });
    res.end(buf);
  });
}
const openServers = [];
function listen(server) {
  openServers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function closeAll() {
  for (const s of openServers) {
    try { s.close(); } catch (e) { /* already closed */ }
  }
}

const apiPort = await listen(apiServer(true));
const fastapiNoTts = await listen(apiServer(false));
const webuiPort = await listen(webuiServer());

const kindApi = await T.probeGsvEndpoint('http://127.0.0.1:' + apiPort);
check('api_v2.py is classified as api', kindApi.state === 'online' && kindApi.kind === 'api' && kindApi.hasTts === true, JSON.stringify(kindApi));
const kindFastapi = await T.probeGsvEndpoint('http://127.0.0.1:' + fastapiNoTts);
check('a FastAPI without /tts is not mistaken for the engine', kindFastapi.kind === 'fastapi' && kindFastapi.hasTts === false, JSON.stringify(kindFastapi));
const kindWebui = await T.probeGsvEndpoint('http://127.0.0.1:' + webuiPort);
check('the Gradio WebUI is named as webui', kindWebui.kind === 'webui', JSON.stringify(kindWebui));
const kindDown = await T.probeGsvEndpoint('http://127.0.0.1:1', 400);
check('a closed port is reported as down', kindDown.state === 'down' && kindDown.kind === 'none', JSON.stringify(kindDown));

const scan = await T.scanGsvEndpoints('http://127.0.0.1:' + webuiPort);
check('scan reports the WebUI it found', scan.webui === 'http://127.0.0.1:' + webuiPort || scan.webui === '', scan.webui);
check('scan tried the well-known api ports', scan.tried.some((t) => /:9880$/.test(t.baseUrl)) && scan.tried.some((t) => /:9881$/.test(t.baseUrl)), scan.tried.map((t) => t.baseUrl).join(' '));
check('scan tried the WebUI ports', scan.tried.some((t) => /:9874$/.test(t.baseUrl)), scan.tried.map((t) => t.baseUrl).join(' '));

// ---------------------------------------------------------------------------
group('F. synth cache hygiene');
const synth = T.synthDir();
mkdirSync(synth, { recursive: true });
const staleFile = path.join(synth, 'synth-stale.wav');
writeFileSync(staleFile, Buffer.alloc(16));
const stale = new Date(Date.now() - 3 * 60 * 60 * 1000);
utimesSync(staleFile, stale, stale);
const freshFile = path.join(synth, 'synth-fresh.wav');
writeFileSync(freshFile, Buffer.alloc(16));
T.pruneSynthCache();
check('expired synth wav is deleted', !existsSync(staleFile));
check('fresh synth wav is kept', existsSync(freshFile));

// Every provider that writes synthesized audio must land in cache/synth, not in
// os.tmpdir() — that leak produced one orphan file per read (and per test run)
// for edge / piper / index / cosy / cloud / gsv / rvc alike.
{
  const hostSrc = readFileSync(new URL('../lib/index.mjs', import.meta.url), 'utf8');
  const tmpWrites = hostSrc.split('\n').filter((l) => /os\.tmpdir\(\)/.test(l) && !/^\s*\/\//.test(l));
  check('no synth provider writes to os.tmpdir()', tmpWrites.length === 1 &&
    /process\.env\.DSH_TTS_OUT_DIR \|\| os\.tmpdir\(\)/.test(tmpWrites[0]), tmpWrites.join(' | '));
  check('the Edge worker receives the cache dir from the parent',
    /DSH_TTS_OUT_DIR: synthDir\(\)/.test(hostSrc));
  const synthWrites = hostSrc.match(/path\.join\(synthDir\(\), `dsh-tts-/g) || [];
  check('all synth providers write under cache/synth', synthWrites.length >= 6, synthWrites.length);
}

// ---------------------------------------------------------------------------
group('G. legacy layout migration');
// A tree shaped like 0.7.5 (flat files next to packs/) must be normalized:
// config/ data/ cache/ appear, files move into their class, nothing is lost.
const legacyHome = mkdtempSync(path.join(os.tmpdir(), 'dsh-legacy-'));
const freshHome = path.join(legacyHome, 'dsh-plugin-tts');
const flatHome = path.join(legacyHome, 'tts-rvc');
mkdirSync(flatHome, { recursive: true });
writeFileSync(path.join(flatHome, 'settings.json'), JSON.stringify({ version: 1, gsv: { baseUrl: 'http://127.0.0.1:9880' } }));
writeFileSync(path.join(flatHome, 'calibration.json'), '{"version":1,"entries":{}}');
writeFileSync(path.join(flatHome, 'cloud-usage.json'), '{"version":1,"months":{}}');
writeFileSync(path.join(flatHome, 'diag-recent.json'), '[]');
mkdirSync(path.join(flatHome, 'packs'));
writeFileSync(path.join(flatHome, 'packs', 'packs.json'), '{"packs":[]}');

const adopted = T.adoptHomeDir(freshHome, flatHome);
check('legacy tree is adopted as the new home', adopted === freshHome, adopted);
check('config/settings.json exists', existsSync(path.join(freshHome, 'config', 'settings.json')));
check('data/calibration.json exists', existsSync(path.join(freshHome, 'data', 'calibration.json')));
check('data/cloud-usage.json exists', existsSync(path.join(freshHome, 'data', 'cloud-usage.json')));
check('cache/diag-recent.json exists', existsSync(path.join(freshHome, 'cache', 'diag-recent.json')));
check('packs/ moved under data/', existsSync(path.join(freshHome, 'data', 'packs', 'packs.json')));
check('no flat copy is left behind', !existsSync(path.join(freshHome, 'settings.json')));

// Re-running is a no-op (every move is skipped when the destination exists).
T.adoptHomeDir(freshHome, path.join(legacyHome, 'no-such-legacy'));
check('re-running the migration is idempotent', existsSync(path.join(freshHome, 'config', 'settings.json')) && !existsSync(path.join(freshHome, 'settings.json')));

// ---------------------------------------------------------------------------
closeAll();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('failures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
process.exit(0);
