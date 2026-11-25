// Host-side voice directory feature (Index-TTS2 api/ckyp, CosyVoice prompts).
//
// Verifies that the plugin can scan a fixed local folder for reference/prompt
// audio even when the API service exposes no /voices endpoint, that uploads
// land in that folder, and that synthesis forwards an absolute path to a
// loopback service (Index api.py / cosy-server.py both accept it).
//
//   node tests/voices-dir.mjs
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DSH_TTS_HOME = mkdtempSync(path.join(os.tmpdir(), 'dsh-voices-dir-home-'));
const plugin = await import('../lib/index.mjs');

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
  effect(fn) { fn?.(); },
  on() { return () => {}; }
};
plugin.apply(ctx);

function mockReq(url, body, method) {
  const chunks = body === undefined ? [] : [body];
  return {
    url,
    method: method || (body === undefined ? 'GET' : 'POST'),
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () => (i < chunks.length ? Promise.resolve({ value: chunks[i++], done: false }) : Promise.resolve({ done: true }))
      };
    }
  };
}
function mockRes() {
  return {
    headersSent: false,
    head: null,
    body: null,
    writeHead(c, h) { this.head = { c, h }; },
    end(b) { this.body = Buffer.isBuffer(b) ? b : Buffer.from(b ?? ''); }
  };
}
const call = async (route, req) => {
  const res = mockRes();
  await route.handler(req, res);
  return res;
};
const byPath = (p) => routes.find((r) => r.kind === 'exact' && r.path === p);
const json = (res) => JSON.parse(res.body.toString('utf8'));
const status = (res) => (res.head && res.head.c) || 0;

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

// --- fixtures --------------------------------------------------------------
const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-voices-dir-fixture-'));
const indexDir = path.join(root, 'api', 'ckyp');
const cosyDir = path.join(root, 'prompts');
mkdirSync(indexDir, { recursive: true });
mkdirSync(cosyDir, { recursive: true });
// 1s 16 kHz mono PCM silence (a valid, non-trivial wav)
const wav = Buffer.alloc(44 + 32000);
wav.write('RIFF', 0, 'ascii');
wav.writeUInt32LE(36 + 32000, 4);
wav.write('WAVEfmt ', 8, 'ascii');
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24);
wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36, 'ascii');
wav.writeUInt32LE(32000, 40);
writeFileSync(path.join(indexDir, 'b.wav'), wav);
writeFileSync(path.join(indexDir, 'a.mp3'), Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(1200)]));
writeFileSync(path.join(indexDir, 'notes.txt'), 'ignore me');
writeFileSync(path.join(cosyDir, 'p1.wav'), wav);

// --- pure helpers ----------------------------------------------------------
{
  const T = plugin.__test;
  check('__test exposes voice-dir helpers',
    typeof T.normVoicesDir === 'function' && typeof T.scanHostVoiceDir === 'function' &&
    typeof T.resolveHostVoicePath === 'function' && typeof T.isLoopbackUrl === 'function');
  check('normVoicesDir trims trailing separator',
    T.normVoicesDir('C:\\AI\\index\\api\\ckyp\\') === 'C:\\AI\\index\\api\\ckyp', T.normVoicesDir('C:\\AI\\index\\api\\ckyp\\'));
  check('normVoicesDir keeps a drive root intact',
    T.normVoicesDir('D:/') === 'D:\\', T.normVoicesDir('D:/'));
  const scan = T.scanHostVoiceDir(indexDir);
  check('scanHostVoiceDir lists audio only, sorted',
    scan.ok && scan.exists && scan.voices.length === 2 &&
    scan.voices[0] === 'a.mp3' && scan.voices[1] === 'b.wav', JSON.stringify(scan.voices));
  const missing = T.scanHostVoiceDir(path.join(root, 'nope'));
  check('scanHostVoiceDir reports a missing directory', missing.ok && missing.exists === false && missing.voices.length === 0);
  const relative = T.scanHostVoiceDir('api/ckyp');
  check('scanHostVoiceDir rejects a relative path', relative.ok === false);
  check('resolveHostVoicePath: loopback + existing -> absolute',
    T.resolveHostVoicePath(indexDir, 'b.wav', 'http://127.0.0.1:7880') === path.join(indexDir, 'b.wav'));
  check('resolveHostVoicePath: remote service -> plain name',
    T.resolveHostVoicePath(indexDir, 'b.wav', 'http://192.168.1.5:7880') === 'b.wav');
  check('resolveHostVoicePath: no dir -> plain name',
    T.resolveHostVoicePath('', 'b.wav', 'http://127.0.0.1:7880') === 'b.wav');
  check('isLoopbackUrl accepts localhost aliases',
    T.isLoopbackUrl('http://127.0.0.1:1') && T.isLoopbackUrl('http://localhost:2') && !T.isLoopbackUrl('http://10.0.0.5:3'));
}

