// @dsh-external/dsh-plugin-tts — Host half.
// Registers webServer routes:
//   POST /dsh-tts-api/speak            { text, voice } -> { url | jobId+chunks } | { error }
//   GET  /dsh-tts-audio/<id>                              -> audio bytes
//   GET  /dsh-tts-api/rvc-next?job=<id>                   -> { url, more } | { done }
//   GET  /dsh-tts-api/rvc-files?baseUrl=&kind=            -> { files }
//   POST /dsh-tts-api/rvc-compact-index                   -> compact .index
//   GET  /dsh-tts-api/rvc-packs?registry=<url>            -> { packs } (voice-pack manifest)
//   GET  /dsh-tts-api/rvc-packs-installed                 -> { installed }
//   POST /dsh-tts-api/rvc-pack-install {registry, packId} -> download+sha256-verify+install
// Synthesis runs a zero-dependency Edge TTS worker via `node -e`
// (Sec-MS-GEC query-param protocol, mirroring node-edge-tts@1.2.10).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const name = 'tts';
export const inject = ['webServer'];

const WORKER_SRC = `// edge-tts-worker — zero-dependency Edge TTS synthesis (Node >= 22).
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const WINDOWS_FILE_TIME_EPOCH = 11644473600n;
const WSS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const CRLF = String.fromCharCode(13, 10);
function generateSecMsGecToken() {
  const ticks = BigInt(Math.floor(Date.now() / 1000) + Number(WINDOWS_FILE_TIME_EPOCH)) * 10000000n;
  const roundedTicks = ticks - (ticks % 3000000000n);
  const hash = crypto.createHash('sha256');
  hash.update(String(roundedTicks) + TRUSTED_CLIENT_TOKEN, 'ascii');
  return hash.digest('hex').toUpperCase();
}
function readStdin() {
  return new Promise(function (resolve, reject) {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function (c) { data += c; });
    process.stdin.on('end', function () { resolve(data); });
    process.stdin.on('error', reject);
  });
}
function xmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function fail(msg) {
  console.error('ERR ' + msg);
  process.exit(1);
}
function synthesizeOnce(voice, text, outPath, lang, rate, pitch, volume) {
  return new Promise(function (resolve, reject) {
    const secMsGec = generateSecMsGecToken();
    const url = WSS_BASE + '?TrustedClientToken=' + TRUSTED_CLIENT_TOKEN + '&Sec-MS-GEC=' + secMsGec + '&Sec-MS-GEC-Version=1-' + CHROMIUM_FULL_VERSION;
    const ws = new WebSocket(url, {
      headers: {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    ws.binaryType = 'arraybuffer';
    const chunks = [];
    let settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      const buf = Buffer.concat(chunks);
      if (buf.length < 100) {
        try { ws.close(); } catch (e) {}
        reject('audio too small: ' + buf.length);
        return;
      }
      try {
        fs.writeFileSync(outPath, buf);
        try { ws.close(); } catch (e) {}
        resolve(buf.length);
      } catch (e) {
        reject('write ' + e.message);
      }
    }
    ws.onerror = function (e) {
      reject('websocket error: ' + (e && e.message ? e.message : String(e)));
    };
    ws.onclose = function (e) {
      if (!settled) reject('closed early code=' + e.code + ' reason=' + e.reason);
    };
    ws.onmessage = function (event) {
      if (settled) return;
      if (typeof event.data === 'string') {
        if (event.data.indexOf('Path:turn.end') >= 0) { finish(); return; }
        return;
      }
      const raw = Buffer.from(event.data);
      const marker = Buffer.from('Path:audio' + CRLF);
      const idx = raw.indexOf(marker);
      if (idx >= 0) {
        const body = raw.subarray(idx + marker.length);
        if (body.length > 0) chunks.push(body);
      } else if (raw.length > 0) {
        chunks.push(raw);
      }
    };
    ws.onopen = function () {
      const requestId = crypto.randomBytes(16).toString('hex');
      const speechConfig = { context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } };
      const ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="' + lang + '">' + '<voice name="' + xmlEscape(voice) + '">' + '<prosody rate="' + xmlEscape(rate) + '" pitch="' + xmlEscape(pitch) + '" volume="' + xmlEscape(volume) + '">' + xmlEscape(text) + '</prosody></voice></speak>';
      ws.send('Content-Type:application/json; charset=utf-8' + CRLF + 'Path:speech.config' + CRLF + CRLF + JSON.stringify(speechConfig));
      ws.send('X-RequestId:' + requestId + CRLF + 'Content-Type:application/ssml+xml' + CRLF + 'Path:ssml' + CRLF + CRLF + ssml);
    };
    setTimeout(function () {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch (e) {}
        reject('timeout');
      }
    }, 60000);
  });
}
function findVoiceArgs() {
  const args = process.argv;
  const out = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--' || a === '-e') continue;
    if (a.indexOf('.cjs') >= 0 || a.indexOf('.mjs') >= 0 || a.indexOf('edge-tts-worker') >= 0) continue;
    out.push(a);
  }
  return out;
}
async function main() {
  const args = findVoiceArgs();
  const voice = args[0] || 'zh-CN-XiaoxuanNeural';
  const rate = args[1] || 'default';
  const pitch = args[2] || 'default';
  const volume = args[3] || 'default';
  const text = (await readStdin()).trim();
  if (!text) return fail('empty text');
  const vparts = String(voice).split('-');
  const lang = (vparts.length >= 2 ? vparts[0] + '-' + vparts[1] : 'zh-CN');
  const outPath = path.join(os.tmpdir(), 'dsh-tts-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.mp3');
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const size = await synthesizeOnce(voice, text, outPath, lang, rate, pitch, volume);
      console.log('OK ' + outPath);
      console.log('SIZE ' + size);
      process.exit(0);
    } catch (e) {
      lastErr = e;
      const msg = String(e);
      if (msg.indexOf('1006') < 0) break;
    }
  }
  return fail(String(lastErr));
}
main().catch(function (e) {
  console.error('ERR fatal: ' + (e && e.stack ? e.stack : String(e)));
  process.exit(1);
});`;

