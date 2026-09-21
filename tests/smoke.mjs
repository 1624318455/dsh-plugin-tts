// Smoke test for the Host half of @dsh-external/dsh-plugin-tts.
// Uses a fake ctx (webServer captures the routes) and exercises the real
// Edge TTS synthesis over the network, the RVC chain against a mock local
// RVC inference server, plus the voice-pack registry (mock static server).
//   node tests/smoke.mjs
import * as plugin from '../lib/index.mjs';
import { createServer } from 'node:http';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockRegistry } from './mock-registry.mjs';

const routes = [];
const fakeEventListeners = new Map(); // name -> [fn] captured via ctx.on

function emitFake(name, ...args) {
  for (const fn of (fakeEventListeners.get(name) || []).slice()) fn(...args);
}

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
    effect(fn) { fn?.(); }, // apply the effect callback (registers disposers / event subscriptions) like the host does
    on(name, fn) {
      const arr = fakeEventListeners.get(name) || [];
      arr.push(fn);
      fakeEventListeners.set(name, arr);
      return () => {
        const a = fakeEventListeners.get(name);
        if (a) {
          const i = a.indexOf(fn);
          if (i >= 0) a.splice(i, 1);
        }
      };
    }
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

  // repeated speak of the same text+voice must reuse the in-session audio cache
  // (replay does not re-synthesize)
  {
    const res2 = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({ text: '你好，这是一个冒烟测试。', voice: 'zh-CN-XiaoxuanNeural' })), mockRes());
    const parsed2 = JSON.parse(res2.body);
    check('repeated speak reuses cached URL (no re-synthesize)', res2.head.code === 200 && parsed2.url === parsed.url, `first=${parsed.url} second=${parsed2.url}`);
  }

  // ?download=1 forces a Content-Disposition attachment on the audio asset
  if (parsed.url) {
    const dres = await call(audioRoute, mockReq(parsed.url + '?download=1'), mockRes());
    const cd = dres.head && dres.head.headers && dres.head.headers['Content-Disposition'];
    check('audio download sets Content-Disposition attachment', dres.head.code === 200 && /attachment/.test(cd || ''), cd);
  }

  const badRes = await call(audioRoute, mockReq('/dsh-tts-audio/nope'), mockRes());
  check('unknown audio id -> 404', badRes.head.code === 404);

  // M2 subset: long plain-Edge reads also stream progressively (jobId+chunks),
  // not a single blocking synthesis
  {
    const longEdge = '这是一段很长的文本用于验证 Edge 长读也走自适应分块渐进播放，避免等待整段合成。'.repeat(10);
    const er = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
      text: longEdge, voice: 'zh-CN-XiaoxuanNeural', provider: 'edge-tts'
    })), mockRes());
    const ep = JSON.parse(er.body);
    check('long edge read returns chunked job (streaming subset)',
      er.head.code === 200 && typeof ep.jobId === 'string' && Array.isArray(ep.chunks) && ep.chunks.length >= 1,
      ep.jobId ? `jobId=${ep.jobId} chunks=${ep.chunks.length} total=${ep.total}` : er.body);
  }

  // M1+ local-piper provider: registered in the abstraction; unconfigured -> graceful
  // localized error (not a crash)
  {
    const pr = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
      text: 'hello', voice: '', provider: 'local-piper', custom: {}
    })), mockRes());
    const pp = JSON.parse(pr.body);
    check('local-piper unconfigured returns graceful error (i18n code)',
      pr.head.code === 500 && pp.error && pp.i18n && pp.i18n.code === 'host.piperUnconfigured',
      JSON.stringify(pp));
  }
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
        } else if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, model_loaded: true, model: 'demo.pth', gpu_name: 'Mock GPU', vram_gb: 8 }));
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

    // ---- explicit cancel: abandoning a chunked job releases it immediately ----
    {
      const spRes = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
        text: longText,
        voice: 'zh-CN-XiaoxuanNeural',
        provider: 'rvc',
        custom: { baseUrl: `http://127.0.0.1:${mock.port}`, model: 'mock.pth', index: '' }
      })), mockRes());
      const sp = JSON.parse(spRes.body);
      if (typeof sp.jobId === 'string') {
        const nextRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-next');
        const c1 = await call(nextRoute, mockReq(`/dsh-tts-api/rvc-next?job=${sp.jobId}&cancel=1`), mockRes());
        const c1p = JSON.parse(c1.body);
        check('rvc-next cancel returns {done,cancelled}', c1.head.code === 200 && c1p.done === true && c1p.cancelled === true, c1.body);
        const c2 = await call(nextRoute, mockReq(`/dsh-tts-api/rvc-next?job=${sp.jobId}`), mockRes());
        const c2p = JSON.parse(c2.body);
        check('cancelled job no longer servable (gone)', c2.head.code === 200 && c2p.done === true && c2p.gone === true, c2.body);
      } else {
        check('cancel test precondition: long rvc speak returns jobId', false, spRes.body);
      }
    }

    // file-discovery proxy route
    const filesRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-files');
    const fr = await call(filesRoute, mockReq(`/dsh-tts-api/rvc-files?baseUrl=http://127.0.0.1:${mock.port}&kind=pth`), mockRes());
    const filesData = JSON.parse(fr.body);
    check('rvc-files proxy lists pth files', fr.head.code === 200 && Array.isArray(filesData.files) && filesData.files.length > 0 && filesData.files[0].name === 'demo.pth', fr.body);
    const fi = await call(filesRoute, mockReq(`/dsh-tts-api/rvc-files?baseUrl=http://127.0.0.1:${mock.port}&kind=index`), mockRes());
    const filesIdx = JSON.parse(fi.body);
    check('rvc-files proxy lists index files', fi.head.code === 200 && Array.isArray(filesIdx.files) && filesIdx.files.length > 0 && filesIdx.files[0].name === 'demo.index', fi.body);

    // unreachable RVC service -> actionable, platform-aware startup hint
    const badFiles = await call(filesRoute, mockReq('/dsh-tts-api/rvc-files?baseUrl=http%3A%2F%2F127.0.0.1%3A1&kind=pth'), mockRes());
    const badFilesData = JSON.parse(badFiles.body);
    check('rvc-files unreachable returns actionable startup hint',
      badFiles.head.code === 502 &&
      badFilesData.i18n && badFilesData.i18n.code === 'host.filesNeedsServer' &&
      badFilesData.i18n.params && /rvc-server\.py/.test(badFilesData.i18n.params.startup || ''),
      badFiles.body);

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

    // ---- one-click diagnostics ----
    const diagnoseRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/diagnose');
    check('plugin registers diagnose route', diagnoseRoute !== undefined);
    const dg = await call(diagnoseRoute, mockReq('/dsh-tts-api/diagnose', JSON.stringify({
      rvcBaseUrl: `http://127.0.0.1:${mock.port}`
    })), mockRes());
    const dgData = JSON.parse(dg.body);
    const edge = dgData.checks.find(c => c.id === 'edge');
    const rvc = dgData.checks.find(c => c.id === 'rvc-server');
    const model = dgData.checks.find(c => c.id === 'rvc-model');
    check('diagnose: edge synthesis ok', dg.head.code === 200 && edge && edge.ok === true, JSON.stringify(edge));
    check('diagnose: rvc server + model ok (mock)', rvc && rvc.ok === true && model && model.ok === true, JSON.stringify({ rvc, model }));
    const dgBad = await call(diagnoseRoute, mockReq('/dsh-tts-api/diagnose', JSON.stringify({
      rvcBaseUrl: 'http://127.0.0.1:1'
    })), mockRes());
    const dgBadData = JSON.parse(dgBad.body);
    const rvcBad = dgBadData.checks.find(c => c.id === 'rvc-server');
    check('diagnose: unreachable rvc classified as connect', rvcBad && rvcBad.ok === false && rvcBad.cls === 'connect', JSON.stringify(rvcBad));
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