// --- config + list + upload (Index) ---------------------------------------
{
  const cfgSave = byPath('/dsh-tts-api/index-config-save');
  const cfgGet = byPath('/dsh-tts-api/index-config');
  const voices = byPath('/dsh-tts-api/index-voices');
  const upload = byPath('/dsh-tts-api/index-upload');
  check('plugin registers index voice routes', !!cfgSave && !!cfgGet && !!voices && !!upload);

  const saved = json(await call(cfgSave, mockReq('/dsh-tts-api/index-config-save', JSON.stringify({ index: { voicesDir: indexDir, recentVoiceDirs: [indexDir, path.join(root, 'older')] } }))));
  check('index-config-save persists voicesDir', saved.ok && saved.index.voicesDir === indexDir, JSON.stringify(saved));
  const got = json(await call(cfgGet, mockReq('/dsh-tts-api/index-config')));
  check('index-config GET returns voicesDir', got.index.voicesDir === indexDir, JSON.stringify(got.index));
  check('index-config persists recent voice dirs',
    Array.isArray(got.index.recentVoiceDirs) && got.index.recentVoiceDirs[0] === indexDir &&
    got.index.recentVoiceDirs.length === 2, JSON.stringify(got.index.recentVoiceDirs));

  const fromStored = json(await call(voices, mockReq('/dsh-tts-api/index-voices?baseUrl=http%3A%2F%2F127.0.0.1%3A1')));
  check('index-voices scans the stored dir without a service',
    fromStored.source === 'dir' && fromStored.exists === true && fromStored.voices.length === 2 &&
    fromStored.directory === indexDir, JSON.stringify(fromStored));

  const fromQuery = json(await call(voices, mockReq('/dsh-tts-api/index-voices?dir=' + encodeURIComponent(indexDir))));
  check('index-voices ?dir= wins over the stored value', fromQuery.dir === undefined && fromQuery.directory === indexDir && fromQuery.source === 'dir');

  const missing = json(await call(voices, mockReq('/dsh-tts-api/index-voices?dir=' + encodeURIComponent(path.join(root, 'nope')))));
  check('index-voices missing dir -> exists:false (no error)', missing.exists === false && missing.voices.length === 0, JSON.stringify(missing));

  const bad = await call(voices, mockReq('/dsh-tts-api/index-voices?dir=api%2Fckyp'));
  const badBody = json(bad);
  check('index-voices relative dir -> 400 host.voicesDirBad',
    status(bad) === 400 && badBody.i18n && badBody.i18n.code === 'host.voicesDirBad', bad.body.toString().slice(0, 200));

  const up = await call(upload, mockReq('/dsh-tts-api/index-upload', JSON.stringify({
    filename: 'new voice.wav', audioBase64: wav.toString('base64'), dir: indexDir
  })));
  const upBody = json(up);
  check('index-upload writes into the configured dir',
    status(up) === 200 && upBody.local === true && existsSync(path.join(indexDir, 'new voice.wav')), up.body.toString().slice(0, 200));

  const after = json(await call(voices, mockReq('/dsh-tts-api/index-voices?dir=' + encodeURIComponent(indexDir))));
  check('scan sees the uploaded file', after.voices.indexOf('new voice.wav') !== -1, JSON.stringify(after.voices));

  const badType = await call(upload, mockReq('/dsh-tts-api/index-upload', JSON.stringify({
    filename: 'evil.exe', audioBase64: wav.toString('base64'), dir: indexDir
  })));
  check('index-upload rejects non-audio extensions', status(badType) === 400, badType.body.toString().slice(0, 160));
}