/** Synthesize one text/voice pair; resolves with the absolute MP3 path. */
function synthesize(text, voice, prosody) {
  return new Promise((resolve, reject) => {
    const outPath = path.join(os.tmpdir(), `dsh-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
    const p = prosody || {};
    const argv = ['-e', WORKER_SRC, '--', voice,
      String(p.rate || 'default'),
      String(p.pitch || 'default'),
      String(p.volume || 'default')];
    const child = spawn(process.execPath, argv, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) { /* already gone */ }
    }, 65000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error('TTS spawn failed: ' + e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error('TTS worker exited ' + code + ': ' + (stderr.trim() || stdout.trim() || 'no output')));
        return;
      }
      const m = stdout.match(/^OK (.+)$/m);
      if (!m) {
        reject(new Error('TTS worker output unexpected: ' + stdout));
        return;
      }
      resolve(m[1]);
    });
    child.stdin.end(text);
  });
}

function writeJson(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function hashText(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// RVC provider: Edge TTS base audio -> local RVC inference server -> voice.
// The RVC server (rvc-server.py) exposes:
//   GET /health   POST /load {model,index}   POST /convert {audio_base64, params}
// ---------------------------------------------------------------------------

const RVC_DEFAULTS = {
  baseUrl: 'http://127.0.0.1:4892',
  model: '',
  index: '',
  baseSource: 'edge',          // 'edge' | 'upload'
  baseAudioName: '',           // uploaded base audio filename (upload mode)
  baseAudioBase64: '',         // uploaded base audio bytes (upload mode)
  baseVoice: 'zh-CN-YunyangNeural',
  baseRate: 'default',
  basePitch: 'default',
  baseVolume: 'default',
  spkId: 0,
  f0File: '',
  f0Method: 'rmvpe',
  indexRate: 0.75,
  f0UpKey: 0,
  resampleSr: 40000,
  rmsMixRate: 0.25,
  protect: 0.33,
  filterRadius: 3
};

let rvcLoadedKey = '';   // model|index fingerprint of the server-side loaded voice

function rvcConfig(custom) {
  const c = custom || {};
  return {
    baseUrl: String(c.baseUrl || RVC_DEFAULTS.baseUrl).replace(/\/+$/, ''),
    model: String(c.model || '').trim(),
    index: String(c.index || '').trim(),
    baseSource: String(c.baseSource || RVC_DEFAULTS.baseSource),
    baseAudioName: String(c.baseAudioName || '').trim(),
    baseAudioBase64: String(c.baseAudioBase64 || ''),
    baseVoice: String(c.baseVoice || RVC_DEFAULTS.baseVoice),
    baseRate: String(c.baseRate || RVC_DEFAULTS.baseRate),
    basePitch: String(c.basePitch || RVC_DEFAULTS.basePitch),
    baseVolume: String(c.baseVolume || RVC_DEFAULTS.baseVolume),
    spkId: Number(c.spkId ?? RVC_DEFAULTS.spkId),
    f0File: String(c.f0File || '').trim(),
    f0Method: String(c.f0Method || RVC_DEFAULTS.f0Method),
    indexRate: Number(c.indexRate ?? RVC_DEFAULTS.indexRate),
    f0UpKey: Number(c.f0UpKey ?? RVC_DEFAULTS.f0UpKey),
    resampleSr: Number(c.resampleSr ?? RVC_DEFAULTS.resampleSr),
    rmsMixRate: Number(c.rmsMixRate ?? RVC_DEFAULTS.rmsMixRate),
    protect: Number(c.protect ?? RVC_DEFAULTS.protect),
    filterRadius: Number(c.filterRadius ?? RVC_DEFAULTS.filterRadius)
  };
}

function rvcFingerprint(cfg) {
  return [
    cfg.model, cfg.index, cfg.baseSource, cfg.baseAudioName, hashText(cfg.baseAudioBase64),
    cfg.baseVoice, cfg.baseRate, cfg.basePitch, cfg.baseVolume,
    cfg.spkId, cfg.f0File, cfg.f0Method, cfg.indexRate, cfg.f0UpKey,
    cfg.resampleSr, cfg.rmsMixRate, cfg.protect, cfg.filterRadius
  ].join('|');
}

async function rvcJson(baseUrl, route, payload, timeoutMs) {
  let res;
  try {
    res = await fetch(baseUrl + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    throw new Error(`无法连接本地 RVC 推理服务（${baseUrl}）：${String((e && e.message) || e)}`);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-json body */ }
  if (!res.ok) {
    throw new Error(`RVC ${route} 失败（HTTP ${res.status}）：${(data && data.message) || res.statusText}`);
  }
  return data;
}

async function ensureRvcLoaded(cfg) {
  const key = cfg.model + '|' + cfg.index;
  if (key === rvcLoadedKey) return;
  await rvcJson(cfg.baseUrl, '/load', { model: cfg.model, index: cfg.index }, 180000);
  rvcLoadedKey = key;
}

async function rvcConvertBytes(cfg, audioBytes) {
  const data = await rvcJson(cfg.baseUrl, '/convert', {
    audio_base64: audioBytes.toString('base64'),
    params: {
      spk_id: cfg.spkId,
      f0_file: cfg.f0File || null,
      f0_method: cfg.f0Method,
      index_rate: cfg.indexRate,
      f0_up_key: cfg.f0UpKey,
      resample_sr: cfg.resampleSr,
      rms_mix_rate: cfg.rmsMixRate,
      protect: cfg.protect,
      filter_radius: cfg.filterRadius
    }
  }, 180000);
  if (!data || !data.audio_base64) throw new Error('RVC /convert 返回异常');
  return Buffer.from(data.audio_base64, 'base64');
}

/** RVC chain: base audio (Edge TTS or user upload) -> local RVC conversion -> wav file path. */
async function synthesizeRvc(text, voice, custom) {
  const cfg = rvcConfig(custom);
  if (!cfg.model) throw new Error('未配置 RVC 模型路径（设置 → 插件 → 语音 → RVC 配置）');
  let audioBytes;
  if (cfg.baseSource === 'upload' && cfg.baseAudioBase64) {
    audioBytes = Buffer.from(cfg.baseAudioBase64, 'base64');
  } else {
    const baseVoice = cfg.baseVoice || voice;
    const mp3Path = await synthesize(text, baseVoice, {
      rate: cfg.baseRate,
      pitch: cfg.basePitch,
      volume: cfg.baseVolume
    });
    audioBytes = readFileSync(mp3Path);
  }
  await ensureRvcLoaded(cfg);
  let wavBytes;
  try {
    wavBytes = await rvcConvertBytes(cfg, audioBytes);
  } catch (e) {
    // one retry with a fresh /load (the server may have unloaded the model)
    rvcLoadedKey = '';
    await ensureRvcLoaded(cfg);
    wavBytes = await rvcConvertBytes(cfg, audioBytes);
  }
  const wavPath = path.join(os.tmpdir(), `dsh-tts-rvc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
  writeFileSync(wavPath, wavBytes);
  return wavPath;
}

// ---------------------------------------------------------------------------
// Adaptive chunked progressive playback.
// Long RVC reads are split into sentence-sized blocks and converted one by one
// into a queue. A one-shot probe calibrates chunk size + prewarm count from the
// local machine's convert/play speed ratio (convert_time / audio_seconds).
// ---------------------------------------------------------------------------

const PROBE_TEXT = '你好，这是语音合成性能检测。';

/** Heuristic speech duration in seconds (zh ~3.6 chars/s, latin ~12 chars/s). */
function estimateSpeechSeconds(text) {
  let cjk = 0, latin = 0, other = 0;
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x4e00 && cp <= 0x9fff) cjk++;
    else if (/[A-Za-z0-9]/.test(ch)) latin++;
    else other++;
  }
  return cjk / 3.6 + latin / 12 + other / 4;
}

function isLatinHeavy(text) {
  let latin = 0, cjk = 0;
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x4e00 && cp <= 0x9fff) cjk++;
    else if (/[A-Za-z]/.test(ch)) latin++;
  }
  return latin > 0 && latin > cjk * 2;
}