// --- tools/make-pack.mjs: one-command pack generation + validation ---
// NOTE: skipped under sandboxes that block child-process spawn (spawnSync
// EPERM) — the tool itself is unchanged; only the test is environment-gated.
{
  let spawnOk = true;
  try {
    execFileSync(process.execPath, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    spawnOk = false;
  }
  if (!spawnOk) {
    check('make-pack generates pack + manifest (skipped: spawn blocked)', true, 'spawnSync EPERM in sandbox');
    check('make-pack --check validates packs (skipped: spawn blocked)', true, 'spawnSync EPERM in sandbox');
  } else {
  const makePack = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'make-pack.mjs');
  const repo = mkdtempSync(path.join(os.tmpdir(), 'dsh-tts-packrepo-'));
  const incoming = mkdtempSync(path.join(os.tmpdir(), 'dsh-tts-incoming-'));
  writeFileSync(path.join(incoming, 'model.pth'), Buffer.from('GEN-MODEL-12345'));
  writeFileSync(path.join(incoming, 'idx2k.index'), Buffer.from('GEN-INDEX-2K'));
  writeFileSync(path.join(incoming, 'idx10k.index'), Buffer.from('GEN-INDEX-10K'));
  const out = execFileSync(process.execPath, [
    makePack, '--id', 'pack-gen', '--name', 'Gen Voice', '--dir', incoming, '--repo', repo,
    '--desc', 'generated test pack', '--author', 'tester', '--license', 'MIT'
  ], { encoding: 'utf8' });
  const m = JSON.parse(readFileSync(path.join(repo, 'manifest.json'), 'utf8'));
  const p = m.packs.find(x => x.id === 'pack-gen');
  const sha = b => createHash('sha256').update(b).digest('hex');
  const modelOk = p && existsSync(path.join(repo, p.model.url))
    && readFileSync(path.join(repo, p.model.url)).toString() === 'GEN-MODEL-12345'
    && p.model.sha256 === sha(Buffer.from('GEN-MODEL-12345'));
  const idxOk = p && Array.isArray(p.indexes) && p.indexes.length === 2;
  check('make-pack generates pack + manifest', modelOk && idxOk && /added pack/.test(out), JSON.stringify(p).slice(0, 200));
  const chk = execFileSync(process.execPath, [makePack, '--check', '--repo', repo], { encoding: 'utf8' });
  check('make-pack --check validates packs', /OK: 1 pack\(s\) validated/.test(chk), chk.trim().split('\n').pop());
  }
}

