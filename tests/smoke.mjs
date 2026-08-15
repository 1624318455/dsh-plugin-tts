// Smoke test for the Host half of @dsh-external/dsh-plugin-tts.
// Uses a fake ctx (webServer captures the routes) and exercises the real
// Edge TTS synthesis over the network, the RVC chain against a mock local
// RVC inference server, plus the voice-pack registry (mock static server).
//   node tests/smoke.mjs
import * as plugin from '../lib/index.mjs';
import { createServer } from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockRegistry } from './mock-registry.mjs';

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
        } else if (req.url === '/compact-index') {
          const payload = JSON.parse(body || '{}');
          if (!payload.index) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'index required' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            path: 'C:/models/demo_compact_' + (payload.target_vectors || 10000) + '.index',
            size: 6000000,
            vectors: payload.target_vectors || 10000,
            source_vectors: 129396,
            source_size: 408000000,
            reduction_pct: 98.5
          }));
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

    // ---- adaptive chunked progressive playback (long RVC text) ----
    const longText = '这是一段用于验证自适应分块渐进播放的长文本朗读测试。'.repeat(12); // ~264 chars -> several chunks
    const longRes = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
      text: longText,
      voice: 'zh-CN-XiaoxuanNeural',
      provider: 'rvc',
      custom: { baseUrl: `http://127.0.0.1:${mock.port}`, model: 'mock.pth', index: '' }
    })), mockRes());
    const longParsed = JSON.parse(longRes.body);
    check('rvc long speak returns jobId + prewarmed chunks', longRes.head.code === 200
      && typeof longParsed.jobId === 'string'
      && Array.isArray(longParsed.chunks) && longParsed.chunks.length >= 2
      && typeof longParsed.total === 'number' && longParsed.total > longParsed.chunks.length,
      `jobId=${longParsed.jobId} chunks=${longParsed.chunks && longParsed.chunks.length} total=${longParsed.total}`);
    if (typeof longParsed.jobId === 'string') {
      const nextRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-next');
      check('plugin registers rvc-next route', nextRoute !== undefined);
      let fetched = longParsed.chunks.length;
      let more = true;
      let drained = 0;
      while (more && drained < 100) {
        const nr = await call(nextRoute, mockReq(`/dsh-tts-api/rvc-next?job=${longParsed.jobId}`), mockRes());
        const np = JSON.parse(nr.body);
        if (np && np.url) fetched++;
        more = !!(np && np.more);
        drained++;
      }
      check('rvc-next drains to total chunks', fetched === longParsed.total && more === false, `fetched=${fetched} total=${longParsed.total}`);
      check('rvc-next done for unknown job', (await call(nextRoute, mockReq('/dsh-tts-api/rvc-next?job=unknown'), mockRes())).body === JSON.stringify({ done: true, gone: true }));
      // a prewarmed chunk url must serve wav through the audio route
      const cRes = await call(audioRoute, mockReq(longParsed.chunks[0]), mockRes());
      const cBytes = Buffer.isBuffer(cRes.body) ? cRes.body : Buffer.from(cRes.body ?? '');
      check('chunk audio route serves wav (RIFF)', cRes.head.code === 200 && cBytes.length > 44 && cBytes.slice(0, 4).toString() === 'RIFF', `code=${cRes.head.code} bytes=${cBytes.length}`);
    }

    // file-discovery proxy route
    const filesRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-files');
    const fr = await call(filesRoute, mockReq(`/dsh-tts-api/rvc-files?baseUrl=http://127.0.0.1:${mock.port}&kind=pth`), mockRes());
    const filesData = JSON.parse(fr.body);
    check('rvc-files proxy lists pth files', fr.head.code === 200 && Array.isArray(filesData.files) && filesData.files.length > 0 && filesData.files[0].name === 'demo.pth', fr.body);
    const fi = await call(filesRoute, mockReq(`/dsh-tts-api/rvc-files?baseUrl=http://127.0.0.1:${mock.port}&kind=index`), mockRes());
    const filesIdx = JSON.parse(fi.body);
    check('rvc-files proxy lists index files', fi.head.code === 200 && Array.isArray(filesIdx.files) && filesIdx.files.length > 0 && filesIdx.files[0].name === 'demo.index', fi.body);

    // compact-index proxy route
    const compactRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-compact-index');
    const cr = await call(compactRoute, mockReq('/dsh-tts-api/rvc-compact-index', JSON.stringify({
      baseUrl: `http://127.0.0.1:${mock.port}`,
      index: 'C:/models/demo.index',
      target_vectors: 2000
    })), mockRes());
    const compactData = JSON.parse(cr.body);
    check('compact-index proxy returns compacted index', cr.head.code === 200
      && compactData.ok === true
      && compactData.path === 'C:/models/demo_compact_2000.index'
      && compactData.reduction_pct === 98.5,
      cr.body);
    const cb = await call(compactRoute, mockReq('/dsh-tts-api/rvc-compact-index', JSON.stringify({
      baseUrl: `http://127.0.0.1:${mock.port}`,
      index: ''
    })), mockRes());
    check('compact-index proxy passes server error', cb.head.code === 502 && typeof JSON.parse(cb.body).error === 'string', cb.body);
  } finally {
    mock.server.close();
  }
}

