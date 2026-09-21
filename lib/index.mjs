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
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import tls from 'node:tls';
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

// --- host-side i18n (focused, backward-compatible) ---
// The host runs in Node and doesn't know the UI language. Instead of baking a
// language in, errors/progress carry a stable `i18n: { code, params }` tag
// alongside the (zh) fallback text. The client renders `code` through its t()
// dictionary (zh/en); callers that don't understand the tag fall back to the
// plain message.
function hostErr(msg, code, params) {
  const e = new Error(msg);
  e.i18n = { code, params: params || {} };
  return e;
}
// write a localized error response: body keeps `error` (zh fallback) and adds
// optional `i18n` metadata for the client.
function writeErr(res, code, msg, i18n) {
  const value = { error: msg };
  if (i18n) value.i18n = i18n;
  writeJson(res, code, value);
}
// serialize a thrown route error (possibly a localized hostErr) to the client,
// carrying optional `i18n: { code, params }` metadata if present.
function writeRouteError(res, err) {
  const msg = String((err && err.message) || err);
  const value = { error: msg };
  if (err && err.i18n) value.i18n = err.i18n;
  writeJson(res, 500, value);
}

// Return a short, user-owned-path-aware "how to start the local RVC service"
// hint. We intentionally avoid hardcoding any machine-specific folder name:
// every user replaces <你的...> with their own path. Both Windows and
// macOS/Linux are shown so it is clear the feature is cross-platform.
function rvcStartupHint() {
  return [
    '便携运行时（免装 RVC WebUI）：',
    '  Windows：解压后双击「启动服务.bat」',
    '  macOS/Linux：解压后在终端运行 <你解压的目录>/start-rvc-server.sh',
    '已有 RVC WebUI：',
    '  Windows（PowerShell）：',
    '    <你的RVC目录>\\runtime\\python.exe <你的RVC目录>\\rvc-server.py --port 4892',
    '  macOS/Linux（终端）：',
    '    <你的RVC目录>/runtime/bin/python <你的RVC目录>/rvc-server.py --port 4892',
    '详细步骤见《RVC 指南》→「启动本地 RVC 服务」。'
  ].join('\n');
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
    cfg.model, cfg.index,
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
    throw hostErr(`无法连接本地 RVC 推理服务（${baseUrl}）：${String((e && e.message) || e)}`, "host.rvcUnreachable", { baseUrl });
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-json body */ }
  if (!res.ok) {
    throw hostErr(`RVC ${route} 失败（HTTP ${res.status}）：${(data && data.message) || res.statusText}`, "host.rvcHttpFail", { route, status: res.status });
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
  if (!data || !data.audio_base64) throw hostErr('RVC /convert 返回异常', 'host.rvcConvertNoAudio');
  return Buffer.from(data.audio_base64, 'base64');
}