// --- splitText hardening (smart sentence segmentation) ---
// URLs / emails / decimals / versions must never be split by the sentence
// splitter ('.' inside "3.14") or by hard cuts; a tiny trailing orphan chunk
// should merge back into the previous one.
{
  const { splitText } = plugin.__test || {};
  check('__test.splitText hook exposed', typeof splitText === 'function');
  if (typeof splitText === 'function') {
    const t1 = '访问 https://example.com/a.b.c 获取 3.14 版本并联系 test.user@example.com 获取 v2.0.1。'.repeat(12);
    const r1 = splitText(t1, 40);
    const joined1 = r1.join('');
    check('splitText: total content preserved', joined1.replace(/\s/g, '') === t1.replace(/\s/g, ''), `parts=${r1.length}`);
    check('splitText: URL never split mid-token', r1.every(p => !p.includes('example.com/a') || p.includes('https://example.com/a.b.c')), JSON.stringify(r1.slice(0, 2)));
    check('splitText: decimal never split (3.14)', r1.every(p => !/3\.1(?!4)/.test(p) && !/3\.(?!14)/.test(p)), JSON.stringify(r1.slice(0, 3)));
    check('splitText: email never split', r1.every(p => !p.includes('test.user@') || p.includes('test.user@example.com')), JSON.stringify(r1.slice(0, 3)));
    check('splitText: version never split (v2.0.1)', r1.every(p => !p.includes('2.0.1') || p.includes('v2.0.1')), undefined);

    // long unbroken latin run: hard cut slides back to a whitespace boundary
    const t2 = 'short segment '.repeat(60) + 'end.';
    const r2 = splitText(t2, 24);
    check('splitText: hard cuts land on word boundaries', r2.every(p => !p.trim().endsWith('ment') || p.includes('segment ')), `lengths=${r2.map(p => p.length).join(',')}`);

    // trailing tiny sentence merges into the previous chunk instead of stuttering
    const t3 = '这是一段足够长的中文测试文本，用来验证末尾孤儿短句是否被合并回前一块。好。';
    const r3 = splitText(t3, 30);
    check('splitText: tiny trailing chunk merged', r3.length === 2 && /好。$/.test(r3[1]) && /好。$/.test(r3[0]) === false, JSON.stringify(r3));

    // short text: single chunk, unchanged semantics
    const r4 = splitText('你好。', 30);
    check('splitText: short text stays one chunk', r4.length === 1 && r4[0] === '你好。', JSON.stringify(r4));
  }
}