// --- voice-pack registry: manifest proxy + verified install ---

{
  // isolated packs dir for the test
  process.env.DSH_TTS_PACKS_DIR = mkdtempSync(path.join(os.tmpdir(), 'dsh-tts-packs-'));
  // build a mock registry dir
  const regDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-tts-reg-'));
  const modelBytes = Buffer.from('FAKE-MODEL-BYTES-0123456789'.repeat(8000)); // ~200KB
  const indexBytes = Buffer.from('FAKE-INDEX-BYTES-abcdef'.repeat(6000));      // ~108KB
  const sha = b => createHash('sha256').update(b).digest('hex');
  const modelSha = sha(modelBytes);
  const indexSha = sha(indexBytes);
  writeFileSync(path.join(regDir, 'model.pth'), modelBytes);
  writeFileSync(path.join(regDir, 'index.index'), indexBytes);
  writeFileSync(path.join(regDir, 'manifest.json'), JSON.stringify({
    schema: 1,
    packs: [
      {
        id: 'pack-a',
        name: 'Demo Voice A',
        description: '测试音色包（模型+紧凑索引）',
        version: '1.0.0',
        author: 'tester',
        license: 'MIT',
        baseVoice: 'zh-CN-YunyangNeural',
        f0Method: 'rmvpe',
        indexRate: 0.75,
        model: { url: '', size: modelBytes.length, sha256: modelSha },
        index: { url: '', size: indexBytes.length, sha256: indexSha }
      },
      { id: 'pack-b', name: 'Demo Voice B', description: '免索引音色包', version: '2.0.0', license: 'CC-BY', model: { url: '', size: modelBytes.length, sha256: modelSha } }
    ]
  }, null, 2));

  // fix relative urls after knowing the server port
  const reg = await startMockRegistry(regDir, 0);
  try {
    const base = reg.base;
    const manifestPath = path.join(regDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const p of manifest.packs) {
      if (p.model) p.model.url = `${base}/model.pth`;
      if (p.index) p.index.url = `${base}/index.index`;
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const packsRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-packs');
    const installRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-pack-install');
    const installedRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-packs-installed');
    check('plugin registers pack routes', packsRoute !== undefined && installRoute !== undefined && installedRoute !== undefined);

    const pr = await call(packsRoute, mockReq(`/dsh-tts-api/rvc-packs?registry=${encodeURIComponent(base)}`), mockRes());
    const prData = JSON.parse(pr.body);
    check('rvc-packs proxies manifest', pr.head.code === 200 && Array.isArray(prData.packs) && prData.packs.length === 2, pr.body);

    const ir = await call(installRoute, mockReq('/dsh-tts-api/rvc-pack-install', JSON.stringify({ registry: base, packId: 'pack-a' })), mockRes());
    const irData = JSON.parse(ir.body);
    const installedModel = irData.modelPath || '';
    const installedIndex = irData.indexPath || '';
    const modelOk = installedModel && existsSync(installedModel) && sha(readFileSync(installedModel)) === modelSha;
    const indexOk = installedIndex && existsSync(installedIndex) && sha(readFileSync(installedIndex)) === indexSha;
    check('rvc-pack-install downloads + sha256 verifies + writes', ir.head.code === 200 && irData.ok && modelOk && indexOk,
      `model=${installedModel} index=${installedIndex}`);

    const ir2 = await call(installRoute, mockReq('/dsh-tts-api/rvc-pack-install', JSON.stringify({ registry: base, packId: 'pack-a' })), mockRes());
    check('re-install skips (already installed)', JSON.parse(ir2.body).skipped === true, ir2.body);

    const irB = await call(installRoute, mockReq('/dsh-tts-api/rvc-pack-install', JSON.stringify({ registry: base, packId: 'pack-b' })), mockRes());
    const irBData = JSON.parse(irB.body);
    check('index-free pack installs without index', irB.head.code === 200 && irBData.ok && irBData.indexPath === '', irB.body);

    const st = await call(installedRoute, mockReq('/dsh-tts-api/rvc-packs-installed'), mockRes());
    const stData = JSON.parse(st.body);
    check('rvc-packs-installed lists 2 packs', st.head.code === 200 && stData.installed && stData.installed['pack-a'] && stData.installed['pack-b'], st.body);

    // multi-index pack with RELATIVE urls (schema v2)
    writeFileSync(path.join(regDir, 'manifest.json'), JSON.stringify({
      schema: 2,
      packs: [{
        id: 'pack-c',
        name: 'Multi Index Voice',
        version: '1.0.0',
        license: 'MIT',
        model: { url: 'packs-shared/model.pth', size: modelBytes.length, sha256: modelSha },
        indexes: [
          { id: 'tiny', name: '紧凑 2k', url: 'packs-shared/i2k.index', size: 5, sha256: sha(Buffer.from('IDX2K')) },
          { id: 'mid', name: '紧凑 10k', url: 'packs-shared/i10k.index', size: 6, sha256: sha(Buffer.from('IDX10K')) }
        ]
      }]
    }, null, 2));
    mkdirSync(path.join(regDir, 'packs-shared'));
    writeFileSync(path.join(regDir, 'packs-shared', 'model.pth'), modelBytes);
    writeFileSync(path.join(regDir, 'packs-shared', 'i2k.index'), Buffer.from('IDX2K'));
    writeFileSync(path.join(regDir, 'packs-shared', 'i10k.index'), Buffer.from('IDX10K'));

    const ic1 = await call(installRoute, mockReq('/dsh-tts-api/rvc-pack-install', JSON.stringify({ registry: base, packId: 'pack-c' })), mockRes());
    const ic1d = JSON.parse(ic1.body);
    const ic1Ok = ic1.head.code === 200 && ic1d.ok && ic1d.indexId === 'tiny'
      && readFileSync(ic1d.indexPath, 'utf8') === 'IDX2K' && ic1d.variants.length === 2;
    check('multi-index install defaults to first variant (relative urls)', ic1Ok, ic1.body);

    const ic2 = await call(installRoute, mockReq('/dsh-tts-api/rvc-pack-install', JSON.stringify({ registry: base, packId: 'pack-c', indexId: 'mid' })), mockRes());
    const ic2d = JSON.parse(ic2.body);
    const ic2Ok = ic2.head.code === 200 && ic2d.ok && ic2d.indexId === 'mid'
      && readFileSync(ic2d.indexPath, 'utf8') === 'IDX10K';
    check('switching index variant re-downloads the chosen index', ic2Ok, ic2.body);

    const st2 = await call(installedRoute, mockReq('/dsh-tts-api/rvc-packs-installed'), mockRes());
    const st2Data = JSON.parse(st2.body);
    check('installed.json records chosen index sha256', st2Data.installed['pack-c'].indexId === 'mid'
      && st2Data.installed['pack-c'].indexSha256 === sha(Buffer.from('IDX10K')), st2.body);

    // tampered sha256 -> install must fail and not leave files
    writeFileSync(path.join(regDir, 'manifest.json'), JSON.stringify({
      schema: 1,
      packs: [{ id: 'pack-bad', name: 'Bad', version: '1.0.0', model: { url: `${base}/model.pth`, size: modelBytes.length, sha256: '0'.repeat(64) } }]
    }, null, 2));
    const bad = await call(installRoute, mockReq('/dsh-tts-api/rvc-pack-install', JSON.stringify({ registry: base, packId: 'pack-bad' })), mockRes());
    const badData = JSON.parse(bad.body);
    check('tampered sha256 rejected', bad.head.code === 502 && /sha256/.test(badData.error || ''), bad.body);
    check('failed install leaves no model file', !existsSync(path.join(process.env.DSH_TTS_PACKS_DIR, 'pack_bad', 'pack_bad.pth')));

    // installed files are named <packId>.pth / <packId>.index so the browse
    // picker can tell voices apart
    check('installed files use pack-id names',
      irData.modelPath.endsWith('pack-a.pth') && irData.indexPath.endsWith('pack-a.index'),
      `${irData.modelPath} / ${irData.indexPath}`);

    // stale entry (files deleted) is reconciled away on read
    const staleDir = path.join(process.env.DSH_TTS_PACKS_DIR, 'pack-a');
    rmSync(staleDir, { recursive: true, force: true });
    const st3 = await call(installedRoute, mockReq('/dsh-tts-api/rvc-packs-installed'), mockRes());
    const st3Data = JSON.parse(st3.body);
    check('deleted pack no longer listed as installed', !st3Data.installed['pack-a'], st3.body);

    // uninstall route removes files + record
    const ui = await call(installRoute, mockReq('/dsh-tts-api/rvc-pack-install', JSON.stringify({ registry: base, packId: 'pack-b' })), mockRes());
    const uiData = JSON.parse(ui.body);
    const uninstallRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-pack-uninstall');
    const un = await call(uninstallRoute, mockReq('/dsh-tts-api/rvc-pack-uninstall', JSON.stringify({ packId: 'pack-b' })), mockRes());
    check('rvc-pack-uninstall removes files + record', un.head.code === 200
      && !existsSync(uiData.modelPath)
      && !JSON.parse((await call(installedRoute, mockReq('/dsh-tts-api/rvc-packs-installed'), mockRes())).body).installed['pack-b'],
      un.body);
  } finally {
    reg.server.close();
  }
}

// --- pack-install progress reporting (delayed registry) ---
{
  process.env.DSH_TTS_PACKS_DIR = mkdtempSync(path.join(os.tmpdir(), 'dsh-tts-packs-prog-'));
  const regDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-tts-reg-prog-'));
  const modelBytes = Buffer.from('PROGRESS-MODEL-0123456789'.repeat(5000));
  const sha = b => createHash('sha256').update(b).digest('hex');
  writeFileSync(path.join(regDir, 'model.pth'), modelBytes);
  writeFileSync(path.join(regDir, 'manifest.json'), JSON.stringify({
    schema: 2,
    packs: [{ id: 'pack-d', name: 'Slow Pack', version: '1.0.0', license: 'MIT',
      model: { url: 'model.pth', size: modelBytes.length, sha256: sha(modelBytes) } }]
  }));
  const reg = await startMockRegistry(regDir, 0, 400); // 400ms delay per file
  try {
    const installRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-pack-install');
    const progressRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-pack-progress');
    check('plugin registers pack-progress route', progressRoute !== undefined);
    const pKey = 'prog-' + Date.now();
    const installPromise = call(installRoute, mockReq('/dsh-tts-api/rvc-pack-install', JSON.stringify({
      registry: reg.base, packId: 'pack-d', progressKey: pKey
    })), mockRes());
    let sawProgress = false;
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 120));
      const pr = mockRes();
      await call(progressRoute, mockReq(`/dsh-tts-api/rvc-pack-progress?key=${pKey}`), pr);
      const d = JSON.parse(pr.body);
      if (d && d.waiting !== true && typeof d.phase === 'string') { sawProgress = true; break; }
    }
    check('pack-progress reports in-flight bytes/phase', sawProgress === true);
    const res = await installPromise;
    check('delayed install completes', JSON.parse(res.body).ok === true, res.body);
    const pr2 = mockRes();
    await call(progressRoute, mockReq(`/dsh-tts-api/rvc-pack-progress?key=${pKey}`), pr2);
    check('pack-progress finished after install', JSON.parse(pr2.body).finished === true, pr2.body);
    const pr3 = mockRes();
    await call(progressRoute, mockReq('/dsh-tts-api/rvc-pack-progress?key=unknown-key-xyz'), pr3);
    check('pack-progress unknown key -> waiting (not done)', JSON.parse(pr3.body).waiting === true, pr3.body);
  } finally {
    reg.server.close();
  }
}