/** RVC chain: Edge TTS base audio of the message text -> local RVC conversion -> wav file path. */
async function synthesizeRvc(text, voice, custom) {
  const cfg = rvcConfig(custom);
  if (!cfg.model) throw hostErr('未配置 RVC 模型路径（设置 → 插件 → 语音 → RVC 配置）', 'host.noModelConfigured');
  const baseVoice = cfg.baseVoice || voice;
  const mp3Path = await synthesize(text, baseVoice, {
    rate: cfg.baseRate,
    pitch: cfg.basePitch,
    volume: cfg.baseVolume
  });
  const audioBytes = readFileSync(mp3Path);
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
// TTS provider abstraction (M1, foundation).
// Each provider implements synthesizeShort(text, voice, prosody, custom) -> absPath
// (a single audio file). The /speak handler dispatches the "short, single-URL"
// path through the registry. Long RVC reads keep their dedicated chunked job path
// (provider-'rvc'); future providers (e.g. a local Piper backend) just register.
// ---------------------------------------------------------------------------
const providers = Object.create(null);
function registerProvider(name, impl) {
  providers[name] = impl;
}
registerProvider('edge-tts', {
  synthesizeShort(text, voice, prosody, custom) {
    return synthesize(text, voice, prosody || undefined);
  }
});
registerProvider('rvc', {
  synthesizeShort(text, voice, prosody, custom) {
    return synthesizeRvc(text, voice, custom);
  }
});
// Local Piper backend (M1+, optional). Needs a Piper binary + a .onnx model to be
// configured by the user; the /speak "short" path dispatches here through the same
// provider abstraction. Without a configured binary/model it fails with a clear,
// localized "not configured" error instead of crashing.
function piperConfig(custom) {
  const c = custom || {};
  return {
    binary: String(c.piperBinary || '').trim(),
    model: String(c.piperModel || '').trim(),
    voice: String(c.piperVoice || 'en_US-lessac-medium')
  };
}
async function synthesizePiper(text, voice, prosody, custom) {
  const cfg = piperConfig(custom);
  if (!cfg.binary || !cfg.model) {
    throw hostErr(
      '未配置本地 Piper（音色提供者 local-piper）：请在设置中填写 Piper 可执行文件与 .onnx 模型路径',
      'host.piperUnconfigured'
    );
  }
  const wavPath = path.join(os.tmpdir(), `dsh-tts-piper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
  await new Promise((resolve, reject) => {
    const p = spawn(cfg.binary, ['--model', cfg.model, '--output_file', wavPath], {
      stdio: ['pipe', 'ignore', 'pipe']
    });
    let stderr = '';
    p.stderr.on('data', d => { stderr += String(d); });
    p.stdin.on('error', () => {});
    p.on('error', err => reject(hostErr(`Piper 启动失败：${err.message}`, 'host.piperSpawnFail')));
    p.on('close', code => {
      if (code === 0) resolve();
      else reject(hostErr(`Piper 转换失败（exit ${code}）：${stderr.slice(0, 300) || '未知错误'}`, 'host.piperFail'));
    });
    try { p.stdin.end(String(text || '')); } catch (e) { reject(hostErr('Piper stdin 失败', 'host.piperFail')); }
  });
  return wavPath;
}
registerProvider('local-piper', {
  synthesizeShort(text, voice, prosody, custom) {
    return synthesizePiper(text, voice, prosody, custom);
  }
});

// ---------------------------------------------------------------------------
// Local Index-TTS2 provider (e.g. a local `index-tts2-nvidia` bundle).
// Talks to the bundle's FastAPI service (default http://127.0.0.1:7880):
//   GET  /health  GET /api/v1/voices  POST /api/v1/tts/tasks {text,...} -> wav
// Single-call synthesis: timbre comes from the reference audio (prompt_audio),
// so no Edge TTS base voice is needed.
// ---------------------------------------------------------------------------

const INDEX_TTS2_DEFAULTS = {
  baseUrl: 'http://127.0.0.1:7880',
  voice: '',
  cleanText: true,
  emoControlMethod: 0,
  emoRefPath: '',
  emoWeight: 0.65,
  emoText: '',
  emoRandom: false,
  maxTextTokensPerSegment: 120,
  doSample: true,
  topP: 0.8,
  topK: 30,
  temperature: 0.8,
  lengthPenalty: 0.0,
  numBeams: 3,
  repetitionPenalty: 10.0,
  maxMelTokens: 1500
};

function indexStartupHint() {
  return [
    '先双击本地包里的「启动api服务.bat」（保持窗口运行，默认端口 7880）；',
    '然后在本页下方点「刷新音色」确认能连上，再选参考音色试听。'
  ].join('\n');
}

function indexTts2Config(custom, fallbackVoice) {
  const c = custom || {};
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    baseUrl: String(c.baseUrl || INDEX_TTS2_DEFAULTS.baseUrl).replace(/\/+$/, ''),
    voice: String(c.voice || fallbackVoice || '').trim(),
    cleanText: c.cleanText === undefined ? true : !!c.cleanText,
    emoControlMethod: [0, 1, 2, 3].includes(num(c.emoControlMethod, 0))
      ? num(c.emoControlMethod, 0) : 0,
    emoRefPath: String(c.emoRefPath || ''),
    emoWeight: num(c.emoWeight, INDEX_TTS2_DEFAULTS.emoWeight),
    emoText: String(c.emoText || ''),
    emoRandom: !!c.emoRandom,
    maxTextTokensPerSegment: Math.max(20, Math.min(500, Math.round(num(c.maxTextTokensPerSegment, 120)))),
    doSample: c.doSample === undefined ? true : !!c.doSample,
    topP: num(c.topP, 0.8),
    topK: Math.max(0, Math.round(num(c.topK, 30))),
    temperature: num(c.temperature, 0.8),
    lengthPenalty: num(c.lengthPenalty, 0.0),
    numBeams: Math.max(1, Math.round(num(c.numBeams, 3))),
    repetitionPenalty: num(c.repetitionPenalty, 10.0),
    maxMelTokens: Math.max(100, Math.round(num(c.maxMelTokens, 1500)))
  };
}

async function indexTts2Post(cfg, route, payload, timeoutMs) {
  let res;
  try {
    res = await fetch(cfg.baseUrl + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    throw hostErr(`无法连接本地 Index-TTS2 服务（${cfg.baseUrl}）：${String((e && e.message) || e)}\n${indexStartupHint()}`, 'host.indexUnreachable', { baseUrl: cfg.baseUrl });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = '';
    try {
      const data = JSON.parse(text);
      detail = String(data.detail || data.message || text).slice(0, 300);
    } catch (e) {
      detail = String(text).slice(0, 300) || res.statusText;
    }
    throw hostErr(`Index-TTS2 ${route} 失败（HTTP ${res.status}）：${detail}`, 'host.indexHttpFail', { route, status: res.status });
  }
  return res;
}

/** Index-TTS2 chain: text -> local FastAPI service -> wav file path. */
async function synthesizeIndexTts2(text, voice, custom) {
  const cfg = indexTts2Config(custom, voice);
  const payload = {
    text: String(text || ''),
    prompt_audio: cfg.voice,
    clean_text: cfg.cleanText,
    emo_control_method: cfg.emoControlMethod,
    emo_ref_path: cfg.emoRefPath || null,
    emo_weight: cfg.emoWeight,
    emo_text: cfg.emoText || null,
    emo_random: cfg.emoRandom,
    max_text_tokens_per_segment: cfg.maxTextTokensPerSegment,
    do_sample: cfg.doSample,
    top_p: cfg.topP,
    top_k: cfg.topK,
    temperature: cfg.temperature,
    length_penalty: cfg.lengthPenalty,
    num_beams: cfg.numBeams,
    repetition_penalty: cfg.repetitionPenalty,
    max_mel_tokens: cfg.maxMelTokens
  };
  const res = await indexTts2Post(cfg, '/api/v1/tts/tasks', payload, 300000);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw hostErr('Index-TTS2 返回的音频过小（可能合成失败）', 'host.indexNoAudio');
  const wavPath = path.join(os.tmpdir(), `dsh-tts-index-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
  writeFileSync(wavPath, buf);
  return wavPath;
}

registerProvider('index-tts2', {
  synthesizeShort(text, voice, prosody, custom) {
    return synthesizeIndexTts2(text, voice, custom);
  }
});

// ---------------------------------------------------------------------------
// Local CosyVoice2 provider (e.g. an aigcpanel CosyVoice-2.0-0.5B bundle).
// Talks to cosy-server.py (default http://127.0.0.1:7890):
//   GET  /health  GET /voices  POST /load {prompt}  POST /upload {…}
//   POST /tts {text, prompt?, speed?, seed?} -> { audio_base64, sample_rate }
// Single-call synthesis: timbre comes from the prompt audio (zero-shot), so
// no Edge TTS base voice is needed. Same shape as the index-tts2 provider.
// ---------------------------------------------------------------------------

const COSY_DEFAULTS = {
  baseUrl: 'http://127.0.0.1:7890',
  voice: '',
  promptText: '',
  speed: 1.0,
  seed: 0
};

function cosyStartupHint() {
  return [
    '先双击本地包里的「启动cosy服务.bat」（保持窗口运行，默认端口 7890）；',
    '然后在本页下方点「刷新音色」确认能连上，再选提示音频试听。'
  ].join('\n');
}

function cosyConfig(custom, fallbackVoice) {
  const c = custom || {};
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    baseUrl: String(c.baseUrl || COSY_DEFAULTS.baseUrl).replace(/\/+$/, ''),
    voice: String(c.voice || fallbackVoice || '').trim(),
    // prompt_text: the transcript of the prompt audio, in order. Multilingual
    // prompts must include the FULL transcript, otherwise the model re-reads
    // the missing part before the new text.
    promptText: String(c.promptText || '').slice(0, 2000),
    speed: Math.min(2, Math.max(0.5, num(c.speed, 1.0))),
    seed: Math.max(0, Math.round(num(c.seed, 0)))
  };
}

async function cosyPost(cfg, route, payload, timeoutMs) {
  let res;
  try {
    res = await fetch(cfg.baseUrl + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    throw hostErr(`无法连接本地 CosyVoice 服务（${cfg.baseUrl}）：${String((e && e.message) || e)}\n${cosyStartupHint()}`, 'host.cosyUnreachable', { baseUrl: cfg.baseUrl });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = '';
    try {
      const data = JSON.parse(text);
      detail = String(data.detail || data.message || text).slice(0, 300);
    } catch (e) {
      detail = String(text).slice(0, 300) || res.statusText;
    }
    throw hostErr(`CosyVoice ${route} 失败（HTTP ${res.status}）：${detail}`, 'host.cosyHttpFail', { route, status: res.status });
  }
  return res;
}

/** CosyVoice chain: text -> local cosy-server.py -> wav file path. */
async function synthesizeCosy(text, voice, custom) {
  const cfg = cosyConfig(custom, voice);
  const res = await cosyPost(cfg, '/tts', {
    text: String(text || ''),
    prompt: cfg.voice || undefined,
    prompt_text: cfg.promptText || undefined,
    speed: cfg.speed,
    seed: cfg.seed
  }, 300000);
  const data = await res.json().catch(() => null);
  const b64 = data && data.audio_base64;
  if (!b64) throw hostErr('CosyVoice 返回异常（无音频内容）', 'host.cosyNoAudio');
  const buf = Buffer.from(String(b64), 'base64');
  if (buf.length < 1000) throw hostErr('CosyVoice 返回的音频过小（可能合成失败）', 'host.cosyNoAudio');
  const wavPath = path.join(os.tmpdir(), `dsh-tts-cosy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
  writeFileSync(wavPath, buf);
  return wavPath;
}

registerProvider('cosyvoice', {
  synthesizeShort(text, voice, prosody, custom) {
    return synthesizeCosy(text, voice, custom);
  }
});

// ---------------------------------------------------------------------------
// Google Cloud TTS provider (paid, API-Key).
// Reuses the SAME /speak job queue + /dsh-tts-audio/<id> + /rvc-next chain as
// edge/rvc/index: short text -> single URL, long text -> chunked job whose
// sink is cloud synthesis per packet. No new playback chain.
// Key lives in the Host file (~/.dsh/tts-rvc/settings.json, cloud.apiKey) and
// NEVER touches localStorage; the client only sends provider + voice names.
// Quota: local per-month char counting by voice tier (standard 4M,
// wavenet/neural2/chirp3 1M). Official serviceusage/monitoring queries are
// intentionally NOT enabled by default (needs SA JSON; 99% users won't have
// it) — the usage endpoint reports local counts only.
// ---------------------------------------------------------------------------

const CLOUD_TTS_DEFAULTS = {
  voice: 'cmn-CN-Wavenet-A'
};
const CLOUD_QUOTA_LIMITS = {
  standard: 4000000,
  wavenet: 1000000,
  neural2: 1000000,
  chirp3: 1000000
};
// Cloud synchronous synthesize hard limit is 5000 UTF-8 bytes; stay under it
// with a safety margin. CJK packets are packed to ~1200 chars max
// (≈3600 bytes), inside the required 800–1200 chars per packet.
const CLOUD_MAX_BYTES = 4500;
const CLOUD_PACK_CHARS = 1200;
const CLOUD_PACK_CHARS_HARD = 1200;

function cloudTier(voiceName) {
  const v = String(voiceName || '');
  if (/chirp/i.test(v)) return 'chirp3';
  if (/neural2/i.test(v)) return 'neural2';
  if (/wavenet/i.test(v)) return 'wavenet';
  return 'standard';
}

function cloudLanguage(voiceName) {
  const parts = String(voiceName || '').split('-');
  if (parts.length >= 2 && parts[0] && parts[1]) return parts[0] + '-' + parts[1];
  return 'cmn-CN';
}

function cloudXmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Every packet is self-closed <speak>…</speak>; tags never span packets.
function cloudBuildSsml(text) {
  return '<speak>' + cloudXmlEscape(String(text || '')) + '</speak>';
}

// Billing caliber: plain-text length + spaces/newlines + SSML tags, i.e. the
// length of the SSML payload we actually send (code points).
function cloudBillableChars(ssml) {
  return [...String(ssml || '')].length;
}

/**
 * Pack text into Cloud-safe packets: reuse splitText (sentence split + atomic
 * URL/email/decimal protection + orphan merge) at ~1000 chars, then merge
 * small parts while BOTH caps hold (utf8 bytes <= 4500, chars <= 1200).
 * Guarantees every returned packet is under the 5000-byte hard limit.
 */
function splitCloudPackets(text, maxBytes) {
  const cap = Number(maxBytes) > 0 ? Math.min(Number(maxBytes), 5000) : CLOUD_MAX_BYTES;
  const base = splitText(String(text || ''), CLOUD_PACK_CHARS);
  const packets = [];
  let cur = '';
  let curBytes = 0;
  const push = () => {
    if (cur) packets.push(cur);
    cur = '';
    curBytes = 0;
  };
  const join2 = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    const gap = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? ' ' : '';
    return a + gap + b;
  };
  for (const part of base) {
    const b = Buffer.byteLength(part, 'utf8');
    if (b > cap) {
      // Defensive: a single sentence part over the cap (shouldn't happen with
      // the 1000-char split, but never emit an over-limit packet). Hard-split
      // on char boundaries so UTF-8 sequences stay intact.
      push();
      let sub = '';
      let subBytes = 0;
      for (const ch of part) {
        const cb = Buffer.byteLength(ch, 'utf8');
        if (subBytes + cb > cap) {
          packets.push(sub);
          sub = ch;
          subBytes = cb;
        } else {
          sub += ch;
          subBytes += cb;
        }
      }
      cur = sub;
      curBytes = subBytes;
      continue;
    }
    const merged = join2(cur, part);
    const mergedBytes = curBytes + b + (merged.length > cur.length + part.length ? 1 : 0);
    if (!cur || (mergedBytes <= cap && merged.length <= CLOUD_PACK_CHARS_HARD)) {
      cur = merged;
      curBytes = Buffer.byteLength(cur, 'utf8');
    } else {
      push();
      cur = part;
      curBytes = b;
    }
  }
  push();
  return packets.filter((p) => p.length > 0);
}

// --- host Cloud service settings (~/.dsh/tts-rvc/settings.json) -----------
// Shape: { version: 1, rvc: {...}, index: {...}, cloud: { apiKey, projectId } }.
// The API key is service-class (survives browser-data clears) and is NEVER
// echoed back in full by any GET route (only apiKeySet + tail hint).
const HOST_CLOUD_KEYS = ['apiKey', 'projectId'];
function loadHostCloudSettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) return {};
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    const src = (data && data.cloud && typeof data.cloud === 'object') ? data.cloud : {};
    const out = {};
    if (typeof src.apiKey === 'string' && src.apiKey.trim() !== '') out.apiKey = src.apiKey.trim();
    if (typeof src.projectId === 'string' && src.projectId.trim() !== '') out.projectId = src.projectId.trim().slice(0, 200);
    return out;
  } catch (e) {
    return {};
  }
}
function saveHostCloudSettings(patch) {
  let data = { version: 1 };
  try {
    if (existsSync(SETTINGS_FILE)) data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) || data;
  } catch (e) { /* start fresh */ }
  const prev = (data && data.cloud && typeof data.cloud === 'object') ? data.cloud : {};
  const next = { ...prev };
  const src = (patch && typeof patch === 'object') ? patch : {};
  for (const k of HOST_CLOUD_KEYS) {
    if (src[k] !== undefined) {
      const v = typeof src[k] === 'string' ? src[k].trim() : '';
      if (v === '') delete next[k];
      else next[k] = k === 'projectId' ? v.slice(0, 200) : v;
    }
  }
  data.version = 1;
  data.cloud = next;
  try {
    mkdirSync(CAL_DIR, { recursive: true });
    writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
  } catch (e) { /* best-effort */ }
  return next;
}

// --- local quota ledger (~/.dsh/tts-rvc/cloud-usage.json) ------------------
// Shape: { version: 1, months: { "YYYY-MM": { standard, wavenet, neural2, chirp3 } } }.
// Month keys rotate automatically (a new month starts at zero); only the last
// 6 months are kept.
// Lazily resolved (CAL_DIR is defined further below; keep module load order safe).
// Honors DSH_TTS_HOME like CAL_DIR so tests can isolate the usage ledger.
function cloudUsageFile() {
  return path.join(ttsHomeDir(), 'cloud-usage.json');
}
function cloudMonthKey(d) {
  try {
    return (d || new Date()).toISOString().slice(0, 7);
  } catch (e) {
    return new Date().toISOString().slice(0, 7);
  }
}
function loadCloudUsage() {
  try {
    if (!existsSync(cloudUsageFile())) return { version: 1, months: {} };
    const data = JSON.parse(readFileSync(cloudUsageFile(), 'utf8'));
    if (!data || typeof data !== 'object' || !data.months || typeof data.months !== 'object') {
      return { version: 1, months: {} };
    }
    return { version: 1, months: data.months };
  } catch (e) {
    return { version: 1, months: {} };
  }
}
function saveCloudUsage(data) {
  try {
    mkdirSync(CAL_DIR, { recursive: true });
    writeFileSync(cloudUsageFile(), JSON.stringify(data, null, 2));
  } catch (e) { /* best-effort */ }
}
function recordCloudUsage(tier, chars) {
  const t = CLOUD_QUOTA_LIMITS[tier] !== undefined ? tier : 'standard';
  const n = Math.max(0, Math.round(Number(chars) || 0));
  if (!n) return null;
  const data = loadCloudUsage();
  const month = cloudMonthKey();
  if (!data.months[month] || typeof data.months[month] !== 'object') {
    data.months[month] = { standard: 0, wavenet: 0, neural2: 0, chirp3: 0 };
  }
  const entry = data.months[month];
  for (const k of Object.keys(CLOUD_QUOTA_LIMITS)) {
    if (typeof entry[k] !== 'number' || !Number.isFinite(entry[k])) entry[k] = 0;
  }
  entry[t] += n;
  const keys = Object.keys(data.months).sort();
  while (keys.length > 6) delete data.months[keys.shift()];
  saveCloudUsage(data);
  return { month, tier: t, chars: n };
}
function getCloudUsageSummary() {
  const data = loadCloudUsage();
  const month = cloudMonthKey();
  const used = data.months[month] && typeof data.months[month] === 'object' ? data.months[month] : {};
  const tiers = {};
  for (const k of Object.keys(CLOUD_QUOTA_LIMITS)) {
    const u = typeof used[k] === 'number' && Number.isFinite(used[k]) ? Math.max(0, Math.round(used[k])) : 0;
    const limit = CLOUD_QUOTA_LIMITS[k];
    tiers[k] = { used: u, limit, remaining: Math.max(0, limit - u) };
  }
  return { month, tiers, official: { enabled: false } };
}

// Map client pct prosody ('default' | '+10%' | '-20%') to Cloud audioConfig.
function cloudProsodyToAudioConfig(prosody) {
  const pct = (v) => {
    if (v === undefined || v === null || v === 'default') return 0;
    const m = String(v).match(/([+-]?\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : 0;
  };
  const p = prosody || {};
  const speakingRate = Math.min(4, Math.max(0.25, 1 + pct(p.rate) / 100));
  const pitch = Math.min(20, Math.max(-20, pct(p.pitch) / 5));
  const volumeGainDb = Math.min(16, Math.max(-96, pct(p.volume) / 5));
  return { audioEncoding: 'MP3', speakingRate, pitch, volumeGainDb };
}

// Retry helper: retry once on network/5xx; 400/401/403 fail fast (retrying a
// rejected packet is pointless and burns quota).
async function cloudWithRetry(fn, attempts) {
  const n = attempts || 2;
  let lastErr = null;
  for (let i = 0; i < n; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e);
      if (/HTTP 40[013]|host\.cloud(NoKey|KeyInvalid|BadRequest)/.test(msg)) throw e;
      if (i < n - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

/** One Cloud packet -> MP3 bytes (+ billable chars). Caller retries per packet. */
async function synthesizeCloudPacket(packetText, voice, prosody, apiKey, timeoutMs) {
  const ssml = cloudBuildSsml(packetText);
  const billable = cloudBillableChars(ssml);
  const body = {
    input: { ssml },
    voice: { languageCode: cloudLanguage(voice), name: voice },
    audioConfig: cloudProsodyToAudioConfig(prosody)
  };
  const url = 'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + encodeURIComponent(apiKey);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs || 60000)
    });
  } catch (e) {
    throw hostErr(`Cloud TTS 请求失败：${String((e && e.message) || e)}`, 'host.cloudHttpFail');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = String(text).slice(0, 200) || res.statusText;
    if (res.status === 400) {
      throw hostErr(`Cloud TTS 拒绝请求（HTTP 400，单包可能超限或 voice 无效）：${detail}`, 'host.cloudBadRequest', { status: res.status });
    }
    if (res.status === 401 || res.status === 403) {
      throw hostErr(`Cloud TTS Key 无效或未启用 Text-to-Speech API（HTTP ${res.status}）：${detail}`, 'host.cloudKeyInvalid', { status: res.status });
    }
    throw hostErr(`Cloud TTS 合成失败（HTTP ${res.status}）：${detail}`, 'host.cloudHttpFail', { status: res.status });
  }
  const data = await res.json().catch(() => null);
  const b64 = data && data.audioContent;
  if (!b64) throw hostErr('Cloud TTS 返回异常（无音频内容）', 'host.cloudNoAudio');
  const buf = Buffer.from(String(b64), 'base64');
  if (buf.length < 100) throw hostErr('Cloud TTS 返回的音频过小（可能合成失败）', 'host.cloudNoAudio');
  return { bytes: buf, billable };
}

/**
 * Cloud chain: text -> Google Cloud TTS -> mp3 file path.
 * Short input (one packet) synthesizes once; longer input concatenates packet
 * MP3s (frame-level concat plays sequentially). The /speak chunked path keeps
 * each job chunk to one packet, so this multi-packet branch is only a safety
 * net for direct calls.
 */
async function synthesizeCloud(text, voice, prosody, custom) {
  const stored = loadHostCloudSettings();
  const apiKey = String((stored && stored.apiKey) || '').trim();
  if (!apiKey) throw hostErr('未配置 Google Cloud TTS API Key（设置 → 插件 → 语音 → Cloud 配置）', 'host.cloudNoKey');
  const v = String((custom && custom.voice) || voice || CLOUD_TTS_DEFAULTS.voice).trim() || CLOUD_TTS_DEFAULTS.voice;
  const tier = cloudTier(v);
  const packets = splitCloudPackets(text);
  if (packets.length <= 1) {
    const { bytes, billable } = await cloudWithRetry(
      () => synthesizeCloudPacket(packets[0] || String(text || ''), v, prosody, apiKey)
    );
    try { recordCloudUsage(tier, billable); } catch (e) { /* non-fatal */ }
    const outPath = path.join(os.tmpdir(), `dsh-tts-cloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
    writeFileSync(outPath, bytes);
    return outPath;
  }
  const bufs = [];
  for (const pkt of packets) {
    // Per-packet retry only: a failed packet retries itself, never the whole job.
    const { bytes, billable } = await cloudWithRetry(
      () => synthesizeCloudPacket(pkt, v, prosody, apiKey)
    );
    try { recordCloudUsage(tier, billable); } catch (e) { /* non-fatal */ }
    bufs.push(bytes);
  }
  const outPath = path.join(os.tmpdir(), `dsh-tts-cloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
  writeFileSync(outPath, Buffer.concat(bufs));
  return outPath;
}

registerProvider('google-cloud-tts', {
  synthesizeShort(text, voice, prosody, custom) {
    return synthesizeCloud(text, voice, prosody, custom);
  }
});
function getProvider(name) {
  return providers[name] || providers['edge-tts'];
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

/**
 * Atomic tokens that must never be split: URLs, emails and decimals/versions.
 * They contain '.' which the sentence splitter would otherwise treat as a
 * sentence end (splitting "3.14" into "3"/"14"), and hard cuts could break
 * them mid-token. Each atom is swapped for a placeholder without sentence
 * punctuation before splitting, then restored on the final parts.
 */
const ATOM_RE = /https?:\/\/[^\s，。！？；,!?;]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\d+(?:\.\d+)+/g;

/** Split text into chunks of <= maxChars, preferring sentence/segment boundaries. */
function splitText(text, maxChars) {
  const atoms = [];
  const guarded = String(text).replace(ATOM_RE, (tok) => {
    atoms.push(tok);
    return '\u0001' + (atoms.length - 1) + '\u0002';
  });
  const parts = [];
  const sentences = [];
  let m;
  const sre = /[^。！？；.!?;]+[。！？；.!?;]?/g;
  while ((m = sre.exec(guarded)) !== null) {
    const s = m[0].trim();
    if (s) sentences.push(s);
  }
  if (!sentences.length) sentences.push(guarded.trim());
  const segRe = /[^，、,]+[，、,]?/g;
  let cur = '';
  const flush = () => {
    if (cur.trim()) parts.push(cur.trim());
    cur = '';
  };
  const CUT_MIN = Math.max(4, Math.floor(maxChars * 0.5));
  // Boundary-aware hard cut: prefer the last whitespace / CJK punctuation in
  // the window, and never split an atomic placeholder (its tail \u0002 is a
  // good boundary; if we're inside one, cut before its \u0001 head).
  function safeEnd(seg, from) {
    const end = Math.min(seg.length, from + maxChars);
    for (let p = end; p > from + CUT_MIN; p--) {
      const ch = seg[p - 1];
      if (/\s/.test(ch) || '，、。！？；,!?;'.includes(ch) || ch === '\u0002') return p;
    }
    for (let p = end - 1; p > from; p--) {
      if (seg[p] === '\u0002') return p + 1;
      if (seg[p] === '\u0001') return p;
    }
    return end;
  }
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
          for (let i = 0; i < seg.length; ) {
            flush();
            const end = safeEnd(seg, i);
            if (end <= i) break; // defensive: never loop forever on zero progress
            cur = seg.slice(i, end);
            flush();
            i = end;
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
  const restored = parts.map((p) =>
    p.replace(/\u0001(\d+)\u0002/g, (_, idx) => atoms[Number(idx)] ?? ''),
  );
  // Orphan-tail fix: a tiny trailing chunk ("好。"/"OK.") reads like a stutter
  // on top of the previous chunk; merge it back when it fits.
  if (restored.length >= 2) {
    const last = restored[restored.length - 1];
    const prev = restored[restored.length - 2];
    if (last.length < 8 && prev.length + last.length <= maxChars) {
      const gap =
        /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(last) ? ' ' : '';
      restored[restored.length - 2] = prev + gap + last;
      restored.pop();
    }
  }
  return restored.filter((p) => p.length > 0);
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
// DSH_TTS_HOME overrides the base dir (tests isolate the settings/usage files).
function ttsHomeDir() {
  const o = process.env.DSH_TTS_HOME;
  if (typeof o === 'string' && o.trim() !== '') return o.trim();
  return path.join(os.homedir(), '.dsh', 'tts-rvc');
}
const CAL_DIR = ttsHomeDir();
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

// --- host RVC service settings (~/.dsh/tts-rvc/settings.json) -------------
// Service-class config (service URL + model/index paths) lives on the Host so
// it survives browser-data clears, incognito and browser switches. UI prefs
// (voice, rate, provider, rawMarkdown, notify, …) stay in localStorage.
// Shape: { version: 1, rvc: { baseUrl, model, index } }. Unknown keys are
// ignored on load; writes merge (never drop) and are best-effort.
const SETTINGS_FILE = path.join(CAL_DIR, 'settings.json');
const HOST_RVC_KEYS = ['baseUrl', 'model', 'index'];
function loadHostRvcSettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) return {};
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    const src = (data && data.rvc && typeof data.rvc === 'object') ? data.rvc : {};
    const out = {};
    for (const k of HOST_RVC_KEYS) {
      if (typeof src[k] === 'string' && src[k].trim() !== '') out[k] = src[k];
    }
    if (typeof src.baseUrl === 'string' && src.baseUrl.trim() !== '') {
      out.baseUrl = src.baseUrl.trim().replace(/\/+$/, '');
    }
    return out;
  } catch (e) {
    return {};
  }
}
function saveHostRvcSettings(patch) {
  let data = { version: 1 };
  try {
    if (existsSync(SETTINGS_FILE)) data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) || data;
  } catch (e) { /* start fresh */ }
  const prev = (data && data.rvc && typeof data.rvc === 'object') ? data.rvc : {};
  const next = { ...prev };
  const src = (patch && typeof patch === 'object') ? patch : {};
  for (const k of HOST_RVC_KEYS) {
    if (typeof src[k] === 'string') {
      const v = k === 'baseUrl' ? src[k].trim().replace(/\/+$/, '') : src[k].trim();
      // empty string clears the key (falls back to RVC_DEFAULTS)
      if (v === '') delete next[k];
      else next[k] = v;
    }
  }
  data.version = 1;
  data.rvc = next;
  try {
    mkdirSync(CAL_DIR, { recursive: true });
    writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
  } catch (e) { /* best-effort: memory still updated for this session */ }
  return next;
}

// --- host CosyVoice service settings (~/.dsh/tts-rvc/settings.json) -------
// Only the service address is service-class (survives browser-data clears);
// voice + synthesis params stay in localStorage as UI prefs.
// Shape: { version: 1, rvc: {...}, index: {...}, cosy: { baseUrl } }.
const HOST_COSY_KEYS = ['baseUrl'];
function loadHostCosySettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) return {};
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    const src = (data && data.cosy && typeof data.cosy === 'object') ? data.cosy : {};
    const out = {};
    if (typeof src.baseUrl === 'string' && src.baseUrl.trim() !== '') {
      out.baseUrl = src.baseUrl.trim().replace(/\/+$/, '');
    }
    return out;
  } catch (e) {
    return {};
  }
}
function saveHostCosySettings(patch) {
  let data = { version: 1 };
  try {
    if (existsSync(SETTINGS_FILE)) data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) || data;
  } catch (e) { /* start fresh */ }
  const prev = (data && data.cosy && typeof data.cosy === 'object') ? data.cosy : {};
  const next = { ...prev };
  const src = (patch && typeof patch === 'object') ? patch : {};
  for (const k of HOST_COSY_KEYS) {
    if (typeof src[k] === 'string') {
      const v = src[k].trim().replace(/\/+$/, '');
      if (v === '') delete next[k];
      else next[k] = v;
    }
  }
  data.version = 1;
  data.cosy = next;
  try {
    mkdirSync(CAL_DIR, { recursive: true });
    writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
  } catch (e) { /* best-effort */ }
  return next;
}

// --- host Index-TTS2 service settings (~/.dsh/tts-rvc/settings.json) -------
// Only the service address is service-class (survives browser-data clears);
// voice + synthesis params stay in localStorage as UI prefs.
// Shape: { version: 1, rvc: {...}, index: { baseUrl } }.
const HOST_INDEX_KEYS = ['baseUrl'];
function loadHostIndexSettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) return {};
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    const src = (data && data.index && typeof data.index === 'object') ? data.index : {};
    const out = {};
    if (typeof src.baseUrl === 'string' && src.baseUrl.trim() !== '') {
      out.baseUrl = src.baseUrl.trim().replace(/\/+$/, '');
    }
    return out;
  } catch (e) {
    return {};
  }
}
function saveHostIndexSettings(patch) {
  let data = { version: 1 };
  try {
    if (existsSync(SETTINGS_FILE)) data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) || data;
  } catch (e) { /* start fresh */ }
  const prev = (data && data.index && typeof data.index === 'object') ? data.index : {};
  const next = { ...prev };
  const src = (patch && typeof patch === 'object') ? patch : {};
  for (const k of HOST_INDEX_KEYS) {
    if (typeof src[k] === 'string') {
      const v = src[k].trim().replace(/\/+$/, '');
      if (v === '') delete next[k];
      else next[k] = v;
    }
  }
  data.version = 1;
  data.index = next;
  try {
    mkdirSync(CAL_DIR, { recursive: true });
    writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
  } catch (e) { /* best-effort */ }
  return next;
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
// Packs install into ~/.dsh/tts-rvc/packs/<packId>/ (<packId>.pth + <packId>.index).
// ---------------------------------------------------------------------------

const PACK_FILE = 'installed.json';

function packsDir() {
  return process.env.DSH_TTS_PACKS_DIR || path.join(os.homedir(), '.dsh', 'tts-rvc', 'packs');
}

function installedPacks() {
  let data = {};
  try {
    data = JSON.parse(readFileSync(path.join(packsDir(), PACK_FILE), 'utf8'));
  } catch (e) {
    return {};
  }
  // reconcile: drop entries whose model file no longer exists (user deleted it)
  let changed = false;
  for (const [id, e] of Object.entries(data)) {
    if (!e || !e.modelPath || !existsSync(e.modelPath)) {
      delete data[id];
      changed = true;
    }
  }
  if (changed) saveInstalledPacks(data);
  return data;
}

function saveInstalledPacks(data) {
  try {
    mkdirSync(packsDir(), { recursive: true });
    writeFileSync(path.join(packsDir(), PACK_FILE), JSON.stringify(data, null, 2));
  } catch (e) { /* best-effort */ }
}

async function fetchManifest(registry, proxy) {
  const url = String(registry || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) throw hostErr('仓库地址必须是 http(s) URL', 'host.registryNotUrl', { url });
  const manifestUrl = url + '/manifest.json';
  const raw = await withRetry(
    () => proxy ? downloadViaProxy(manifestUrl, proxy, { timeoutMs: 60000 }) : fetchBytes(manifestUrl, 60000),
    '清单',
  );
  let data = null;
  try { data = JSON.parse(raw.toString('utf8')); } catch (e) { /* fall through */ }
  if (!data) throw hostErr('清单格式无效', 'host.manifestInvalid');
  if (!Array.isArray(data.packs)) throw hostErr('清单格式无效（缺少 packs 数组）', 'host.manifestNoPacks');
  return { url, data };
}

/** Minimal HTTP(S) download through an HTTP proxy (CONNECT tunnel), no deps. */
function downloadViaProxy(targetUrl, proxyUrl, opts = {}) {
  const { timeoutMs = 900000, onChunk = null } = opts;
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const p = new URL(proxyUrl);
    const isHttps = u.protocol === 'https:';
    const port = u.port || (isHttps ? 443 : 80);
    const connectPath = u.hostname + ':' + port;
    let settled = false;
    const fail = (e) => { if (!settled) { settled = true; reject(e); } };
    const creq = httpRequest({
      host: p.hostname,
      port: p.port || 80,
      method: 'CONNECT',
      path: connectPath,
      headers: { Host: connectPath, 'Proxy-Connection': 'Keep-Alive' }
    });
    const timer = setTimeout(() => { try { creq.destroy(); } catch (e) {} fail(new Error('代理连接超时')); }, 30000);
    creq.on('connect', (res, socket) => {
      clearTimeout(timer);
      if (res.statusCode !== 200) { try { socket.destroy(); } catch (e) {} fail(new Error('代理 CONNECT ' + res.statusCode)); return; }
      const wire = isHttps ? tls.connect({ socket, servername: u.hostname }) : socket;
      wire.on('error', fail);
      const req = (isHttps ? httpsRequest : httpRequest)({
        createConnection: () => wire,
        host: u.hostname,
        port,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { Host: u.host, Connection: 'close' }
      }, (r) => {
        if (r.statusCode < 200 || r.statusCode >= 300) {
          r.resume();
          fail(new Error('HTTP ' + r.statusCode));
          return;
        }
        const chunks = [];
        const total = Number(r.headers['content-length']) || 0;
        let done = 0;
        r.on('data', (c) => {
          chunks.push(c);
          done += c.length;
          if (onChunk) onChunk(c, done, total);
        });
        r.on('end', () => { settled = true; resolve(Buffer.concat(chunks)); });
        r.on('error', fail);
      });
      req.on('error', fail);
      req.end();
    });
    creq.on('error', (e) => { clearTimeout(timer); fail(e); });
    creq.end();
  });
}

/** Simple fetch-body helper with AbortSignal timeout (direct connection). */
async function fetchBytes(url, timeoutMs) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Retry a network call a few times (slow/flaky connections self-heal). */
async function withRetry(fn, label, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw hostErr(`${label} 下载失败：${String((lastErr && lastErr.message) || lastErr)}`, "host.downloadFailed", { label });
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

// --- pack-install progress (client polls GET /rvc-pack-progress?key=) -------
const packProgress = new Map(); // key -> { phase, done, total, startedAt, finished? }

function setPackProgress(key, patch) {
  if (!key) return;
  const p = packProgress.get(key) || { phase: '准备', phaseKey: 'prepare', done: 0, total: 0, startedAt: Date.now() };
  Object.assign(p, patch);
  packProgress.set(key, p);
}

/** Mark the install finished (entry stays a while so the client sees 100%). */
function finishPackProgress(key) {
  if (!key) return;
  const p = packProgress.get(key);
  if (p) p.finished = true;
}

/** Stream-download with incremental sha256 + progress; returns the full bytes. */
async function downloadStream(url, expectedSha256, expectedSize, label, onProgress, proxy) {
  return withRetry(async () => {
    const hash = createHash('sha256');
    let bytes;
    if (proxy) {
      bytes = await downloadViaProxy(url, proxy, {
        timeoutMs: 1200000,
        onChunk: (c, done, total) => {
          hash.update(c);
          if (onProgress) onProgress(done, total || done);
        },
      });
    } else {
      const r = await fetch(url, { signal: AbortSignal.timeout(1200000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const total = Number(r.headers.get('content-length')) || 0;
      if (!r.body) throw hostErr('下载流不可用', 'host.downloadStreamUnavailable');
      const reader = r.body.getReader();
      const chunks = [];
      let done = 0;
      for (;;) {
        const { done: d, value } = await reader.read();
        if (d) break;
        chunks.push(Buffer.from(value));
        hash.update(value);
        done += value.length;
        if (onProgress) onProgress(done, total || done);
      }
      bytes = Buffer.concat(chunks);
    }
    if (expectedSize && bytes.length !== expectedSize) {
      throw hostErr(`大小不符（期望 ${expectedSize}，实际 ${bytes.length}）`, "host.sizeMismatch", { expected: expectedSize, actual: bytes.length });
    }
    if (expectedSha256) {
      const actual = hash.digest('hex');
      if (actual !== String(expectedSha256).toLowerCase()) {
        throw hostErr(`sha256 校验失败（期望 ${expectedSha256}，实际 ${actual}）`, "host.sha256Mismatch");
      }
    }
    return bytes;
  }, label);
}

async function installPack(registry, packId, indexId, progressKey, proxy) {
  const { url: base, data } = await fetchManifest(registry);
  const pack = data.packs.find((p) => p && p.id === packId);
  if (!pack) throw hostErr(`仓库中没有音色包 ${packId}`, "host.packNotFound", { packId });
  const stem = String(packId).replace(/[^\w.-]/g, '_');
  const dir = path.join(packsDir(), stem);
  const model = pack.model;
  if (!model || !model.url) throw hostErr('音色包缺少模型文件', 'host.packNoModel');
  // index variants: `indexes` array (preferred) or legacy single `index`
  let indexes = Array.isArray(pack.indexes) && pack.indexes.length
    ? pack.indexes.slice()
    : (pack.index ? [{ id: 'default', name: '默认索引', ...pack.index }] : []);
  const chosen = indexes.find((i) => i.id === indexId) || indexes[0] || null;
  const modelUrl = resolvePackUrl(base, model.url);
  const indexUrl = chosen ? resolvePackUrl(base, chosen.url) : '';
  const installed = installedPacks();
  const current = installed[packId] || {};
  // installed files keep the pack id in their name so the browse picker can
  // tell voices apart (e.g. guanguanV1.pth / guanguanV1.index)
  const modelPath = path.join(dir, stem + '.pth');
  const indexPath = indexUrl ? path.join(dir, stem + '.index') : '';
  const variants = indexes.map((i) => ({ id: i.id, name: i.name || i.id, size: i.size || 0 }));
  const modelUpToDate = current.version === pack.version && current.modelSha256 === model.sha256 && existsSync(modelPath);
  const indexUpToDate = !indexUrl || (indexPath && existsSync(indexPath) && current.indexSha256 === chosen.sha256);
  if (modelUpToDate && indexUpToDate) {
    return { ok: true, skipped: true, name: pack.name, modelPath, indexPath, indexId: chosen ? chosen.id : '', variants };
  }
  mkdirSync(dir, { recursive: true });
  const totalBytes = (model.size || 0) + (chosen && indexUrl ? chosen.size || 0 : 0);
  let downloaded = 0;
  try {
    if (!modelUpToDate) {
      setPackProgress(progressKey, { phase: '模型', phaseKey: 'model', done: 0, total: totalBytes });
      const modelBytes = await downloadStream(modelUrl, model.sha256, model.size, '模型', (d) => {
        downloaded = d;
        setPackProgress(progressKey, { phase: '模型', phaseKey: 'model', done: downloaded });
      }, proxy);
      writeFileSync(modelPath, modelBytes);
      downloaded = model.size || downloaded;
    }
    if (indexUrl && !indexUpToDate) {
      setPackProgress(progressKey, { phase: '索引', phaseKey: 'index', done: downloaded });
      const indexBytes = await downloadStream(indexUrl, chosen.sha256, chosen.size, '索引', (d) => {
        setPackProgress(progressKey, { phase: '索引', phaseKey: 'index', done: downloaded + d });
      }, proxy);
      writeFileSync(indexPath, indexBytes);
    }
  } catch (e) {
    finishPackProgress(progressKey);
    // remove partial install so a retry starts clean
    try {
      rmSync(modelPath, { force: true });
      rmSync(indexPath, { force: true });
    } catch (e2) { /* best-effort cleanup */ }
    throw e;
  }
  finishPackProgress(progressKey);
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

// ---------------------------------------------------------------------------
// Agent-event voice alerts (approval reminders).
// Approval requests/decisions are session events on the `session/event`
// firehose ('approval/asked' / 'approval/decided' in SessionEventMap —
// dsh-user-approval). The plugin Host subscribes via the sandbox-exposed
// `ctx.on`, buffers a small queue, and the client polls it incrementally
// (GET /dsh-tts-api/notify?s=N) to read the alert aloud. Dedup by (type, id)
// so a request is never announced twice, while its paired decision still is.
// ---------------------------------------------------------------------------
const notifyState = {
  queue: [],       // [{ seq, kind: 'approval'|'approval-decided', id, toolName, reason, outcome }]
  seen: new Set(), // per-(type,id) keys already ingested (dedup)
  seq: 0,
  cap: 20,
  seenCap: 200
};

function truncateForSpeech(s, max) {
  const t = String(s == null ? '' : s).trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** Ingest one session event into the notification queue (pure, testable). */
function ingestSessionEvent(event) {
  if (!event || typeof event !== 'object') return;
  const type = String(event.type || '');
  if (type !== 'approval/asked' && type !== 'approval/decided') return;
  // Real SessionEvent shape: { type, seq, time, data: {...} } — the payload
  // (id/toolName/reason/outcome) lives under `data`; fall back to the top
  // level so flat test fixtures keep working.
  const d = event.data && typeof event.data === 'object' ? event.data : event;
  const id = String(d.id || '');
  // An approval request and its decision are PAIRED by the same id, so dedup
  // per (type, id), not per id — both deserve an announcement.
  const seenKey = type + ':' + id;
  if (!id || notifyState.seen.has(seenKey)) return;
  notifyState.seen.add(seenKey);
  if (type === 'approval/asked') {
    notifyState.queue.push({
      seq: ++notifyState.seq,
      kind: 'approval',
      id,
      toolName: truncateForSpeech(d.toolName, 40),
      reason: truncateForSpeech(d.reason, 80)
    });
  } else {
    // dsh-user-approval outcome vocabulary: allowed-once | rejected |
    // cancelled | unavailable — collapsed to granted/rejected/settled for the
    // localized client announcements.
    const outcome = String(d.outcome || '');
    notifyState.queue.push({
      seq: ++notifyState.seq,
      kind: 'approval-decided',
      id,
      outcome: outcome === 'allowed-once' || outcome === 'granted'
        ? 'granted'
        : outcome === 'rejected'
          ? 'rejected'
          : 'settled'
    });
  }
  if (notifyState.seen.size > notifyState.seenCap) notifyState.seen.clear(); // coarse reset; client also dedups by seq
  while (notifyState.queue.length > notifyState.cap) notifyState.queue.shift();
}

export function apply(ctx) {
  const webServer = ctx.get('webServer');
  if (!webServer) return;

  // Approval voice alerts: subscribe to the session/event firehose (the
  // sandbox exposes ctx.on; feature-detect so the smoke fake-ctx still works).
  if (typeof ctx.on === 'function') {
    ctx.effect(
      () =>
        ctx.on('session/event', (_session, event) => {
          try {
            ingestSessionEvent(event);
          } catch (e) { /* observer failures are logged-and-contained by design */ }
        }),
      'dsh-plugin-tts: session events (approval alerts)',
    );
  }

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
      const audioPath = await job.sink(text);
      const id = 'c' + (++seq).toString(36) + '-' + hashText(text).slice(0, 6);
      files.set(id, audioPath);
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

  // Explicit cancel: the client abandons a chunked job early (user stops /
  // switches message). Stop scheduling further chunks and drop the job from the
  // registry immediately instead of waiting for the lazy 2/10-min GC, so the
  // local RVC GPU/memory is released promptly. The in-flight chunk (if any)
  // finishes writing a harmless temp file; no new chunks are started.
  function cancelJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return false;
    job.done = true;
    job.finishedAt = job.finishedAt || Date.now();
    jobs.delete(jobId);
    return true;
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
        const indexCfg = provider === 'index-tts2' ? indexTts2Config(custom, voice) : null;
        const cosyCfg = provider === 'cosyvoice' ? cosyConfig(custom, voice) : null;
        const cloudVoice = provider === 'google-cloud-tts'
          ? (String((custom && custom.voice) || voice || CLOUD_TTS_DEFAULTS.voice).trim() || CLOUD_TTS_DEFAULTS.voice)
          : null;
        const providerKey = provider === 'rvc'
          ? 'rvc|' + rvcFingerprint(cfg)
          : provider === 'index-tts2'
            ? 'index-tts2|' + JSON.stringify(indexCfg || {})
            : provider === 'cosyvoice'
              ? 'cosyvoice|' + JSON.stringify(cosyCfg || {})
              : provider === 'google-cloud-tts'
              ? 'google-cloud-tts|' + (cloudVoice || '') + '|' + JSON.stringify(prosody || {})
              : provider + '|' + JSON.stringify(prosody || {});
        const key = providerKey + '|' + voice + '|' + text;
        const hit = cache.get(key);
        if (hit) {
          // Harden: the cached URL may point to a file already evicted from the
          // `files` map or cleaned from the OS temp dir. Only reuse it if the
          // backing file still exists; otherwise re-synthesize (avoids a stale
          // URL that would 404 at play time).
          const hitId = String(hit).split('/').pop();
          const hitPath = files.get(hitId);
          if (hitPath && existsSync(hitPath)) {
            writeJson(res, 200, { url: hit });
            return;
          }
          cache.delete(key);
        }

        // ---- adaptive chunked progressive playback ----
        // Long reads stream progressively ("first chunk plays while the rest
        // synthesize") for RVC / Index-TTS2 / CosyVoice / Cloud / plain Edge
        // TTS, reusing one pipeline: RVC uses the calibration-probed chunk
        // size; Index-TTS2, CosyVoice and Edge use a fixed size (remote/local
        // synthesis is the bottleneck, no local speed to probe). Cloud uses
        // splitCloudPackets (sentence split + atomic protection from splitText,
        // then byte packing under the 5000-byte sync hard limit); short Cloud
        // text stays in the single-URL branch below as long as it fits one packet.
        const chunkable = estimateSpeechSeconds(text) > 12;
        if (chunkable) {
          cleanupJobs();
          const cal = provider === 'rvc'
            ? await getCalibration(cfg)
            : provider === 'index-tts2'
              ? { chunkSec: 15, prewarm: 2, ratio: 0 }
              : provider === 'cosyvoice'
                ? { chunkSec: 15, prewarm: 2, ratio: 0 }
                : provider === 'google-cloud-tts'
                ? { chunkSec: 120, prewarm: 1, ratio: 0 }
                : { chunkSec: 20, prewarm: 2, ratio: 0 };
          const maxChars = Math.max(16, Math.round(cal.chunkSec * (isLatinHeavy(text) ? 12 : 3.6)));
          const parts = provider === 'google-cloud-tts'
            ? splitCloudPackets(text)
            : splitText(text, maxChars);
          if (parts.length > 1) {
            const jobId = 'j' + (++jobSeq).toString(36);
            const job = {
              id: jobId,
              voice,
              custom,
              sink: provider === 'rvc'
                ? t => synthesizeRvc(t, voice, custom)
                : provider === 'index-tts2'
                  ? t => synthesizeIndexTts2(t, voice, custom)
                  : provider === 'cosyvoice'
                    ? t => synthesizeCosy(t, voice, custom)
                    : provider === 'google-cloud-tts'
                    ? t => synthesizeCloud(t, cloudVoice || voice, prosody, custom)
                    : t => synthesize(t, voice, prosody || undefined),
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

        const absPath = await getProvider(provider).synthesizeShort(
          text, voice, prosody, custom,
        );
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
        writeRouteError(res, e);
      }
    }
  });

  const audioDisposer = webServer.register({
    kind: 'prefix',
    path: '/dsh-tts-audio',
    async handler(req, res) {
      try {
        const url = req.url || '/';
        const segs = url.split('?')[0].split('/').filter(Boolean);
        const id = segs[segs.length - 1] || '';
        const download = new URL(url, 'http://x').searchParams.get('download') === '1';
        const absPath = files.get(id);
        if (!absPath || !existsSync(absPath)) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('not found');
          return;
        }
        const bytes = readFileSync(absPath);
        const isWav = absPath.toLowerCase().endsWith('.wav');
        const headers = {
          'Content-Type': isWav ? 'audio/wav' : 'audio/mpeg',
          'Content-Length': bytes.length,
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff'
        };
        if (download) {
          // send as a downloadable attachment so users can keep the synthesized
          // audio (Edge base, RVC-converted or Index-TTS2) instead of only streaming it
          const filename = 'dsh-tts-' + id + (isWav ? '.wav' : '.mp3');
          headers['Content-Disposition'] = "attachment; filename=\"" + filename + "\"";
        }
        res.writeHead(200, headers);
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
      const q = new URL(req.url || '', 'http://x').searchParams;
      const baseUrl = String(q.get('baseUrl') || RVC_DEFAULTS.baseUrl).replace(/\/+$/, '');
      try {
        const kind = q.get('kind') === 'index' ? 'index' : 'pth';
        const r = await fetch(baseUrl + '/files?kind=' + kind, {
          signal: AbortSignal.timeout(15000)
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) {
          writeErr(res, 502, `RVC /files 接口异常（HTTP ${r.status}）：${(data && data.message) || r.statusText}`, { code: "host.filesHttpFail", params: { status: r.status } });
          return;
        }
        writeJson(res, 200, data || { ok: false, files: [] });
      } catch (e) {
        const startup = rvcStartupHint();
        const rawError = String((e && e.message) || e);
        writeErr(res, 502,
          `无法连接本地 RVC 服务（${baseUrl}）——浏览本地文件需要它先运行。\n` +
          startup +
          `\n并确认设置里的「服务地址」与端口一致。原始错误：${rawError}`,
          { code: "host.filesNeedsServer", params: { baseUrl, startup, error: rawError } }
        );
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
        const cancel = q.get('cancel') === '1';
        cleanupJobs();
        if (cancel) {
          // client abandon: release the job now (see cancelJob)
          const was = cancelJob(jobId);
          writeJson(res, 200, { done: true, cancelled: was });
          return;
        }
        const r = await nextJobChunk(jobId);
        writeJson(res, 200, r);
      } catch (e) {
        writeErr(res, 500, `后续段落合成失败：${String((e && e.message) || e)}`, { code: "host.chunkFail" });
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
        const msg = String((e && e.message) || e);
        const needsServer = /无法连接本地 RVC 推理服务/.test(msg);
        const startup = rvcStartupHint();
        writeErr(res, 502,
          needsServer
            ? `无法连接本地 RVC 服务——生成紧凑索引需要它先运行。\n` +
              startup +
              `\n原始错误：${msg}`
            : `紧凑索引生成失败：${msg}`,
          {
            code: needsServer ? "host.compactNeedsServer" : "host.compactFail",
            params: needsServer ? { baseUrl, startup, error: msg } : { error: msg }
          }
        );
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
        const proxy = q.get('proxy') || '';
        const { data } = await fetchManifest(registry, proxy);
        writeJson(res, 200, data);
      } catch (e) {
        writeErr(res, 502, `获取音色包列表失败：${String((e && e.message) || e)}`, { code: "host.packsListFail" });
      }
    }
  });

  const packsInstalledDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/rvc-packs-installed',
    async handler(req, res) {
      try {
        writeJson(res, 200, { installed: installedPacks(), packsDir: packsDir() });
      } catch (e) {
        writeRouteError(res, e);
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
        const progressKey = parsed.progressKey ? String(parsed.progressKey).slice(0, 80) : '';
        const proxy = parsed.proxy ? String(parsed.proxy).slice(0, 300) : '';
        if (!registry || !packId) {
          writeErr(res, 400, 'registry 与 packId 必填', { code: 'host.registryPackRequired' });
          return;
        }
        // create the progress entry BEFORE the manifest fetch so the client's
        // poll never sees an empty gap and mistakes it for "finished"
        setPackProgress(progressKey, { phase: '准备', phaseKey: 'prepare', done: 0, total: 0 });
        try {
          const result = await installPack(registry, packId, indexId, progressKey, proxy);
          writeJson(res, 200, result);
        } catch (e) {
          finishPackProgress(progressKey);
          writeErr(res, 502, `音色包安装失败：${String((e && e.message) || e)}`, { code: "host.packInstallFail" });
        }
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });

  const packUninstallDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/rvc-pack-uninstall',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const packId = String(parsed.packId || '').trim();
        if (!packId) {
          writeErr(res, 400, 'packId 必填', { code: 'host.packIdRequired' });
          return;
        }
        const stem = packId.replace(/[^\w.-]/g, '_');
        const dir = path.join(packsDir(), stem);
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch (e) { /* best-effort */ }
        const installed = installedPacks();
        delete installed[packId];
        saveInstalledPacks(installed);
        writeJson(res, 200, { ok: true });
      } catch (e) {
        writeErr(res, 502, `卸载失败：${String((e && e.message) || e)}`, { code: "host.packUninstallFail" });
      }
    }
  });

  const diagnoseDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/diagnose',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const baseUrl = String(parsed.rvcBaseUrl || RVC_DEFAULTS.baseUrl).replace(/\/+$/, '');
        const checks = [];

        // 1) Edge TTS online synthesis
        const edgeCheck = { id: 'edge', name: 'Edge TTS 在线合成', ok: false, cls: '', detail: '' };
        try {
          const t0 = Date.now();
          await synthesize('测试一下。', 'zh-CN-XiaoxuanNeural', {});
          edgeCheck.ok = true;
          edgeCheck.cls = 'ok';
          edgeCheck.detail = '正常（' + (Date.now() - t0) + 'ms）';
        } catch (e) {
          const msg = String((e && e.message) || e);
          if (msg.includes('1007')) {
            edgeCheck.cls = 'voice';
            edgeCheck.detail = '音色被端点移除（1007）：请换用列表内的音色';
          } else if (/403|Sec-MS-GEC|1006|timeout|websocket|closed early/i.test(msg)) {
            edgeCheck.cls = 'protocol';
            edgeCheck.detail = 'Edge 端点协议/网络异常：' + msg.slice(0, 140);
          } else {
            edgeCheck.cls = 'connect';
            edgeCheck.detail = '网络/连接异常：' + msg.slice(0, 140);
          }
        }
        checks.push(edgeCheck);

        // 2) RVC server reachability + loaded model status
        const rvcCheck = { id: 'rvc-server', name: '本地 RVC 服务', ok: false, cls: '', detail: '' };
        const modelCheck = { id: 'rvc-model', name: 'RVC 模型', ok: false, cls: '', detail: '' };
        try {
          const r = await fetch(baseUrl + '/health', { signal: AbortSignal.timeout(6000) });
          const d = await r.json().catch(() => null);
          if (!r.ok || !d || d.ok !== true) {
            rvcCheck.cls = 'protocol';
            rvcCheck.detail = '服务响应异常（HTTP ' + r.status + '）';
          } else {
            rvcCheck.ok = true;
            rvcCheck.cls = 'ok';
            rvcCheck.detail = '在线' + (d.gpu_name ? ' · ' + d.gpu_name + ' · ' + (d.vram_gb || '?') + 'GB' : '');
            if (d.model_loaded) {
              modelCheck.ok = true;
              modelCheck.cls = 'ok';
              modelCheck.detail = '已加载：' + (d.model || '');
            } else {
              modelCheck.cls = 'warn';
              modelCheck.detail = '服务在线但未加载模型——填好模型路径后，首次朗读会自动加载';
            }
          }
        } catch (e) {
          rvcCheck.cls = 'connect';
          rvcCheck.detail = '无法连接（' + baseUrl + '）——请先启动 rvc-server.py（见使用手册 §4.2），并确认「服务地址」';
        }
        checks.push(rvcCheck, modelCheck);

        // 3) Local Index-TTS2 service (reference-audio voice engine)
        const indexBaseUrl = String(parsed.indexBaseUrl || INDEX_TTS2_DEFAULTS.baseUrl).replace(/\/+$/, '');
        const indexCheck = { id: 'index-server', name: '本地 Index-TTS2 服务', ok: false, cls: '', detail: '' };
        const indexVoiceCheck = { id: 'index-voice', name: 'Index-TTS2 参考音色', ok: false, cls: '', detail: '' };
        try {
          const r = await fetch(indexBaseUrl + '/health', { signal: AbortSignal.timeout(6000) });
          const d = await r.json().catch(() => null);
          if (!r.ok || !d) {
            indexCheck.cls = 'protocol';
            indexCheck.detail = '服务响应异常（HTTP ' + r.status + '）';
          } else {
            indexCheck.ok = true;
            indexCheck.cls = 'ok';
            indexCheck.detail = '在线' + (d.model_loaded === false ? '（模型未加载）' : '');
            try {
              const vr = await fetch(indexBaseUrl + '/api/v1/voices', { signal: AbortSignal.timeout(6000) });
              const vd = await vr.json().catch(() => null);
              const voices = (vd && Array.isArray(vd.voices)) ? vd.voices : [];
              if (!vr.ok) {
                indexVoiceCheck.cls = 'protocol';
                indexVoiceCheck.detail = '音色列表异常（HTTP ' + vr.status + '）';
              } else if (!voices.length) {
                indexVoiceCheck.cls = 'warn';
                indexVoiceCheck.detail = '服务在线但 api/ckyp 为空——请放参考音频再刷新';
              } else {
                indexVoiceCheck.ok = true;
                indexVoiceCheck.cls = 'ok';
                indexVoiceCheck.detail = voices.length + ' 个参考音色：' + voices.slice(0, 3).join('、') + (voices.length > 3 ? '…' : '');
              }
            } catch (e2) {
              indexVoiceCheck.cls = 'connect';
              indexVoiceCheck.detail = '音色列表读取失败：' + String((e2 && e2.message) || e2).slice(0, 120);
            }
          }
        } catch (e) {
          indexCheck.cls = 'connect';
          indexCheck.detail = '无法连接（' + indexBaseUrl + '）——请先双击本地包里的「启动api服务.bat」，并确认「服务地址」';
        }
        checks.push(indexCheck, indexVoiceCheck);

        // 4) Local CosyVoice service (zero-shot prompt voice engine)
        const cosyBaseUrl = String(parsed.cosyBaseUrl || COSY_DEFAULTS.baseUrl).replace(/\/+$/, '');
        const cosyCheck = { id: 'cosy-server', name: '本地 CosyVoice 服务', ok: false, cls: '', detail: '' };
        const cosyVoiceCheck = { id: 'cosy-voice', name: 'CosyVoice 提示音频', ok: false, cls: '', detail: '' };
        try {
          const r = await fetch(cosyBaseUrl + '/health', { signal: AbortSignal.timeout(6000) });
          const d = await r.json().catch(() => null);
          if (!r.ok || !d) {
            cosyCheck.cls = 'protocol';
            cosyCheck.detail = '服务响应异常（HTTP ' + r.status + '）';
          } else {
            cosyCheck.ok = true;
            cosyCheck.cls = 'ok';
            cosyCheck.detail = '在线' + (d.gpu_name ? ' · ' + d.gpu_name + ' · ' + (d.vram_gb || '?') + 'GB' : '');
            try {
              const vr = await fetch(cosyBaseUrl + '/voices', { signal: AbortSignal.timeout(6000) });
              const vd = await vr.json().catch(() => null);
              const voices = (vd && Array.isArray(vd.voices)) ? vd.voices : [];
              if (!vr.ok) {
                cosyVoiceCheck.cls = 'protocol';
                cosyVoiceCheck.detail = '提示音频列表异常（HTTP ' + vr.status + '）';
              } else if (!voices.length) {
                cosyVoiceCheck.cls = 'warn';
                cosyVoiceCheck.detail = '服务在线但 prompts 为空——请放提示音频再刷新';
              } else {
                cosyVoiceCheck.ok = true;
                cosyVoiceCheck.cls = 'ok';
                cosyVoiceCheck.detail = voices.length + ' 个提示音频：' + voices.slice(0, 3).join('、') + (voices.length > 3 ? '…' : '');
              }
            } catch (e2) {
              cosyVoiceCheck.cls = 'connect';
              cosyVoiceCheck.detail = '提示音频列表读取失败：' + String((e2 && e2.message) || e2).slice(0, 120);
            }
          }
        } catch (e) {
          cosyCheck.cls = 'connect';
          cosyCheck.detail = '无法连接（' + cosyBaseUrl + '）——请先双击本地包里的「启动cosy服务.bat」，并确认「服务地址」';
        }
        checks.push(cosyCheck, cosyVoiceCheck);

        // 5) Google Cloud TTS: key presence + optional live probe.
        // Skipped by default (no key configured -> neutral state, not red);
        // when probe=true and a key exists, synthesize a short test clip.
        const cloudStored = loadHostCloudSettings();
        const cloudCheck = { id: 'cloud', name: 'Google Cloud TTS', ok: false, cls: '', detail: '' };
        if (!cloudStored.apiKey) {
          cloudCheck.cls = 'skip';
          cloudCheck.detail = '未配置 API Key（设置 → 插件 → 语音 → Cloud 配置填写后可测）';
        } else if (String(parsed.cloudProbe || '') === '1') {
          const cloudVoice = String(parsed.cloudVoice || CLOUD_TTS_DEFAULTS.voice);
          try {
            const t0 = Date.now();
            await synthesizeCloudPacket('测试一下。', cloudVoice, null, cloudStored.apiKey, 30000);
            cloudCheck.ok = true;
            cloudCheck.cls = 'ok';
            cloudCheck.detail = '正常（' + (Date.now() - t0) + 'ms · ' + cloudTier(cloudVoice) + '）';
          } catch (e) {
            const msg = String((e && e.message) || e);
            if (/Key 无效|API Key/i.test(msg)) {
              cloudCheck.cls = 'voice';
              cloudCheck.detail = 'Key 无效或未启用 Text-to-Speech API';
            } else {
              cloudCheck.cls = 'connect';
              cloudCheck.detail = '合成异常：' + msg.slice(0, 140);
            }
          }
        } else {
          cloudCheck.ok = true;
          cloudCheck.cls = 'ok';
          cloudCheck.detail = '已配置 API Key（勾选探测可实测合成）';
        }
        checks.push(cloudCheck);
        writeJson(res, 200, { ok: checks.every((c) => c.ok), checks });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });

  const packProgressDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/rvc-pack-progress',
    async handler(req, res) {
      try {
        const q = new URL(req.url || '', 'http://x').searchParams;
        const key = q.get('key') || '';
        const p = key ? packProgress.get(key) : undefined;
        if (p) {
          const elapsed = Math.max(1, (Date.now() - p.startedAt) / 1000);
          writeJson(res, 200, {
            phase: p.phase,
            phaseKey: p.phaseKey || (p.phase === '模型' ? 'model' : p.phase === '索引' ? 'index' : 'prepare'),
            done: p.done,
            total: p.total,
            speed: Math.round(p.done / elapsed),
            finished: !!p.finished
          });
          if (Date.now() - p.startedAt > 600000) packProgress.delete(key);
          return;
        }
        writeJson(res, 200, { waiting: true }); // entry not created yet — keep polling
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });

  // Host RVC service settings: GET returns persisted service config merged
  // over defaults; POST merges the given keys (empty string clears a key).
  // localStorage keeps UI prefs only; this file is the source of truth for
  // baseUrl/model/index across browsers and browser-data clears.
  const rvcConfigGetDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/rvc-config',
    async handler(req, res) {
      try {
        if ((req.method || 'GET').toUpperCase() !== 'GET') {
          writeJson(res, 405, { error: 'method not allowed' });
          return;
        }
        const stored = loadHostRvcSettings();
        writeJson(res, 200, {
          rvc: {
            baseUrl: stored.baseUrl || RVC_DEFAULTS.baseUrl,
            model: stored.model || '',
            index: stored.index || ''
          }
        });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const rvcConfigPostDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/rvc-config-save',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const patch = (parsed && parsed.rvc && typeof parsed.rvc === 'object') ? parsed.rvc : parsed;
        if (patch.baseUrl !== undefined && typeof patch.baseUrl === 'string' && patch.baseUrl.trim() !== '') {
          const u = patch.baseUrl.trim();
          if (!/^https?:\/\//i.test(u)) {
            writeJson(res, 400, { error: '服务地址必须是 http(s) URL', i18n: { code: 'host.registryNotUrl', params: {} } });
            return;
          }
        }
        const next = saveHostRvcSettings(patch);
        writeJson(res, 200, {
          ok: true,
          rvc: {
            baseUrl: next.baseUrl || RVC_DEFAULTS.baseUrl,
            model: next.model || '',
            index: next.index || ''
          }
        });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });

  // Local Index-TTS2 service proxy: voices list, reference-audio upload and
  // service-address persistence. Synthesis itself goes through /speak with
  // provider 'index-tts2' (custom = shared.index), so chunking/cache stay unified.
  const indexVoicesDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/index-voices',
    async handler(req, res) {
      try {
        const q = new URL(req.url || '', 'http://x').searchParams;
        const baseUrl = String(q.get('baseUrl') || INDEX_TTS2_DEFAULTS.baseUrl).replace(/\/+$/, '');
        let r;
        try {
          r = await fetch(baseUrl + '/api/v1/voices', { signal: AbortSignal.timeout(15000) });
        } catch (e) {
          writeErr(res, 502,
            `无法连接本地 Index-TTS2 服务（${baseUrl}）。\n${indexStartupHint()}\n原始错误：${String((e && e.message) || e)}`,
            { code: 'host.indexNeedsServer', params: { baseUrl } });
          return;
        }
        const data = await r.json().catch(() => null);
        if (!r.ok) {
          writeErr(res, 502, `Index-TTS2 /api/v1/voices 异常（HTTP ${r.status}）`, { code: 'host.indexVoicesFail', params: { status: r.status } });
          return;
        }
        writeJson(res, 200, data || { voices: [], count: 0 });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const indexUploadDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/index-upload',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const baseUrl = String(parsed.baseUrl || INDEX_TTS2_DEFAULTS.baseUrl).replace(/\/+$/, '');
        const filename = String(parsed.filename || '').split(/[\\/]/).pop();
        const audioBase64 = String(parsed.audioBase64 || '');
        if (!filename || !audioBase64) {
          writeErr(res, 400, 'filename 与 audioBase64 必填', { code: 'host.uploadRequired' });
          return;
        }
        const bytes = Buffer.from(audioBase64, 'base64');
        if (!bytes.length) {
          writeErr(res, 400, '音频内容为空', { code: 'host.uploadEmpty' });
          return;
        }
        // Forward as multipart to the Index-TTS2 service (no extra deps:
        // build the multipart body by hand).
        const boundary = '----dsh-index-' + Date.now().toString(36);
        const head = Buffer.from(
          '--' + boundary + '\r\n' +
          'Content-Disposition: form-data; name="file"; filename="' + filename.replace(/"/g, '_') + '"\r\n' +
          'Content-Type: application/octet-stream\r\n\r\n', 'utf8');
        const tail = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
        let r;
        try {
          r = await fetch(baseUrl + '/api/v1/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
            body: Buffer.concat([head, bytes, tail]),
            signal: AbortSignal.timeout(120000)
          });
        } catch (e) {
          writeErr(res, 502, `无法连接本地 Index-TTS2 服务（${baseUrl}）`, { code: 'host.indexNeedsServer', params: { baseUrl } });
          return;
        }
        const data = await r.json().catch(() => null);
        if (!r.ok) {
          writeErr(res, 502, `参考音频上传失败（HTTP ${r.status}）：${(data && (data.detail || data.message)) || r.statusText}`, { code: 'host.indexUploadFail', params: { status: r.status } });
          return;
        }
        writeJson(res, 200, data || { ok: true });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const indexConfigGetDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/index-config',
    async handler(req, res) {
      try {
        if ((req.method || 'GET').toUpperCase() !== 'GET') {
          writeJson(res, 405, { error: 'method not allowed' });
          return;
        }
        const stored = loadHostIndexSettings();
        writeJson(res, 200, { index: { baseUrl: stored.baseUrl || INDEX_TTS2_DEFAULTS.baseUrl } });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const indexConfigPostDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/index-config-save',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const patch = (parsed && parsed.index && typeof parsed.index === 'object') ? parsed.index : parsed;
        if (patch.baseUrl !== undefined && typeof patch.baseUrl === 'string' && patch.baseUrl.trim() !== '') {
          const u = patch.baseUrl.trim();
          if (!/^https?:\/\//i.test(u)) {
            writeJson(res, 400, { error: '服务地址必须是 http(s) URL', i18n: { code: 'host.registryNotUrl', params: {} } });
            return;
          }
        }
        const next = saveHostIndexSettings(patch);
        writeJson(res, 200, { ok: true, index: { baseUrl: next.baseUrl || INDEX_TTS2_DEFAULTS.baseUrl } });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });

  // Local CosyVoice service proxy: voices list, prompt-audio upload and
  // service-address persistence. Synthesis itself goes through /speak with
  // provider 'cosyvoice' (custom = shared.cosy), so chunking/cache stay unified.
  const cosyVoicesDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/cosy-voices',
    async handler(req, res) {
      try {
        const q = new URL(req.url || '', 'http://x').searchParams;
        const baseUrl = String(q.get('baseUrl') || COSY_DEFAULTS.baseUrl).replace(/\/+$/, '');
        let r;
        try {
          r = await fetch(baseUrl + '/voices', { signal: AbortSignal.timeout(15000) });
        } catch (e) {
          writeErr(res, 502,
            `无法连接本地 CosyVoice 服务（${baseUrl}）。\n${cosyStartupHint()}\n原始错误：${String((e && e.message) || e)}`,
            { code: 'host.cosyNeedsServer', params: { baseUrl } });
          return;
        }
        const data = await r.json().catch(() => null);
        if (!r.ok) {
          writeErr(res, 502, `CosyVoice /voices 异常（HTTP ${r.status}）`, { code: 'host.cosyVoicesFail', params: { status: r.status } });
          return;
        }
        writeJson(res, 200, data || { voices: [], count: 0 });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const cosyUploadDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/cosy-upload',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const baseUrl = String(parsed.baseUrl || COSY_DEFAULTS.baseUrl).replace(/\/+$/, '');
        const filename = String(parsed.filename || '').split(/[\\/]/).pop();
        const audioBase64 = String(parsed.audioBase64 || '');
        if (!filename || !audioBase64) {
          writeErr(res, 400, 'filename 与 audioBase64 必填', { code: 'host.uploadRequired' });
          return;
        }
        const bytes = Buffer.from(audioBase64, 'base64');
        if (!bytes.length) {
          writeErr(res, 400, '音频内容为空', { code: 'host.uploadEmpty' });
          return;
        }
        // cosy-server.py takes JSON + base64 directly (no multipart needed).
        let r;
        try {
          r = await fetch(baseUrl + '/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, audio_base64: bytes.toString('base64') }),
            signal: AbortSignal.timeout(120000)
          });
        } catch (e) {
          writeErr(res, 502, `无法连接本地 CosyVoice 服务（${baseUrl}）`, { code: 'host.cosyNeedsServer', params: { baseUrl } });
          return;
        }
        const data = await r.json().catch(() => null);
        if (!r.ok) {
          writeErr(res, 502, `提示音频上传失败（HTTP ${r.status}）：${(data && (data.detail || data.message)) || r.statusText}`, { code: 'host.cosyUploadFail', params: { status: r.status } });
          return;
        }
        writeJson(res, 200, data || { ok: true });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const cosyConfigGetDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/cosy-config',
    async handler(req, res) {
      try {
        if ((req.method || 'GET').toUpperCase() !== 'GET') {
          writeJson(res, 405, { error: 'method not allowed' });
          return;
        }
        const stored = loadHostCosySettings();
        writeJson(res, 200, { cosy: { baseUrl: stored.baseUrl || COSY_DEFAULTS.baseUrl } });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const cosyConfigPostDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/cosy-config-save',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const patch = (parsed && parsed.cosy && typeof parsed.cosy === 'object') ? parsed.cosy : parsed;
        if (patch.baseUrl !== undefined && typeof patch.baseUrl === 'string' && patch.baseUrl.trim() !== '') {
          const u = patch.baseUrl.trim();
          if (!/^https?:\/\//i.test(u)) {
            writeJson(res, 400, { error: '服务地址必须是 http(s) URL', i18n: { code: 'host.registryNotUrl', params: {} } });
            return;
          }
        }
        const next = saveHostCosySettings(patch);
        writeJson(res, 200, { ok: true, cosy: { baseUrl: next.baseUrl || COSY_DEFAULTS.baseUrl } });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });

  // Google Cloud TTS service settings: GET never echoes the key in full
  // (only apiKeySet + a tail hint); POST sets keys (empty string clears).
  // Project ID is optional and only stored for future official-quota queries.
  const cloudConfigGetDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/cloud-config',
    async handler(req, res) {
      try {
        if ((req.method || 'GET').toUpperCase() !== 'GET') {
          writeJson(res, 405, { error: 'method not allowed' });
          return;
        }
        const stored = loadHostCloudSettings();
        const tail = stored.apiKey ? stored.apiKey.slice(-4) : '';
        writeJson(res, 200, {
          cloud: {
            apiKeySet: !!stored.apiKey,
            apiKeyTail: stored.apiKey ? '…' + tail : '',
            projectId: stored.projectId || ''
          }
        });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const cloudConfigPostDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/cloud-config-save',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const patch = (parsed && parsed.cloud && typeof parsed.cloud === 'object') ? parsed.cloud : parsed;
        if (patch.apiKey !== undefined && typeof patch.apiKey === 'string' && patch.apiKey.trim() !== '') {
          if (patch.apiKey.trim().length < 10) {
            writeJson(res, 400, { error: 'API Key 看起来太短，请检查是否粘贴完整', i18n: { code: 'host.cloudKeyBad', params: {} } });
            return;
          }
        }
        const next = saveHostCloudSettings(patch);
        writeJson(res, 200, {
          ok: true,
          cloud: {
            apiKeySet: !!next.apiKey,
            apiKeyTail: next.apiKey ? '…' + next.apiKey.slice(-4) : '',
            projectId: next.projectId || ''
          }
        });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });

  // Local quota ledger: this month's used chars + remaining per tier.
  // Official serviceusage/monitoring queries are opt-in later (needs SA JSON);
  // until then `official.enabled` is false and only local counts are shown.
  const cloudUsageDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/cloud-usage',
    async handler(req, res) {
      try {
        if ((req.method || 'GET').toUpperCase() !== 'GET') {
          writeJson(res, 405, { error: 'method not allowed' });
          return;
        }
        writeJson(res, 200, { ok: true, ...getCloudUsageSummary() });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });

  // Cloud connectivity test: synthesizes a short probe with the stored key.
  // Does NOT consume the returned audio; counts the probe chars like any read.
  const cloudTestDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/cloud-test',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const stored = loadHostCloudSettings();
        const apiKey = stored.apiKey || '';
        if (!apiKey) {
          writeErr(res, 400, '未配置 API Key（请先粘贴并保存）', { code: 'host.cloudNoKey' });
          return;
        }
        const voice = String((parsed && parsed.voice) || CLOUD_TTS_DEFAULTS.voice);
        const tier = cloudTier(voice);
        const t0 = Date.now();
        try {
          const { bytes, billable } = await cloudWithRetry(
            () => synthesizeCloudPacket('你好，这是一个语音测试。', voice, null, apiKey, 30000)
          );
          try { recordCloudUsage(tier, billable); } catch (e) { /* non-fatal */ }
          writeJson(res, 200, {
            ok: true,
            ms: Date.now() - t0,
            bytes: bytes.length,
            voice,
            tier
          });
        } catch (e) {
          writeRouteError(res, e);
        }
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });

  // Approval-alert queue: the client polls for new items since its cursor and
  // reads them aloud (approval requests interrupt, results announce when idle).
  const notifyDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/notify',
    async handler(req, res) {
      try {
        const q = new URL(req.url || '', 'http://x').searchParams;
        const since = Number(q.get('s') || 0) || 0;
        const items = notifyState.queue
          .filter((i) => i.seq > since)
          .map((i) => ({
            seq: i.seq,
            kind: i.kind,
            toolName: i.toolName,
            reason: i.reason,
            outcome: i.outcome
          }));
        writeJson(res, 200, { items, latest: notifyState.seq });
      } catch (e) {
        writeRouteError(res, e);
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
  ctx.effect(() => packUninstallDisposer, 'dsh-plugin-tts: rvc pack-uninstall route');
  ctx.effect(() => packProgressDisposer, 'dsh-plugin-tts: rvc pack-progress route');
  ctx.effect(() => rvcConfigGetDisposer, 'dsh-plugin-tts: rvc config route');
  ctx.effect(() => rvcConfigPostDisposer, 'dsh-plugin-tts: rvc config save route');
  ctx.effect(() => indexVoicesDisposer, 'dsh-plugin-tts: index voices route');
  ctx.effect(() => indexUploadDisposer, 'dsh-plugin-tts: index upload route');
  ctx.effect(() => indexConfigGetDisposer, 'dsh-plugin-tts: index config route');
  ctx.effect(() => indexConfigPostDisposer, 'dsh-plugin-tts: index config save route');
  ctx.effect(() => cosyVoicesDisposer, 'dsh-plugin-tts: cosy voices route');
  ctx.effect(() => cosyUploadDisposer, 'dsh-plugin-tts: cosy upload route');
  ctx.effect(() => cosyConfigGetDisposer, 'dsh-plugin-tts: cosy config route');
  ctx.effect(() => cosyConfigPostDisposer, 'dsh-plugin-tts: cosy config save route');
  ctx.effect(() => cloudConfigGetDisposer, 'dsh-plugin-tts: cloud config route');
  ctx.effect(() => cloudConfigPostDisposer, 'dsh-plugin-tts: cloud config save route');
  ctx.effect(() => cloudUsageDisposer, 'dsh-plugin-tts: cloud usage route');
  ctx.effect(() => cloudTestDisposer, 'dsh-plugin-tts: cloud test route');
  ctx.effect(() => notifyDisposer, 'dsh-plugin-tts: notify route');
  ctx.effect(() => diagnoseDisposer, 'dsh-plugin-tts: diagnose route');
}

// Test hook: expose pure helpers for unit tests without a real server.
// (e.g. tests/smoke.mjs asserts splitText never cuts URLs/decimals mid-token,
// and drives ingestSessionEvent + the notify queue directly.)
export const __test = {
  splitText,
  splitCloudPackets,
  cloudTier,
  cloudBillableChars,
  cloudBuildSsml,
  ingestSessionEvent,
  loadHostRvcSettings,
  saveHostRvcSettings,
  indexTts2Config,
  loadHostIndexSettings,
  saveHostIndexSettings,
  cosyConfig,
  loadHostCosySettings,
  saveHostCosySettings,
  loadHostCloudSettings,
  saveHostCloudSettings,
  recordCloudUsage,
  getCloudUsageSummary,
  notify: () => ({
    seq: notifyState.seq,
    queued: notifyState.queue.length
  })
};