// --- directory picker helpers: mkdir + parent of a missing dir -------------
{
  const mkdir = byPath('/dsh-tts-api/fs-mkdir');
  const fsList = byPath('/dsh-tts-api/gsv-fs-list');
  const base = path.join(root, 'picker-parent');
  mkdirSync(base, { recursive: true });
  const mk = await call(mkdir, mockReq('/dsh-tts-api/fs-mkdir', JSON.stringify({ dir: base, name: '新 音色库' })));
  const mkBody = json(mk);
  check('fs-mkdir creates a child folder',
    status(mk) === 200 && mkBody.ok && mkBody.created === true && existsSync(path.join(base, '新 音色库')), mk.body.toString().slice(0, 200));
  const again = await call(mkdir, mockReq('/dsh-tts-api/fs-mkdir', JSON.stringify({ dir: base, name: '新 音色库' })));
  check('fs-mkdir is idempotent for an existing folder', json(again).created === false);
  const bad = await call(mkdir, mockReq('/dsh-tts-api/fs-mkdir', JSON.stringify({ dir: base, name: '..' })));
  check('fs-mkdir rejects an empty/traversal name', status(bad) === 400);
  const missing = json(await call(fsList, mockReq('/dsh-tts-api/gsv-fs-list?dir=' + encodeURIComponent(path.join(base, 'nope')))));
  check('fs-list reports the parent of a missing dir', missing.exists === false && missing.parent === base, JSON.stringify(missing));

  // Directory picker extras: breadcrumbs + per-folder audio counts.
  const audioChild = path.join(base, 'with-audio');
  mkdirSync(audioChild, { recursive: true });
  writeFileSync(path.join(audioChild, 'a.wav'), 'x');
  writeFileSync(path.join(audioChild, 'b.mp3'), 'x');
  writeFileSync(path.join(audioChild, 'notes.txt'), 'x');
  const baseList = json(await call(fsList, mockReq('/dsh-tts-api/gsv-fs-list?dir=' + encodeURIComponent(base))));
  check('fs-list counts audio files per subfolder',
    baseList.dirAudio && baseList.dirAudio['with-audio'] === 2, JSON.stringify(baseList.dirAudio));
  check('fs-list counts only audio (txt ignored) and keeps the folder list',
    Array.isArray(baseList.dirs) && baseList.dirs.indexOf('with-audio') >= 0, JSON.stringify(baseList.dirs));
  check('fs-list breadcrumbs end at the current folder',
    Array.isArray(baseList.crumbs) && baseList.crumbs.length > 0 &&
    baseList.crumbs[baseList.crumbs.length - 1].path === base,
    JSON.stringify(baseList.crumbs));
  check('fs-list breadcrumbs start at the filesystem root',
    baseList.crumbs[0].path === path.parse(base).root && baseList.crumbs[0].name.length > 0,
    JSON.stringify(baseList.crumbs[0]));

  const fsOpen = byPath('/dsh-tts-api/fs-open');
  const relOpen = await call(fsOpen, mockReq('/dsh-tts-api/fs-open', JSON.stringify({ dir: 'relative/path' })));
  check('fs-open rejects a relative dir', status(relOpen) === 400, relOpen.body.toString().slice(0, 160));
  const missOpen = await call(fsOpen, mockReq('/dsh-tts-api/fs-open', JSON.stringify({ dir: path.join(base, 'nope') })));
  check('fs-open rejects a missing dir', status(missOpen) === 400, missOpen.body.toString().slice(0, 160));

  // Data-folder route: only the read side is exercised here (the open action
  // would spawn a file manager on the test machine).
  const dataDirRoute = byPath('/dsh-tts-api/data-dir');
  const dataDirRes = await call(dataDirRoute, mockReq('/dsh-tts-api/data-dir'));
  const dataDirBody = json(dataDirRes);
  check('data-dir returns the plugin home folder',
    status(dataDirRes) === 200 && dataDirBody.dir === process.env.DSH_TTS_HOME && existsSync(dataDirBody.dir),
    dataDirRes.body.toString().slice(0, 200));
  check('open-data-dir route registered', !!byPath('/dsh-tts-api/open-data-dir'));
}

// --- config + list (Cosy) -------------------------------------------------
{
  const cfgSave = byPath('/dsh-tts-api/cosy-config-save');
  const cfgGet = byPath('/dsh-tts-api/cosy-config');
  const voices = byPath('/dsh-tts-api/cosy-voices');
  const saved = json(await call(cfgSave, mockReq('/dsh-tts-api/cosy-config-save', JSON.stringify({ cosy: { voicesDir: cosyDir } }))));
  check('cosy-config-save persists voicesDir', saved.ok && saved.cosy.voicesDir === cosyDir, JSON.stringify(saved));
  const got = json(await call(cfgGet, mockReq('/dsh-tts-api/cosy-config')));
  check('cosy-config GET returns voicesDir', got.cosy.voicesDir === cosyDir, JSON.stringify(got.cosy));
  const list = json(await call(voices, mockReq('/dsh-tts-api/cosy-voices?baseUrl=http%3A%2F%2F127.0.0.1%3A1')));
  check('cosy-voices scans the stored dir without a service',
    list.source === 'dir' && list.voices.length === 1 && list.voices[0] === 'p1.wav', JSON.stringify(list));
}

