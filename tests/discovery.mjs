// Provider discovery / candidate library (stage 1+2).
//
// The scanner must never identify a model by its extension or folder name: a
// .pth is a torch container shared by RVC, GPT-SoVITS, Index-TTS2, CosyVoice
// and everything else that calls torch.save. These fixtures build real zip
// containers and install layouts so the content-level checks are exercised
// without touching a real model or network.
//   node tests/discovery.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'dsh-tts-disc-'));
process.env.DSH_TTS_HOME = path.join(tmpRoot, 'home');

const host = await import('../lib/index.mjs');
const T = host.__test;

// ---- tiny zip writer: enough for torch.save-shaped containers -------------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function makeZip(file, entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const comp = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  writeFileSync(file, Buffer.concat([...locals, cd, eocd]));
}
const pickleBytes = (keys) => Buffer.concat([
  Buffer.from([0x80, 0x02, 0x7d, 0x71, 0x00]),
  Buffer.from(keys.map((k) => `X\x01\x00\x00\x00${k}`).join(''), 'latin1'),
  Buffer.from('.', 'latin1')
]);

// ---- RVC: torch zip with the v2 checkpoint keys ---------------------------
{
  const dir = path.join(tmpRoot, 'rvc');
  mkdirSync(dir, { recursive: true });
  const model = path.join(dir, 'demo-voice.pth');
  makeZip(model, { 'archive/data.pkl': pickleBytes(['weight', 'config', 'version', 'info', 'sr', 'f0']), 'archive/data/0': Buffer.alloc(2048, 1) });
  writeFileSync(path.join(dir, 'demo-voice.index'), Buffer.concat([Buffer.from('IxF2', 'latin1'), Buffer.alloc(64)]));
  const info = T.inspectRvcCheckpoint(model);
  check('RVC v2 checkpoint: strong structural match', !!info && info.strong === true, info && 'keys=' + info.keys.join('/'));
  check('RVC v2 checkpoint: version detected', !!info && info.version === 'v2', info && 'version=' + info.version);
  const cand = T.buildCandidate('rvc', 'model', {
    label: 'demo-voice.pth', paths: { file: model, index: path.join(dir, 'demo-voice.index') },
    evidence: ['zip'], confidence: 'high', fingerprint: T.fileFingerprint(model, 'partial')
  });
  const again = T.buildCandidate('rvc', 'model', {
    label: 'demo-voice.pth', paths: { file: model }, evidence: ['zip'], confidence: 'high',
    fingerprint: T.fileFingerprint(model, 'partial')
  });
  check('content id ignores paths (same model, same id)', cand.id === again.id, cand.id);
  const moved = path.join(tmpRoot, 'renamed-folder', 'whatever-name.pth');
  mkdirSync(path.dirname(moved), { recursive: true });
  copyFileSync(model, moved);
  const movedCand = T.buildCandidate('rvc', 'model', {
    label: 'whatever-name.pth', paths: { file: moved }, evidence: ['zip'], confidence: 'high',
    fingerprint: T.fileFingerprint(moved, 'partial')
  });
  check('content id survives rename/move', movedCand.id === cand.id, movedCand.id);
}

// ---- discriminator: D_ prefix lowers confidence, still identifiable ------
{
  const dir = path.join(tmpRoot, 'rvc-d');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'D_demo.pth');
  makeZip(file, { 'archive/data.pkl': pickleBytes(['weight', 'config', 'version', 'sr', 'f0']) });
  const info = T.inspectRvcCheckpoint(file);
  check('RVC D_ checkpoint: flagged as discriminator candidate', !!info && info.discriminator === true);
}

// ---- non-RVC torch weights stay unidentified ------------------------------
{
  const dir = path.join(tmpRoot, 'other');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'gpt.pth');
  makeZip(file, { 'archive/data.pkl': pickleBytes(['model', 'layers', 'weight']) });
  const info = T.inspectRvcCheckpoint(file);
  check('generic state_dict (Index-TTS2-like): not claimed as RVC', !!info && !info.strong, info && 'keys=' + info.keys.join('/'));
  const idx = path.join(dir, 'x.index');
  writeFileSync(idx, Buffer.concat([Buffer.from('XXXX', 'latin1'), Buffer.alloc(32)]));
  check('foreign .index file: faiss magic rejected', T.inspectFaissIndex(idx) === false);
}