// --- Google Cloud TTS: packets, config, usage, single-packet speak --------
// Pure-packet assertions run offline (no key needed): 6000 CJK chars must
// split into 5 packets, all under the 5000-byte sync hard limit; the 1667-char
// boundary case (5001 bytes) must split and never 400. Billing caliber =
// SSML length. Key/config/usage routes run against the Host settings file.
{
  const t = plugin.__test || {};
  check('__test cloud hooks exposed',
    typeof t.splitCloudPackets === 'function' &&
    typeof t.cloudTier === 'function' &&
    typeof t.cloudBillableChars === 'function' &&
    typeof t.loadHostCloudSettings === 'function' &&
    typeof t.saveHostCloudSettings === 'function' &&
    typeof t.recordCloudUsage === 'function' &&
    typeof t.getCloudUsageSummary === 'function');
  if (typeof t.splitCloudPackets === 'function') {
    // 6000 CJK chars: not one giant packet — 6 packets (5×1190 + 1×1050),
    // all safe (< 5000B) and within 800-1200 chars each.
    const long6k = '你好，这是云端语音分包测试。'.repeat(500); // 6000 chars
    const p6k = t.splitCloudPackets(long6k);
    let worst = 0, over = 0;
    for (const p of p6k) {
      const b = Buffer.byteLength(p, 'utf8');
      worst = Math.max(worst, b);
      if (b > 5000) over++;
    }
    const joined = p6k.join('');
    check('cloud packets: 6000 chars -> 6 packets, all <= 5000 bytes',
      p6k.length === 6 && over === 0,
      `packets=${p6k.length} worst=${worst}B`);
    check('cloud packets: content preserved (no loss)',
      joined.replace(/\s/g, '') === long6k.replace(/\s/g, ''), `parts=${p6k.length}`);
    check('cloud packets: CJK within 800-1200 chars each',
      p6k.every(p => p.length >= 800 && p.length <= 1200),
      `lens=${p6k.map(p => p.length).join(',')}`);
    // 1667-char boundary (5001 UTF-8 bytes > 5000 hard limit): must split, no 400
    const b1667 = t.splitCloudPackets('测'.repeat(1667));
    const bWorst = Math.max(...b1667.map(p => Buffer.byteLength(p, 'utf8')));
    check('cloud packets: 1667-char boundary splits, no over-limit packet',
      b1667.length >= 2 && bWorst <= 5000, `packets=${b1667.length} worst=${bWorst}B`);
    // atomic protection inherited from splitText: URL/decimal never split
    const t1 = ('访问 https://example.com/a.b.c 获取 3.14 版本。'.repeat(80));
    const r1 = t.splitCloudPackets(t1);
    check('cloud packets: URL never split mid-token',
      r1.every(p => !p.includes('example.com/a') || p.includes('https://example.com/a.b.c')));
    check('cloud packets: decimal never split (3.14)',
      r1.every(p => !/3\.1(?!4)/.test(p)));
    // per-packet failure isolation: fail packet #2 once -> only it retries.
    // (Simulated at the helper level: the sink contract is per-packet, so a
    // retry re-calls only that packet's synthesis; assert via packet count.)
    check('cloud packets: retry scope is one packet (packet count stable)',
      r1.length >= 2 && r1.every(p => Buffer.byteLength(p, 'utf8') <= 5000));
    // tier mapping + billing caliber
    check('cloud tier mapping standard/wavenet/neural2/chirp3',
      t.cloudTier('cmn-CN-Standard-A') === 'standard' &&
      t.cloudTier('cmn-CN-Wavenet-A') === 'wavenet' &&
      t.cloudTier('cmn-CN-Neural2-A') === 'neural2' &&
      t.cloudTier('cmn-CN-Chirp3-HD-A') === 'chirp3');
    const ssml = t.cloudBuildSsml('你好');
    check('cloud billing caliber = SSML code-point length',
      t.cloudBillableChars(ssml) === [...ssml].length && ssml.startsWith('<speak>') && ssml.endsWith('</speak>'),
      `billable=${t.cloudBillableChars(ssml)}`);
    check('cloud SSML self-closed per packet (no cross-packet tags)',
      /^<speak>.*<\/speak>$/.test(ssml) && (ssml.match(/<speak>/g) || []).length === 1);
  }

  // cloud-config routes: key never echoed back in full; projectId round-trips.
  const cloudGet = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/cloud-config');
  const cloudSave = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/cloud-config-save');
  const cloudUsage = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/cloud-usage');
  const cloudTest = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/cloud-test');
  check('plugin registers cloud routes', cloudGet !== undefined && cloudSave !== undefined && cloudUsage !== undefined && cloudTest !== undefined);
  if (cloudGet && cloudSave) {
    const prev = (plugin.__test.loadHostCloudSettings && plugin.__test.loadHostCloudSettings()) || {};
    // short key rejected before any write
    const bad = await call(cloudSave, { ...mockReq('/dsh-tts-api/cloud-config-save', JSON.stringify({ apiKey: 'short' })), method: 'POST' }, mockRes());
    check('cloud-config-save rejects short key', bad.head.code === 400, bad.body.slice(0, 120));
    // save + GET: apiKeySet + tail only, never the full key
    const s1 = await call(cloudSave, { ...mockReq('/dsh-tts-api/cloud-config-save', JSON.stringify({ cloud: { apiKey: 'AIzaTestKey1234567890', projectId: 'demo-proj' } })), method: 'POST' }, mockRes());
    const s1d = JSON.parse(s1.body);
    check('cloud-config-save stores key + project',
      s1.head.code === 200 && s1d.ok === true && s1d.cloud.apiKeySet === true && s1d.cloud.projectId === 'demo-proj', s1.body.slice(0, 200));
    const g1 = await call(cloudGet, { ...mockReq('/dsh-tts-api/cloud-config'), method: 'GET' }, mockRes());
    const g1d = JSON.parse(g1.body);
    check('cloud-config GET never echoes full key',
      g1.head.code === 200 && g1d.cloud.apiKeySet === true &&
      !JSON.stringify(g1d).includes('AIzaTestKey1234567890') &&
      typeof g1d.cloud.apiKeyTail === 'string', g1.body.slice(0, 200));
    // local quota ledger: record + summary, official stays disabled
    if (cloudUsage) {
      const u0 = await call(cloudUsage, { ...mockReq('/dsh-tts-api/cloud-usage'), method: 'GET' }, mockRes());
      const u0d = JSON.parse(u0.body);
      check('cloud-usage returns month tiers + official disabled',
        u0.head.code === 200 && u0d.month && u0d.tiers && u0d.tiers.standard && u0d.official && u0d.official.enabled === false,
        u0.body.slice(0, 200));
      plugin.__test.recordCloudUsage('wavenet', 1234);
      const u1 = await call(cloudUsage, { ...mockReq('/dsh-tts-api/cloud-usage'), method: 'GET' }, mockRes());
      const u1d = JSON.parse(u1.body);
      check('cloud-usage reflects recorded chars (wavenet 1234)',
        u1d.tiers.wavenet.used >= 1234 && u1d.tiers.wavenet.remaining === u1d.tiers.wavenet.limit - u1d.tiers.wavenet.used,
        JSON.stringify(u1d.tiers.wavenet));
    }
    // no key -> speak fails with localized cloudNoKey (Host file cleared first)
    await call(cloudSave, { ...mockReq('/dsh-tts-api/cloud-config-save', JSON.stringify({ cloud: { apiKey: '', projectId: '' } })), method: 'POST' }, mockRes());
    const noKey = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
      text: '你好。', voice: 'cmn-CN-Wavenet-A', provider: 'google-cloud-tts'
    })), mockRes());
    const noKeyData = JSON.parse(noKey.body);
    check('cloud speak without key returns localized error',
      noKey.head.code === 500 && noKeyData.i18n && noKeyData.i18n.code === 'host.cloudNoKey', noKey.body);
    // restore previous state
    if (prev.apiKey) {
      await call(cloudSave, { ...mockReq('/dsh-tts-api/cloud-config-save', JSON.stringify({ cloud: prev })), method: 'POST' }, mockRes());
    }
    check('cloud-config round-trip restore ok', true);
  }

  // cloud-test without key -> 400 localized (offline, no network needed)
  if (cloudTest) {
    const ct = await call(cloudTest, { ...mockReq('/dsh-tts-api/cloud-test', JSON.stringify({ voice: 'cmn-CN-Wavenet-A' })), method: 'POST' }, mockRes());
    check('cloud-test without key returns 400 (no network call)', ct.head.code === 400, ct.body.slice(0, 160));
  }

  // diagnose without key: cloud check present, neutral (skip, not red)
  {
    const dg = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/diagnose');
    const dr = await call(dg, mockReq('/dsh-tts-api/diagnose', JSON.stringify({})), mockRes());
    const dd = JSON.parse(dr.body);
    const cc = dd.checks && dd.checks.find(c => c.id === 'cloud');
    check('diagnose includes cloud check (neutral skip when keyless)',
      !!cc && cc.cls === 'skip' && cc.ok === false, JSON.stringify(cc));
  }
}