// --- synthesis forwards an absolute path to a loopback service ------------
function startFake(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => resolve(b));
  });
}

{
  let seen = null;
  const { server, port } = await startFake(async (req, res) => {
    if (req.url === '/api/v1/tts/tasks') {
      seen = JSON.parse(await readBody(req));
      res.writeHead(200, { 'Content-Type': 'audio/wav' });
      res.end(wav);
      return;
    }
    res.writeHead(404).end('{}');
  });
  const speak = byPath('/dsh-tts-api/speak');
  const res = await call(speak, mockReq('/dsh-tts-api/speak', JSON.stringify({
    text: '这是一句用来验证绝对路径的短句。',
    provider: 'index-tts2',
    custom: { baseUrl: 'http://127.0.0.1:' + port, voicesDir: indexDir, voice: 'b.wav' }
  })));
  const body = json(res);
  check('index speak with voicesDir succeeds', status(res) === 200 && !!body.url, res.body.toString().slice(0, 200));
  check('index speak forwards the absolute prompt path',
    seen && seen.prompt_audio === path.join(indexDir, 'b.wav'), JSON.stringify(seen && seen.prompt_audio));
  server.close();
}

{
  let seen = null;
  const { server, port } = await startFake(async (req, res) => {
    if (req.url === '/tts') {
      seen = JSON.parse(await readBody(req));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ audio_base64: wav.toString('base64'), sample_rate: 24000 }));
      return;
    }
    res.writeHead(404).end('{}');
  });
  const speak = byPath('/dsh-tts-api/speak');
  const res = await call(speak, mockReq('/dsh-tts-api/speak', JSON.stringify({
    text: '这是另一句用来验证提示音频路径的短句。',
    provider: 'cosyvoice',
    custom: { baseUrl: 'http://127.0.0.1:' + port, voicesDir: cosyDir, voice: 'p1.wav', promptText: '测试提示音频' }
  })));
  const body = json(res);
  check('cosy speak with voicesDir succeeds', status(res) === 200 && !!body.url, res.body.toString().slice(0, 200));
  check('cosy speak forwards the absolute prompt path',
    seen && seen.prompt === path.join(cosyDir, 'p1.wav'), JSON.stringify(seen && seen.prompt));
  server.close();
}

// --- required-field guards ------------------------------------------------
{
  const speak = byPath('/dsh-tts-api/speak');
  const noIndex = await call(speak, mockReq('/dsh-tts-api/speak', JSON.stringify({
    text: '缺少参考音色的验证句。',
    provider: 'index-tts2',
    custom: { baseUrl: 'http://127.0.0.1:1', voicesDir: indexDir, voice: '' }
  })));
  const noIndexBody = json(noIndex);
  check('index speak without a voice -> host.indexNoVoice',
    status(noIndex) === 500 && noIndexBody.i18n && noIndexBody.i18n.code === 'host.indexNoVoice', noIndex.body.toString().slice(0, 200));

  const noCosy = await call(speak, mockReq('/dsh-tts-api/speak', JSON.stringify({
    text: '缺少提示音频文字稿的验证句。',
    provider: 'cosyvoice',
    custom: { baseUrl: 'http://127.0.0.1:1', voicesDir: cosyDir, voice: 'p1.wav', promptText: '' }
  })));
  const noCosyBody = json(noCosy);
  check('cosy speak without a transcript -> host.cosyNoPromptText',
    status(noCosy) === 500 && noCosyBody.i18n && noCosyBody.i18n.code === 'host.cosyNoPromptText', noCosy.body.toString().slice(0, 200));

  const noGsv = await call(speak, mockReq('/dsh-tts-api/speak', JSON.stringify({
    text: '缺少参考文本的验证句。',
    provider: 'gpt-sovits',
    custom: { baseUrl: 'http://127.0.0.1:1', refAudio: 'D:\\tmp\\ref.wav', promptText: '' }
  })));
  const noGsvBody = json(noGsv);
  check('gsv speak without a transcript -> host.gsvNoPromptText',
    status(noGsv) === 500 && noGsvBody.i18n && noGsvBody.i18n.code === 'host.gsvNoPromptText', noGsv.body.toString().slice(0, 200));
}