// ---- GPT-SoVITS install ---------------------------------------------------
{
  const dir = path.join(tmpRoot, 'GPT-SoVITS');
  mkdirSync(path.join(dir, 'GPT_SoVITS', 'configs'), { recursive: true });
  writeFileSync(path.join(dir, 'api_v2.py'), 'import argparse\n');
  writeFileSync(path.join(dir, 'GPT_SoVITS', 'configs', 'tts_infer.yaml'), [
    'custom:',
    '  bert_base_path: GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large',
    '  t2s_weights_path: GPT_weights_v4/speaker-a-e15.ckpt',
    '  version: v4',
    '  vits_weights_path: SoVITS_weights_v4/speaker_a_e2.pth'
  ].join('\n'));
  const cand = T.detectGsvInstall(dir);
  check('GPT-SoVITS install: tts_infer.yaml identifies it', !!cand && cand.confidence === 'high', cand && cand.evidence.join(' | '));
  check('GPT-SoVITS install: version carried as evidence', !!cand && cand.evidence.some((e) => e.includes('v4')), cand && cand.meta.version);
}

// ---- Index-TTS2 install ---------------------------------------------------
{
  const dir = path.join(tmpRoot, 'index-tts2');
  mkdirSync(path.join(dir, 'indextts'), { recursive: true });
  mkdirSync(path.join(dir, 'checkpoints'), { recursive: true });
  writeFileSync(path.join(dir, 'checkpoints', 'config.yaml'), 'gpt_path: checkpoints/gpt.pth\ns2mel_path: checkpoints/s2mel.pth\n');
  const cand = T.detectIndexInstall(dir);
  check('Index-TTS2 install: package + checkpoints config', !!cand && cand.confidence === 'high', cand && cand.evidence.join(' | '));
}

// ---- CosyVoice install ----------------------------------------------------
{
  const dir = path.join(tmpRoot, 'CosyVoice');
  const model = path.join(dir, 'pretrained_models', 'CosyVoice2-0.5B');
  mkdirSync(model, { recursive: true });
  writeFileSync(path.join(model, 'cosyvoice2.yaml'), 'llm: llm.pt\nflow: flow.pt\nhift: hift.pt\n');
  for (const f of ['llm.pt', 'flow.pt', 'hift.pt']) writeFileSync(path.join(model, f), 'x');
  const cand = T.detectCosyInstall(dir);
  check('CosyVoice install: pretrained_models/CosyVoice2-0.5B', !!cand && cand.confidence === 'high', cand && cand.evidence.join(' | '));
}

// ---- Breeze TTS 2 checkpoint + repo ----------------------------------------
{
  const dir = path.join(tmpRoot, 'breeze-tts-2');
  mkdirSync(path.join(dir, 'audio_tokenizer'), { recursive: true });
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ codec_config: { _frame_rate: 12.5 } }));
  writeFileSync(path.join(dir, 'audio_tokenizer', 'config.json'), '{}');
  writeFileSync(path.join(dir, 'model-00001-of-00001.safetensors'), Buffer.from([0, 1, 2]));
  const cand = T.detectBreezeCheckpoint(dir);
  check('Breeze checkpoint: config + audio_tokenizer + weights',
    !!cand && cand.confidence === 'high' && cand.meta.modelDir === dir,
    cand && cand.evidence.join(' | '));
  check('Breeze checkpoint is not offered as a launchable install', !!cand && cand.meta.canStart === false);
  check('Breeze checkpoint carries the codec frame rate as evidence',
    !!cand && cand.evidence.some((e) => e.includes('frame_rate=12.5')));
  check('a bare config.json is not a Breeze checkpoint',
    T.detectBreezeCheckpoint(path.join(tmpRoot, 'not-breeze')) === null);
}