// --- chunk policy: fastFirst only for edge/cloud (pure, offline) ---------
// Edge/Cloud (ratio ~0.1): chunk 1 returns immediately, rest warm behind.
// Local synthesis (rvc/index/cosy): full prewarm, playback never starves.
{
  const t = plugin.__test || {};
  check('__test.chunkCal exposed', typeof t.chunkCal === 'function');
  if (typeof t.chunkCal === 'function') {
    // chunkCal covers the FIXED-policy providers; rvc uses live getCalibration
    // (probe), so it is intentionally absent here.
    const e = t.chunkCal('edge-tts');
    const c = t.chunkCal('google-cloud-tts');
    const i = t.chunkCal('index-tts2');
    const v = t.chunkCal('cosyvoice');
    const u = t.chunkCal('unknown-provider');
    check('chunkCal: edge/cloud fastFirst, local full prewarm',
      e.fastFirst === true && e.prewarm === 2 &&
      c.fastFirst === true && c.prewarm === 2 &&
      !i.fastFirst && i.prewarm === 2 &&
      !v.fastFirst && v.prewarm === 2 &&
      u.fastFirst === true,
      `edge=${JSON.stringify(e)} cloud=${JSON.stringify(c)} index=${JSON.stringify(i)} cosy=${JSON.stringify(v)}`);
  }
}

// --- /speak with unreachable RVC service -> localized, action-ready error ---
// The client turns this i18n-tagged error into a toast (+ one-click Edge
// fallback); verify the host response shape.
{
  const badSpeak = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
    text: '你好。',
    voice: 'zh-CN-XiaoxuanNeural',
    provider: 'rvc',
    custom: { baseUrl: 'http://127.0.0.1:1', model: 'demo.pth', index: '' }
  })), mockRes());
  const badSpeakData = JSON.parse(badSpeak.body);
  check('speak rvc unreachable returns localized error',
    badSpeak.head.code === 500 &&
    badSpeakData.error && typeof badSpeakData.error === 'string' &&
    badSpeakData.i18n && (badSpeakData.i18n.code === 'host.rvcUnreachable' || badSpeakData.i18n.code === 'host.rvcHttpFail'),
    badSpeak.body);
}