// --- local service lifecycle (user-configured commands) ---------------------
{
  const list = byPath('/dsh-tts-api/services');
  const save = byPath('/dsh-tts-api/service-save');
  const start = byPath('/dsh-tts-api/service-start');
  const stop = byPath('/dsh-tts-api/service-stop');
  check('service routes registered', !!list && !!save && !!start && !!stop);

  const empty = json(await call(list, mockReq('/dsh-tts-api/services')));
  check('services list exposes every local engine with empty config',
    empty.ok && plugin.__test.SERVICE_PROVIDERS.every(p => empty.services[p] && empty.services[p].command === '' && empty.services[p].running === false),
    JSON.stringify(Object.keys(empty.services || {})));

  const badCwd = await call(save, mockReq('/dsh-tts-api/service-save', JSON.stringify({
    provider: 'gpt-sovits', command: 'x', cwd: 'relative/dir', port: 9880
  })));
  check('service-save rejects a relative working dir', status(badCwd) === 400, badCwd.body.toString().slice(0, 160));
  const badProvider = await call(save, mockReq('/dsh-tts-api/service-save', JSON.stringify({
    provider: 'nope', command: 'x'
  })));
  check('service-save rejects an unknown provider', status(badProvider) === 400);

  const saved = json(await call(save, mockReq('/dsh-tts-api/service-save', JSON.stringify({
    provider: 'gpt-sovits', command: 'echo hello', cwd: root, port: 3999
  }))));
  check('service-save persists command / cwd / port',
    saved.ok && saved.service.command === 'echo hello' && saved.service.cwd === root && saved.service.port === 3999,
    JSON.stringify(saved));

  const sleepCmd = `"${process.execPath}" -e "setTimeout(()=>{},30000)"`;
  await call(save, mockReq('/dsh-tts-api/service-save', JSON.stringify({
    provider: 'gpt-sovits', command: sleepCmd, cwd: root, port: 0
  })));
  const started = await call(start, mockReq('/dsh-tts-api/service-start', JSON.stringify({ provider: 'gpt-sovits' })));
  const startedBody = json(started);
  check('service-start spawns the saved command',
    status(started) === 200 && startedBody.ok && startedBody.running === true && startedBody.pid > 0,
    started.body.toString().slice(0, 300));

  const running = json(await call(list, mockReq('/dsh-tts-api/services')));
  check('services list reports the running process + pid',
    running.services['gpt-sovits'].running === true && running.services['gpt-sovits'].pid > 0,
    JSON.stringify(running.services['gpt-sovits']));

  const stopped = await call(stop, mockReq('/dsh-tts-api/service-stop', JSON.stringify({ provider: 'gpt-sovits' })));
  check('service-stop terminates the process tree', status(stopped) === 200 && json(stopped).stopped === true, stopped.body.toString().slice(0, 200));

  const afterStop = json(await call(list, mockReq('/dsh-tts-api/services')));
  check('services list shows the process as stopped',
    afterStop.services['gpt-sovits'].running === false, JSON.stringify(afterStop.services['gpt-sovits']));

  const unknownStart = await call(start, mockReq('/dsh-tts-api/service-start', JSON.stringify({ provider: 'nope' })));
  check('service-start rejects an unknown provider', status(unknownStart) === 400);

  // A command that cannot start must fail fast and keep its log for the UI.
  await call(save, mockReq('/dsh-tts-api/service-save', JSON.stringify({
    provider: 'index-tts2', command: 'definitely-not-a-real-command-xyz', cwd: '', port: 0
  })));
  const failedStart = await call(start, mockReq('/dsh-tts-api/service-start', JSON.stringify({ provider: 'index-tts2' })));
  const failedBody = json(failedStart);
  check('service-start reports a failed command with its log',
    status(failedStart) === 400 && !failedBody.ok && Array.isArray(failedBody.log) && failedBody.log.length > 0,
    failedStart.body.toString().slice(0, 300));

  // --- scanned install -> suggested start command --------------------------
  const suggest = byPath('/dsh-tts-api/service-suggest');
  const pyDir = path.join(root, 'scanned-gsv');
  mkdirSync(path.join(pyDir, 'runtime'), { recursive: true });
  writeFileSync(path.join(pyDir, 'api_v2.py'), 'print(1)');
  writeFileSync(path.join(pyDir, 'runtime', process.platform === 'win32' ? 'python.exe' : 'python'), 'x');
  const pySug = await call(suggest, mockReq('/dsh-tts-api/service-suggest', JSON.stringify({ dir: pyDir, provider: 'gpt-sovits' })));
  const pyBody = json(pySug);
  check('service-suggest builds a python command for a scanned install',
    status(pySug) === 200 && pyBody.ok && pyBody.source === 'python' &&
    pyBody.command.indexOf('api_v2.py') >= 0 && pyBody.command.indexOf('-p 9880') >= 0 &&
    pyBody.cwd === pyDir && pyBody.port === 9880,
    pySug.body.toString().slice(0, 300));

  const envDir = path.join(root, 'scanned-env');
  mkdirSync(path.join(envDir, 'env'), { recursive: true });
  writeFileSync(path.join(envDir, 'api.py'), 'print(1)');
  writeFileSync(path.join(envDir, 'env', process.platform === 'win32' ? 'python.exe' : 'python'), 'x');
  const envSug = json(await call(suggest, mockReq('/dsh-tts-api/service-suggest', JSON.stringify({ dir: envDir, provider: 'index-tts2' }))));
  check('service-suggest finds a bundled env/ python and the api.py entry',
    envSug.ok && envSug.source === 'python' &&
    envSug.command.indexOf(path.join('env', process.platform === 'win32' ? 'python.exe' : 'python')) >= 0 &&
    envSug.command.indexOf('api.py') >= 0, JSON.stringify(envSug));

  const batDir = path.join(root, 'scanned-cosy');
  mkdirSync(batDir, { recursive: true });
  const batName = process.platform === 'win32' ? '启动cosy服务.bat' : 'start-cosy.sh';
  writeFileSync(path.join(batDir, batName), 'echo hi');
  const batSug = json(await call(suggest, mockReq('/dsh-tts-api/service-suggest', JSON.stringify({ dir: batDir, provider: 'cosyvoice' }))));
  check('service-suggest prefers a shipped launcher script',
    batSug.ok && batSug.source === 'launcher' && batSug.command.indexOf(batName) >= 0,
    JSON.stringify(batSug));

  const emptyDir = path.join(root, 'scanned-empty');
  mkdirSync(emptyDir, { recursive: true });
  const noSug = await call(suggest, mockReq('/dsh-tts-api/service-suggest', JSON.stringify({ dir: emptyDir, provider: 'rvc' })));
  check('service-suggest reports an empty install with a 400', status(noSug) === 400, noSug.body.toString().slice(0, 200));

  // --- synth cache info + clear -------------------------------------------
  const cacheInfo = byPath('/dsh-tts-api/cache-info');
  const cacheClear = byPath('/dsh-tts-api/cache-clear');
  const cacheDir = path.join(process.env.DSH_TTS_HOME, 'cache', 'synth');
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path.join(cacheDir, 'test-1.wav'), Buffer.alloc(2048));
  writeFileSync(path.join(cacheDir, 'test-2.mp3'), Buffer.alloc(1024));
  const info = json(await call(cacheInfo, mockReq('/dsh-tts-api/cache-info')));
  check('cache-info reports synth files and bytes',
    info.ok && info.files >= 2 && info.bytes >= 3072 && info.dir === cacheDir, JSON.stringify(info));
  const cleared = json(await call(cacheClear, mockReq('/dsh-tts-api/cache-clear')));
  check('cache-clear removes synthesized audio and reports the result',
    cleared.ok && cleared.cleared.files >= 2 && cleared.after.files === 0, JSON.stringify(cleared));
}