{
  const dir = path.join(tmpRoot, 'breeze-tts');
  mkdirSync(path.join(dir, 'breeze_infer'), { recursive: true });
  mkdirSync(path.join(dir, 'models'), { recursive: true });
  writeFileSync(path.join(dir, 'breeze_infer', 'api.py'), '');
  writeFileSync(path.join(dir, 'models', 'breeze.py'), '');
  writeFileSync(path.join(dir, 'requirements.txt'), 'torch\n');
  const cand = T.detectBreezeRepo(dir);
  check('Breeze repo: breeze_infer/api.py + models/breeze.py',
    !!cand && cand.confidence === 'high' && cand.kind === 'install',
    cand && cand.evidence.join(' | '));
  check('Breeze repo is launchable from discovery', !!cand && cand.meta.canStart === true);
}

// ---- Google service-account credential ------------------------------------
{
  const file = path.join(tmpRoot, 'gcp.json');
  writeFileSync(file, JSON.stringify({ type: 'service_account', project_id: 'demo', client_email: 'bot@demo.iam.gserviceaccount.com', private_key: '-----BEGIN-----' }));
  const cand = T.detectCloudCredential(file);
  check('Cloud credential: service_account JSON detected', !!cand && cand.confidence === 'high', cand && cand.evidence.join(' | '));
  check('Cloud candidate carries project id for auto-fill', !!cand && cand.meta && cand.meta.projectId === 'demo', cand && cand.meta.projectId);
  check('Cloud evidence never carries the raw e-mail', !!cand && !cand.evidence.join(' ').includes('bot@'), 'masked');
  writeFileSync(path.join(tmpRoot, 'not-gcp.json'), '{"hello":1}');
  check('ordinary JSON is not a credential', T.detectCloudCredential(path.join(tmpRoot, 'not-gcp.json')) === null);
}

// ---- aigcpanel-style CosyVoice bundle (server + nested model) -------------
{
  const bundle = path.join(tmpRoot, 'aigcpanel-server-Cosyvoice205b');
  const model = path.join(bundle, 'aigcpanelmodels', 'iic', 'CosyVoice2-0.5B');
  mkdirSync(model, { recursive: true });
  for (const f of ['llm.pt', 'flow.pt', 'hift.pt']) writeFileSync(path.join(model, f), 'x');
  writeFileSync(path.join(model, 'cosyvoice2.yaml'), 'llm: llm.pt\nflow: flow.pt\nhift: hift.pt\n');
  writeFileSync(path.join(bundle, 'cosy-server.py'), '');
  const cand = T.detectCosyInstall(bundle);
  check('CosyVoice bundle root: cosy-server.py + aigcpanelmodels/iic/CosyVoice2-0.5B',
    !!cand && cand.confidence === 'high' && cand.evidence.indexOf('cosy-server.py') !== -1,
    cand && cand.evidence.join(' | '));
}

// ---- breadth-first walk: a depth-4 install survives a deep sibling tree ---
{
  const gsv = path.join(tmpRoot, 'deep', 't1', 't2', 'GPT-SoVITS');
  mkdirSync(path.join(gsv, 'GPT_SoVITS', 'configs'), { recursive: true });
  writeFileSync(path.join(gsv, 'GPT_SoVITS', 'configs', 'tts_infer.yaml'), 'custom:\n  version: v2\n  t2s_weights_path: x.ckpt\n');
  let junk = path.join(tmpRoot, 'junk');
  for (let i = 0; i < 8; i++) {
    junk = path.join(junk, 'level' + i);
    mkdirSync(junk, { recursive: true });
    writeFileSync(path.join(junk, 'note.txt'), 'x');
  }
  T.saveDiscoveryStore({ roots: [tmpRoot], candidates: [] });
  const job = T.startDiscoveryScan({ targets: ['fs'], mode: 'quick' });
  const deadline = Date.now() + 20000;
  let status = T.discoveryScanStatus(job);
  while (status.state === 'running' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    status = T.discoveryScanStatus(job);
  }
  const labels = status.results.map((c) => c.paths && c.paths.dir).filter(Boolean);
  check('quick (BFS) finds a depth-4 install past a deeper junk tree',
    labels.some((d) => d.toLowerCase() === gsv.toLowerCase()), labels.slice(0, 6).join(' | '));
  check('quick (BFS) finds the aigcpanel CosyVoice bundle root',
    status.results.some((c) => c.provider === 'cosyvoice' && c.evidence.indexOf('cosy-server.py') !== -1));
}