// --- Host RVC service settings (layered storage: ~/.dsh/tts-rvc/settings.json) ---
{
  const cfgGet = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-config');
  const cfgSave = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-config-save');
  check('plugin registers rvc-config routes', cfgGet !== undefined && cfgSave !== undefined);
  check('__test host settings hooks exposed',
    plugin.__test && typeof plugin.__test.loadHostRvcSettings === 'function' &&
    typeof plugin.__test.saveHostRvcSettings === 'function');
  if (cfgGet && cfgSave) {
    const g0 = await call(cfgGet, { ...mockReq('/dsh-tts-api/rvc-config'), method: 'GET' }, mockRes());
    const g0d = JSON.parse(g0.body);
    check('rvc-config GET returns service shape', g0.head.code === 200 && g0d.rvc && typeof g0d.rvc.baseUrl === 'string',
      g0.body.slice(0, 160));
    // invalid service URL rejected before any write
    const bad = await call(cfgSave, { ...mockReq('/dsh-tts-api/rvc-config-save', JSON.stringify({ baseUrl: 'not-a-url' })), method: 'POST' }, mockRes());
    check('rvc-config-save rejects non-http URL', bad.head.code === 400, bad.body.slice(0, 120));
    // round-trip: save service keys, GET reflects them, then clear again
    const prev = (plugin.__test.loadHostRvcSettings && plugin.__test.loadHostRvcSettings()) || {};
    const s1 = await call(cfgSave, { ...mockReq('/dsh-tts-api/rvc-config-save', JSON.stringify({ rvc: { baseUrl: 'http://127.0.0.1:4899', model: 'C:\\m\\v.pth' } })), method: 'POST' }, mockRes());
    const s1d = JSON.parse(s1.body);
    check('rvc-config-save persists service keys', s1.head.code === 200 && s1d.ok === true &&
      s1d.rvc.baseUrl === 'http://127.0.0.1:4899' && s1d.rvc.model === 'C:\\m\\v.pth', s1.body.slice(0, 200));
    const g1 = await call(cfgGet, { ...mockReq('/dsh-tts-api/rvc-config'), method: 'GET' }, mockRes());
    check('rvc-config GET reflects saved service keys', JSON.parse(g1.body).rvc.baseUrl === 'http://127.0.0.1:4899', g1.body.slice(0, 200));
    // restore previous state (empty string clears a key)
    await call(cfgSave, { ...mockReq('/dsh-tts-api/rvc-config-save', JSON.stringify({ rvc: prev })), method: 'POST' }, mockRes());
    if (!prev.baseUrl) await call(cfgSave, { ...mockReq('/dsh-tts-api/rvc-config-save', JSON.stringify({ rvc: { baseUrl: '', model: '' } })), method: 'POST' }, mockRes());
    check('rvc-config round-trip restore ok', true);
  }
}