/** Split text into chunks of <= maxChars, preferring sentence/segment boundaries. */
function splitText(text, maxChars) {
  const parts = [];
  const sentences = [];
  let m;
  const sre = /[^。！？；.!?;]+[。！？；.!?;]?/g;
  while ((m = sre.exec(text)) !== null) {
    const s = m[0].trim();
    if (s) sentences.push(s);
  }
  if (!sentences.length) sentences.push(String(text).trim());
  const segRe = /[^，、,]+[，、,]?/g;
  let cur = '';
  const flush = () => {
    if (cur.trim()) parts.push(cur.trim());
    cur = '';
  };
  for (const s of sentences) {
    if (cur && cur.length + s.length > maxChars) flush();
    if (s.length > maxChars) {
      const segs = [];
      while ((m = segRe.exec(s)) !== null) {
        const g = m[0].trim();
        if (g) segs.push(g);
      }
      for (const seg of segs) {
        if (cur && cur.length + seg.length > maxChars) flush();
        if (seg.length > maxChars) {
          for (let i = 0; i < seg.length; i += maxChars) {
            flush();
            cur = seg.slice(i, i + maxChars);
            flush();
          }
        } else {
          cur += seg;
        }
      }
    } else {
      cur += s;
    }
  }
  flush();
  return parts.filter((p) => p.length > 0);
}