// --- GSV model scan + weight switching -------------------------------------
{
  const modelRoot = path.join(root, 'gsv-install');
  mkdirSync(path.join(modelRoot, 'GPT_weights_v4'), { recursive: true });
  mkdirSync(path.join(modelRoot, 'SoVITS_weights_v4'), { recursive: true });
  mkdirSync(path.join(modelRoot, 'GPT_SoVITS', 'pretrained_models', 'gsv-v4-pretrained'), { recursive: true });
  writeFileSync(path.join(modelRoot, 'GPT_weights_v4', 'speaker-e15.ckpt'), 'x');
  writeFileSync(path.join(modelRoot, 'SoVITS_weights_v4', 'speaker_e2.pth'), 'x');
  writeFileSync(path.join(modelRoot, 'GPT_SoVITS', 'pretrained_models', 's1base.ckpt'), 'x');
  writeFileSync(path.join(modelRoot, 'GPT_SoVITS', 'pretrained_models', 'gsv-v4-pretrained', 's2Gv4.pth'), 'x');
  writeFileSync(path.join(modelRoot, 'readme.txt'), 'ignore');

  const scan = plugin.__test.scanGsvModels(modelRoot);
  check('scanGsvModels finds trained GPT weights',
    scan.ok && scan.gpt.some(x => /speaker-e15\.ckpt$/.test(x.path) && x.group === 'GPT_weights_v4'), JSON.stringify(scan.gpt));
  check('scanGsvModels finds trained SoVITS weights',
    scan.ok && scan.sovits.some(x => /speaker_e2\.pth$/.test(x.path)), JSON.stringify(scan.sovits));
  check('scanGsvModels exposes base weights',
    scan.gpt.some(x => x.base) && scan.sovits.some(x => x.base), JSON.stringify(scan));
  check('scanGsvModels derives a generic speaker stem',
    scan.gpt.some(x => x.speaker === 'speaker') && scan.sovits.some(x => x.speaker === 'speaker'), JSON.stringify(scan.gpt.concat(scan.sovits)));
  check('scanGsvModels leaves base entries without a speaker',
    scan.gpt.filter(x => x.base).every(x => x.speaker === '') &&
    scan.sovits.filter(x => x.base).every(x => x.speaker === ''), JSON.stringify(scan));

  const modelsRoute = byPath('/dsh-tts-api/gsv-models');
  const noDir = await call(modelsRoute, mockReq('/dsh-tts-api/gsv-models'));
  check('gsv-models without a directory -> 400', status(noDir) === 400, noDir.body.toString().slice(0, 160));
  const listed = await call(modelsRoute, mockReq('/dsh-tts-api/gsv-models?dir=' + encodeURIComponent(modelRoot)));
  const listedBody = json(listed);
  check('gsv-models lists weights for a directory',
    status(listed) === 200 && listedBody.gpt.length >= 2 && listedBody.sovits.length >= 2, listed.body.toString().slice(0, 200));

  // Startup weights come from tts_infer.yaml `custom:`; the reader must not
  // care about section order or specific file names.
  const yamlDir = path.join(modelRoot, 'GPT_SoVITS', 'configs');
  mkdirSync(yamlDir, { recursive: true });
  writeFileSync(path.join(yamlDir, 'tts_infer.yaml'), [
    'custom:',
    '  device: cuda',
    '  t2s_weights_path: GPT_weights_v4/speaker-e15.ckpt',
    '  version: v4',
    '  vits_weights_path: SoVITS_weights_v4/speaker_e2.pth',
    'v4:',
    '  t2s_weights_path: GPT_SoVITS/pretrained_models/s1base.ckpt',
    '  vits_weights_path: GPT_SoVITS/pretrained_models/gsv-v4-pretrained/s2Gv4.pth',
    ''
  ].join('\n'));
  const current = plugin.__test.readGsvServiceWeights(modelRoot);
  check('readGsvServiceWeights reads the custom section of tts_infer.yaml',
    current.ok === true && current.section === 'custom' &&
    current.gpt === path.join(modelRoot, 'GPT_weights_v4', 'speaker-e15.ckpt') &&
    current.sovits === path.join(modelRoot, 'SoVITS_weights_v4', 'speaker_e2.pth'), JSON.stringify(current));
  check('readGsvServiceWeights reports version + file presence',
    current.version === 'v4' && current.gptExists === true && current.sovitsExists === true, JSON.stringify(current));
  const missingYaml = plugin.__test.readGsvServiceWeights(path.join(root, 'no-install'));
  check('readGsvServiceWeights degrades to unknown without a file',
    missingYaml.ok === false && missingYaml.reason === 'noFile', JSON.stringify(missingYaml));

  const listedWithCurrent = json(await call(modelsRoute, mockReq('/dsh-tts-api/gsv-models?dir=' + encodeURIComponent(modelRoot))));
  check('gsv-models includes the service startup weights',
    listedWithCurrent.current && listedWithCurrent.current.ok === true &&
    /speaker-e15\.ckpt$/.test(listedWithCurrent.current.gpt), JSON.stringify(listedWithCurrent.current));

  let calls = [];
  const { server, port } = await startFake(async (req, res) => {
    if (/^\/set_(sovits|gpt)_weights/.test(req.url)) {
      calls.push(req.url.split('?')[0].replace('/set_', ''));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"message":"success"}');
      return;
    }
    if (req.url === '/tts') {
      await readBody(req);
      res.writeHead(200, { 'Content-Type': 'audio/wav' });
      res.end(wav);
      return;
    }
    res.writeHead(404).end('{}');
  });
  const applyRoute = byPath('/dsh-tts-api/gsv-set-weights');
  const applied = await call(applyRoute, mockReq('/dsh-tts-api/gsv-set-weights', JSON.stringify({
    baseUrl: 'http://127.0.0.1:' + port,
    gpt: path.join(modelRoot, 'GPT_weights_v4', 'speaker-e15.ckpt'),
    sovits: path.join(modelRoot, 'SoVITS_weights_v4', 'speaker_e2.pth')
  })));
  const appliedBody = json(applied);
  check('gsv-set-weights succeeds and reports timing', status(applied) === 200 && appliedBody.ok === true, applied.body.toString().slice(0, 200));
  check('gsv-set-weights loads SoVITS before GPT', calls.join(',') === 'sovits_weights,gpt_weights', calls.join(','));
  const cfg = json(await call(byPath('/dsh-tts-api/gsv-config'), mockReq('/dsh-tts-api/gsv-config')));
  check('gsv-config persists the applied weight paths',
    cfg.gsv.gptWeights === path.join(modelRoot, 'GPT_weights_v4', 'speaker-e15.ckpt') &&
    cfg.gsv.sovitsWeights === path.join(modelRoot, 'SoVITS_weights_v4', 'speaker_e2.pth'), JSON.stringify(cfg.gsv));

  // A preview/read after applying weights must not reuse audio synthesized by
  // the previous pair. The apply route drops the short-text URL cache; a
  // `fresh` preview also bypasses it so any just-edited field is audible.
  const gsvRef = path.join(root, 'gsv-ref.wav');
  writeFileSync(gsvRef, 'x');
  const speakGsv = (fresh) => call(byPath('/dsh-tts-api/speak'), mockReq('/dsh-tts-api/speak', JSON.stringify({
    text: '权重缓存回归测试。',
    provider: 'gpt-sovits',
    fresh: !!fresh,
    custom: { baseUrl: 'http://127.0.0.1:' + port, refAudio: gsvRef, promptText: '你好', promptLang: 'zh' }
  })));
  const first = json(await speakGsv(false));
  check('gsv speak succeeds against the fake service', !!first.url, JSON.stringify(first));
  const again = json(await speakGsv(false));
  check('gsv speak reuses the cached URL for identical settings',
    again.cached === true && again.url === first.url, JSON.stringify({ first: first.url, again }));
  await call(applyRoute, mockReq('/dsh-tts-api/gsv-set-weights', JSON.stringify({
    baseUrl: 'http://127.0.0.1:' + port,
    gpt: path.join(modelRoot, 'GPT_weights_v4', 'speaker-e15.ckpt'),
    sovits: path.join(modelRoot, 'SoVITS_weights_v4', 'speaker_e2.pth')
  })));
  const afterApply = json(await speakGsv(false));
  check('applying weights invalidates cached GSV audio',
    !!afterApply.url && afterApply.url !== first.url && !afterApply.cached, JSON.stringify(afterApply));
  const freshPreview = json(await speakGsv(true));
  check('fresh previews bypass the short-text cache',
    !!freshPreview.url && freshPreview.url !== afterApply.url && !freshPreview.cached, JSON.stringify(freshPreview));

  // Voice health: the Host stamps `exists` on every library read so the UI
  // can show a "file missing" badge without probing each path itself.
  const cfgSave = byPath('/dsh-tts-api/gsv-config-save');
  const presentWav = path.join(root, 'health.wav');
  writeFileSync(presentWav, 'x');
  const savedHealth = json(await call(cfgSave, mockReq('/dsh-tts-api/gsv-config-save', JSON.stringify({
    voices: [
      { id: 'v-present', name: 'health.wav', path: presentWav, promptText: 'hello', promptLang: 'en' },
      { id: 'v-gone', name: 'gone.wav', path: path.join(root, 'gone.wav'), promptText: '', promptLang: 'ja' }
    ]
  }))));
  const healthOf = id => (savedHealth.gsv.voices || []).find(v => v.id === id) || {};
  check('gsv-config stamps exists=true for a present voice file',
    healthOf('v-present').exists === true, JSON.stringify(savedHealth.gsv.voices));
  check('gsv-config stamps exists=false for a missing voice file',
    healthOf('v-gone').exists === false, JSON.stringify(savedHealth.gsv.voices));
  check('gsv-config keeps transcript + lang for the voice health badges',
    healthOf('v-gone').promptText === '' && healthOf('v-gone').promptLang === 'ja', JSON.stringify(healthOf('v-gone')));
  server.close();
}

try { rmSync(root, { recursive: true, force: true }); } catch (e) {}
try { rmSync(process.env.DSH_TTS_HOME, { recursive: true, force: true }); } catch (e) {}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