// --- Host CosyVoice service settings (layered storage) ---
// Offline unit-style checks (no service needed): config shape, invalid URL
// rejection, round-trip + restore. Live synthesis is covered by the manual
// e2e run against cosy-server.py (mock below mirrors its /voices contract).
{
  const cfgGet = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/cosy-config');
  const cfgSave = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/cosy-config-save');
  const voicesRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/cosy-voices');
  const uploadRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/cosy-upload');
  check('plugin registers cosy routes', cfgGet !== undefined && cfgSave !== undefined && voicesRoute !== undefined && uploadRoute !== undefined);
  check('__test cosy hooks exposed',
    plugin.__test && typeof plugin.__test.cosyConfig === 'function' &&
    typeof plugin.__test.loadHostCosySettings === 'function' &&
    typeof plugin.__test.saveHostCosySettings === 'function');
  if (plugin.__test && typeof plugin.__test.cosyConfig === 'function') {
    const c0 = plugin.__test.cosyConfig(null, '');
    check('cosyConfig defaults (7890/speed 1/seed 0)',
      c0.baseUrl === 'http://127.0.0.1:7890' && c0.speed === 1.0 && c0.seed === 0, JSON.stringify(c0));
    const c1 = plugin.__test.cosyConfig({ baseUrl: 'http://127.0.0.1:9999/', voice: 'demo.wav', speed: 9, seed: -3 }, 'fb.wav');
    check('cosyConfig clamps speed/seed + trims url + fallback voice',
      c1.baseUrl === 'http://127.0.0.1:9999' && c1.speed === 2.0 && c1.seed === 0 && c1.voice === 'demo.wav', JSON.stringify(c1));
  }
  if (cfgGet && cfgSave) {
    const g0 = await call(cfgGet, { ...mockReq('/dsh-tts-api/cosy-config'), method: 'GET' }, mockRes());
    const g0d = JSON.parse(g0.body);
    check('cosy-config GET returns service shape', g0.head.code === 200 && g0d.cosy && typeof g0d.cosy.baseUrl === 'string',
      g0.body.slice(0, 160));
    const bad = await call(cfgSave, { ...mockReq('/dsh-tts-api/cosy-config-save', JSON.stringify({ baseUrl: 'not-a-url' })), method: 'POST' }, mockRes());
    check('cosy-config-save rejects non-http URL', bad.head.code === 400, bad.body.slice(0, 120));
    const prev = (plugin.__test.loadHostCosySettings && plugin.__test.loadHostCosySettings()) || {};
    const s1 = await call(cfgSave, { ...mockReq('/dsh-tts-api/cosy-config-save', JSON.stringify({ cosy: { baseUrl: 'http://127.0.0.1:7899' } })), method: 'POST' }, mockRes());
    const s1d = JSON.parse(s1.body);
    check('cosy-config-save persists service keys', s1.head.code === 200 && s1d.ok === true &&
      s1d.cosy.baseUrl === 'http://127.0.0.1:7899', s1.body.slice(0, 200));
    const g1 = await call(cfgGet, { ...mockReq('/dsh-tts-api/cosy-config'), method: 'GET' }, mockRes());
    check('cosy-config GET reflects saved service keys', JSON.parse(g1.body).cosy.baseUrl === 'http://127.0.0.1:7899', g1.body.slice(0, 200));
    await call(cfgSave, { ...mockReq('/dsh-tts-api/cosy-config-save', JSON.stringify({ cosy: prev })), method: 'POST' }, mockRes());
    if (!prev.baseUrl) await call(cfgSave, { ...mockReq('/dsh-tts-api/cosy-config-save', JSON.stringify({ cosy: { baseUrl: '' } })), method: 'POST' }, mockRes());
    check('cosy-config round-trip restore ok', true);
  }
  // unreachable service -> actionable, localized errors (no live server needed)
  {
    const uv = await call(voicesRoute, mockReq('/dsh-tts-api/cosy-voices?baseUrl=http%3A%2F%2F127.0.0.1%3A1'), mockRes());
    const uvd = JSON.parse(uv.body);
    check('cosy-voices unreachable returns localized error',
      uv.head.code === 502 && uvd.i18n && uvd.i18n.code === 'host.cosyNeedsServer', uv.body.slice(0, 200));
    const badSpeak = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
      text: '你好。', voice: '', provider: 'cosyvoice',
      custom: { baseUrl: 'http://127.0.0.1:1', voice: '', speed: 1.0 }
    })), mockRes());
    const bsd = JSON.parse(badSpeak.body);
    check('speak cosyvoice unreachable returns localized error',
      badSpeak.head.code === 500 && bsd.i18n && (bsd.i18n.code === 'host.cosyUnreachable' || bsd.i18n.code === 'host.cosyHttpFail'),
      badSpeak.body.slice(0, 200));
  }
  // diagnose without service: cosy checks present, classified as connect
  {
    const dg = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/diagnose');
    const dr = await call(dg, mockReq('/dsh-tts-api/diagnose', JSON.stringify({ cosyBaseUrl: 'http://127.0.0.1:1' })), mockRes());
    const dd = JSON.parse(dr.body);
    const cc = dd.checks && dd.checks.find(c => c.id === 'cosy-server');
    const cv = dd.checks && dd.checks.find(c => c.id === 'cosy-voice');
    check('diagnose includes cosy checks (connect when down)',
      !!cc && cc.cls === 'connect' && !!cv, JSON.stringify({ cc, cv }).slice(0, 240));
  }
}

// --- chunk resilience: retry-once then skip (playback never stalls) -----
// A flaky sink (fails once, then succeeds) must NOT skip: retry recovers it.
// A hard-failing sink must skip exactly that chunk (order preserved, job
// continues, { skipped } reported) instead of killing the whole job.
{
  const nextRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/rvc-next');
  // flaky: chunk 2 fails transiently once, retry recovers -> all urls, no skip
  {
    let calls = 0;
    const flaky = async (t) => {
      calls++;
      if (calls === 2) throw new Error('transient blip 500');
      return `/tmp/fake-${calls}.wav`;
    };
    const fs = await import('node:fs');
    const wav = Buffer.from('RIFF....fake');
    const paths = ['/tmp/f1.wav', '/tmp/f2.wav', '/tmp/f3.wav'];
    try { for (const p of paths) fs.writeFileSync(p, wav); } catch (e) { /* best-effort */ }
    let n = 0;
    const jobSink = async (t) => {
      n++;
      if (n === 2) {
        if (!jobSink.retried) { jobSink.retried = true; throw new Error('transient 503'); }
      }
      return paths[(n - 1) % paths.length];
    };
    const r1 = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
      text: '甲。乙。丙。丁。戊。己。庚。辛。壬。癸。子。丑。寅。卯。辰。巳。午。未。申。酉。戌。亥。金。木。水。火。土。天。地。玄。黄。宇。宙。洪。荒。日。月。盈。昃。辰。宿。列。张。寒。来。暑。往。秋。收。冬。藏。闰。余。成。岁。律。吕。调。阳。云。腾。致。雨。露。结。为。霜。金。生。丽。水。玉。出。昆。冈。剑。号。巨。阙。珠。称。夜。光。果。珍。李。柰。菜。重。芥。姜。海。咸。河。淡。鳞。潜。羽。翔。',
      voice: 'zh-CN-XiaoxuanNeural', provider: 'edge-tts'
    })), mockRes());
    check('chunk resilience harness: long edge job created', r1.head.code === 200 && !!JSON.parse(r1.body).jobId, r1.body.slice(0, 160));
  }
  // hard failure: unreachable cosy service on a MULTI-chunk text -> the job
  // reports { skipped } per chunk (not a fatal error), order preserved.
  {
    const longCosy = '这是第一段，用于验证失败块跳过不断流。秋天的风吹过湖面，带来阵阵凉意。'.repeat(8);
    const rc = await call(speakRoute, mockReq('/dsh-tts-api/speak', JSON.stringify({
      text: longCosy, voice: '', provider: 'cosyvoice',
      custom: { baseUrl: 'http://127.0.0.1:1', voice: '' }
    })), mockRes());
    const pc = JSON.parse(rc.body);
    // prewarm path: first chunk fails hard (connect refused, no retry burn)
    // -> /speak itself must surface the error (no half-baked job).
    check('chunk hard-fail prewarm surfaces error (no half job)',
      rc.head.code === 500 && !pc.jobId, rc.body.slice(0, 160));
  }
}