function chunkTier(ratio) {
  if (ratio <= 0.4) return { chunkSec: 20, prewarm: 2 };
  if (ratio <= 0.6) return { chunkSec: 15, prewarm: 2 };
  if (ratio <= 0.9) return { chunkSec: 10, prewarm: 3 };
  return { chunkSec: 6, prewarm: 4 };
}

const FALLBACK_CAL = { ratio: null, chunkSec: 10, prewarm: 3, probeFailed: true, at: 0 };
const calibCache = new Map(); // rvcFingerprint -> { ratio, chunkSec, prewarm, at }
const CAL_TTL_MS = 10 * 60 * 1000;

// --- calibration persistence (~/.dsh/tts-rvc/calibration.json) -------------
// Probe results survive across dsh restarts, so the one-shot ~7s probe is paid
// only once per config+device (7-day validity; re-probes when the GPU changes).
const CAL_DIR = path.join(os.homedir(), '.dsh', 'tts-rvc');
const CAL_FILE = path.join(CAL_DIR, 'calibration.json');
const CAL_FILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let calFileData = null;   // parsed file, lazily loaded
const deviceByUrl = new Map(); // baseUrl -> { gpu, at } (5-min session cache)

function loadCalFile() {
  if (calFileData !== null) return calFileData;
  try {
    if (existsSync(CAL_FILE)) calFileData = JSON.parse(readFileSync(CAL_FILE, 'utf8'));
    else calFileData = { version: 1, entries: {} };
  } catch (e) {
    calFileData = { version: 1, entries: {} };
  }
  if (!calFileData.entries || typeof calFileData.entries !== 'object') calFileData.entries = {};
  return calFileData;
}

function saveCalFile() {
  try {
    mkdirSync(CAL_DIR, { recursive: true });
    writeFileSync(CAL_FILE, JSON.stringify(calFileData, null, 2));
  } catch (e) { /* best-effort persistence */ }
}