{
  const vols = T.listDiscoveryVolumes();
  check('volume list for the folder picker', Array.isArray(vols) && vols.length >= 1
    && (/^[A-Za-z]:\\$/.test(vols[0]) || vols[0] === '/'), Array.isArray(vols) ? vols.join(',') : 'missing');
  T.saveDiscoveryStore({ roots: [], candidates: [] });
  const store = T.discoveryAddRoot(path.join(tmpRoot, 'rvc'));
  check('root registered', store.roots.length === 1, store.roots[0]);
  T.discoveryRemoveRoot(path.join(tmpRoot, 'rvc'));
  T.discoveryAddRoot(tmpRoot);

  const job = T.startDiscoveryScan({ targets: ['fs'], mode: 'deep' });
  const deadline = Date.now() + 15000;
  let status = T.discoveryScanStatus(job);
  while (status.state === 'running' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    status = T.discoveryScanStatus(job);
  }
  check('walk scan finishes', status.state === 'done', status.state + ' / ' + status.error);
  const providers = new Set(status.results.map((c) => c.provider));
  check('walk finds the RVC model', providers.has('rvc'), status.results.length + ' results');
  check('walk finds the GPT-SoVITS install', providers.has('gpt-sovits'));
  check('walk finds the Index-TTS2 install', providers.has('index-tts2'));
  check('walk finds the CosyVoice install', providers.has('cosyvoice'));
  check('walk finds the Breeze checkpoint and repo', providers.has('breeze-tts-2'));
  check('walk finds the Cloud credential', providers.has('google-cloud-tts'));
  const persisted = T.loadDiscoveryStore();
  check('candidate library starts empty until saved', persisted.candidates.length === 0);
  const saved = status.results.find((c) => c.provider === 'rvc');
  if (saved) {
    const after = await import('../lib/index.mjs');
    const stored = after.__test.loadDiscoveryStore();
    const merged = JSON.parse(JSON.stringify(after.__test.saveDiscoveryStore({
      roots: stored.roots,
      candidates: [saved]
    })));
    check('candidate persists to config/candidates.json', merged.candidates[0].id === saved.id);
  }
}

// ---- verify: an RVC model gets a full hash; a foreign file fails ----------
{
  const model = path.join(tmpRoot, 'rvc', 'demo-voice.pth');
  const store = T.loadDiscoveryStore();
  const cand = T.buildCandidate('rvc', 'model', {
    label: 'demo-voice.pth', paths: { file: model }, evidence: ['zip'], confidence: 'high',
    fingerprint: T.fileFingerprint(model, 'partial')
  });
  T.saveDiscoveryStore({ roots: store.roots, candidates: [cand] });
  const verified = await T.verifyDiscoveryCandidate(cand.id);
  check('verify: RVC model marked verified with full hash', verified.status === 'verified' && /^f1:/.test(verified.fingerprint.full), verified.status);

  const bogus = path.join(tmpRoot, 'bogus.pth');
  writeFileSync(bogus, 'not a zip');
  const bogusCand = T.buildCandidate('rvc', 'model', {
    label: 'bogus.pth', paths: { file: bogus }, evidence: [], confidence: 'low',
    fingerprint: T.fileFingerprint(bogus, 'partial')
  });
  T.saveDiscoveryStore({ roots: store.roots, candidates: [bogusCand] });
  let failed = false;
  try { await T.verifyDiscoveryCandidate(bogusCand.id); } catch (e) { failed = true; }
  check('verify: non-model file is refused', failed);
}

rmSync(tmpRoot, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} discovery checks passed`);
process.exit(failed === 0 ? 0 : 1);