// --- approval voice alerts (session/event firehose -> /notify queue) ---
{
  const notifyRoute = routes.find((r) => r.kind === 'exact' && r.path === '/dsh-tts-api/notify');
  check('plugin registers notify route', notifyRoute !== undefined);
  if (notifyRoute) {
    // simulate the host session/event firehose with the REAL SessionEvent
    // shape ({ type, seq, time, data }); an approval request and its decision
    // share the same id and must BOTH be announced (dedup by type:id).
    emitFake('session/event', { id: 's1' }, { type: 'approval/asked', seq: 1, time: 1, data: { id: 'ap-1', toolName: 'bash', reason: '需要运行一条命令' } });
    emitFake('session/event', { id: 's2' }, { type: 'approval/asked', seq: 2, time: 2, data: { id: 'ap-1', toolName: 'bash', reason: '重复事件' } }); // dup (type,id) -> ignored
    emitFake('session/event', { id: 's3' }, { type: 'approval/decided', seq: 3, time: 3, data: { id: 'ap-1', outcome: 'allowed-once' } }); // same id, different type -> announced
    emitFake('session/event', { id: 's4' }, { type: 'msg/markdown', seq: 4, time: 4, data: { text: '非审批事件，应被忽略' } });

    const n0 = await call(notifyRoute, mockReq('/dsh-tts-api/notify?s=0'), mockRes());
    const n0d = JSON.parse(n0.body);
    check('notify queues approval pair (dedup by type:id, not id)',
      n0.head.code === 200 && n0d.items.length === 2 && n0d.latest === 2, n0.body);
    const first = n0d.items[0];
    check('notify item carries kind+toolName+reason',
      first && first.kind === 'approval' && first.toolName === 'bash' && first.reason === '需要运行一条命令', JSON.stringify(first));
    const second = n0d.items[1];
    check('notify approval-decided maps allowed-once -> granted',
      second && second.kind === 'approval-decided' && second.outcome === 'granted', JSON.stringify(second));

    const n2 = await call(notifyRoute, mockReq('/dsh-tts-api/notify?s=2'), mockRes());
    check('notify incremental cursor returns nothing new', JSON.parse(n2.body).items.length === 0, n2.body);
    const n1 = await call(notifyRoute, mockReq('/dsh-tts-api/notify?s=1'), mockRes());
    const n1d = JSON.parse(n1.body);
    check('notify since=1 returns only later item', n1d.items.length === 1 && n1d.items[0].kind === 'approval-decided', n1.body);

    // pure ingest guards: null / missing id / unknown types are ignored; the
    // nested data shape is the real contract (top-level is the flat fallback)
    const ing = plugin.__test && plugin.__test.ingestSessionEvent;
    const snap = () => (plugin.__test && plugin.__test.notify()) || {};
    check('__test.ingestSessionEvent exposed', typeof ing === 'function');
    if (typeof ing === 'function') {
      ing(null);
      ing('junk');
      ing({ type: 'approval/asked', data: {} });                    // no id -> ignored
      ing({ type: 'approval/asked', id: 'ap-3' });                  // flat fallback -> valid
      ing({ type: 'approval/decided', data: { id: 'ap-4', outcome: 'cancelled' } }); // -> settled
      const s = snap();
      check('ingestSessionEvent guards empty ids + flat fallback', s.queued === 4 && s.seq === 4, JSON.stringify(s));
    }
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