/** GPU name from the RVC server /health, cached 5 min per baseUrl (null = unknown). */
async function getRvcDevice(cfg) {
  const now = Date.now();
  const hit = deviceByUrl.get(cfg.baseUrl);
  if (hit && now - hit.at < 5 * 60 * 1000) return hit.gpu;
  let gpu = null;
  try {
    const r = await fetch(cfg.baseUrl + '/health', { signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => null);
    gpu = (d && typeof d.gpu_name === 'string' && d.gpu_name) || null;
  } catch (e) { /* offline/old server -> unknown device */ }
  deviceByUrl.set(cfg.baseUrl, { gpu, at: now });
  return gpu;
}

/**
 * Calibrate the local convert speed for a config: in-memory hit first, then the
 * persisted calibration file (skips the probe across restarts), then a live
 * probe. Probe results are persisted with the current GPU name so a device
 * change triggers a re-probe instead of reusing stale numbers.
 */
async function getCalibration(cfg) {
  const key = rvcFingerprint(cfg);
  const now = Date.now();
  const hit = calibCache.get(key);
  if (hit && (hit.probeFailed ? now - hit.at < 120000 : now - hit.at < CAL_TTL_MS)) return hit;

  // persisted entry -> adopt without probing (unless the device changed)
  const file = loadCalFile();
  const fileHit = file.entries[key];
  if (fileHit && !fileHit.probeFailed && now - fileHit.at < CAL_FILE_TTL_MS) {
    const dev = await getRvcDevice(cfg);
    if (!dev || !fileHit.device || fileHit.device === dev) {
      const cal = {
        ratio: fileHit.ratio, chunkSec: fileHit.chunkSec, prewarm: fileHit.prewarm,
        probeFailed: false, at: fileHit.at, fromDisk: true
      };
      calibCache.set(key, cal);
      return cal;
    }
  }

  // live probe
  const t0 = now;
  let ratio = null;
  try {
    const mp3Path = await synthesize(PROBE_TEXT, cfg.baseVoice || RVC_DEFAULTS.baseVoice, {
      rate: cfg.baseRate, pitch: cfg.basePitch, volume: cfg.baseVolume
    });
    const audioBytes = readFileSync(mp3Path);
    const estSec = estimateSpeechSeconds(PROBE_TEXT) || 1;
    await ensureRvcLoaded(cfg);
    await rvcConvertBytes(cfg, audioBytes);
    ratio = (Date.now() - t0) / 1000 / estSec;
  } catch (e) {
    ratio = null; // probe failure -> conservative defaults
  }
  const cal = ratio === null
    ? { ...FALLBACK_CAL, at: Date.now() }
    : { ratio, ...chunkTier(ratio), probeFailed: false, at: Date.now() };
  if (ratio !== null) {
    // persist only successful probes; keep any older good entry on failure
    cal.device = (await getRvcDevice(cfg)) || undefined;
    file.entries[key] = {
      ratio: cal.ratio, chunkSec: cal.chunkSec, prewarm: cal.prewarm,
      at: cal.at, device: cal.device || null
    };
    const keys = Object.keys(file.entries);
    if (keys.length > 100) {
      keys.sort((a, b) => (file.entries[a].at || 0) - (file.entries[b].at || 0));
      for (const k of keys.slice(0, keys.length - 100)) delete file.entries[k];
    }
    saveCalFile();
  }
  calibCache.set(key, cal);
  if (calibCache.size > 40) {
    const first = calibCache.keys().next().value;
    if (first !== undefined) calibCache.delete(first);
  }
  return cal;
}

// ---------------------------------------------------------------------------
// Voice packs: registry manifest + download + sha256-verified install.
// Packs install into ~/.dsh/tts-rvc/packs/<packId>/ (model.pth + index.index).
// ---------------------------------------------------------------------------

const PACK_FILE = 'installed.json';

function packsDir() {
  return process.env.DSH_TTS_PACKS_DIR || path.join(os.homedir(), '.dsh', 'tts-rvc', 'packs');
}

function installedPacks() {
  try {
    return JSON.parse(readFileSync(path.join(packsDir(), PACK_FILE), 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveInstalledPacks(data) {
  try {
    mkdirSync(packsDir(), { recursive: true });
    writeFileSync(path.join(packsDir(), PACK_FILE), JSON.stringify(data, null, 2));
  } catch (e) { /* best-effort */ }
}

async function fetchManifest(registry) {
  const url = String(registry || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) throw new Error('仓库地址必须是 http(s) URL');
  const r = await fetch(url + '/manifest.json', { signal: AbortSignal.timeout(20000) });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data) throw new Error(`清单获取失败（HTTP ${r.status}）`);
  if (!Array.isArray(data.packs)) throw new Error('清单格式无效（缺少 packs 数组）');
  return { url, data };
}

/** Resolve a possibly-relative manifest URL against the registry base. */
function resolvePackUrl(base, u) {
  const s = String(u || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : base + '/' + s.replace(/^\/+/, '');
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function downloadVerified(url, expectedSha256, expectedSize, label) {
  const r = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error(`${label} 下载失败（HTTP ${r.status}）`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (expectedSize && bytes.length !== expectedSize) {
    throw new Error(`${label} 大小不符（期望 ${expectedSize}，实际 ${bytes.length}）`);
  }
  if (expectedSha256) {
    const actual = sha256Hex(bytes);
    if (actual !== String(expectedSha256).toLowerCase()) {
      throw new Error(`${label} sha256 校验失败（期望 ${expectedSha256}，实际 ${actual}）`);
    }
  }
  return bytes;
}

async function installPack(registry, packId, indexId) {
  const { url: base, data } = await fetchManifest(registry);
  const pack = data.packs.find((p) => p && p.id === packId);
  if (!pack) throw new Error(`仓库中没有音色包 ${packId}`);
  const dir = path.join(packsDir(), String(packId).replace(/[^\w.-]/g, '_'));
  const model = pack.model;
  if (!model || !model.url) throw new Error('音色包缺少模型文件');
  // index variants: `indexes` array (preferred) or legacy single `index`
  let indexes = Array.isArray(pack.indexes) && pack.indexes.length
    ? pack.indexes.slice()
    : (pack.index ? [{ id: 'default', name: '默认索引', ...pack.index }] : []);
  const chosen = indexes.find((i) => i.id === indexId) || indexes[0] || null;
  const modelUrl = resolvePackUrl(base, model.url);
  const indexUrl = chosen ? resolvePackUrl(base, chosen.url) : '';
  const installed = installedPacks();
  const current = installed[packId] || {};
  const modelPath = path.join(dir, 'model.pth');
  const indexPath = indexUrl ? path.join(dir, 'index.index') : '';
  const variants = indexes.map((i) => ({ id: i.id, name: i.name || i.id, size: i.size || 0 }));
  const modelUpToDate = current.version === pack.version && current.modelSha256 === model.sha256 && existsSync(modelPath);
  const indexUpToDate = !indexUrl || (indexPath && existsSync(indexPath) && current.indexSha256 === chosen.sha256);
  if (modelUpToDate && indexUpToDate) {
    return { ok: true, skipped: true, name: pack.name, modelPath, indexPath, indexId: chosen ? chosen.id : '', variants };
  }
  mkdirSync(dir, { recursive: true });
  try {
    if (!modelUpToDate) {
      const modelBytes = await downloadVerified(modelUrl, model.sha256, model.size, '模型');
      writeFileSync(modelPath, modelBytes);
    }
    if (indexUrl && !indexUpToDate) {
      const indexBytes = await downloadVerified(indexUrl, chosen.sha256, chosen.size, '索引');
      writeFileSync(indexPath, indexBytes);
    }
  } catch (e) {
    // remove partial install so a retry starts clean
    try {
      rmSync(modelPath, { force: true });
      rmSync(path.join(dir, 'index.index'), { force: true });
    } catch (e2) { /* best-effort cleanup */ }
    throw e;
  }
  installed[packId] = {
    id: packId,
    name: pack.name || packId,
    version: pack.version || '1.0.0',
    license: pack.license || 'unknown',
    modelPath,
    indexPath,
    modelSha256: model.sha256 || '',
    indexSha256: chosen && chosen.sha256 ? String(chosen.sha256).toLowerCase() : '',
    indexId: chosen ? chosen.id : '',
    installedAt: Date.now()
  };
  saveInstalledPacks(installed);
  const size = (model.size || 0) + (chosen ? chosen.size || 0 : 0);
  return {
    ok: true, skipped: false, name: pack.name, modelPath, indexPath,
    indexId: chosen ? chosen.id : '', variants, size
  };
}

export function apply(ctx) {
  const webServer = ctx.get('webServer');
  if (!webServer) return;

  const files = new Map();   // id -> absolute mp3 path
  const cache = new Map();   // voice|text -> url
  let seq = 0;

  // --- adaptive chunk job registry (rvc long reads) ---
  const jobs = new Map();    // jobId -> { id, voice, custom, parts, nextIdx, tail, done, finishedAt, created }
  let jobSeq = 0;

  function convertChunk(job) {
    const run = async () => {
      if (job.done || job.nextIdx >= job.parts.length) return { done: true };
      const text = job.parts[job.nextIdx];
      const wavPath = await synthesizeRvc(text, job.voice, job.custom);
      const id = 'c' + (++seq).toString(36) + '-' + hashText(text).slice(0, 6);
      files.set(id, wavPath);
      if (files.size > 300) {
        const first = files.keys().next().value;
        if (first !== undefined) files.delete(first);
      }
      job.nextIdx++;
      return { url: '/dsh-tts-audio/' + id, more: job.nextIdx < job.parts.length };
    };
    const p = job.tail.then(run, run);
    job.tail = p.catch(() => {}); // keep the chain alive even on per-chunk failure
    return p;
  }

  function nextJobChunk(jobId) {
    const job = jobs.get(jobId);
    if (!job) return Promise.resolve({ done: true, gone: true });
    if (job.nextIdx >= job.parts.length) {
      job.finishedAt = job.finishedAt || Date.now();
      return Promise.resolve({ done: true });
    }
    return convertChunk(job);
  }

  function cleanupJobs() {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (job.finishedAt && now - job.finishedAt > 120000) jobs.delete(id);
      else if (!job.finishedAt && now - job.created > 600000) jobs.delete(id);
    }
    if (jobs.size > 50) {
      const entries = [...jobs.entries()].sort((x, y) => {
        const a = x[1].finishedAt || Number.MAX_SAFE_INTEGER;
        const b = y[1].finishedAt || Number.MAX_SAFE_INTEGER;
        return a - b;
      });
      while (jobs.size > 50) jobs.delete(entries.shift()[0]);
    }
  }

  const speakDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/speak',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const text = String((parsed && parsed.text) || '').trim();
        if (!text) {
          writeJson(res, 400, { error: 'empty text' });
          return;
        }
        const voice = String((parsed && parsed.voice) || 'zh-CN-XiaoxuanNeural');
        const provider = String((parsed && parsed.provider) || 'edge-tts');
        const custom = (parsed && parsed.custom) || null;
        const prosody = (parsed && parsed.prosody) || null;
        const cfg = provider === 'rvc' ? rvcConfig(custom) : null;
        const providerKey = provider === 'rvc'
          ? 'rvc|' + rvcFingerprint(cfg)
          : provider + '|' + JSON.stringify(prosody || {});
        const key = providerKey + '|' + voice + '|' + text;
        const hit = cache.get(key);
        if (hit) {
          writeJson(res, 200, { url: hit });
          return;
        }

        // ---- adaptive chunked progressive playback (long RVC, Edge base) ----
        if (provider === 'rvc' && cfg && cfg.baseSource !== 'upload' && estimateSpeechSeconds(text) > 12) {
          cleanupJobs();
          const cal = await getCalibration(cfg);
          const maxChars = Math.max(16, Math.round(cal.chunkSec * (isLatinHeavy(text) ? 12 : 3.6)));
          const parts = splitText(text, maxChars);
          if (parts.length > 1) {
            const jobId = 'j' + (++jobSeq).toString(36);
            const job = {
              id: jobId,
              voice,
              custom,
              parts,
              nextIdx: 0,
              tail: Promise.resolve(),
              done: false,
              finishedAt: null,
              created: Date.now()
            };
            jobs.set(jobId, job);
            const prewarm = Math.min(cal.prewarm, parts.length);
            const urls = [];
            for (let i = 0; i < prewarm; i++) {
              const r = await convertChunk(job);
              if (r && r.url) urls.push(r.url);
            }
            writeJson(res, 200, {
              jobId,
              chunks: urls,
              total: parts.length,
              ratio: cal.ratio,
              chunkSec: cal.chunkSec
            });
            return;
          }
        }

        const absPath = provider === 'rvc'
          ? await synthesizeRvc(text, voice, custom)
          : await synthesize(text, voice, prosody || undefined);
        const id = 'a' + (++seq).toString(36) + '-' + hashText(text).slice(0, 6);
        files.set(id, absPath);
        if (files.size > 300) {
          const first = files.keys().next().value;
          if (first !== undefined) files.delete(first);
        }
        const url = '/dsh-tts-audio/' + id;
        cache.set(key, url);
        if (cache.size > 60) {
          const first = cache.keys().next().value;
          if (first !== undefined) cache.delete(first);
        }
        writeJson(res, 200, { url });
      } catch (e) {
        writeJson(res, 500, { error: String((e && e.message) || e) });
      }
    }
  });

  const audioDisposer = webServer.register({
    kind: 'prefix',
    path: '/dsh-tts-audio',
    async handler(req, res) {
      try {
        const segs = (req.url || '/').split('?')[0].split('/').filter(Boolean);
        const id = segs[segs.length - 1] || '';
        const absPath = files.get(id);
        if (!absPath || !existsSync(absPath)) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('not found');
          return;
        }
        const bytes = readFileSync(absPath);
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Content-Length': bytes.length,
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(bytes);
      } catch (e) {
        try {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('tts audio error');
        } catch (e2) { /* socket gone */ }
      }
    }
  });

  const filesDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/rvc-files',
    async handler(req, res) {
      try {
        const url = req.url || '';
        const q = new URL(url, 'http://x').searchParams;
        const baseUrl = String(q.get('baseUrl') || RVC_DEFAULTS.baseUrl).replace(/\/+$/, '');
        const kind = q.get('kind') === 'index' ? 'index' : 'pth';
        const r = await fetch(baseUrl + '/files?kind=' + kind, {
          signal: AbortSignal.timeout(15000)
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) {
          writeJson(res, 502, { error: `RVC /files 失败（HTTP ${r.status}）：${(data && data.message) || r.statusText}` });
          return;
        }
        writeJson(res, 200, data || { ok: false, files: [] });
      } catch (e) {
        writeJson(res, 502, { error: `无法连接本地 RVC 推理服务（文件列表）：${String((e && e.message) || e)}` });
      }
    }
  });

  const nextDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/rvc-next',
    async handler(req, res) {
      try {
        const q = new URL(req.url || '', 'http://x').searchParams;
        const jobId = q.get('job') || '';
        cleanupJobs();
        const r = await nextJobChunk(jobId);
        writeJson(res, 200, r);
      } catch (e) {
        writeJson(res, 500, { error: `后续段落合成失败：${String((e && e.message) || e)}` });
      }
    }
  });

  const compactDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/rvc-compact-index',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const baseUrl = String(parsed.baseUrl || RVC_DEFAULTS.baseUrl).replace(/\/+$/, '');
        const data = await rvcJson(baseUrl, '/compact-index', {
          index: String(parsed.index || ''),
          target_vectors: Number(parsed.target_vectors || 10000),
          out_dir: String(parsed.out_dir || '')
        }, 300000);
        writeJson(res, 200, data);
      } catch (e) {
        writeJson(res, 502, { error: `紧凑索引生成失败：${String((e && e.message) || e)}` });
      }
    }
  });

  const packsDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/rvc-packs',
    async handler(req, res) {
      try {
        const q = new URL(req.url || '', 'http://x').searchParams;
        const registry = q.get('registry') || '';
        const { data } = await fetchManifest(registry);
        writeJson(res, 200, data);
      } catch (e) {
        writeJson(res, 502, { error: `获取音色包列表失败：${String((e && e.message) || e)}` });
      }
    }
  });

  const packsInstalledDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/rvc-packs-installed',
    async handler(req, res) {
      try {
        writeJson(res, 200, { installed: installedPacks() });
      } catch (e) {
        writeJson(res, 500, { error: String((e && e.message) || e) });
      }
    }
  });

  const packInstallDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/rvc-pack-install',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const registry = String(parsed.registry || '');
        const packId = String(parsed.packId || '').trim();
        const indexId = parsed.indexId ? String(parsed.indexId) : '';
        if (!registry || !packId) {
          writeJson(res, 400, { error: 'registry 与 packId 必填' });
          return;
        }
        const result = await installPack(registry, packId, indexId);
        writeJson(res, 200, result);
      } catch (e) {
        writeJson(res, 502, { error: `音色包安装失败：${String((e && e.message) || e)}` });
      }
    }
  });

  ctx.effect(() => speakDisposer, 'dsh-plugin-tts: speak route');
  ctx.effect(() => audioDisposer, 'dsh-plugin-tts: audio route');
  ctx.effect(() => filesDisposer, 'dsh-plugin-tts: rvc files route');
  ctx.effect(() => nextDisposer, 'dsh-plugin-tts: rvc next route');
  ctx.effect(() => compactDisposer, 'dsh-plugin-tts: rvc compact-index route');
  ctx.effect(() => packsDisposer, 'dsh-plugin-tts: rvc packs route');
  ctx.effect(() => packsInstalledDisposer, 'dsh-plugin-tts: rvc packs-installed route');
  ctx.effect(() => packInstallDisposer, 'dsh-plugin-tts: rvc pack-install route');
}