// --- pack download through an HTTP CONNECT proxy (mimics Clash) ---
{
  process.env.DSH_TTS_PACKS_DIR = mkdtempSync(path.join(os.tmpdir(), 'dsh-tts-packs-proxy-'));
  const regDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-tts-reg-proxy-'));
  const modelBytes = Buffer.from('PROXY-DOWNLOAD-abcdef'.repeat(8000));
  const sha = b => createHash('sha256').update(b).digest('hex');
  writeFileSync(path.join(regDir, 'model.pth'), modelBytes);
  writeFileSync(path.join(regDir, 'manifest.json'), JSON.stringify({
    schema: 2,
    packs: [{ id: 'pack-p', name: 'Proxy Pack', version: '1.0.0', license: 'MIT',
      model: { url: 'model.pth', size: modelBytes.length, sha256: sha(modelBytes) } }]
  }));
  const reg = await startMockRegistry(regDir, 0);
  // minimal CONNECT tunnel proxy (CONNECT arrives via the 'connect' event)
  const proxy = createServer((req, res) => { res.writeHead(405); res.end(); });
  proxy.on('connect', (req, clientSocket, head) => {
    const idx = req.url.indexOf(':');
    const host = req.url.slice(0, idx);
    const port = Number(req.url.slice(idx + 1));
    const target = net.connect(port, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) target.write(head);
      clientSocket.pipe(target);
      target.pipe(clientSocket);
    });
    target.on('error', () => { try { clientSocket.destroy(); } catch (e) {} });
    clientSocket.on('error', () => {});
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  const proxyPort = proxy.address().port;
  try {
    const packsRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-packs');
    const installRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-pack-install');
    const pr = await call(packsRoute, mockReq(`/dsh-tts-api/rvc-packs?registry=${encodeURIComponent(reg.base)}&proxy=${encodeURIComponent(`http://127.0.0.1:${proxyPort}`)}`), mockRes());
    const prData = JSON.parse(pr.body);
    check('manifest fetch through proxy', pr.head.code === 200 && prData.packs[0].id === 'pack-p', pr.body);
    const ir = await call(installRoute, mockReq('/dsh-tts-api/rvc-pack-install', JSON.stringify({
      registry: reg.base, packId: 'pack-p', proxy: `http://127.0.0.1:${proxyPort}`
    })), mockRes());
    const irData = JSON.parse(ir.body);
    check('install through proxy tunnel downloads + verifies', ir.head.code === 200 && irData.ok
      && existsSync(irData.modelPath) && sha(readFileSync(irData.modelPath)) === sha(modelBytes), ir.body);
  } finally {
    proxy.close();
    reg.server.close();
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
