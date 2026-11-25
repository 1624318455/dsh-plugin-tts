// @memef1f1y/dsh-plugin-tts — Host half.
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
// (Sec-MS-GEC query-param protocol, mirroring node-edge-tts@1.2.10;
// 2026-10 v1->v2 migration per rany2/edge-tts#490: WSS host is now
// api.msedgeservices.com with Ocp-Apim-Subscription-Key, legacy token kept).
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, renameSync, openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { connect as netConnect } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import tls from 'node:tls';
import os from 'node:os';
import path from 'node:path';

export const name = 'tts';
export const inject = ['webServer'];

const WORKER_SRC = `// edge-tts-worker — zero-dependency Edge TTS synthesis (Node >= 22).
// Transient failures are retried once with backoff; auth/voice errors fail fast.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const WINDOWS_FILE_TIME_EPOCH = 11644473600n;
const WSS_BASE = 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1';
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
function isHardWorkerError(msg) {
  return /40[013]|1007|unsupported voice|empty text/i.test(String(msg || ''));
}
function synthesizeOnce(voice, text, outPath, lang, rate, pitch, volume) {
  return new Promise(function (resolve, reject) {
    const secMsGec = generateSecMsGecToken();
    const connectionId = crypto.randomBytes(16).toString('hex');
    const url = WSS_BASE + '?Ocp-Apim-Subscription-Key=' + TRUSTED_CLIENT_TOKEN + '&Sec-MS-GEC=' + secMsGec + '&Sec-MS-GEC-Version=1-' + CHROMIUM_FULL_VERSION + '&ConnectionId=' + connectionId;
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
    let pendingError = null;
    let errorTimer = null;
    function describeWsError(e) {
      try {
        if (!e || typeof e !== 'object') return 'websocket error: ' + String(e);
        const parts = [];
        if (e.type) parts.push('type=' + e.type);
        if (e.code !== undefined && e.code !== null && e.code !== '') parts.push('code=' + e.code);
        if (e.reason) parts.push('reason=' + String(e.reason).slice(0, 120));
        if (e.message) parts.push('message=' + String(e.message).slice(0, 200));
        else {
          const s = String(e);
          if (s && s !== '[object Event]' && s !== '[object ErrorEvent]' && s !== '[object Object]') {
            parts.push('detail=' + s.slice(0, 200));
          }
        }
        parts.push('url=api.msedgeservices.com/tts/v1');
        return 'websocket error (' + parts.join(' ') + ')';
      } catch (err) {
        return 'websocket error: ' + String(e);
      }
    }
    function finish() {
      if (settled) return;
      settled = true;
      if (errorTimer) { clearTimeout(errorTimer); errorTimer = null; }
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
      pendingError = describeWsError(e);
      if (errorTimer) clearTimeout(errorTimer);
      errorTimer = setTimeout(function () {
        if (!settled) {
          settled = true;
          errorTimer = null;
          reject(pendingError);
        }
      }, 1500);
    };
    ws.onclose = function (e) {
      if (settled) return;
      const code = e && e.code;
      const reason = e && e.reason;
      if (pendingError) {
        if (errorTimer) { clearTimeout(errorTimer); errorTimer = null; }
        settled = true;
        reject(pendingError + ' closed code=' + code + ' reason=' + String(reason || '').slice(0, 120));
        return;
      }
      reject('closed early code=' + code + ' reason=' + reason);
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
        if (errorTimer) { clearTimeout(errorTimer); errorTimer = null; }
        try { ws.close(); } catch (e) {}
        reject('timeout after 20000ms without turn.end (endpoint slow or blocked)');
      }
    }, 20000);
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
  const OUT_DIR = process.env.DSH_TTS_OUT_DIR || os.tmpdir();
  const outPath = path.join(OUT_DIR, 'dsh-tts-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.mp3');
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const size = await synthesizeOnce(voice, text, outPath, lang, rate, pitch, volume);
      console.log('OK ' + outPath);
      console.log('SIZE ' + size);
      process.exit(0);
    } catch (e) {
      lastErr = e;
      if (isHardWorkerError(String((e && e.message) || e))) break;
      if (attempt === 0) console.log('RETRY ' + String((e && e.message) || e).slice(0, 200));
      if (attempt === 0) await new Promise(function (r) { setTimeout(r, 800); });
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
    ensureDir(synthDir());
    const outPath = path.join(synthDir(), `dsh-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
    const p = prosody || {};
    const argv = ['-e', WORKER_SRC, '--', voice,
      String(p.rate || 'default'),
      String(p.pitch || 'default'),
      String(p.volume || 'default')];
    const child = spawn(process.execPath, argv, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { DSH_TTS_OUT_DIR: synthDir() })
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    // Worker worst case: 20s attempt + 0.8s backoff + 20s retry ≈ 41s.
    // Kill above that so a blackholed endpoint can't hang /speak for a minute.
    // Other providers (rvc/index/cosy/cloud) keep their own long timeouts.
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch (e) { /* already gone */ }
    }, 45000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error('TTS spawn failed: ' + e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error('TTS worker timeout (45s): Edge 端点无响应，已重试一次；请检查网络/代理后重试'));
        return;
      }
      if (code !== 0) {
        reject(new Error('TTS worker exited ' + code + ': ' + (stderr.trim() || stdout.trim() || 'no output')));
        return;
      }
      const m = stdout.match(/^OK (.+)$/m);
      if (!m) {
        reject(new Error('TTS worker output unexpected: ' + stdout));
        return;
      }
      const rt = countWorkerRetries(stdout);
      if (rt.count > 0) {
        // Success-after-retry: worth one info line so "slow but recovered"
        // is distinguishable from plain "slow" in the exported log.
        recordHostError({
          provider: 'edge-tts', voice,
          textLen: String(text).length,
          stage: 'edge-retry', kind: 'info',
          error: 'retries=' + rt.count + ' lastErr=' + rt.last
        });
      }
      resolve(m[1]);
    });
    child.stdin.end(text);
  });
}

// Retry gate for Edge synthesis errors (mirrors isHardWorkerError inside
// WORKER_SRC, which runs in a separate `node -e` process and can't be
// imported — keep the two regexes in sync). Fail fast on auth/voice errors;
// everything else is transient and worth a retry.
function isHardEdgeWorkerError(msg) {
  return /40[013]|1007|unsupported voice|empty text/i.test(String(msg || ''));
}

// The worker announces transient-failure retries as `RETRY <err>` stdout
// lines (side-channel: the OK-path parser ignores them). Counting them tells
// "slow but recovered" apart from "slow" in latency triage.
function countWorkerRetries(stdout) {
  const lines = String(stdout || '').match(/^RETRY (.*)$/gm) || [];
  return {
    count: lines.length,
    last: lines.length ? lines[lines.length - 1].replace(/^RETRY /, '').slice(0, 200) : ''
  };
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
  if (!cfg.model) throw hostErr('未配置 RVC 模型路径（语音设置 → RVC 配置）', 'host.noModelConfigured');
  const t0 = Date.now();
  let stage = 'base';
  const mark = {};
  try {
    const baseVoice = cfg.baseVoice || voice;
    const mp3Path = await synthesize(text, baseVoice, {
      rate: cfg.baseRate,
      pitch: cfg.basePitch,
      volume: cfg.baseVolume
    });
    mark.base = Date.now() - t0;
    const audioBytes = readFileSync(mp3Path);
    stage = 'load';
    const tLoad = Date.now();
    await ensureRvcLoaded(cfg);
    mark.load = Date.now() - tLoad;
    stage = 'convert';
    const tConv = Date.now();
    let wavBytes;
    try {
      wavBytes = await rvcConvertBytes(cfg, audioBytes);
    } catch (e) {
      // one retry with a fresh /load (the server may have unloaded the model)
      rvcLoadedKey = '';
      await ensureRvcLoaded(cfg);
      wavBytes = await rvcConvertBytes(cfg, audioBytes);
    }
    mark.convert = Date.now() - tConv;
    // Synthesized output is cache, not data: land it under cache/synth/ (the
    // old os.tmpdir() path leaked one file per read — 28 orphans on the dev
    // machine) and prune on write.
    ensureDir(synthDir());
    const wavPath = path.join(synthDir(), `synth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
    writeFileSync(wavPath, wavBytes);
    pruneSynthCache();
    return wavPath;
  } catch (e) {
    // Stage breakdown for triage ("stuck in base / load / convert?").
    // The original error is rethrown unchanged for the user-facing path.
    recordHostError({
      provider: 'rvc', voice,
      textLen: String(text || '').length,
      stage: 'rvc-stages', kind: 'info',
      error: 'failedAt=' + stage +
        ' baseMs=' + (mark.base === undefined ? -1 : mark.base) +
        ' loadMs=' + (mark.load === undefined ? -1 : mark.load) +
        ' convertMs=' + (mark.convert === undefined ? -1 : mark.convert) +
        ' totalMs=' + (Date.now() - t0)
    });
    throw e;
  }
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
  ensureDir(synthDir());
  const wavPath = path.join(synthDir(), `dsh-tts-piper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
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
    voicesDir: normVoicesDir(c.voicesDir),
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
    const hint = res.status === 404
      ? '\n该地址没有 /api/v1/tts/tasks：官方 Index-TTS2 源码不提供 HTTP API，需要先运行 API 适配服务。'
      : '';
    throw hostErr(`Index-TTS2 ${route} 失败（HTTP ${res.status}）：${detail}${hint}`, 'host.indexHttpFail', { route, status: res.status });
  }
  return res;
}

/** Index-TTS2 chain: text -> local FastAPI service -> wav file path. */
async function synthesizeIndexTts2(text, voice, custom) {
  const cfg = indexTts2Config(custom, '');
  // Host-side voice library: send the absolute path when the service runs
  // locally. The bundled api.py resolves absolute paths verbatim; otherwise
  // keep the plain name so a service that owns its own ckyp/ still works.
  const promptAudio = resolveHostVoicePath(cfg.voicesDir, cfg.voice, cfg.baseUrl);
  const payload = {
    text: String(text || ''),
    prompt_audio: promptAudio,
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
  ensureDir(synthDir());
  const wavPath = path.join(synthDir(), `dsh-tts-index-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
  writeFileSync(wavPath, buf);
  pruneSynthCache();
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
    voicesDir: normVoicesDir(c.voicesDir),
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
    const hint = res.status === 404
      ? '\n该地址没有 /tts：官方 CosyVoice 的 FastAPI 只有 /inference_* 接口，需要 cosy-server.py 适配服务。'
      : '';
    throw hostErr(`CosyVoice ${route} 失败（HTTP ${res.status}）：${detail}${hint}`, 'host.cosyHttpFail', { route, status: res.status });
  }
  return res;
}

/** CosyVoice chain: text -> local cosy-server.py -> wav file path. */
async function synthesizeCosy(text, voice, custom) {
  const cfg = cosyConfig(custom, '');
  // Same Host-side library story as Index-TTS2: cosy-server.py joins the name
  // onto PROMPTS_DIR, which passes an absolute path through unchanged.
  const prompt = resolveHostVoicePath(cfg.voicesDir, cfg.voice, cfg.baseUrl);
  const res = await cosyPost(cfg, '/tts', {
    text: String(text || ''),
    prompt: prompt || undefined,
    prompt_text: cfg.promptText || undefined,
    speed: cfg.speed,
    seed: cfg.seed
  }, 300000);
  const data = await res.json().catch(() => null);
  const b64 = data && data.audio_base64;
  if (!b64) throw hostErr('CosyVoice 返回异常（无音频内容）', 'host.cosyNoAudio');
  const buf = Buffer.from(String(b64), 'base64');
  if (buf.length < 1000) throw hostErr('CosyVoice 返回的音频过小（可能合成失败）', 'host.cosyNoAudio');
  ensureDir(synthDir());
  const wavPath = path.join(synthDir(), `dsh-tts-cosy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
  writeFileSync(wavPath, buf);
  pruneSynthCache();
  return wavPath;
}

registerProvider('cosyvoice', {
  synthesizeShort(text, voice, prosody, custom) {
    return synthesizeCosy(text, voice, custom);
  }
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Local GPT-SoVITS provider (api_v2.py, default http://127.0.0.1:9880).
//
// Speaks the engine's NATIVE /tts protocol — no protocol gateway in
// between. The Gradio WebUI exposes no HTTP API, so users start api_v2.py
// from the bundle and point "Service URL" at it. ref_audio_path is a path on
// the machine running api_v2.py, so it is forwarded verbatim (no upload, no
// base64) — same shape as the Index-TTS2 / CosyVoice local providers.
//
// Payload: text / text_lang / ref_audio_path / prompt_text / prompt_lang /
// media_type / speed_factor / text_split_method plus the standard sampling
// knobs. The host already chunks long reads into ~15s packets, so the default
// split method is chosen per packet (one sentence -> cut0, several -> cut1,
// >120 chars -> cut5) instead of a hard cut5 that re-splits each packet and
// clips the sentence tail. Engine-private knobs ride in `extraBody` and are
// flattened into the payload, exactly like the other local providers.
// ---------------------------------------------------------------------------

const GSV_DEFAULTS = {
  baseUrl: 'http://127.0.0.1:9880',
  refAudio: '',
  promptText: '',
  promptLang: 'zh',
  textLang: 'auto',
  mediaType: 'wav',
  speed: 1.0,
  splitMethod: 'auto',
  extraBody: ''
};
const GSV_TIMEOUT_MS = 300000;
const GSV_MEDIA_TYPES = ['wav', 'ogg', 'aac'];
const GSV_LANGS = ['auto', 'zh', 'en', 'ja', 'ko', 'yue'];
const GSV_SPLIT_METHODS = ['auto', 'cut0', 'cut1', 'cut2', 'cut3', 'cut4', 'cut5'];
// api_v2.py only accepts wav / ogg / aac here; "mp3" returns HTTP 400 on the
// V4 bundles. Do not widen this list without a real upstream check.
const GSV_SAMPLING = {
  top_k: 15,
  top_p: 1.0,
  temperature: 1.0,
  batch_size: 1,
  seed: 42,
  parallel_infer: true,
  repetition_penalty: 1.35
};

function gsvStartupHint() {
  return [
    '在 GPT-SoVITS 整合包目录启动 api_v2.py（保持窗口运行，默认端口 9880）；',
    'Gradio WebUI 不提供 HTTP 接口，必须用同目录的 api_v2.py；',
    '「参考音频」填那台机器上的绝对路径，并填好对应的「参考文本」。'
  ].join('\n');
}

/** Trim a base URL and append /tts (a full /tts URL is also accepted). */
function gsvTtsUrl(baseUrl) {
  const u = String(baseUrl || GSV_DEFAULTS.baseUrl).trim().replace(/\/+$/, '');
  return /\/tts$/i.test(u) ? u : u + '/tts';
}

function gsvConfig(custom) {
  const c = custom || {};
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const pick = (v, list, d) => {
    const s = String(v || '').toLowerCase();
    return list.indexOf(s) >= 0 ? s : d;
  };
  return {
    baseUrl: String(c.baseUrl || GSV_DEFAULTS.baseUrl).trim().replace(/\/+$/, ''),
    refAudio: String(c.refAudio || '').trim(),
    promptText: String(c.promptText || '').slice(0, 2000),
    // prompt_lang has no "auto" in api_v2.py; text_lang gained it in V4.
    promptLang: pick(c.promptLang, GSV_LANGS.filter(x => x !== 'auto'), GSV_DEFAULTS.promptLang),
    textLang: pick(c.textLang, GSV_LANGS, GSV_DEFAULTS.textLang),
    mediaType: pick(c.mediaType, GSV_MEDIA_TYPES, GSV_DEFAULTS.mediaType),
    speed: Math.min(4, Math.max(0.25, num(c.speed, 1.0))),
    splitMethod: pick(c.splitMethod, GSV_SPLIT_METHODS, GSV_DEFAULTS.splitMethod),
    extraBody: String(c.extraBody || '').slice(0, 4000)
  };
}

function parseGsvExtraBody(raw) {
  const s = String(raw || '').trim();
  if (!s) return {};
  let v;
  try {
    v = JSON.parse(s);
  } catch (e) {
    throw hostErr('高级参数不是合法 JSON：' + String((e && e.message) || e).slice(0, 140), 'host.gsvBadExtra');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw hostErr('高级参数必须是 JSON 对象，例如 {"top_k": 15}', 'host.gsvBadExtra');
  }
  return v;
}

const GSV_SENT_END_RE = /[。！？；…]+|[!?;]+(?=\s|$)|\.(?=\s|$)/g;
/** A packet is already ~15s of speech; re-splitting it into punctuation
 *  fragments is what produces the clipped sentence tails. */
function pickGsvSplitMethod(text, forced) {
  if (forced && forced !== 'auto') return forced;
  const t = String(text || '');
  if (t.length > 120) return 'cut5';
  const n = (t.match(GSV_SENT_END_RE) || []).length;
  return n <= 1 ? 'cut0' : 'cut1';
}

/** Sniff the container from magic bytes — never trust the requested format. */
function audioKindFromBytes(buf) {
  if (!buf || buf.length < 4) return '';
  const tag = buf.toString('ascii', 0, 4);
  if (buf.length >= 12 && tag === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (tag === 'OggS') return 'ogg';
  if (tag === 'fLaC') return 'flac';
  if (buf.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    return ((buf[1] >> 1) & 0x03) === 0 ? 'aac' : 'mp3';
  }
  if (tag === 'FORM' && buf.toString('ascii', 8, 12) === 'AIFF') return 'aiff';
  return '';
}

/** True when the body looks like a JSON document (first non-space byte is { or [). */
function looksLikeJsonBytes(buf) {
  if (!buf || buf.length === 0) return false;
  const limit = Math.min(buf.length, 64);
  for (let i = 0; i < limit; i++) {
    const c = buf[i];
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue;
    return c === 0x7b || c === 0x5b;
  }
  return false;
}

/** Effective endpoint: explicit request > Host file > built-in default. */
function resolveGsvBaseUrl(custom) {
  const explicit = String((custom && custom.baseUrl) || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const fromFile = String(loadHostGsvSettings().baseUrl || '').trim().replace(/\/+$/, '');
  return fromFile || GSV_DEFAULTS.baseUrl;
}

async function synthesizeGsv(text, voice, prosody, custom, timeoutMs) {
  const cfg = gsvConfig(custom);
  const baseUrl = resolveGsvBaseUrl(custom);
  const url = gsvTtsUrl(baseUrl);
  if (!cfg.refAudio) {
    throw hostErr(
      '还没有设置「参考音频」：请填 GPT-SoVITS 所在机器上的参考音频绝对路径，并写好「参考文本」。',
      'host.gsvNoRefAudio'
    );
  }
  if (!cfg.promptText) {
    throw hostErr(
      '还没有填写「参考文本」：GPT-SoVITS 的 V3/V4 内核要求参考音频必须配逐字稿，请按顺序全文填写这段音频里说的内容。',
      'host.gsvNoPromptText'
    );
  }
  const extra = parseGsvExtraBody(cfg.extraBody);
  const payload = Object.assign({}, GSV_SAMPLING, {
    text: String(text || ''),
    text_lang: cfg.textLang,
    ref_audio_path: cfg.refAudio,
    prompt_text: cfg.promptText,
    prompt_lang: cfg.promptLang,
    media_type: cfg.mediaType,
    speed_factor: cfg.speed,
    text_split_method: pickGsvSplitMethod(text, cfg.splitMethod),
    streaming_mode: false
  }, extra);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Number(timeoutMs) > 0 ? Number(timeoutMs) : GSV_TIMEOUT_MS)
    });
  } catch (e) {
    throw hostErr(
      `无法连接本地 GPT-SoVITS 服务（${url}）：${String((e && e.message) || e)}\n${gsvStartupHint()}`,
      'host.gsvUnreachable',
      { baseUrl }
    );
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    let detail = String(raw || '').slice(0, 300) || res.statusText;
    try {
      const data = JSON.parse(raw);
      const err = data && (data.detail || data.message || data.error);
      detail = String((err && (err.message || err)) || detail).slice(0, 300);
    } catch (e) { /* keep raw text */ }
    if (res.status === 400 || res.status === 422) {
      throw hostErr(`GPT-SoVITS 拒绝请求（HTTP ${res.status}）：${detail}`, 'host.gsvBadRequest', { status: res.status });
    }
    throw hostErr(`GPT-SoVITS 合成失败（HTTP ${res.status}）：${detail}`, 'host.gsvHttpFail', { status: res.status });
  }
  const ctype = String(res.headers.get('content-type') || '').toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  // 200 + JSON is the most common self-hosted failure mode ("succeeded but
  // nothing plays"). Surface the payload instead of writing a bogus file.
  if (ctype.includes('json') || looksLikeJsonBytes(buf)) {
    let detail = buf.toString('utf8').slice(0, 300);
    try {
      const data = JSON.parse(detail);
      const err = data && (data.detail || data.message || data.error);
      detail = String((err && (err.message || err)) || detail).slice(0, 300);
    } catch (e) { /* keep raw */ }
    throw hostErr('GPT-SoVITS 返回了 JSON 而不是音频：' + detail, 'host.gsvNoAudio');
  }
  const kind = audioKindFromBytes(buf);
  if (!kind) {
    throw hostErr(
      `GPT-SoVITS 返回的内容不是可识别的音频（${buf.length} 字节，content-type=${ctype || '?'}）`,
      'host.gsvNoAudio'
    );
  }
  if (buf.length < 1000) {
    throw hostErr('GPT-SoVITS 返回的音频过小（可能合成失败）', 'host.gsvNoAudio');
  }
  ensureDir(synthDir());
  const outPath = path.join(
    synthDir(),
    `gsv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${kind}`
  );
  writeFileSync(outPath, buf);
  pruneSynthCache();
  return outPath;
}

// --- endpoint classification ----------------------------------------------
// api_v2.py is FastAPI: /openapi.json exists and lists /tts. The Gradio WebUI
// (default 9874, inference page 9872) serves HTML on every path and has no API,
// which is the single most common "I started it but nothing plays" mistake —
// pointing the plugin at the WebUI. Name it instead of reporting "HTTP 404".
const GSV_API_PORTS = [9880, 9881];
const GSV_WEBUI_PORTS = [9874, 9872];

async function probeGsvEndpoint(baseUrl, timeoutMs = 2500) {
  const root = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!root) return { state: 'empty', kind: 'none' };
  const t = Number(timeoutMs) > 0 ? Number(timeoutMs) : 2500;
  try {
    const r = await fetch(root + '/openapi.json', { signal: AbortSignal.timeout(t) });
    const ctype = String(r.headers.get('content-type') || '');
    if (/json/i.test(ctype)) {
      const body = await r.json().catch(() => null);
      const paths = (body && body.paths && typeof body.paths === 'object') ? Object.keys(body.paths) : [];
      if (paths.length) {
        const hasTts = paths.some((p) => /(^|\/)tts$/.test(p));
        return { state: 'online', kind: hasTts ? 'api' : 'fastapi', hasTts };
      }
    }
    const r2 = await fetch(root + '/', { signal: AbortSignal.timeout(t) });
    const text = await r2.text().catch(() => '');
    if (/gradio/i.test(text)) return { state: 'online', kind: 'webui' };
    return { state: 'online', kind: 'other' };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return { state: /timeout|abort/i.test(msg) ? 'timeout' : 'down', kind: 'none', detail: msg.slice(0, 120) };
  }
}

// Probe the address the user typed plus each engine's well-known ports, so a
// moved bundle (9881) or a WebUI mis-entry is identified instead of guessed.
async function scanGsvEndpoints(baseUrl) {
  const list = [];
  const push = (u) => {
    const v = String(u || '').trim().replace(/\/+$/, '');
    if (v && list.indexOf(v) < 0) list.push(v);
  };
  push(baseUrl);
  let host = '127.0.0.1';
  try {
    if (baseUrl) host = new URL(baseUrl).hostname || host;
  } catch (e) { /* keep default */ }
  for (const port of GSV_API_PORTS) push(`http://${host}:${port}`);
  for (const port of GSV_WEBUI_PORTS) push(`http://${host}:${port}`);
  const tried = await Promise.all(
    list.map(async (url) => Object.assign({ baseUrl: url }, await probeGsvEndpoint(url)))
  );
  const api = tried.find((x) => x.kind === 'api');
  const webui = tried.find((x) => x.kind === 'webui');
  return { ok: !!api, api: api ? api.baseUrl : '', webui: webui ? webui.baseUrl : '', tried };
}

// --- GPT-SoVITS reference-audio library (single machine) ------------------
// The picker needs a directory listing, and a browser <input type=file> never
// yields an absolute path — so the Host lists the folder and the UI shows a
// dropdown. Files the user drops are copied into data/refs/ and referred to by
// the generated absolute path, so api_v2.py can always read them.
const FS_AUDIO_EXTS = ['.wav', '.mp3', '.flac', '.m4a', '.ogg', '.aac'];
const FS_LIST_MAX = 2000;
// Counting audio files inside each subfolder costs one extra readdir; cap it so
// opening C:\ or a slow network share stays responsive.
const FS_COUNT_MAX = 120;

/** Ancestor chain for the picker breadcrumb (drive/root included). */
function fsPathCrumbs(dir) {
  const out = [];
  let cur = path.resolve(String(dir || ''));
  for (let guard = 0; guard < 64; guard++) {
    const base = path.basename(cur);
    out.unshift({ name: base || cur.replace(/[\\/]+$/, '') || cur, path: cur });
    const parent = path.dirname(cur);
    if (!parent || parent === cur) break;
    cur = parent;
  }
  return out;
}

/** How many audio files a folder holds; -1 when unreadable, null when skipped. */
function fsAudioCount(dir) {
  try {
    let n = 0;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      if (FS_AUDIO_EXTS.indexOf(path.extname(ent.name).toLowerCase()) >= 0) n += 1;
    }
    return n;
  } catch (e) {
    return -1;
  }
}

function fsIsAbsolute(p) {
  const s = String(p || '');
  return path.isAbsolute(s) || path.win32.isAbsolute(s);
}

function fsListDir(dir) {
  const target = String(dir || '').trim();
  if (!target) return { ok: false, error: 'dir 必填' };
  if (!fsIsAbsolute(target)) return { ok: false, error: '目录必须是绝对路径（例如 D:\\GPT-SoVITS\\refs）' };
  let st;
  try {
    st = statSync(target);
  } catch (e) {
    const parent = path.dirname(target);
    return { ok: true, exists: false, dir: target, parent: parent && parent !== target ? parent : '', crumbs: fsPathCrumbs(parent || target), dirs: [], files: [], dirAudio: {} };
  }
  if (!st.isDirectory()) {
    const parent = path.dirname(target);
    return { ok: true, exists: false, dir: target, parent: parent && parent !== target ? parent : '', crumbs: fsPathCrumbs(parent || target), dirs: [], files: [], dirAudio: {} };
  }
  let entries = [];
  try {
    entries = readdirSync(target, { withFileTypes: true });
  } catch (e) {
    return { ok: false, error: '目录无法读取：' + String((e && e.message) || e).slice(0, 120) };
  }
  const dirs = [];
  const files = [];
  for (const ent of entries) {
    if (!ent || !ent.name || ent.name.startsWith('.')) continue;
    if (ent.isDirectory()) {
      if (dirs.length < FS_LIST_MAX) dirs.push(ent.name);
      continue;
    }
    const ext = path.extname(ent.name).toLowerCase();
    if (FS_AUDIO_EXTS.indexOf(ext) < 0) continue;
    if (files.length >= FS_LIST_MAX) continue;
    let size = 0;
    let mtime = 0;
    try {
      const s2 = statSync(path.join(target, ent.name));
      size = s2.size;
      mtime = s2.mtimeMs;
    } catch (e) { /* racing rename: keep the name */ }
    files.push({ name: ent.name, size, mtime });
  }
  // Most recently touched first: the clip you just recorded is what you want.
  files.sort((a, b) => b.mtime - a.mtime);
  dirs.sort((a, b) => a.localeCompare(b));
  const parent = path.dirname(target);
  const dirAudio = {};
  for (let i = 0; i < dirs.length && i < FS_COUNT_MAX; i++) {
    dirAudio[dirs[i]] = fsAudioCount(path.join(target, dirs[i]));
  }
  return {
    ok: true,
    exists: true,
    dir: target,
    parent: parent && parent !== target ? parent : '',
    crumbs: fsPathCrumbs(target),
    dirs,
    dirAudio,
    files
  };
}

/** Normalize a user-supplied voice library directory (absolute path). */
function normVoicesDir(v) {
  let s = String(v || '').trim();
  if (!s) return '';
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) {
    s = path.join(os.homedir(), s.slice(1));
  }
  // Keep a drive root ("D:\", "C:/") intact: trimming its separator would
  // turn it into a relative path.
  if (/^[A-Za-z]:[\\/]?$/.test(s)) return s.slice(0, 2) + '\\';
  return s.replace(/[\\/]+$/, '');
}

/**
 * List reference/prompt audio from a fixed, service-owned voice directory.
 * This is the Host-side fallback for API services that expose no /voices
 * endpoint (official source trees) — the plugin can still show a dropdown as
 * long as the user points it at the directory the service reads.
 */
function scanHostVoiceDir(dir) {
  const target = normVoicesDir(dir);
  if (!target) return { ok: false, error: '音色目录未配置' };
  if (!fsIsAbsolute(target)) {
    return { ok: false, error: '音色目录必须是绝对路径（例如 D:\\index-tts2\\api\\ckyp）', dir: target };
  }
  const listed = fsListDir(target);
  if (!listed.ok) return { ok: false, error: listed.error, dir: target };
  if (!listed.exists) {
    return { ok: true, exists: false, dir: target, voices: [], entries: [], count: 0 };
  }
  const entries = (listed.files || []).map((f) => ({
    name: f.name,
    path: path.join(target, f.name),
    size: f.size,
    mtime: f.mtime
  }));
  // Stable alphabetical order matches the service-side listing.
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return {
    ok: true,
    exists: true,
    dir: target,
    voices: entries.map((e) => e.name),
    entries,
    count: entries.length
  };
}

/**
 * Scan a GPT-SoVITS install root for switchable weight pairs.
 * Layout: GPT_weights-xxxx + SoVITS_weights-xxxx folders, plus the bundled
 * base weights under GPT_SoVITS/pretrained_models (any-voice combo).
 */
function scanGsvModels(dir) {
  const root = normVoicesDir(dir);
  if (!root) return { ok: false, error: '请先选择 GPT-SoVITS 模型目录' };
  if (!fsIsAbsolute(root)) return { ok: false, error: '模型目录必须是绝对路径' };
  let st;
  try {
    st = statSync(root);
  } catch (e) {
    return { ok: false, error: '目录不存在：' + root, dir: root };
  }
  if (!st.isDirectory()) return { ok: false, error: '不是目录：' + root, dir: root };

  const MAX = 400;
  const gpt = [];
  const sovits = [];
  const seen = new Set();
  const listDir = (d) => {
    try { return readdirSync(d, { withFileTypes: true }); } catch (e) { return []; }
  };
  const speakerOf = (fileName) => {
    const stem = String(fileName || '').replace(/\.[^.]+$/, '');
    const trimmed = stem
      .replace(/[-_]e\d+.*$/i, '')
      .replace(/[-_]s\d+.*$/i, '')
      .replace(/[-_]l\d+.*$/i, '')
      .trim();
    return trimmed || stem;
  };
  const addFile = (list, file, group, isBase) => {
    const p = path.join(file.dir, file.name);
    if (seen.has(p) || list.length >= MAX) return;
    seen.add(p);
    let size = 0;
    let mtime = 0;
    try {
      const st2 = statSync(p);
      size = st2.size;
      mtime = st2.mtimeMs;
    } catch (e) { /* racing rename */ }
    list.push({
      name: file.name,
      path: p,
      size,
      mtime,
      group: group || '',
      base: !!isBase,
      // Speaker stem is derived from the file name only (e.g. xxx-e15 /
      // xxx_e2_s220_l32 -> xxx). No model or speaker names are hardcoded.
      speaker: isBase ? '' : speakerOf(file.name)
    });
  };
  const scanAudioLike = (d, exts, list, group, isBase) => {
    for (const ent of listDir(d)) {
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (exts.indexOf(ext) < 0) continue;
      addFile(list, { dir: d, name: ent.name }, group, isBase);
    }
  };

  // Root-level weight files and the conventional *_weights* folders.
  scanAudioLike(root, ['.ckpt'], gpt, '');
  scanAudioLike(root, ['.pth'], sovits, '');
  for (const ent of listDir(root)) {
    if (!ent.isDirectory()) continue;
    const sub = path.join(root, ent.name);
    if (/^gpt_weights/i.test(ent.name)) scanAudioLike(sub, ['.ckpt'], gpt, ent.name);
    else if (/^sovits_weights/i.test(ent.name)) scanAudioLike(sub, ['.pth'], sovits, ent.name);
  }

  // Bundled base weights (zero-shot, no speaker fine-tune).
  const pretrained = path.join(root, 'GPT_SoVITS', 'pretrained_models');
  scanAudioLike(pretrained, ['.ckpt'], gpt, '', true);
  for (const ent of listDir(pretrained)) {
    if (!ent.isDirectory()) continue;
    if (!/^gsv-v/i.test(ent.name)) continue;
    scanAudioLike(path.join(pretrained, ent.name), ['.pth'], sovits, '', true);
  }

  const byName = (a, b) =>
    (a.base ? 0 : 1) - (b.base ? 0 : 1) ||
    String(a.group || '').localeCompare(String(b.group || '')) ||
    (b.mtime || 0) - (a.mtime || 0) ||
    a.name.localeCompare(b.name);
  gpt.sort(byName);
  sovits.sort(byName);
  return {
    ok: true,
    dir: root,
    gpt,
    sovits,
    gptCount: gpt.length,
    sovitsCount: sovits.length
  };
}

/**
 * Read the weights a GPT-SoVITS service loaded at startup.
 *
 * api_v2.py builds its TTS config from the `custom:` mapping in
 * GPT_SoVITS/configs/tts_infer.yaml (TTS.py: `configs.get("custom", ...)`),
 * so that section is the authoritative "startup weights" record. We parse the
 * two keys we need instead of pulling in a YAML dependency, and we never look
 * at specific file names: whatever the section says is what the service got.
 *
 * Hot-switching through /set_*_weights does not rewrite this file, which is
 * why the UI labels the result as the startup configuration.
 */
function readGsvServiceWeights(dir) {
  const root = normVoicesDir(dir);
  if (!root) return { ok: false, reason: 'noDir' };
  const file = path.join(root, 'GPT_SoVITS', 'configs', 'tts_infer.yaml');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    return { ok: false, reason: 'noFile', file, dir: root };
  }
  // tts_infer.yaml is a flat two-level document: `section:` then indented
  // `key: value` pairs. Collect every section once, then pick `custom`.
  const sections = {};
  let current = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine;
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const top = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (top) {
      current = top[1];
      sections[current] = sections[current] || {};
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    sections[current][kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  const usable = sec => !!(sec && (sec.t2s_weights_path || sec.vits_weights_path));
  let section = 'custom';
  if (!usable(sections.custom)) {
    const fallback = Object.keys(sections).find(k => usable(sections[k]));
    if (!fallback) return { ok: false, reason: 'noWeights', file, dir: root };
    section = fallback;
  }
  const sec = sections[section] || {};
  const absolute = value => {
    const v = String(value || '').trim();
    if (!v) return '';
    return fsIsAbsolute(v) ? path.normalize(v) : path.join(root, v);
  };
  const gpt = absolute(sec.t2s_weights_path);
  const sovits = absolute(sec.vits_weights_path);
  return {
    ok: true,
    section,
    file,
    dir: root,
    version: String(sec.version || ''),
    gpt,
    sovits,
    gptName: gpt ? path.basename(gpt) : '',
    sovitsName: sovits ? path.basename(sovits) : '',
    gptExists: gpt ? existsSync(gpt) : false,
    sovitsExists: sovits ? existsSync(sovits) : false
  };
}

/** Open a folder in the OS file manager (Host side, same machine). */
function openDirInFileManager(dir) {
  const target = normVoicesDir(dir);
  if (!target) return { ok: false, error: '目录不能为空' };
  if (!fsIsAbsolute(target)) return { ok: false, error: '目录必须是绝对路径' };
  let st;
  try {
    st = statSync(target);
  } catch (e) {
    return { ok: false, error: '目录不存在：' + target };
  }
  if (!st.isDirectory()) return { ok: false, error: '不是目录：' + target };
  let cmd;
  let args;
  if (process.platform === 'win32') {
    cmd = 'explorer.exe';
    args = [target];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = [target];
  } else {
    cmd = 'xdg-open';
    args = [target];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
  } catch (e) {
    return { ok: false, error: '无法打开文件管理器：' + String((e && e.message) || e) };
  }
  return { ok: true, dir: target, platform: process.platform };
}

/** True when the service runs on this machine (absolute paths are readable). */
function isLoopbackUrl(baseUrl) {  try {
    const h = new URL(String(baseUrl || '')).hostname.toLowerCase();
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]' || h === '0.0.0.0';
  } catch (e) {
    return false;
  }
}

/**
 * Resolve a selected voice name to an absolute path when the Host-side library
 * is in use and the API service runs locally. Index-TTS2's API accepts absolute
 * paths (api.py get_prompt_audio_path), so the service does not have to scan
 * the same directory. CosyVoice's wrapper does the same via os.path.join().
 */
function resolveHostVoicePath(voicesDir, voice, baseUrl) {
  const name = String(voice || '').trim();
  if (!name) return '';
  if (fsIsAbsolute(name)) return name;
  if (!voicesDir || !isLoopbackUrl(baseUrl)) return name;
  const abs = path.join(normVoicesDir(voicesDir), name);
  return existsSync(abs) ? abs : name;
}

function fsStatPath(p) {
  const target = String(p || '').trim();
  if (!target) return { ok: true, exists: false };
  try {
    const st = statSync(target);
    return { ok: true, exists: true, isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs };
  } catch (e) {
    return { ok: true, exists: false };
  }
}

/** Create one child folder under an absolute parent (directory picker). */
function fsMkdirChild(dir, name) {
  const base = String(dir || '').trim();
  if (!base || !fsIsAbsolute(base)) return { ok: false, error: '父目录必须是绝对路径' };
  const child = String(name || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/^\.+$/, '')
    .trim()
    .slice(0, 80);
  if (!child) return { ok: false, error: '文件夹名称无效' };
  const target = path.join(base, child);
  try {
    if (existsSync(target)) {
      const st = statSync(target);
      if (!st.isDirectory()) return { ok: false, error: '同名文件已存在：' + target };
      return { ok: true, created: false, dir: target };
    }
    mkdirSync(target);
    return { ok: true, created: true, dir: target };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

// --- provider discovery / candidate library -------------------------------
// A `.pth` is a torch container, not an RVC signature: GPT-SoVITS, Index-TTS2,
// CosyVoice and countless other projects save weights the same way, so neither
// the extension nor the folder name carries identity. Every check below reads
// content instead — zip directory + pickle key names + YAML manifests — and
// stays static. An untrusted `.pth` is never torch.load'ed here (pickling is
// code execution); loading happens only through rvc-server, after the user
// explicitly picks a model.
//
// Candidates live in config/candidates.json, keyed by a content id so a moved
// or renamed folder keeps its identity (and a copy is recognized as the same
// model rather than a second one).
const DISCOVERY_WEIGHT_EXTS = new Set(['.pth', '.pt', '.ckpt']);
const DISCOVERY_SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'venv', '.venv', 'env', '.env',
  '__pycache__', 'site-packages', 'dist-info', '.cache', '.npm', '.pnpm-store',
  'windows', 'system volume information', '$recycle.bin', 'recovery',
  '.conda', 'pkgs', 'conda-meta', 'cuda', 'cudnn', 'nvidia'
]);
const DISCOVERY_PORTS = [
  { port: 4892, provider: 'rvc' },
  { port: 7880, provider: 'index-tts2' },
  { port: 7890, provider: 'cosyvoice' },
  { port: 9880, provider: 'gpt-sovits' },
  { port: 9881, provider: 'gpt-sovits' }
];
const DISCOVERY_FAISS_MAGIC = new Set(['IxFI', 'IxF2', 'IxQB', 'IxQH', 'IxQM', 'IwFl', 'IwFr', 'IxMp', 'IxSQ']);
const DISCOVERY_BUDGET = {
  quick: { depth: 4, dirs: 20000, files: 800, ms: 25000 },
  deep: { depth: 7, dirs: 80000, files: 6000, ms: 90000 }
};
const DISCOVERY_STORE_MAX = 200;
const DISCOVERY_ROOTS_MAX = 20;

function discoveryStoreFile() {
  return homeFileForWrite('config', 'candidates.json');
}
// Drives the picker can jump to. A path-only picker is a dead end on Windows:
// walking up from C:\Users\<you> stops at C:\ and never reaches D:/E:.
function listDiscoveryVolumes() {
  const out = [];
  if (process.platform === 'win32') {
    for (let code = 65; code <= 90; code++) {
      const root = String.fromCharCode(code) + ':\\';
      try {
        if (existsSync(root)) out.push(root);
      } catch (e) { /* absent / unreadable drive letter */ }
    }
  } else {
    out.push('/');
  }
  return out;
}
function emptyDiscoveryStore() {
  return { version: 1, roots: [], candidates: [] };
}
function loadDiscoveryStore() {
  try {
    const file = discoveryStoreFile();
    if (!existsSync(file)) return emptyDiscoveryStore();
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const store = emptyDiscoveryStore();
    if (Array.isArray(data.roots)) {
      store.roots = data.roots
        .filter((r) => typeof r === 'string' && r.trim() !== '')
        .map((r) => r.trim())
        .slice(0, DISCOVERY_ROOTS_MAX);
    }
    if (Array.isArray(data.candidates)) {
      store.candidates = data.candidates.filter((c) => c && typeof c.id === 'string' && typeof c.provider === 'string');
    }
    return store;
  } catch (e) {
    return emptyDiscoveryStore();
  }
}
function saveDiscoveryStore(store) {
  ensureHomeDirs();
  const next = {
    version: 1,
    roots: Array.isArray(store.roots) ? store.roots.slice(0, DISCOVERY_ROOTS_MAX) : [],
    candidates: Array.isArray(store.candidates) ? store.candidates.slice(0, DISCOVERY_STORE_MAX) : []
  };
  writeFileSync(discoveryStoreFile(), JSON.stringify(next, null, 2));
  return next;
}

function readRange(file, start, length) {
  if (length <= 0) return Buffer.alloc(0);
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    let off = 0;
    while (off < length) {
      const n = readSync(fd, buf, off, length - off, start + off);
      if (n <= 0) break;
      off += n;
    }
    return off === length ? buf : buf.subarray(0, off);
  } finally {
    try { closeSync(fd); } catch (e) { /* already closed */ }
  }
}
function readTextFile(file, maxBytes) {
  try {
    const st = statSync(file);
    const len = Math.min(st.size, maxBytes || 256 * 1024);
    return readRange(file, 0, len).toString('utf8');
  } catch (e) {
    return '';
  }
}
function statSafe(file) {
  try { return statSync(file); } catch (e) { return null; }
}

function zipEntriesOf(file) {
  const st = statSafe(file);
  if (!st || !st.isFile() || st.size < 22) return null;
  const tailLen = Math.min(st.size, 66 * 1024);
  const tail = readRange(file, st.size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (count > 20000 || cdSize > 8 * 1024 * 1024 || cdOffset + cdSize > st.size) return null;
  const cd = readRange(file, cdOffset, cdSize);
  const entries = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const method = cd.readUInt16LE(p + 10);
    const csize = cd.readUInt32LE(p + 20);
    const nlen = cd.readUInt16LE(p + 28);
    const elen = cd.readUInt16LE(p + 30);
    const clen = cd.readUInt16LE(p + 32);
    const lho = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nlen);
    entries.push({ name, method, csize, lho });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}
function zipEntryData(file, entry, maxBytes) {
  if (!entry || entry.csize <= 0 || entry.csize > (maxBytes || 8 * 1024 * 1024)) return null;
  const lh = readRange(file, entry.lho, 30);
  if (lh.length < 30 || lh.readUInt32LE(0) !== 0x04034b50) return null;
  const nlen = lh.readUInt16LE(26);
  const elen = lh.readUInt16LE(28);
  const start = entry.lho + 30 + nlen + elen;
  const raw = readRange(file, start, entry.csize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    try { return inflateRawSync(raw); } catch (e) { return null; }
  }
  return null;
}

// RVC checkpoints are torch-saved dicts; the pickle names its own keys, so a
// bounded substring scan over archive/data.pkl is enough to tell an RVC voice
// from a SoVITS generator, an Index-TTS2 module, or a random state_dict.
function inspectRvcCheckpoint(file) {
  const entries = zipEntriesOf(file);
  if (!entries) {
    const head = readRange(file, 0, 4);
    if (head.length === 4 && !(head[0] === 0x50 && head[1] === 0x4b)) {
      return { zip: false, strong: false, keys: [] };
    }
    return null;
  }
  const pkl = entries.find((e) => e.name === 'archive/data.pkl')
    || entries.find((e) => /\.pkl$/i.test(e.name));
  if (!pkl) return { zip: true, strong: false, keys: [] };
  const data = zipEntryData(file, pkl, 8 * 1024 * 1024);
  if (!data) return { zip: true, strong: false, keys: [] };
  const text = data.toString('latin1');
  const keys = ['weight', 'config', 'version', 'info', 'sr', 'f0', 'model'].filter((k) => text.indexOf(k) !== -1);
  const strong = keys.indexOf('weight') !== -1
    && keys.indexOf('config') !== -1
    && (keys.indexOf('version') !== -1 || keys.indexOf('sr') !== -1);
  const v2 = strong && keys.indexOf('sr') !== -1 && keys.indexOf('f0') !== -1;
  const name = path.basename(file);
  return {
    zip: true,
    strong,
    keys,
    version: v2 ? 'v2' : (keys.indexOf('model') !== -1 ? 'v1' : ''),
    discriminator: /^D[_-]/i.test(name)
  };
}

function inspectFaissIndex(file) {
  try {
    const st = statSafe(file);
    if (!st || !st.isFile() || st.size < 8) return false;
    return DISCOVERY_FAISS_MAGIC.has(readRange(file, 0, 4).toString('latin1'));
  } catch (e) {
    return false;
  }
}

function parseYamlScalars(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line) || /^\s*-/.test(line)) continue;
    const m = /^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (!v || v === '|' || v === '>') continue;
    v = v.replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
    out[m[1]] = v;
  }
  return out;
}

function hashFileRange(file, start, length) {
  const buf = readRange(file, start, length);
  return createHash('sha256').update(buf).digest('hex');
}
function fileFingerprint(file, mode) {
  const st = statSafe(file);
  if (!st || !st.isFile()) return { size: 0, partial: '', full: '' };
  const window = 1024 * 1024;
  const head = hashFileRange(file, 0, Math.min(st.size, window));
  const tailStart = Math.max(0, st.size - window);
  const tail = hashFileRange(file, tailStart, st.size - tailStart);
  const out = { size: st.size, partial: 'p1:' + head.slice(0, 24) + tail.slice(0, 24), full: '' };
  if (mode === 'full') out.full = hashFileFull(file);
  return out;
}
function hashFileFull(file) {
  const h = createHash('sha256');
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let pos = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
      pos += n;
    }
  } finally {
    try { closeSync(fd); } catch (e) { /* already closed */ }
  }
  return 'f1:' + h.digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

// Content id: provider + kind + the fingerprint (or manifest) — never a path,
// so moving/renaming a folder keeps the identity.
function buildCandidate(provider, kind, fields) {
  const f = fields || {};
  const fp = f.fingerprint || {};
  const basis = [provider, kind, f.contentKey || '', String(fp.size || ''), fp.partial || '', fp.full || '', f.baseUrl || ''].join('|');
  const id = provider + ':' + createHash('sha256').update(basis).digest('hex').slice(0, 24);
  const cand = {
    id,
    provider,
    kind,
    label: String(f.label || '').slice(0, 160),
    paths: (f.paths && typeof f.paths === 'object') ? f.paths : {},
    baseUrl: String(f.baseUrl || ''),
    evidence: Array.isArray(f.evidence) ? f.evidence.map((e) => String(e).slice(0, 160)).slice(0, 12) : [],
    confidence: f.confidence || 'medium',
    status: 'detected',
    fingerprint: { size: Number(fp.size) || 0, partial: String(fp.partial || ''), full: String(fp.full || '') },
    meta: (f.meta && typeof f.meta === 'object') ? f.meta : {},
    firstSeenAt: nowIso(),
    lastVerifiedAt: '',
    lastUsedAt: ''
  };
  return cand;
}

function findRvcIndex(modelFile) {
  const dir = path.dirname(modelFile);
  const stem = path.basename(modelFile, path.extname(modelFile));
  let names = [];
  try { names = readdirSync(dir); } catch (e) { return ''; }
  const exact = names.find((n) => n.toLowerCase() === (stem + '.index').toLowerCase());
  if (exact) return path.join(dir, exact);
  const pref = names.find((n) => /\.index$/i.test(n) && n.toLowerCase().startsWith(stem.toLowerCase()));
  return pref ? path.join(dir, pref) : '';
}

function rvcCandidateFromFile(file, info, mode) {
  const fp = fileFingerprint(file, mode === 'full' ? 'full' : 'partial');
  const index = findRvcIndex(file);
  const evidence = ['torch zip + pickle keys: ' + info.keys.join('/')];
  if (info.version) evidence.push('version=' + info.version);
  if (index) evidence.push('index=' + path.basename(index));
  if (info.discriminator) evidence.push('name starts with D_ (discriminator?)');
  return buildCandidate('rvc', 'model', {
    label: path.basename(file),
    paths: index ? { file, index } : { file },
    evidence,
    confidence: info.discriminator ? 'low' : (info.version === 'v2' ? 'high' : 'medium'),
    fingerprint: fp,
    contentKey: 'pth'
  });
}

function manifestKey(dir, rels) {
  return rels.map((rel) => {
    const st = statSafe(path.join(dir, rel));
    return rel + ':' + (st ? (st.isDirectory() ? 'dir' : String(st.size)) : '-');
  }).sort().join(';');
}

function detectGsvInstall(dir) {
  const rel = path.join('GPT_SoVITS', 'configs', 'tts_infer.yaml');
  const cfg = path.join(dir, rel);
  if (!existsSync(cfg)) return null;
  const y = parseYamlScalars(readTextFile(cfg, 256 * 1024));
  const weights = [y.t2s_weights_path, y.vits_weights_path].filter(Boolean);
  const evidence = ['GPT_SoVITS/configs/tts_infer.yaml'];
  if (y.version) evidence.push('version=' + y.version);
  for (const w of weights) evidence.push('weights=' + w);
  if (existsSync(path.join(dir, 'api_v2.py'))) evidence.push('api_v2.py');
  return buildCandidate('gpt-sovits', 'install', {
    label: path.basename(dir) || dir,
    paths: { dir },
    evidence,
    confidence: weights.length ? 'high' : 'medium',
    contentKey: 'gsv:' + manifestKey(dir, [rel, 'api_v2.py', 'GPT_SoVITS/pretrained_models']),
    meta: { version: y.version || '', t2sWeights: y.t2s_weights_path || '', vitsWeights: y.vits_weights_path || '' }
  });
}

function detectIndexInstall(dir) {
  if (!existsSync(path.join(dir, 'indextts'))) return null;
  const cfg = path.join(dir, 'checkpoints', 'config.yaml');
  const hasCkpt = existsSync(path.join(dir, 'checkpoints'));
  if (!hasCkpt) return null;
  const y = existsSync(cfg) ? parseYamlScalars(readTextFile(cfg, 256 * 1024)) : {};
  const evidence = ['indextts/'];
  if (existsSync(cfg)) evidence.push('checkpoints/config.yaml');
  for (const k of ['gpt_path', 's2mel_path', 'semantic_path', 'wav2vec_path', 'model_dir']) {
    if (y[k]) evidence.push(k + '=' + y[k]);
  }
  return buildCandidate('index-tts2', 'install', {
    label: path.basename(dir) || dir,
    paths: { dir },
    evidence,
    confidence: existsSync(cfg) ? 'high' : 'medium',
    contentKey: 'index:' + manifestKey(dir, ['indextts', 'checkpoints/config.yaml'])
  });
}

function detectCosyInstall(dir) {
  // Two shapes in the wild:
  //  a) a repo/bundle root that ships our cosy-server.py (aigcpanel bundles);
  //  b) a bare model dir named CosyVoice*, under pretrained_models/ or an
  //     aigcpanelmodels/iic/ tree.
  // The bundle root is the useful discovery target: it carries the launcher,
  // while the model dir may sit five levels down.
  const COSY_BASES = [
    dir,
    path.join(dir, 'pretrained_models'),
    path.join(dir, 'aigcpanelmodels'),
    path.join(dir, 'aigcpanelmodels', 'iic'),
    path.join(dir, 'models')
  ];
  let modelDir = '';
  let modelName = '';
  let modelFiles = [];
  for (const base of COSY_BASES) {
    let entries = [];
    try { entries = readdirSync(base, { withFileTypes: true }); } catch (e) { continue; }
    for (const ent of entries) {
      if (!ent.isDirectory() || !/^CosyVoice/i.test(ent.name)) continue;
      const candidate = path.join(base, ent.name);
      let files = [];
      try { files = readdirSync(candidate); } catch (e) { continue; }
      const yaml = files.find((f) => /\.ya?ml$/i.test(f));
      const core = ['llm.pt', 'flow.pt', 'hift.pt'].filter((f) => files.indexOf(f) !== -1);
      if (!yaml || core.length < 2) continue;
      modelDir = candidate;
      modelName = ent.name;
      modelFiles = [yaml].concat(core);
      break;
    }
    if (modelDir) break;
  }
  const server = existsSync(path.join(dir, 'cosy-server.py'));
  if (!modelDir && !server) return null;
  const evidence = [];
  if (server) evidence.push('cosy-server.py');
  if (modelDir) {
    const rel = path.relative(dir, modelDir) || modelName;
    evidence.push(rel + '/' + modelFiles[0]);
    for (const f of modelFiles.slice(1)) evidence.push(rel + '/' + f);
  }
  return buildCandidate('cosyvoice', 'install', {
    label: modelName || (path.basename(dir) === '' ? dir : path.basename(dir)) || dir,
    paths: modelDir ? { dir, modelDir } : { dir },
    evidence,
    confidence: modelDir ? 'high' : 'medium',
    contentKey: 'cosy:' + (modelDir ? manifestKey(modelDir, modelFiles) : 'server:' + manifestKey(dir, ['cosy-server.py']))
  });
}

function detectCloudCredential(file) {
  const st = statSafe(file);
  if (!st || !st.isFile() || st.size < 80 || st.size > 2 * 1024 * 1024) return null;
  const text = readTextFile(file, 2 * 1024 * 1024);
  if (!/"type"\s*:\s*"service_account"/.test(text)) return null;
  let obj = null;
  try { obj = JSON.parse(text); } catch (e) { return null; }
  if (!obj || obj.type !== 'service_account' || !obj.client_email) return null;
  const domain = String(obj.client_email).split('@')[1] || '';
  return buildCandidate('google-cloud-tts', 'credential', {
    label: path.basename(file),
    paths: { file },
    evidence: ['type=service_account', 'project=' + String(obj.project_id || '?'), 'client=***@' + domain],
    confidence: 'high',
    fingerprint: fileFingerprint(file, 'partial'),
    contentKey: 'gcp',
    meta: { projectId: String(obj.project_id || '') }
  });
}

function detectInstallsInDir(dir) {
  const out = [];
  for (const fn of [detectGsvInstall, detectIndexInstall, detectCosyInstall]) {
    try {
      const hit = fn(dir);
      if (hit) out.push(hit);
    } catch (e) { /* one broken layout must not abort the walk */ }
  }
  return out;
}

function mergeEvidence(a, b) {
  const seen = new Set();
  const out = [];
  for (const e of (Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : [])) {
    const s = String(e).slice(0, 160);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };
function dedupeCandidates(list) {
  const map = new Map();
  for (const cand of Array.isArray(list) ? list : []) {
    if (!cand || !cand.id) continue;
    const prev = map.get(cand.id);
    if (!prev) { map.set(cand.id, cand); continue; }
    const keep = (CONFIDENCE_RANK[cand.confidence] || 0) > (CONFIDENCE_RANK[prev.confidence] || 0) ? cand : prev;
    const drop = keep === cand ? prev : cand;
    keep.evidence = mergeEvidence(keep.evidence, drop.evidence);
    map.set(cand.id, keep);
  }
  return Array.from(map.values());
}

function normalizeCandidateInput(input) {
  if (!input || typeof input !== 'object') return null;
  const provider = String(input.provider || '');
  if (!['rvc', 'gpt-sovits', 'index-tts2', 'cosyvoice', 'google-cloud-tts'].includes(provider)) return null;
  const kind = ['model', 'install', 'service', 'credential'].includes(input.kind) ? input.kind : 'model';
  const id = String(input.id || '');
  if (!id) return null;
  return {
    id,
    provider,
    kind,
    label: String(input.label || '').slice(0, 160),
    paths: (input.paths && typeof input.paths === 'object') ? input.paths : {},
    baseUrl: String(input.baseUrl || '').slice(0, 300),
    evidence: Array.isArray(input.evidence) ? input.evidence.map((e) => String(e).slice(0, 160)).slice(0, 12) : [],
    confidence: ['high', 'medium', 'low'].includes(input.confidence) ? input.confidence : 'medium',
    status: ['detected', 'verified', 'locked'].includes(input.status) ? input.status : 'detected',
    fingerprint: (input.fingerprint && typeof input.fingerprint === 'object') ? {
      size: Number(input.fingerprint.size) || 0,
      partial: String(input.fingerprint.partial || ''),
      full: String(input.fingerprint.full || '')
    } : { size: 0, partial: '', full: '' },
    meta: (input.meta && typeof input.meta === 'object') ? input.meta : {},
    firstSeenAt: String(input.firstSeenAt || nowIso()),
    lastVerifiedAt: String(input.lastVerifiedAt || ''),
    lastUsedAt: String(input.lastUsedAt || '')
  };
}

function upsertDiscoveryCandidate(input) {
  const cand = normalizeCandidateInput(input);
  if (!cand) throw hostErr('候选数据无效', 'host.discBadCandidate');
  const store = loadDiscoveryStore();
  const idx = store.candidates.findIndex((c) => c.id === cand.id);
  if (idx >= 0) {
    const prev = store.candidates[idx];
    store.candidates[idx] = {
      ...prev,
      ...cand,
      // A lock/verify is user intent — never downgraded by a later scan.
      status: prev.status === 'locked' || prev.status === 'verified' ? prev.status : cand.status,
      firstSeenAt: prev.firstSeenAt || cand.firstSeenAt,
      lastUsedAt: prev.lastUsedAt || ''
    };
  } else {
    store.candidates.unshift(cand);
    if (store.candidates.length > DISCOVERY_STORE_MAX) store.candidates.length = DISCOVERY_STORE_MAX;
  }
  saveDiscoveryStore(store);
  return store.candidates.find((c) => c.id === cand.id);
}

function discoveryAddRoot(dir) {
  const target = String(dir || '').trim();
  if (!target) throw hostErr('目录不能为空', 'host.discBadRoot');
  if (target.length > 500 || !fsIsAbsolute(target)) throw hostErr('必须是绝对路径：' + target, 'host.discBadRoot');
  const st = statSafe(target);
  if (!st || !st.isDirectory()) throw hostErr('目录不存在：' + target, 'host.discBadRoot');
  const store = loadDiscoveryStore();
  if (store.roots.some((r) => r.toLowerCase() === target.toLowerCase())) return store;
  if (store.roots.length >= DISCOVERY_ROOTS_MAX) throw hostErr('扫描根目录最多 ' + DISCOVERY_ROOTS_MAX + ' 个', 'host.discRootLimit');
  store.roots.push(target);
  return saveDiscoveryStore(store);
}
function discoveryRemoveRoot(dir) {
  const target = String(dir || '').trim().toLowerCase();
  const store = loadDiscoveryStore();
  store.roots = store.roots.filter((r) => r.toLowerCase() !== target);
  return saveDiscoveryStore(store);
}

function tcpOpen(port, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (e) { /* already gone */ }
      resolve(ok);
    };
    const socket = netConnect({ host: '127.0.0.1', port });
    socket.setTimeout(timeoutMs || 700, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function probeLocalJson(url, ms) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms || 1800) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { ok: res.ok, status: res.status, json, text: text.slice(0, 4000) };
  } catch (e) {
    return { ok: false, status: 0, error: String((e && e.message) || e) };
  }
}

function guessProviderFromCommand(cmd) {
  const s = String(cmd || '').toLowerCase();
  if (/api_v2\.py|gpt[-_]sovits/.test(s)) return 'gpt-sovits';
  if (/cosy/.test(s)) return 'cosyvoice';
  if (/indextts|index[-_]tts/.test(s)) return 'index-tts2';
  if (/rvc-server|rvc_webui|infer-web|rvc/.test(s)) return 'rvc';
  return '';
}
function dirOfScriptInCommand(cmd) {
  const s = String(cmd || '');
  const quoted = /"([^"]+\.py)"/i.exec(s) || /'([^']+\.py)'/i.exec(s);
  let file = quoted ? quoted[1] : '';
  if (!file) {
    const m = /([A-Za-z]:\\[^\s"']+\.py|\/[^\s"']+\.py)/.exec(s);
    file = m ? m[1] : '';
  }
  if (!file) return '';
  try { return path.dirname(file); } catch (e) { return ''; }
}

function listLocalTtsProcesses() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      execFile('ps', ['-eo', 'pid=,args='], { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const rows = [];
        for (const line of String(stdout).split(/\r?\n/)) {
          const m = /^\s*(\d+)\s+(.*)$/.exec(line);
          if (!m) continue;
          const provider = guessProviderFromCommand(m[2]);
          if (!provider) continue;
          rows.push({ pid: Number(m[1]), commandLine: m[2], provider, dir: dirOfScriptInCommand(m[2]), ports: [] });
        }
        resolve(rows);
      });
      return;
    }
    const script = [
      '$rows = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "api_v2\\.py|cosy|rvc-server|rvc_webui|indextts|index-tts" } | Select-Object ProcessId,CommandLine;',
      '$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess;',
      '[pscustomobject]@{ rows = @($rows); listeners = @($listeners) } | ConvertTo-Json -Depth 4 -Compress'
    ].join(' ');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 9000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      let data = null;
      try { data = JSON.parse(stdout); } catch (e) { return resolve([]); }
      const asArray = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
      const rows = asArray(data.rows);
      const listeners = asArray(data.listeners);
      const portsByPid = new Map();
      for (const l of listeners) {
        const pid = Number(l.OwningProcess);
        if (!pid) continue;
        if (!portsByPid.has(pid)) portsByPid.set(pid, []);
        portsByPid.get(pid).push(Number(l.LocalPort));
      }
      resolve(rows.map((r) => {
        const cmd = String(r.CommandLine || '');
        return {
          pid: Number(r.ProcessId),
          commandLine: cmd,
          provider: guessProviderFromCommand(cmd),
          dir: dirOfScriptInCommand(cmd),
          ports: portsByPid.get(Number(r.ProcessId)) || []
        };
      }));
    });
  });
}

async function scanDiscoveryPorts() {
  const procs = await listLocalTtsProcesses();
  const out = [];
  for (const def of DISCOVERY_PORTS) {
    if (!(await tcpOpen(def.port))) continue;
    const baseUrl = 'http://127.0.0.1:' + def.port;
    const evidence = ['listening on ' + def.port];
    let confident = false;
    if (def.provider === 'rvc') {
      const h = await probeLocalJson(baseUrl + '/health');
      if (h.ok) {
        confident = true;
        evidence.push('/health ok');
        const j = h.json || {};
        if (j.model) evidence.push('loaded=' + path.basename(String(j.model)));
        if (j.sr) evidence.push('sr=' + j.sr);
      }
    } else if (def.provider === 'index-tts2') {
      const v = await probeLocalJson(baseUrl + '/api/v1/voices');
      if (v.ok) { confident = true; evidence.push('/api/v1/voices ok'); }
    } else if (def.provider === 'cosyvoice') {
      const v = await probeLocalJson(baseUrl + '/voices');
      if (v.ok) { confident = true; evidence.push('/voices ok'); }
    } else {
      const o = await probeLocalJson(baseUrl + '/openapi.json');
      if (o.ok && /\/tts/.test(o.text)) { confident = true; evidence.push('api_v2 /tts'); }
    }
    const proc = procs.find((p) => p.ports.indexOf(def.port) !== -1)
      || procs.find((p) => p.provider === def.provider);
    const dir = proc && proc.dir ? proc.dir : '';
    if (proc) {
      evidence.push('pid ' + proc.pid);
      if (dir) evidence.push('dir=' + dir);
    }
    out.push(buildCandidate(def.provider, 'service', {
      label: def.provider + ' @ ' + def.port,
      baseUrl,
      paths: dir ? { dir } : {},
      evidence,
      confidence: confident ? 'high' : 'medium',
      contentKey: 'svc'
    }));
  }
  return out;
}

let discoveryScanSeq = 0;
const discoveryScans = new Map();

function discoveryScanStatus(job) {
  return {
    jobId: job.id,
    state: job.state,
    phase: job.phase,
    progress: { dirs: job.progress.dirs, files: job.progress.files },
    results: job.state === 'done' ? job.results : [],
    error: job.error || '',
    cancelled: !!job.cancelled
  };
}

function startDiscoveryScan(opts) {
  const options = opts || {};
  const targets = Array.isArray(options.targets) && options.targets.length
    ? options.targets.filter((t) => t === 'ports' || t === 'fs')
    : ['ports', 'fs'];
  const mode = options.mode === 'deep' ? 'deep' : 'quick';
  const job = {
    id: 'scan-' + (++discoveryScanSeq),
    state: 'running',
    phase: 'starting',
    progress: { dirs: 0, files: 0 },
    results: [],
    error: '',
    cancelled: false,
    startedAt: Date.now(),
    finishedAt: 0
  };
  discoveryScans.set(job.id, job);
  for (const [id, old] of discoveryScans) {
    if (discoveryScans.size <= 8) break;
    if (old.state !== 'running') discoveryScans.delete(id);
  }
  runDiscoveryScan(job, targets, mode).catch((e) => {
    job.state = 'error';
    job.error = String((e && e.message) || e).slice(0, 300);
    job.finishedAt = Date.now();
  });
  return job;
}

async function runDiscoveryScan(job, targets, mode) {
  if (targets.indexOf('ports') !== -1) {
    job.phase = 'ports';
    const hits = await scanDiscoveryPorts();
    job.results.push(...hits);
  }
  if (targets.indexOf('fs') !== -1 && !job.cancelled) {
    job.phase = 'walk';
    await walkDiscoveryRoots(job, mode);
  }
  job.results = dedupeCandidates(job.results);
  job.state = job.cancelled ? 'cancelled' : 'done';
  job.phase = 'done';
  job.finishedAt = Date.now();
}

// Directory names that usually hold an engine install. BFS visits shallow
// depths first anyway; this only orders siblings within one depth so a drive
// full of games/apps still surfaces `...\TTS\...` inside the time budget.
const DISCOVERY_HINT_RE = /(tts|voice|cosy|index|sovits|sovits|gpt|rvc|model|weights|ai|server|bundle|整合|语音|声音)/i;
function discoveryDirScore(name) {
  return DISCOVERY_HINT_RE.test(name) ? 1 : 0;
}

async function walkDiscoveryRoots(job, mode) {
  const budget = DISCOVERY_BUDGET[mode] || DISCOVERY_BUDGET.quick;
  const deadline = Date.now() + budget.ms;
  const store = loadDiscoveryStore();
  const roots = store.roots.filter((r) => {
    const st = statSafe(r);
    return !!st && st.isDirectory();
  });
  if (!roots.length) return;
  // Breadth-first by depth. A depth-first stack dives into the first huge tree
  // it meets (a game/AppData folder) and burns the budget before ever reaching
  // a shallow sibling install; breadth-first always finishes depth 0, then 1, … so
  // a bundle two or three levels down cannot be starved by a deep sibling.
  const buckets = Array.from({ length: budget.depth + 1 }, () => []);
  const seen = new Set();
  const queued = new Set();
  const hits = [];
  for (const root of roots) {
    const key = root.toLowerCase();
    if (queued.has(key)) continue;
    queued.add(key);
    buckets[0].push(root);
  }
  let visited = 0;
  let ticks = 0;
  for (let depth = 0; depth <= budget.depth; depth++) {
    const queue = buckets[depth];
    if (!queue.length || job.cancelled) continue;
    // Likely engine folders first at the same depth (stable: sort is fine here
    // because this runs once per depth level, not per directory).
    queue.sort((a, b) => discoveryDirScore(path.basename(b)) - discoveryDirScore(path.basename(a)));
    for (const dir of queue) {
      if (job.cancelled || Date.now() > deadline || visited >= budget.dirs) break;
      const key = dir.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      visited += 1;
      job.progress.dirs = visited;
      ticks += 1;
      if (ticks % 4 === 0) await new Promise((r) => setImmediate(r));
      for (const cand of detectInstallsInDir(dir)) hits.push(cand);
      let entries = [];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const ent of entries) {
        if (job.cancelled || Date.now() > deadline || job.progress.files > budget.files) break;
        const name = ent.name;
        if (!name || name.charAt(0) === '.') continue;
        const full = path.join(dir, name);
        const isDir = ent.isDirectory();
        const isFile = ent.isFile();
        if (ent.isSymbolicLink && ent.isSymbolicLink()) continue;
        if (isDir) {
          if (depth + 1 > budget.depth) continue;
          if (DISCOVERY_SKIP_DIRS.has(name.toLowerCase())) continue;
          const childKey = full.toLowerCase();
          if (queued.has(childKey)) continue;
          queued.add(childKey);
          buckets[depth + 1].push(full);
          continue;
        }
        if (!isFile) continue;
        const ext = path.extname(name).toLowerCase();
        if (DISCOVERY_WEIGHT_EXTS.has(ext)) {
          job.progress.files += 1;
          if (job.progress.files > budget.files) continue;
          const info = inspectRvcCheckpoint(full);
          if (info && info.strong) hits.push(rvcCandidateFromFile(full, info, mode));
        } else if (ext === '.json') {
          const st = statSafe(full);
          if (!st || st.size > 2 * 1024 * 1024) continue;
          job.progress.files += 1;
          const cred = detectCloudCredential(full);
          if (cred) hits.push(cred);
        }
      }
    }
  }
  job.results.push(...dedupeCandidates(hits));
}

async function verifyDiscoveryCandidate(id) {
  const store = loadDiscoveryStore();
  const idx = store.candidates.findIndex((c) => c.id === String(id || ''));
  if (idx < 0) throw hostErr('候选不存在', 'host.discMissing');
  const cand = store.candidates[idx];
  const evidence = [];
  let confidence = cand.confidence;
  if (cand.kind === 'model' && cand.paths && cand.paths.file) {
    const st = statSafe(cand.paths.file);
    if (!st || !st.isFile()) throw hostErr('文件已不存在：' + cand.paths.file, 'host.discFileGone');
    const info = inspectRvcCheckpoint(cand.paths.file);
    if (!info || !info.strong) throw hostErr('结构校验未通过（不像 RVC 模型）', 'host.discVerifyFail');
    const fp = fileFingerprint(cand.paths.file, 'full');
    cand.fingerprint = { size: fp.size, partial: fp.partial, full: fp.full };
    evidence.push('full sha256 verified');
    if (info.version) evidence.push('version=' + info.version);
    confidence = info.discriminator ? 'low' : 'high';
  } else if (cand.kind === 'service' && cand.baseUrl) {
    const baseUrl = String(cand.baseUrl).replace(/\/+$/, '');
    let ok = false;
    if (cand.provider === 'rvc') ok = (await probeLocalJson(baseUrl + '/health')).ok;
    else if (cand.provider === 'index-tts2') ok = (await probeLocalJson(baseUrl + '/api/v1/voices')).ok;
    else if (cand.provider === 'cosyvoice') ok = (await probeLocalJson(baseUrl + '/voices')).ok;
    else if (cand.provider === 'gpt-sovits') {
      const o = await probeLocalJson(baseUrl + '/openapi.json');
      ok = o.ok && /\/tts/.test(o.text);
    }
    if (!ok) throw hostErr('服务未响应（' + baseUrl + '）', 'host.discServiceDown');
    evidence.push('service responded');
    confidence = 'high';
  } else if (cand.kind === 'install' && cand.paths && cand.paths.dir) {
    const st = statSafe(cand.paths.dir);
    if (!st || !st.isDirectory()) throw hostErr('目录已不存在', 'host.discFileGone');
    const again = detectInstallsInDir(cand.paths.dir).find((c) => c.id === cand.id)
      || detectInstallsInDir(cand.paths.dir)[0];
    if (!again) throw hostErr('目录结构校验未通过', 'host.discVerifyFail');
    evidence.push('layout re-checked');
    confidence = 'high';
  } else if (cand.kind === 'credential' && cand.paths && cand.paths.file) {
    const again = detectCloudCredential(cand.paths.file);
    if (!again) throw hostErr('凭据校验未通过', 'host.discVerifyFail');
    evidence.push('service_account re-checked');
    confidence = 'high';
  } else {
    throw hostErr('该候选不支持校验', 'host.discVerifyUnsupported');
  }
  cand.confidence = confidence;
  cand.status = 'verified';
  cand.lastVerifiedAt = nowIso();
  cand.evidence = mergeEvidence(cand.evidence, evidence);
  store.candidates[idx] = cand;
  saveDiscoveryStore(store);
  return cand;
}


function storeGsvRefFile(filename, bytes) {
  ensureDir(gsvRefsDir());
  const base = path.basename(String(filename || 'ref.wav')).replace(/[\\/:*?"<>|]+/g, '_').slice(-120);
  const ext = path.extname(base).toLowerCase();
  const safeExt = FS_AUDIO_EXTS.indexOf(ext) >= 0 ? ext : '.wav';
  const stem = base.slice(0, base.length - ext.length) || 'ref';
  const id = createHash('sha1').update(bytes).digest('hex').slice(0, 8);
  const outPath = path.join(gsvRefsDir(), `${id}-${stem}${safeExt}`);
  writeFileSync(outPath, bytes);
  return outPath;
}

registerProvider('gpt-sovits', {
  synthesizeShort(text, voice, prosody, custom) {
    return synthesizeGsv(text, voice, prosody, custom);
  }
});

// --- host GPT-SoVITS settings (config/settings.json) ----------------------
// The service address is service-class (survives browser-data clears). The
// voice library lives here too: a voice = a reference wav plus the transcript
// that wav actually says, so it must outlive browser storage and stay readable
// by the Host-side chunk jobs. Synthesis knobs stay in localStorage.
// Shape: { version: 2, ..., gsv: {
//   baseUrl, refsDir, activeVoiceId,
//   recentDirs: string[],
//   voices: [{ id, name, path, promptText, promptLang, lastUsedAt }]
// } }
const HOST_GSV_KEYS = ['baseUrl', 'refsDir', 'activeVoiceId', 'modelDir', 'gptWeights', 'sovitsWeights'];
const GSV_VOICE_MAX = 200;
const GSV_RECENT_DIRS_MAX = 5;

function normGsvVoice(raw) {
  const v = (raw && typeof raw === 'object') ? raw : null;
  if (!v) return null;
  const p = String(v.path || '').trim();
  if (!p) return null;
  const name = String(v.name || '').trim() || p.split(/[\\/]/).pop();
  return {
    id: String(v.id || '').trim() || createHash('sha1').update(p).digest('hex').slice(0, 12),
    name: name.slice(0, 120),
    path: p.slice(0, 2000),
    promptText: String(v.promptText || '').slice(0, 2000),
    promptLang: String(v.promptLang || 'zh').trim().slice(0, 8) || 'zh',
    lastUsedAt: Number(v.lastUsedAt) || 0
  };
}

function loadHostGsvSettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) return {};
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    const src = (data && data.gsv && typeof data.gsv === 'object') ? data.gsv : {};
    const out = {};
    for (const k of HOST_GSV_KEYS) {
      if (typeof src[k] === 'string' && src[k].trim() !== '') {
        out[k] = k === 'baseUrl' ? src[k].trim() : normVoicesDir(src[k]);
      }
    }
    if (out.baseUrl) out.baseUrl = out.baseUrl.replace(/\/+$/, '');
    out.recentDirs = Array.isArray(src.recentDirs)
      ? src.recentDirs.filter((d) => typeof d === 'string' && d.trim() !== '').slice(0, GSV_RECENT_DIRS_MAX)
      : [];
    out.voices = Array.isArray(src.voices)
      ? src.voices.map(normGsvVoice).filter(Boolean).slice(0, GSV_VOICE_MAX)
      : [];
    return out;
  } catch (e) {
    return {};
  }
}

function saveHostGsvSettings(patch) {
  let data = { version: 1 };
  try {
    if (existsSync(SETTINGS_FILE)) data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) || data;
  } catch (e) { /* start fresh */ }
  const prev = (data && data.gsv && typeof data.gsv === 'object') ? data.gsv : {};
  const next = { ...prev };
  const src = (patch && typeof patch === 'object') ? patch : {};
  for (const k of HOST_GSV_KEYS) {
    if (typeof src[k] !== 'string') continue;
    const v = k === 'baseUrl'
      ? src[k].trim().replace(/\/+$/, '')
      : normVoicesDir(src[k]);
    if (v === '') delete next[k];
    else next[k] = v;
  }
  if (Array.isArray(src.recentDirs)) {
    next.recentDirs = src.recentDirs
      .filter((d) => typeof d === 'string' && d.trim() !== '')
      .map((d) => d.trim())
      .slice(0, GSV_RECENT_DIRS_MAX);
  }
  if (Array.isArray(src.voices)) {
    next.voices = src.voices.map(normGsvVoice).filter(Boolean).slice(0, GSV_VOICE_MAX);
  }
  data.version = 2;
  data.gsv = next;
  try {
    ensureHomeDirs();
    writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
  } catch (e) { /* best-effort */ }
  return next;
}

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
    ensureHomeDirs();
    writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
  } catch (e) { /* best-effort */ }
  return next;
}

// --- local quota ledger (~/.dsh/tts-rvc/cloud-usage.json) ------------------
// Shape: { version: 1, months: { "YYYY-MM": { standard, wavenet, neural2, chirp3 } } }.
// Month keys rotate automatically (a new month starts at zero); only the last
// 6 months are kept.
// Lazily resolved through homeFile() so a half-finished migration still reads.
// Honors DSH_TTS_HOME so tests can isolate the usage ledger.
function cloudUsageFile() {
  return homeFile('data', 'cloud-usage.json');
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
    ensureHomeDirs();
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
  if (!apiKey) throw hostErr('未配置 Google Cloud TTS API Key（语音设置 → Cloud 配置）', 'host.cloudNoKey');
  const v = String((custom && custom.voice) || voice || CLOUD_TTS_DEFAULTS.voice).trim() || CLOUD_TTS_DEFAULTS.voice;
  const tier = cloudTier(v);
  const packets = splitCloudPackets(text);
  if (packets.length <= 1) {
    const { bytes, billable } = await cloudWithRetry(
      () => synthesizeCloudPacket(packets[0] || String(text || ''), v, prosody, apiKey)
    );
    try { recordCloudUsage(tier, billable); } catch (e) { /* non-fatal */ }
    ensureDir(synthDir());
    const outPath = path.join(synthDir(), `dsh-tts-cloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
    writeFileSync(outPath, bytes);
    pruneSynthCache();
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
  ensureDir(synthDir());
  const outPath = path.join(synthDir(), `dsh-tts-cloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
  writeFileSync(outPath, Buffer.concat(bufs));
  pruneSynthCache();
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

/**
 * Character spans of each part within the source text: [[start,end), …].
 * Walks the text once, tolerating whitespace differences (trimmed part edges,
 * collapsed newlines, Cloud's synthetic join gaps) — never message content
 * aware beyond ordering. Returns null when the parts cannot be walked in
 * order (then callers fall back to equal division). Pure, unit-tested.
 * Lets the client map "chunk k" to an exact text slice for scroll-follow
 * highlight (docs/maintainer/scroll-follow-v2.md P1-3) instead of guessing by length.
 */
function spanParts(text, parts) {
  const src = String(text || '');
  const spans = [];
  let pos = 0;
  for (const part of parts) {
    while (pos < src.length && /\s/.test(src[pos])) pos++;
    const start = pos;
    let ok = true;
    for (const ch of String(part)) {
      if (/\s/.test(ch)) {
        while (pos < src.length && /\s/.test(src[pos])) pos++;
      } else {
        if (src[pos] !== ch) { ok = false; break; }
        pos++;
      }
    }
    if (!ok) return null;
    spans.push([start, pos]);
  }
  return spans;
}

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

// Chunk policy per provider (pure, unit-tested):
// fastFirst (edge/cloud only, ratio ~0.1): TTFB = 1 block — chunk 1 returns
// immediately, the rest warm in the background at their own indexes (served
// strictly in order). Local synthesis (rvc/index/cosy, ratio 0.5-1.1) keeps
// full prewarm so playback never starves.
function chunkCal(provider) {
  if (provider === 'index-tts2') return { chunkSec: 15, prewarm: 2, ratio: 0 };
  if (provider === 'cosyvoice') return { chunkSec: 15, prewarm: 2, ratio: 0 };
  // GPT-SoVITS: a cold GPU start can take >10s, so fastFirst keeps TTFB at
  // one request while prewarm 2 covers the next chunk in the background.
  if (provider === 'gpt-sovits') return { chunkSec: 15, prewarm: 2, ratio: 0, fastFirst: true };
  if (provider === 'google-cloud-tts') return { chunkSec: 120, prewarm: 2, ratio: 0, fastFirst: true };
  return { chunkSec: 20, prewarm: 2, ratio: 0, fastFirst: true };
}

const FALLBACK_CAL = { ratio: null, chunkSec: 10, prewarm: 3, probeFailed: true, at: 0 };
const calibCache = new Map(); // rvcFingerprint -> { ratio, chunkSec, prewarm, at }
const CAL_TTL_MS = 10 * 60 * 1000;

// --- on-disk layout (~/.dsh/dsh-plugin-tts) -------------------------------
// Three classes only, each with a distinct contract:
//   config/  user-editable and worth backing up (settings.json)
//   data/    NOT regenerable (refs/ uploaded wavs, packs/, calibration, usage)
//   cache/   safe to delete wholesale (synth/*.wav, diag-recent.json)
// Up to 0.7.5 everything sat flat in ~/.dsh/tts-rvc/ and synthesized wavs went
// to os.tmpdir() where nothing ever cleaned them. Both are fixed below.
function legacyHomeDir() {
  return path.join(os.homedir(), '.dsh', 'tts-rvc');
}
function defaultHomeDir() {
  return path.join(os.homedir(), '.dsh', 'dsh-plugin-tts');
}

// Flat file -> class subdir. Order matters only for readability; every move is
// idempotent and skipped when the destination already exists.
const HOME_LAYOUT_MOVES = [
  ['settings.json', 'config'],
  ['calibration.json', 'data'],
  ['cloud-usage.json', 'data'],
  ['diag-recent.json', 'cache'],
  ['packs', 'data']
];

// Move the legacy tree once, then normalize the flat layout into subdirs.
// Returns the directory to use: the new tree, or the legacy one when it cannot
// be moved (cross-device link, permissions) — losing a user's packs would be
// far worse than keeping the old path.
function adoptHomeDir(target, legacy) {
  try {
    if (!existsSync(target) && existsSync(legacy)) {
      try {
        renameSync(legacy, target);
      } catch (e) {
        return legacy;
      }
    }
    if (!existsSync(target)) return target;
    for (const [name, sub] of HOME_LAYOUT_MOVES) {
      const from = path.join(target, name);
      const to = path.join(target, sub, name);
      if (!existsSync(from) || existsSync(to)) continue;
      try {
        mkdirSync(path.join(target, sub), { recursive: true });
        renameSync(from, to);
      } catch (e) { /* leave it where it is; readers fall back to the root */ }
    }
    return target;
  } catch (e) {
    return target;
  }
}

let homeDirResolved = null;
function ttsHomeDir() {
  if (homeDirResolved) return homeDirResolved;
  const override = process.env.DSH_TTS_HOME;
  if (typeof override === 'string' && override.trim() !== '') {
    homeDirResolved = override.trim();
  } else {
    homeDirResolved = adoptHomeDir(defaultHomeDir(), legacyHomeDir());
  }
  return homeDirResolved;
}
function homeSub(sub) {
  return path.join(ttsHomeDir(), sub);
}
const configDir = () => homeSub('config');
const dataDir = () => homeSub('data');
const cacheDir = () => homeSub('cache');
const synthDir = () => path.join(cacheDir(), 'synth');
const gsvRefsDir = () => path.join(dataDir(), 'refs');

// One path reader for files that moved: the class subdir first, then the legacy
// flat location, so an interrupted migration never hides existing settings.
function homeFile(sub, name) {
  const preferred = path.join(ttsHomeDir(), sub, name);
  if (existsSync(preferred)) return preferred;
  const flat = path.join(ttsHomeDir(), name);
  return existsSync(flat) ? flat : preferred;
}
// Writes always land in the class subdir.
function homeFileForWrite(sub, name) {
  return path.join(ttsHomeDir(), sub, name);
}
function ensureDir(dir) {
  try { mkdirSync(dir, { recursive: true }); } catch (e) { /* best effort */ }
}
function ensureHomeDirs() {
  ensureDir(configDir());
  ensureDir(dataDir());
  ensureDir(cacheDir());
  ensureDir(synthDir());
  ensureDir(gsvRefsDir());
}

// Synthesized wavs are pure cache: expiry + count cap, enforced on write.
const SYNTH_TTL_MS = 2 * 60 * 60 * 1000;
const SYNTH_MAX_FILES = 200;
let lastSynthPrune = 0;
function pruneSynthCache() {
  const now = Date.now();
  if (now - lastSynthPrune < 60 * 1000) return;
  lastSynthPrune = now;
  try {
    const dir = synthDir();
    if (!existsSync(dir)) return;
    const rows = [];
    for (const name of readdirSync(dir)) {
      if (!/\.(wav|mp3|ogg)$/i.test(name)) continue;
      const full = path.join(dir, name);
      let st;
      try { st = statSync(full); } catch (e) { continue; }
      rows.push({ full, at: st.mtimeMs });
    }
    rows.sort((a, b) => a.at - b.at);
    const stale = rows.filter((r) => now - r.at > SYNTH_TTL_MS);
    const overflow = rows.slice(0, Math.max(0, rows.length - SYNTH_MAX_FILES));
    for (const r of new Set([...stale, ...overflow])) {
      try { rmSync(r.full, { force: true }); } catch (e) { /* in use on Windows */ }
    }
  } catch (e) { /* cache hygiene must never break synthesis */ }
}

const CAL_FILE = homeFile("data", "calibration.json");
const CAL_FILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let calFileData = null; // parsed file, lazily loaded
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
    ensureHomeDirs();
    writeFileSync(CAL_FILE, JSON.stringify(calFileData, null, 2));
  } catch (e) { /* best-effort persistence */ }
}

// --- host RVC service settings (config/settings.json) ---------------------
// Service-class config (service URL + model/index paths) lives on the Host so
// it survives browser-data clears, incognito and browser switches. UI prefs
// (voice, rate, provider, rawMarkdown, notify, …) stay in localStorage.
// Shape: { version: 1, rvc: { baseUrl, model, index } }. Unknown keys are
// ignored on load; writes merge (never drop) and are best-effort.
const SETTINGS_FILE = homeFile('config', 'settings.json');
// ---- user-configured local services (config/services.json) ----------------
// One record per local engine: the command the user themselves starts today by
// double-clicking a .bat. Nothing is bundled: command/cwd/port are pure data,
// so the plugin stays portable and never ships machine-specific paths.
const SERVICES_FILE = homeFile('config', 'services.json');
const SERVICE_PROVIDERS = ['rvc', 'index-tts2', 'cosyvoice', 'gpt-sovits'];
const SERVICE_LOG_MAX = 60;
// provider -> { child, startedAt, log[] } (in-memory only; a plugin restart
// forgets the handle, the process itself keeps running as it would normally)
const serviceRuntime = new Map();

function loadHostServices() {
  const out = {};
  for (const p of SERVICE_PROVIDERS) out[p] = { command: '', cwd: '', port: 0 };
  try {
    if (!existsSync(SERVICES_FILE)) return out;
    const data = JSON.parse(readFileSync(SERVICES_FILE, 'utf8'));
    const src = (data && data.services && typeof data.services === 'object') ? data.services : {};
    for (const p of SERVICE_PROVIDERS) {
      const rec = src[p];
      if (!rec || typeof rec !== 'object') continue;
      if (typeof rec.command === 'string') out[p].command = rec.command.trim().slice(0, 2000);
      if (typeof rec.cwd === 'string') out[p].cwd = rec.cwd.trim().slice(0, 2000);
      const port = Number(rec.port);
      out[p].port = Number.isFinite(port) && port > 0 && port < 65536 ? Math.floor(port) : 0;
    }
  } catch (e) { /* corrupt file: fall back to empty (never block the panel) */ }
  return out;
}

function saveHostService(provider, patch) {
  if (SERVICE_PROVIDERS.indexOf(provider) < 0) return { ok: false, error: '未知的提供者：' + provider };
  const src = patch && typeof patch === 'object' ? patch : {};
  const command = String(src.command === undefined ? '' : src.command).trim();
  const cwd = String(src.cwd === undefined ? '' : src.cwd).trim();
  const portNum = Number(src.port);
  const port = Number.isFinite(portNum) && portNum > 0 && portNum < 65536 ? Math.floor(portNum) : 0;
  if (command.length > 2000) return { ok: false, error: '启动命令过长' };
  if (cwd && !fsIsAbsolute(cwd)) return { ok: false, error: '工作目录必须是绝对路径' };
  const all = loadHostServices();
  all[provider] = { command, cwd, port };
  try {
    ensureDir(homeSub('config'));
    writeFileSync(SERVICES_FILE, JSON.stringify({ version: 1, services: all }, null, 2));
  } catch (e) {
    return { ok: false, error: '写入配置失败：' + String((e && e.message) || e) };
  }
  return { ok: true, service: all[provider] };
}

function serviceAlive(entry) {
  return !!(entry && entry.child && entry.child.exitCode === null && !entry.child.killed);
}

async function hostServiceState(provider) {
  const cfg = loadHostServices()[provider] || { command: '', cwd: '', port: 0 };
  const entry = serviceRuntime.get(provider);
  const running = serviceAlive(entry);
  const portOpen = cfg.port ? await tcpOpen(cfg.port, 500) : false;
  return {
    provider,
    command: cfg.command || '',
    cwd: cfg.cwd || '',
    port: cfg.port || 0,
    running,
    pid: running ? entry.child.pid : 0,
    startedAt: running ? entry.startedAt : 0,
    portOpen,
    log: entry ? entry.log.slice(-SERVICE_LOG_MAX) : []
  };
}

function hostServiceStart(provider) {
  return new Promise((resolve) => {
    if (SERVICE_PROVIDERS.indexOf(provider) < 0) {
      resolve({ ok: false, error: '未知的提供者：' + provider });
      return;
    }
    const cfg = loadHostServices()[provider] || {};
    const command = String(cfg.command || '').trim();
    if (!command) {
      resolve({ ok: false, error: '还没有填写启动命令' });
      return;
    }
    const cwd = String(cfg.cwd || '').trim();
    if (cwd && !fsIsAbsolute(cwd)) {
      resolve({ ok: false, error: '工作目录必须是绝对路径' });
      return;
    }
    if (cwd && !existsSync(cwd)) {
      resolve({ ok: false, error: '工作目录不存在：' + cwd });
      return;
    }
    const prev = serviceRuntime.get(provider);
    if (serviceAlive(prev)) {
      resolve({ ok: true, already: true, pid: prev.child.pid });
      return;
    }
    let child;
    try {
      child = spawn(command, {
        shell: true,
        cwd: cwd || undefined,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) {
      resolve({ ok: false, error: String((e && e.message) || e) });
      return;
    }
    const entry = { child, startedAt: Date.now(), log: [] };
    serviceRuntime.set(provider, entry);
    const push = (chunk) => {
      for (const line of String(chunk || '').split(/\r?\n/)) {
        if (!line.trim()) continue;
        entry.log.push(line.slice(0, 400));
      }
      if (entry.log.length > SERVICE_LOG_MAX) entry.log.splice(0, entry.log.length - SERVICE_LOG_MAX);
    };
    try {
      if (child.stdout) child.stdout.on('data', push);
      if (child.stderr) child.stderr.on('data', push);
    } catch (e) { /* pipes unavailable: status alone still works */ }
    child.on('error', (e) => push('spawn error: ' + String((e && e.message) || e)));
    child.on('exit', (code, signal) => push('exited code=' + code + (signal ? ' signal=' + signal : '')));
    // A bad command exits almost immediately; wait a moment so the UI can
    // report the failure (and its first log lines) instead of a fake success.
    setTimeout(() => {
      const alive = serviceAlive(entry);
      resolve({
        ok: alive,
        already: false,
        pid: child.pid,
        running: alive,
        error: alive ? '' : (entry.log.slice(-3).join('\n') || '进程已退出'),
        log: entry.log.slice(-SERVICE_LOG_MAX)
      });
    }, 900);
  });
}

function hostServiceStop(provider) {
  return new Promise((resolve) => {
    const entry = serviceRuntime.get(provider);
    if (!serviceAlive(entry)) {
      serviceRuntime.delete(provider);
      resolve({ ok: true, stopped: false });
      return;
    }
    const child = entry.child;
    const pid = child.pid;
    let done = false;
    const finish = (signal) => {
      if (done) return;
      done = true;
      // Keep the log around so the UI can show how it ended.
      resolve({ ok: true, stopped: true, pid, signal: signal || '' });
    };
    try { child.once('exit', () => finish('exit')); } catch (e) {}
    try {
      if (process.platform === 'win32') {
        // The spawned process is a shell; /T is required to reach the engine.
        const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
        killer.on('exit', () => setTimeout(() => finish('taskkill'), 250));
        killer.on('error', () => {
          try { child.kill(); } catch (e) {}
          setTimeout(() => finish('kill'), 400);
        });
      } else {
        try { child.kill('SIGTERM'); } catch (e) {}
        setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} }, 2000);
        setTimeout(() => finish('sigterm'), 3000);
      }
    } catch (e) {
      finish('');
    }
    // Hard cap: never leave the HTTP request hanging.
    setTimeout(() => finish('timeout'), 6000);
  });
}

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
    ensureHomeDirs();
    writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
  } catch (e) { /* best-effort: memory still updated for this session */ }
  return next;
}

// --- host CosyVoice service settings (~/.dsh/tts-rvc/settings.json) -------
// Service address + Host-side prompt directory are service-class; voice and
// synthesis params stay in localStorage.
// Shape: { version: 1, rvc: {...}, index: {...}, cosy: { baseUrl, voicesDir } }.
const HOST_COSY_KEYS = ['baseUrl', 'voicesDir'];
function loadHostCosySettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) return {};
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    const src = (data && data.cosy && typeof data.cosy === 'object') ? data.cosy : {};
    const out = {};
    if (typeof src.baseUrl === 'string' && src.baseUrl.trim() !== '') {
      out.baseUrl = src.baseUrl.trim().replace(/\/+$/, '');
    }
    if (typeof src.voicesDir === 'string' && src.voicesDir.trim() !== '') {
      out.voicesDir = normVoicesDir(src.voicesDir);
    }
    out.recentVoiceDirs = Array.isArray(src.recentVoiceDirs)
      ? src.recentVoiceDirs.filter((d) => typeof d === 'string' && d.trim() !== '').map(normVoicesDir).slice(0, 5)
      : [];
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
      const v = k === 'baseUrl'
        ? src[k].trim().replace(/\/+$/, '')
        : normVoicesDir(src[k]);
      if (v === '') delete next[k];
      else next[k] = v;
    }
  }
  if (Array.isArray(src.recentVoiceDirs)) {
    next.recentVoiceDirs = src.recentVoiceDirs
      .filter((d) => typeof d === 'string' && d.trim() !== '')
      .map(normVoicesDir)
      .slice(0, 5);
  }
  data.version = 1;
  data.cosy = next;
  try {
    ensureHomeDirs();
    writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
  } catch (e) { /* best-effort */ }
  return next;
}

// --- host Index-TTS2 service settings (~/.dsh/tts-rvc/settings.json) -------
// Service address + Host-side voice directory are service-class (survive
// browser-data clears); voice + synthesis params stay in localStorage.
// Shape: { version: 1, rvc: {...}, index: { baseUrl, voicesDir } }.
const HOST_INDEX_KEYS = ['baseUrl', 'voicesDir'];
function loadHostIndexSettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) return {};
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    const src = (data && data.index && typeof data.index === 'object') ? data.index : {};
    const out = {};
    if (typeof src.baseUrl === 'string' && src.baseUrl.trim() !== '') {
      out.baseUrl = src.baseUrl.trim().replace(/\/+$/, '');
    }
    if (typeof src.voicesDir === 'string' && src.voicesDir.trim() !== '') {
      out.voicesDir = normVoicesDir(src.voicesDir);
    }
    out.recentVoiceDirs = Array.isArray(src.recentVoiceDirs)
      ? src.recentVoiceDirs.filter((d) => typeof d === 'string' && d.trim() !== '').map(normVoicesDir).slice(0, 5)
      : [];
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
      const v = k === 'baseUrl'
        ? src[k].trim().replace(/\/+$/, '')
        : normVoicesDir(src[k]);
      if (v === '') delete next[k];
      else next[k] = v;
    }
  }
  if (Array.isArray(src.recentVoiceDirs)) {
    next.recentVoiceDirs = src.recentVoiceDirs
      .filter((d) => typeof d === 'string' && d.trim() !== '')
      .map(normVoicesDir)
      .slice(0, 5);
  }
  data.version = 1;
  data.index = next;
  try {
    ensureHomeDirs();
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
  return process.env.DSH_TTS_PACKS_DIR || path.join(dataDir(), 'packs');
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

// ---------------------------------------------------------------------------
// Recent-error ring buffer for the one-click diagnostic log.
// In-memory, capped at 20 entries. Only metadata is kept: timestamps,
// provider/voice, text length, stage, latency and trimmed error text.
// NEVER the message text itself, and NEVER API keys.
// ---------------------------------------------------------------------------
const recentErrors = [];
// Ring capacity: 20 used to evict real evidence under test traffic (smoke
// runs share this file), so chunk-triage entries went missing from exports.
const RECENT_CAP = 30;
// Persisted alongside calibration.json/settings.json so the failure history
// survives dsh restarts (a fresh update erases in-memory history otherwise).
// Same schema as the in-memory entries; no message text, no keys.
const RECENT_FILE = homeFile('cache', 'diag-recent.json');
// Error kind for triage (kept in sync with the client-side copy in
// lib/client.js classifyDiagError — same codes, same order).
function classifyHostError(msg) {
  const s = String(msg || '');
  if (/1007|unsupported voice/i.test(s)) return 'voice';
  if (/403|401|Sec-MS-GEC/i.test(s)) return 'auth';
  if (/未配置|not configured|unconfigured|NoKey|NoModel|no key|no model|缺少/i.test(s)) return 'config';
  if (/无法连接|unreachable|ECONNREFUSED|fetch failed/i.test(s)) return 'service';
  if (/timeout|超时/i.test(s)) return 'timeout';
  if (/1006|websocket|closed early|closed code|reset|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(s)) return 'network';
  if (/首段合成|chunk/i.test(s)) return 'chunk';
  if (/spawn|worker/i.test(s)) return 'spawn';
  return 'unknown';
}
function recordHostError(entry) {
  try {
    const e = Object.assign({ at: Date.now() }, entry);
    if (!e.kind) e.kind = classifyHostError(e.error);
    recentErrors.push(e);
    while (recentErrors.length > RECENT_CAP) recentErrors.shift();
    saveRecentErrors();
  } catch (err) { /* logging must never break synthesis */ }
}
function saveRecentErrors() {
  try {
    ensureHomeDirs();
    writeFileSync(RECENT_FILE, JSON.stringify(recentErrors.slice(-RECENT_CAP)));
  } catch (e) { /* best-effort */ }
}
function loadRecentErrors() {
  try {
    if (!existsSync(RECENT_FILE)) return;
    const data = JSON.parse(readFileSync(RECENT_FILE, 'utf8'));
    if (Array.isArray(data)) {
      for (const e of data.slice(-RECENT_CAP)) {
        if (e && typeof e === 'object') recentErrors.push(e);
      }
    }
  } catch (e) { /* start empty */ }
}
loadRecentErrors();
// Plugin build identity for the exported log (best-effort; never throws).
let PLUGIN_META = { name: '@memef1f1y/dsh-plugin-tts', version: 'unknown' };
try {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  if (pkg && pkg.version) PLUGIN_META = { name: pkg.name || PLUGIN_META.name, version: String(pkg.version) };
} catch (e) { /* keep fallback */ }
// Edge worker build meta surfaced in /diagnose so a pasted log identifies the
// retry/timeout behaviour the user ran with. KEEP IN SYNC with WORKER_SRC
// (single-attempt timeout) and synthesize() (spawn kill timeout).
const WORKER_META = {
  chromium: '143.0.3650.75',
  singleTimeoutMs: 20000,
  spawnTimeoutMs: 45000,
  retry: 'transient-once-800ms-backoff'
};
// Host chunk-pipeline build tag, surfaced in /diagnose next to worker meta.
// Bump on every Host-side playback fix: package.json versions only move on
// releases, so without this two different Host builds are indistinguishable
// in an exported log (exactly what stalled the 1/3/2 swap triage).
const HOST_BUILD = '2026-11-25.01-gsv-voice-library';

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
  // Indexed serve model: each part has a fixed index. Synthesis fills
  // job.urls[idx] (url string, false = skipped after retry, undefined =
  // pending) strictly through the serial job.tail chain; serving always
  // advances job.serveIdx in order and awaits that index's own synthesis.
  // This closes the fastFirst race where a background-prewarmed chunk and an
  // on-demand /rvc-next request shared one nextIdx cursor: the on-demand
  // request could synthesize parts[2] while parts[1] was still warming, and
  // the client (which fills queue[want] in request order) would play 1,3,2.
  const jobs = new Map();    // jobId -> { id, voice, custom, parts, serveIdx, synthIdx, urls, pendings, tail, done, finishedAt, created }
  let jobSeq = 0;

  // Per-chunk retry budget: a transient blip (network/5xx/GPU hiccup) retries
  // the SAME chunk once after a short backoff; a hard failure (400/401/403,
  // missing key/model) fails fast without burning the retry. Exhausted chunks
  // are SKIPPED (not fatal): playback continues with the next chunk and the
  // client toasts which segment was skipped. serveIdx only advances when its
  // own index resolves — order is never broken.
  function isHardChunkError(e) {
    const msg = String((e && e.message) || e);
    return /HTTP 40[013]|host\.(cloud(NoKey|KeyInvalid|BadRequest)|noModelConfigured|piperUnconfigured)/.test(msg);
  }

  function storeChunkFile(job, idx, audioPath) {
    const id = 'c' + (++seq).toString(36) + '-' + hashText(job.parts[idx]).slice(0, 6);
    files.set(id, audioPath);
    if (files.size > 300) {
      const first = files.keys().next().value;
      if (first !== undefined) files.delete(first);
    }
    return '/dsh-tts-audio/' + id;
  }

  // Synthesize parts[idx], store the result in job.urls[idx], resolve with the
  // serve payload for that index. Serialized on job.tail; concurrent callers
  // awaiting the same idx share the one synthesis via job.pendings.
  function synthChunkAt(job, idx) {
    const existing = job.pendings.get(idx);
    if (existing) return existing;
    const run = async () => {
      if (job.done) return { done: true };
      const text = job.parts[idx];
      let audioPath = null;
      let lastErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          audioPath = await job.sink(text);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          if (isHardChunkError(e)) break;
          if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
        }
      }
      if (lastErr) {
        // Skip, don't kill the job: record the hole at its own index so the
        // serve cursor still walks it in order; the client surfaces { skipped }
        // as a toast.
        job.urls[idx] = false;
        const skipErr = String((lastErr && lastErr.message) || lastErr);
        try { (job.skipErrors || (job.skipErrors = {}))[idx] = skipErr.slice(0, 300); } catch (e) { /* best-effort */ }
        recordHostError({
          provider: job.provider || '?',
          voice: job.voice,
          textLen: String(job.parts[idx] || '').length,
          stage: 'chunk ' + (idx + 1) + '/' + job.parts.length,
          error: skipErr.slice(0, 300)
        });
        return { skipped: idx + 1, error: skipErr };
      }
      const url = storeChunkFile(job, idx, audioPath);
      job.urls[idx] = url;
      return { url };
    };
    const p = job.tail.then(run, run);
    job.tail = p.catch(() => {}); // keep the chain alive even on per-chunk failure
    job.pendings.set(idx, p);
    const forget = () => { if (job.pendings.get(idx) === p) job.pendings.delete(idx); };
    p.then(forget, forget);
    return p;
  }

  // One summary line per finished chunked job (drained or cancelled): without
  // it a serve-order incident leaves zero host trace (the 1/3/2 swap recorded
  // nothing). Idempotent — re-polls after completion must not duplicate it.
  // No message text, only counts (same privacy rule as the error ring).
  function noteJobDone(job, outcome) {
    if (!job || job.doneLogged) return;
    job.doneLogged = true;
    try {
      const skipped = Object.keys(job.skipErrors || {}).map((k) => Number(k) + 1).sort((a, b) => a - b);
      recordHostError({
        provider: job.provider || '?',
        voice: job.voice,
        total: job.parts.length,
        served: job.serveIdx,
        skipped,
        stage: 'job',
        kind: 'info',
        ms: Date.now() - (job.created || Date.now()),
        error: 'outcome=' + outcome + ' served=' + job.serveIdx + '/' + job.parts.length +
          ' skipped=[' + skipped.join(',') + ']'
      });
    } catch (e) { /* logging must never break serving */ }
  }

  // Serve the next index in order, awaiting its own synthesis when needed.
  // Never synthesizes serveIdx+1 before serveIdx resolves, so the client —
  // which fills queue[want] in request order — always gets parts in order.
  async function nextJobChunk(jobId) {
    const job = jobs.get(jobId);
    if (!job) return { done: true, gone: true };
    if (job.done) return { done: true };
    const idx = job.serveIdx;
    if (idx >= job.parts.length) {
      job.finishedAt = job.finishedAt || Date.now();
      noteJobDone(job, 'drained');
      return { done: true };
    }
    const known = job.urls[idx];
    if (typeof known === 'string' || known === false) {
      job.serveIdx++;
      const more = job.serveIdx < job.parts.length;
      if (!more) {
        job.finishedAt = job.finishedAt || Date.now();
        noteJobDone(job, 'drained');
      }
      if (known === false) {
        return { skipped: idx + 1, error: job.skipErrors ? job.skipErrors[idx] || '' : '', more, index: idx };
      }
      return { url: known, more, index: idx };
    }
    const r = await synthChunkAt(job, idx);
    if (!jobs.get(jobId) || job.done) return { done: true };
    // synthChunkAt stored urls[idx]; serve it now (skip entries included).
    if (job.serveIdx !== idx) {
      // A cancel/retry moved the cursor while we awaited; re-enter once.
      return nextJobChunk(jobId);
    }
    job.serveIdx++;
    const more = job.serveIdx < job.parts.length;
    if (!more) {
      job.finishedAt = job.finishedAt || Date.now();
      noteJobDone(job, 'drained');
    }
    if (r && r.url) return { url: r.url, more, index: idx };
    if (r && r.skipped) return { skipped: idx + 1, error: r.error || '', more, index: idx };
    return { done: true };
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
    noteJobDone(job, 'cancelled');
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
      const t0 = Date.now();
      let dbg = null; // { provider, voice, textLen } for the error log below
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
        dbg = { provider, voice, textLen: text.length };
        const cfg = provider === 'rvc' ? rvcConfig(custom) : null;
        const indexCfg = provider === 'index-tts2' ? indexTts2Config(custom, '') : null;
        const cosyCfg = provider === 'cosyvoice' ? cosyConfig(custom, '') : null;
        const gsvCfg = provider === 'gpt-sovits' ? gsvConfig(custom) : null;
        // Required-field guards. The bundled Index/Cosy services fall back to the
        // first voice when the prompt is empty, which silently reads in the wrong
        // voice — treat the selected prompt as required instead.
        if (indexCfg && !indexCfg.voice) {
          throw hostErr('还没有选择参考音色：请点「刷新音色」选择一个，或在音色目录里放入音频。', 'host.indexNoVoice', {});
        }
        if (cosyCfg && !cosyCfg.voice) {
          throw hostErr('还没有选择提示音频：请点「刷新音色」选择一个提示音频。', 'host.cosyNoVoice', {});
        }
        if (cosyCfg && !cosyCfg.promptText) {
          throw hostErr('还没有填写提示音频文字稿：请按顺序全文填写这段提示音频里说的内容。', 'host.cosyNoPromptText', {});
        }
        // The cache key must reflect the endpoint actually used, including the
        // Host-file fallback: otherwise switching the saved baseUrl would serve
        // audio synthesized by the previous endpoint for the same text.
        if (gsvCfg) gsvCfg.baseUrl = resolveGsvBaseUrl(custom);
        {
          // Model/reference identity for triage (basenames only — never full
          // paths, never key material).
          const base = (p) => String(p || '').split(/[\\/]/).pop().slice(0, 80);
          if (provider === 'rvc' && cfg) {
            if (cfg.model) dbg.model = base(cfg.model);
            if (cfg.index) dbg.index = base(cfg.index);
          } else if ((provider === 'index-tts2' || provider === 'cosyvoice') && custom && custom.voice) {
            dbg.ref = base(custom.voice);
          } else if (provider === 'local-piper' && custom && custom.piperModel) {
            dbg.model = base(custom.piperModel);
          }
        }
        const cloudVoice = provider === 'google-cloud-tts'
          ? (String((custom && custom.voice) || voice || CLOUD_TTS_DEFAULTS.voice).trim() || CLOUD_TTS_DEFAULTS.voice)
          : null;
        const providerKey = provider === 'rvc'
          ? 'rvc|' + rvcFingerprint(cfg)
          : provider === 'index-tts2'
            ? 'index-tts2|' + JSON.stringify(indexCfg || {})
            : provider === 'cosyvoice'
              ? 'cosyvoice|' + JSON.stringify(cosyCfg || {})
              : provider === 'gpt-sovits'
                ? 'gpt-sovits|' + JSON.stringify(gsvCfg || {})
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
            writeJson(res, 200, { url: hit, cached: true });
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
            : chunkCal(provider);
          if (provider === 'rvc') {
            // Calibration outcome explains chunked-playback starvation
            // (wrong chunkSec/prewarm, stale disk entry, failed probe).
            recordHostError({
              provider, voice, textLen: text.length,
              stage: 'calibration', kind: 'info',
              error: 'ratio=' + (cal.ratio === null || cal.ratio === undefined ? '?' : Number(cal.ratio).toFixed(2)) +
                ' chunkSec=' + cal.chunkSec + ' prewarm=' + cal.prewarm +
                ' probeFailed=' + (!!cal.probeFailed) + ' fromDisk=' + (!!cal.fromDisk)
            });
          }
          // fastFirst (edge/cloud only): TTFB = 1 block. Synthesize chunk 0,
          // return immediately, warm the rest in the background through the
          // same serial tail chain. Serving is strictly by index (serveIdx),
          // so a still-warming chunk is awaited — never overtaken by a later
          // one. Local synthesis (rvc/index/cosy, ratio 0.5-1.1) keeps full
          // prewarm (no fastFirst) so playback never starves.
          const maxChars = Math.max(16, Math.round(cal.chunkSec * (isLatinHeavy(text) ? 12 : 3.6)));
          const parts = provider === 'google-cloud-tts'
            ? splitCloudPackets(text)
            : splitText(text, maxChars);
          // Block spans for scroll-follow highlight mapping (P1-3); omitted
          // when unwalkable — the client falls back to equal division.
          const spans = spanParts(text, parts);
          if (parts.length > 1) {
            const jobId = 'j' + (++jobSeq).toString(36);
            const job = {
              id: jobId,
              provider,
              voice,
              custom,
              sink: provider === 'rvc'
                ? t => synthesizeRvc(t, voice, custom)
                : provider === 'index-tts2'
                  ? t => synthesizeIndexTts2(t, voice, custom)
                  : provider === 'cosyvoice'
                    ? t => synthesizeCosy(t, voice, custom)
                    : provider === 'gpt-sovits'
                      ? t => synthesizeGsv(t, voice, prosody, custom)
                    : provider === 'google-cloud-tts'
                    ? t => synthesizeCloud(t, cloudVoice || voice, prosody, custom)
                    : t => synthesize(t, voice, prosody || undefined),
              parts,
              serveIdx: 0,
              synthIdx: 0,
              urls: new Array(parts.length),
              skipErrors: {},
              pendings: new Map(),
              tail: Promise.resolve(),
              done: false,
              finishedAt: null,
              created: Date.now()
            };
            jobs.set(jobId, job);
            const prewarm = Math.min(cal.prewarm, parts.length);
            if (cal.fastFirst) {
              // First chunk awaited (failure -> 500 like before, never a
              // half-baked job); the rest warm in the background, each bound
              // to its own index. A background failure is recorded at its
              // index and served as { skipped } in order — never overtaken.
              const first = await synthChunkAt(job, 0);
              job.synthIdx = 1;
              if (!first || !first.url) {
                jobs.delete(jobId);
                throw hostErr('首段合成失败', 'host.chunkFail');
              }
              job.serveIdx = 1;
              for (let i = 1; i < prewarm; i++) {
                job.synthIdx = i + 1;
                synthChunkAt(job, i).catch(() => { /* served as skip in order */ });
              }
              writeJson(res, 200, {
                jobId,
                chunks: [first.url],
                total: parts.length,
                ratio: cal.ratio,
                chunkSec: cal.chunkSec,
                ...(spans ? { spans } : {})
              });
              return;
            }
            const urls = [];
            let playable = 0;
            const prewarmSkipped = [];
            for (let i = 0; i < prewarm; i++) {
              job.synthIdx = i + 1;
              const r = await synthChunkAt(job, i);
              // Keep index alignment (a skipped prewarm chunk stays a `false`
              // hole the client walks over in order) instead of compacting.
              // Skipped prewarm chunks are SILENT otherwise (the skip happened
              // during /speak, not at /rvc-next time), so report their 1-based
              // numbers explicitly for the client toast.
              if (r && r.url) { urls.push(r.url); playable++; }
              else { urls.push(false); prewarmSkipped.push(i + 1); }
            }
            job.serveIdx = prewarm;
            if (!playable) {
              // all prewarm chunks skipped/failed (e.g. service down): never
              // hand out a half-baked job with zero playable audio.
              jobs.delete(jobId);
              throw hostErr('首段合成失败', 'host.chunkFail');
            }
            writeJson(res, 200, {
              jobId,
              chunks: urls,
              total: parts.length,
              ratio: cal.ratio,
              chunkSec: cal.chunkSec,
              skipped: prewarmSkipped,
              ...(spans ? { spans } : {})
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
        if (dbg) {
          recordHostError(Object.assign({}, dbg, {
            stage: 'speak',
            ms: Date.now() - t0,
            error: String((e && e.message) || e).slice(0, 300)
          }));
        }
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
        // Container comes from the file extension we wrote (GPT-SoVITS
        // may return ogg/aac too, not just wav).
        const ext = String(absPath).toLowerCase().split('.').pop();
        const MIME = {
          wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac',
          ogg: 'audio/ogg', opus: 'audio/ogg', aac: 'audio/aac',
          aiff: 'audio/aiff', pcm: 'audio/L16'
        };
        const mime = MIME[ext] || 'audio/mpeg';
        const headers = {
          'Content-Type': mime,
          'Content-Length': bytes.length,
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff'
        };
        if (download) {
          // send as a downloadable attachment so users can keep the synthesized
          // audio (Edge base, RVC-converted, Index-TTS2 or GPT-SoVITS)
          const filename = 'dsh-tts-' + id + '.' + (MIME[ext] ? ext : 'mp3');
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
          modelCheck.cls = 'skip';
          modelCheck.detail = '服务未连上，跳过模型检查';
        }
        checks.push(rvcCheck, modelCheck);

        // 3) Local Index-TTS2 service (reference-audio voice engine)
        const indexBaseUrl = String(parsed.indexBaseUrl || INDEX_TTS2_DEFAULTS.baseUrl).replace(/\/+$/, '');
        const indexCheck = { id: 'index-server', name: '本地 Index-TTS2 服务', ok: false, cls: '', detail: '' };
        const indexVoiceCheck = { id: 'index-voice', name: 'Index-TTS2 参考音色', ok: false, cls: '', detail: '' };
        const indexVoiceDir = normVoicesDir(String(parsed.indexVoicesDir || loadHostIndexSettings().voicesDir || ''));
        const indexHostScan = indexVoiceDir ? scanHostVoiceDir(indexVoiceDir) : null;
        if (indexHostScan) {
          if (!indexHostScan.ok) {
            indexVoiceCheck.cls = 'protocol';
            indexVoiceCheck.detail = indexHostScan.error;
          } else if (!indexHostScan.exists) {
            indexVoiceCheck.cls = 'warn';
            indexVoiceCheck.detail = '音色目录不存在：' + indexHostScan.dir;
          } else if (!indexHostScan.count) {
            indexVoiceCheck.cls = 'warn';
            indexVoiceCheck.detail = '音色目录为空：' + indexHostScan.dir;
          } else {
            indexVoiceCheck.ok = true;
            indexVoiceCheck.cls = 'ok';
            indexVoiceCheck.detail = indexHostScan.count + ' 个参考音色（' + indexHostScan.dir + '）：' +
              indexHostScan.voices.slice(0, 3).join('、') + (indexHostScan.count > 3 ? '…' : '');
          }
        }
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
            if (!indexHostScan) {
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
          }
        } catch (e) {
          indexCheck.cls = 'connect';
          indexCheck.detail = '无法连接（' + indexBaseUrl + '）——请先双击本地包里的「启动api服务.bat」，并确认「服务地址」';
          if (!indexHostScan) {
            indexVoiceCheck.cls = 'skip';
            indexVoiceCheck.detail = '服务未连上，跳过音色检查';
          }
        }
        checks.push(indexCheck, indexVoiceCheck);

        // 4) Local CosyVoice service (zero-shot prompt voice engine)
        const cosyBaseUrl = String(parsed.cosyBaseUrl || COSY_DEFAULTS.baseUrl).replace(/\/+$/, '');
        const cosyCheck = { id: 'cosy-server', name: '本地 CosyVoice 服务', ok: false, cls: '', detail: '' };
        const cosyVoiceCheck = { id: 'cosy-voice', name: 'CosyVoice 提示音频', ok: false, cls: '', detail: '' };
        const cosyVoiceDir = normVoicesDir(String(parsed.cosyVoicesDir || loadHostCosySettings().voicesDir || ''));
        const cosyHostScan = cosyVoiceDir ? scanHostVoiceDir(cosyVoiceDir) : null;
        if (cosyHostScan) {
          if (!cosyHostScan.ok) {
            cosyVoiceCheck.cls = 'protocol';
            cosyVoiceCheck.detail = cosyHostScan.error;
          } else if (!cosyHostScan.exists) {
            cosyVoiceCheck.cls = 'warn';
            cosyVoiceCheck.detail = '提示音频目录不存在：' + cosyHostScan.dir;
          } else if (!cosyHostScan.count) {
            cosyVoiceCheck.cls = 'warn';
            cosyVoiceCheck.detail = '提示音频目录为空：' + cosyHostScan.dir;
          } else {
            cosyVoiceCheck.ok = true;
            cosyVoiceCheck.cls = 'ok';
            cosyVoiceCheck.detail = cosyHostScan.count + ' 个提示音频（' + cosyHostScan.dir + '）：' +
              cosyHostScan.voices.slice(0, 3).join('、') + (cosyHostScan.count > 3 ? '…' : '');
          }
        }
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
            if (!cosyHostScan) {
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
          }
        } catch (e) {
          cosyCheck.cls = 'connect';
          cosyCheck.detail = '无法连接（' + cosyBaseUrl + '）——请先双击本地包里的「启动cosy服务.bat」，并确认「服务地址」';
          if (!cosyHostScan) {
            cosyVoiceCheck.cls = 'skip';
            cosyVoiceCheck.detail = '服务未连上，跳过提示音频检查';
          }
        }
        checks.push(cosyCheck, cosyVoiceCheck);

        // 5) Google Cloud TTS: key presence + optional live probe.
        // Skipped by default (no key configured -> neutral state, not red);
        // when probe=true and a key exists, synthesize a short test clip.
        const cloudStored = loadHostCloudSettings();
        const cloudCheck = { id: 'cloud', name: 'Google Cloud TTS', ok: false, cls: '', detail: '' };
        if (!cloudStored.apiKey) {
          cloudCheck.cls = 'skip';
          cloudCheck.detail = '未配置 API Key（语音设置 → Cloud 配置填写后可测）';
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

        // 6) Local GPT-SoVITS service: reachability, then a real short
        // synthesis. Both are skipped unless this provider is active — an
        // unused default :9880 would otherwise read as a red failure for
        // everyone using Edge/RVC (same rule as the Cloud check above).
        const gsvRaw = {
          baseUrl: String(parsed.gsvBaseUrl || '').trim(),
          refAudio: String(parsed.gsvRefAudio || '').trim(),
          promptText: String(parsed.gsvPromptText || '').trim(),
          promptLang: String(parsed.gsvPromptLang || '').trim(),
          textLang: String(parsed.gsvTextLang || '').trim(),
          mediaType: String(parsed.gsvMediaType || '').trim(),
          speed: parsed.gsvSpeed,
          splitMethod: String(parsed.gsvSplitMethod || '').trim(),
          extraBody: String(parsed.gsvExtraBody || '')
        };
        const gsvCfg = gsvConfig(gsvRaw);
        const gsvCheck = { id: 'gsv-server', name: '本地 GPT-SoVITS 服务', ok: false, cls: '', detail: '' };
        const gsvSynthCheck = { id: 'gsv-synth', name: 'GPT-SoVITS 合成', ok: false, cls: '', detail: '' };
        if (String(parsed.gsvActive || '') !== '1') {
          gsvCheck.cls = 'skip';
          gsvCheck.detail = '未选用该提供者（切到「GPT-SoVITS」后会实测）';
          gsvSynthCheck.cls = 'skip';
          gsvSynthCheck.detail = '未选用该提供者，跳过合成';
        } else {
          // api_v2.py has no /health. Any HTTP response (even 404 on /) proves
          // the process is listening; a connection error is the real failure.
          // The human-facing detail shows only "在线" (reachable) — exposing the
          // raw status code (e.g. 404 on the root path) looked like an error to
          // users even though the service is up.
          // api_v2.py is FastAPI (/openapi.json lists /tts); the Gradio WebUI
          // answers HTML and has no API at all. Classify instead of reporting a
          // bare "HTTP 404", and when the typed port is wrong look for the engine
          // on its well-known ports.
          const probed = await probeGsvEndpoint(gsvCfg.baseUrl, 8000);
          let reachable = false;
          if (probed.kind === 'api') {
            reachable = true;
            gsvCheck.ok = true;
            gsvCheck.cls = 'ok';
            gsvCheck.detail = '在线（api_v2.py）';
          } else if (probed.kind === 'webui') {
            gsvCheck.cls = 'protocol';
            gsvCheck.detail = '连到的是 Gradio WebUI（' + gsvCfg.baseUrl + '），它没有 HTTP 接口——请在整合包目录启动 api_v2.py，把「服务地址」改成它打印的端口';
          } else if (probed.state === 'online') {
            gsvCheck.cls = 'protocol';
            gsvCheck.detail = '端口有响应，但不像 api_v2.py（缺少 /tts 接口）：' + gsvCfg.baseUrl;
          } else {
            let hint = '无法连接（' + gsvCfg.baseUrl + '）——请启动 api_v2.py 并确认「服务地址」';
            try {
              const scan = await scanGsvEndpoints(gsvCfg.baseUrl);
              if (scan.api && scan.api !== gsvCfg.baseUrl) {
                hint = '在 ' + scan.api + ' 找到了 api_v2.py——把「服务地址」改成它即可';
              } else if (scan.webui) {
                hint = '在 ' + scan.webui + ' 找到的是 Gradio WebUI（不是 API）；请另起 api_v2.py（默认 9880）';
              }
            } catch (e2) { /* keep the plain hint */ }
            gsvCheck.cls = 'connect';
            gsvCheck.detail = hint;
          }
          if (!reachable) {
            gsvSynthCheck.cls = 'skip';
            gsvSynthCheck.detail = '服务不可达，跳过合成';
          } else if (String(parsed.probe || '') === 'light') {
            // Lightweight status probe (settings-panel dots): connectivity only,
            // never spends GPU time on a real synthesis.
            gsvSynthCheck.cls = 'skip';
            gsvSynthCheck.detail = '轻量探测：跳过合成';
          } else {
            try {
              const t0 = Date.now();
              const p = await synthesizeGsv('你好，这是一个语音测试。', '', null, gsvRaw, 60000);
              const size = existsSync(p) ? readFileSync(p).length : 0;
              try { rmSync(p, { force: true }); } catch (e) { /* temp file only */ }
              gsvSynthCheck.ok = true;
              gsvSynthCheck.cls = 'ok';
              gsvSynthCheck.detail = '正常（' + (Date.now() - t0) + 'ms · ' + size + ' B · ' + gsvCfg.mediaType + '）';
            } catch (e) {
              const msg = String((e && e.message) || e);
              const code = (e && e.i18n && e.i18n.code) || '';
              if (code === 'host.gsvNoRefAudio') {
                gsvSynthCheck.cls = 'voice';
                gsvSynthCheck.detail = '未设置参考音频：' + msg.slice(0, 120);
              } else if (code === 'host.gsvBadExtra') {
                gsvSynthCheck.cls = 'protocol';
                gsvSynthCheck.detail = '高级参数不是合法 JSON 对象：' + msg.slice(0, 120);
              } else if (code === 'host.gsvBadRequest') {
                gsvSynthCheck.cls = 'protocol';
                gsvSynthCheck.detail = '参数被拒绝（检查参考音频路径 / 语言 / 输出格式）：' + msg.slice(0, 140);
              } else if (/abort|timeout|超时/i.test(msg)) {
                gsvSynthCheck.cls = 'warn';
                gsvSynthCheck.detail = '合成超时（60s）——GPU 冷启动慢可稍后重试';
              } else {
                gsvSynthCheck.cls = 'connect';
                gsvSynthCheck.detail = '合成失败：' + msg.slice(0, 160);
              }
            }
          }
        }
        checks.push(gsvCheck, gsvSynthCheck);
        // In-flight chunked jobs (counts only — never text) for "stuck at
        // segment x/y" triage when the user exports mid-read.
        const activeJobs = [...jobs.values()].map((j) => ({
          provider: j.provider || '?',
          total: j.parts.length,
          done: j.serveIdx,
          ready: (j.urls || []).filter((u) => typeof u === 'string').length
        }));
        writeJson(res, 200, {
          ok: checks.every((c) => c.ok),
          checks,
          plugin: PLUGIN_META,
          worker: WORKER_META,
          hostBuild: HOST_BUILD,
          activeJobs,
          recent: recentErrors.slice(-RECENT_CAP)
        });
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
        // Host-side voice directory: an explicit ?dir= wins, then the saved
        // Host setting. When set we never fall back to the service list (a
        // missing directory is a configuration error the user must see).
        const stored = loadHostIndexSettings();
        const dir = normVoicesDir(q.get('dir') || stored.voicesDir || '');
        if (dir) {
          const scan = scanHostVoiceDir(dir);
          if (!scan.ok) {
            writeErr(res, 400, scan.error, { code: 'host.voicesDirBad', params: { dir } });
            return;
          }
          writeJson(res, 200, {
            voices: scan.voices,
            entries: scan.entries,
            directory: scan.dir,
            exists: scan.exists,
            source: 'dir',
            count: scan.count
          });
          return;
        }
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
        writeJson(res, 200, Object.assign({ source: 'service' }, data || { voices: [], count: 0 }));
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
        // Host-side library: write straight into the configured directory.
        const stored = loadHostIndexSettings();
        const dir = normVoicesDir(parsed.dir || stored.voicesDir || '');
        if (dir) {
          if (!fsIsAbsolute(dir)) {
            writeErr(res, 400, '音色目录必须是绝对路径：' + dir, { code: 'host.voicesDirBad', params: { dir } });
            return;
          }
          if (bytes.length > 30 * 1024 * 1024) {
            writeErr(res, 400, '参考音频过大（上限 30MB）', { code: 'host.uploadTooLarge' });
            return;
          }
          const safeName = path.basename(filename).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'voice.wav';
          const ext = path.extname(safeName).toLowerCase();
          if (FS_AUDIO_EXTS.indexOf(ext) < 0) {
            writeErr(res, 400, '不支持的音频格式：' + (ext || '(无扩展名)'), { code: 'host.uploadBadType' });
            return;
          }
          try {
            ensureDir(dir);
            writeFileSync(path.join(dir, safeName), bytes);
          } catch (e) {
            writeErr(res, 500, '写入音色目录失败：' + String((e && e.message) || e).slice(0, 160), { code: 'host.voicesDirWrite', params: { dir } });
            return;
          }
          writeJson(res, 200, { ok: true, local: true, filename: safeName, path: path.join(dir, safeName), bytes: bytes.length });
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
        writeJson(res, 200, {
          index: {
            baseUrl: stored.baseUrl || INDEX_TTS2_DEFAULTS.baseUrl,
            voicesDir: stored.voicesDir || '',
            recentVoiceDirs: stored.recentVoiceDirs || []
          }
        });
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
        writeJson(res, 200, {
          ok: true,
          index: {
            baseUrl: next.baseUrl || INDEX_TTS2_DEFAULTS.baseUrl,
            voicesDir: next.voicesDir || '',
            recentVoiceDirs: next.recentVoiceDirs || []
          }
        });
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
        const stored = loadHostCosySettings();
        const dir = normVoicesDir(q.get('dir') || stored.voicesDir || '');
        if (dir) {
          const scan = scanHostVoiceDir(dir);
          if (!scan.ok) {
            writeErr(res, 400, scan.error, { code: 'host.voicesDirBad', params: { dir } });
            return;
          }
          writeJson(res, 200, {
            voices: scan.voices,
            entries: scan.entries,
            directory: scan.dir,
            exists: scan.exists,
            source: 'dir',
            count: scan.count
          });
          return;
        }
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
        writeJson(res, 200, Object.assign({ source: 'service' }, data || { voices: [], count: 0 }));
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
        const stored = loadHostCosySettings();
        const dir = normVoicesDir(parsed.dir || stored.voicesDir || '');
        if (dir) {
          if (!fsIsAbsolute(dir)) {
            writeErr(res, 400, '提示音频目录必须是绝对路径：' + dir, { code: 'host.voicesDirBad', params: { dir } });
            return;
          }
          if (bytes.length > 30 * 1024 * 1024) {
            writeErr(res, 400, '提示音频过大（上限 30MB）', { code: 'host.uploadTooLarge' });
            return;
          }
          const safeName = path.basename(filename).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'prompt.wav';
          const ext = path.extname(safeName).toLowerCase();
          if (FS_AUDIO_EXTS.indexOf(ext) < 0) {
            writeErr(res, 400, '不支持的音频格式：' + (ext || '(无扩展名)'), { code: 'host.uploadBadType' });
            return;
          }
          try {
            ensureDir(dir);
            writeFileSync(path.join(dir, safeName), bytes);
          } catch (e) {
            writeErr(res, 500, '写入提示音频目录失败：' + String((e && e.message) || e).slice(0, 160), { code: 'host.voicesDirWrite', params: { dir } });
            return;
          }
          writeJson(res, 200, { ok: true, local: true, filename: safeName, path: path.join(dir, safeName), bytes: bytes.length });
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
        writeJson(res, 200, {
          cosy: {
            baseUrl: stored.baseUrl || COSY_DEFAULTS.baseUrl,
            voicesDir: stored.voicesDir || '',
            recentVoiceDirs: stored.recentVoiceDirs || []
          }
        });
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
        writeJson(res, 200, {
          ok: true,
          cosy: {
            baseUrl: next.baseUrl || COSY_DEFAULTS.baseUrl,
            voicesDir: next.voicesDir || '',
            recentVoiceDirs: next.recentVoiceDirs || []
          }
        });
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

  // GPT-SoVITS provider: baseUrl + the reference-audio library are
  // service-class (persisted in config/settings.json). Synthesis goes through
  // /speak with provider 'gpt-sovits', so chunking/cache stay unified.
  const gsvConfigGetDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/gsv-config',
    async handler(req, res) {
      try {
        const stored = loadHostGsvSettings();
        writeJson(res, 200, {
          gsv: {
            baseUrl: stored.baseUrl || GSV_DEFAULTS.baseUrl,
            refsDir: stored.refsDir || '',
            modelDir: stored.modelDir || '',
            gptWeights: stored.gptWeights || '',
            sovitsWeights: stored.sovitsWeights || '',
            activeVoiceId: stored.activeVoiceId || '',
            recentDirs: stored.recentDirs || [],
            voices: (stored.voices || []).map(v => ({ ...v, exists: existsSync(v.path) }))
          },
          refsDirDefault: gsvRefsDir()
        });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const gsvConfigPostDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/gsv-config-save',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const patch = (parsed && parsed.gsv && typeof parsed.gsv === 'object') ? parsed.gsv : parsed;
        if (patch.baseUrl !== undefined && typeof patch.baseUrl === 'string' && patch.baseUrl.trim() !== '') {
          if (!/^https?:\/\//i.test(patch.baseUrl.trim())) {
            writeJson(res, 400, { error: '服务地址必须是 http(s) URL', i18n: { code: 'host.registryNotUrl', params: {} } });
            return;
          }
        }
        const next = saveHostGsvSettings(patch);
        writeJson(res, 200, {
          ok: true,
          gsv: {
            baseUrl: next.baseUrl || GSV_DEFAULTS.baseUrl,
            refsDir: next.refsDir || '',
            modelDir: next.modelDir || '',
            gptWeights: next.gptWeights || '',
            sovitsWeights: next.sovitsWeights || '',
            activeVoiceId: next.activeVoiceId || '',
            recentDirs: next.recentDirs || [],
            voices: (next.voices || []).map(v => ({ ...v, exists: existsSync(v.path) }))
          }
        });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  // --- local service lifecycle (user-configured commands) ------------------
  // GET  /dsh-tts-api/services      -> config + runtime state for every engine
  // POST /dsh-tts-api/service-save  -> persist command/cwd/port
  // POST /dsh-tts-api/service-start -> spawn the saved command
  // POST /dsh-tts-api/service-stop  -> kill the spawned tree
  const servicesListDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/services',
    async handler(req, res) {
      try {
        const services = {};
        await Promise.all(SERVICE_PROVIDERS.map(async (p) => { services[p] = await hostServiceState(p); }));
        writeJson(res, 200, { ok: true, services });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const readBodyJson = async (req) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body); } catch (e) { return {}; }
  };
  const serviceSaveDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/service-save',
    async handler(req, res) {
      try {
        const parsed = await readBodyJson(req);
        const result = saveHostService(String(parsed.provider || ''), {
          command: parsed.command,
          cwd: parsed.cwd,
          port: parsed.port
        });
        if (!result.ok) {
          writeErr(res, 400, result.error, { code: 'host.serviceSaveFail', params: {} });
          return;
        }
        writeJson(res, 200, { ok: true, service: result.service });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const serviceStartDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/service-start',
    async handler(req, res) {
      try {
        const parsed = await readBodyJson(req);
        const provider = String(parsed.provider || '');
        const result = await hostServiceStart(provider);
        if (!result.ok) {
          writeJson(res, 400, {
            error: result.error,
            log: result.log || [],
            i18n: { code: 'host.serviceStartFail', params: {} }
          });
          return;
        }
        writeJson(res, 200, Object.assign({ ok: true }, result, { state: await hostServiceState(provider) }));
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const serviceStopDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/service-stop',
    async handler(req, res) {
      try {
        const parsed = await readBodyJson(req);
        const provider = String(parsed.provider || '');
        if (SERVICE_PROVIDERS.indexOf(provider) < 0) {
          writeErr(res, 400, '未知的提供者：' + provider, { code: 'host.serviceUnknown', params: { provider } });
          return;
        }
        const result = await hostServiceStop(provider);
        writeJson(res, 200, Object.assign({ ok: true }, result, { state: await hostServiceState(provider) }));
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  // Directory listing for the voice picker. A browser file input never exposes
  // an absolute path, and api_v2.py needs one it can open itself — so listing
  // and picking happen Host-side on the same machine.
  const gsvFsListDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/gsv-fs-list',
    async handler(req, res) {
      try {
        const q = new URL(req.url || '', 'http://x').searchParams;
        const dir = q.get('dir') || '';
        const result = fsListDir(dir);
        if (!result.ok) {
          writeErr(res, 400, result.error, { code: 'host.fsBadDir', params: {} });
          return;
        }
        writeJson(res, 200, result);
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const gsvFsStatDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/gsv-fs-stat',
    async handler(req, res) {
      try {
        const q = new URL(req.url || '', 'http://x').searchParams;
        writeJson(res, 200, fsStatPath(q.get('path') || ''));
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  // Generic "new folder" for the directory pickers (voice library, references).
  const fsMkdirDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/fs-mkdir',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const result = fsMkdirChild(parsed && parsed.dir, parsed && parsed.name);
        if (!result.ok) {
          writeErr(res, 400, result.error, { code: 'host.fsMkdirFail', params: {} });
          return;
        }
        writeJson(res, 200, result);
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  // "Open in Explorer/Finder": reveal the current picker folder on this machine.
  const fsOpenDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/fs-open',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const result = openDirInFileManager(parsed && parsed.dir);
        if (!result.ok) {
          writeErr(res, 400, result.error, { code: 'host.fsOpenFail', params: {} });
          return;
        }
        writeJson(res, 200, result);
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  // Plugin data folder: path for display + "open in file manager" action.
  // Saves the user from hunting for ~/.dsh/dsh-plugin-tts by hand.
  const dataDirDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/data-dir',
    async handler(req, res) {
      try {
        ensureHomeDirs();
        writeJson(res, 200, { ok: true, dir: ttsHomeDir() });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const openDataDirDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/open-data-dir',
    async handler(req, res) {
      try {
        ensureHomeDirs();
        const result = openDirInFileManager(ttsHomeDir());
        if (!result.ok) {
          writeErr(res, 400, result.error, { code: 'host.fsOpenFail', params: {} });
          return;
        }
        writeJson(res, 200, result);
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  // --- discovery: candidate library + scans -------------------------------
  const discoveryGetDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/discovery',
    async handler(req, res) {
      try {
        const store = loadDiscoveryStore();
        writeJson(res, 200, {
          ok: true,
          home: os.homedir(),
          drives: listDiscoveryVolumes(),
          roots: store.roots,
          candidates: store.candidates
        });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const discoveryActionDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/discovery-action',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const action = String((parsed && parsed.action) || '');
        if (action === 'addRoot') {
          writeJson(res, 200, { ok: true, store: discoveryAddRoot(parsed.dir) });
          return;
        }
        if (action === 'removeRoot') {
          writeJson(res, 200, { ok: true, store: discoveryRemoveRoot(parsed.dir) });
          return;
        }
        if (action === 'save') {
          const cand = upsertDiscoveryCandidate(parsed.candidate);
          writeJson(res, 200, { ok: true, candidate: cand, store: loadDiscoveryStore() });
          return;
        }
        if (action === 'remove') {
          const store = loadDiscoveryStore();
          store.candidates = store.candidates.filter((c) => c.id !== String(parsed.id || ''));
          writeJson(res, 200, { ok: true, store: saveDiscoveryStore(store) });
          return;
        }
        if (action === 'lock' || action === 'unlock') {
          const store = loadDiscoveryStore();
          const hit = store.candidates.find((c) => c.id === String(parsed.id || ''));
          if (!hit) throw hostErr('候选不存在', 'host.discMissing');
          hit.status = action === 'lock' ? 'locked' : (hit.lastVerifiedAt ? 'verified' : 'detected');
          writeJson(res, 200, { ok: true, store: saveDiscoveryStore(store) });
          return;
        }
        if (action === 'use') {
          const store = loadDiscoveryStore();
          const hit = store.candidates.find((c) => c.id === String(parsed.id || ''));
          if (!hit) throw hostErr('候选不存在', 'host.discMissing');
          hit.lastUsedAt = nowIso();
          if (hit.status === 'detected') hit.status = 'locked';
          writeJson(res, 200, { ok: true, candidate: hit, store: saveDiscoveryStore(store) });
          return;
        }
        if (action === 'verify') {
          const cand = await verifyDiscoveryCandidate(String(parsed.id || ''));
          writeJson(res, 200, { ok: true, candidate: cand, store: loadDiscoveryStore() });
          return;
        }
        writeErr(res, 400, '未知操作：' + action, { code: 'host.discBadAction' });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const discoveryScanStartDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/discovery-scan',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const job = startDiscoveryScan({
          targets: Array.isArray(parsed.targets) ? parsed.targets : undefined,
          mode: parsed.mode
        });
        writeJson(res, 200, discoveryScanStatus(job));
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const discoveryScanStatusDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/discovery-scan-status',
    async handler(req, res) {
      try {
        const q = new URL(req.url || '', 'http://x').searchParams;
        const job = discoveryScans.get(String(q.get('job') || ''));
        if (!job) {
          writeErr(res, 404, '扫描任务不存在', { code: 'host.discJobMissing' });
          return;
        }
        if (q.get('cancel') === '1') job.cancelled = true;
        writeJson(res, 200, discoveryScanStatus(job));
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  // Dropped / selected wav -> data/refs/<sha1:8>-<name>.wav -> absolute path the
  // engine can read. Single-machine assumption, stated in the guide.
  const gsvRefsUploadDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/gsv-refs-upload',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const filename = String(parsed.filename || '').slice(0, 200);
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
        if (bytes.length > 30 * 1024 * 1024) {
          writeErr(res, 400, '参考音频过大（上限 30MB）', { code: 'host.uploadTooLarge' });
          return;
        }
        const outPath = storeGsvRefFile(filename, bytes);
        writeJson(res, 200, { ok: true, path: outPath, name: path.basename(outPath), bytes: bytes.length });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  // "Point me at the right port": probes what the user typed then each engine's
  // well-known port, and separates the real API from the Gradio WebUI.
  const gsvProbeDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/gsv-probe',
    async handler(req, res) {
      try {
        const q = new URL(req.url || '', 'http://x').searchParams;
        const baseUrl = String(q.get('baseUrl') || '').trim() || GSV_DEFAULTS.baseUrl;
        writeJson(res, 200, await scanGsvEndpoints(baseUrl));
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  // Model weights: list switchable GPT / SoVITS pairs from an install root,
  // then apply them on the running api_v2.py (no restart / yaml editing).
  const gsvModelsDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/gsv-models',
    async handler(req, res) {
      try {
        const q = new URL(req.url || '', 'http://x').searchParams;
        const stored = loadHostGsvSettings();
        const dir = normVoicesDir(q.get('dir') || stored.modelDir || '');
        if (!dir) {
          writeErr(res, 400, '请先选择 GPT-SoVITS 模型目录（安装根目录）', { code: 'host.gsvModelDirMissing', params: {} });
          return;
        }
        const scan = scanGsvModels(dir);
        if (!scan.ok) {
          writeErr(res, 400, scan.error, { code: 'host.gsvModelScanFail', params: { dir } });
          return;
        }
        // The weights the service booted with (tts_infer.yaml `custom:`), so the
        // panel can show what is actually loaded next to what is selected here.
        writeJson(res, 200, { ...scan, current: readGsvServiceWeights(dir) });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });
  const gsvSetWeightsDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/gsv-set-weights',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const baseUrl = String(parsed.baseUrl || GSV_DEFAULTS.baseUrl).trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(baseUrl)) {
          writeErr(res, 400, '服务地址必须是 http(s) URL', { code: 'host.registryNotUrl', params: {} });
          return;
        }
        const gpt = String(parsed.gpt || '').trim();
        const sovits = String(parsed.sovits || '').trim();
        if (!gpt && !sovits) {
          writeErr(res, 400, '请至少选择一个权重文件', { code: 'host.gsvWeightsEmpty', params: {} });
          return;
        }
        const t0 = Date.now();
        const call = async (route, weightsPath) => {
          let r;
          try {
            r = await fetch(baseUrl + route + '?weights_path=' + encodeURIComponent(weightsPath), {
              signal: AbortSignal.timeout(180000)
            });
          } catch (e) {
            throw hostErr(
              `无法连接 GPT-SoVITS 服务（${baseUrl}）\n${gsvStartupHint()}\n原始错误：${String((e && e.message) || e)}`,
              'host.gsvUnreachable',
              { baseUrl }
            );
          }
          const text = await r.text().catch(() => '');
          let detail = '';
          try {
            const d = JSON.parse(text);
            detail = String(d.message || d.Exception || text).slice(0, 300);
          } catch (e) {
            detail = String(text).slice(0, 300) || r.statusText;
          }
          if (!r.ok) {
            throw hostErr(
              `切换权重失败（${route}，HTTP ${r.status}）：${detail}`,
              'host.gsvWeightsFail',
              { route, status: r.status }
            );
          }
        };
        // SoVITS first: it determines the model version/languages the GPT
        // weights must match; then load the matching GPT checkpoint.
        if (sovits) await call('/set_sovits_weights', sovits);
        if (gpt) await call('/set_gpt_weights', gpt);
        const patch = {};
        if (gpt) patch.gptWeights = gpt;
        if (sovits) patch.sovitsWeights = sovits;
        saveHostGsvSettings(patch);
        writeJson(res, 200, { ok: true, gpt, sovits, ms: Date.now() - t0 });
      } catch (e) {
        writeRouteError(res, e);
      }
    }
  });

  // One-shot probe from the settings panel: a real /tts synthesis with the
  // values currently in the form (not a stale Host-file fallback).
  const gsvTestDisposer = webServer.register({
    kind: 'exact',
    path: '/dsh-tts-api/gsv-test',
    async handler(req, res) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) { /* fall through */ }
        const custom = (parsed && parsed.custom && typeof parsed.custom === 'object') ? parsed.custom : {};
        const probe = '你好，这是一个语音测试。';
        const t0 = Date.now();
        try {
          const p = await synthesizeGsv(probe, '', null, custom);
          const size = existsSync(p) ? readFileSync(p).length : 0;
          try { rmSync(p, { force: true }); } catch (e) { /* temp file only */ }
          const cfg = gsvConfig(custom);
          writeJson(res, 200, {
            ok: true,
            ms: Date.now() - t0,
            bytes: size,
            mediaType: cfg.mediaType,
            splitMethod: pickGsvSplitMethod(probe, cfg.splitMethod)
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
  ctx.effect(() => gsvConfigGetDisposer, 'dsh-plugin-tts: gsv config route');
  ctx.effect(() => gsvConfigPostDisposer, 'dsh-plugin-tts: gsv config save route');
  ctx.effect(() => gsvModelsDisposer, 'dsh-plugin-tts: gsv models route');
  ctx.effect(() => gsvSetWeightsDisposer, 'dsh-plugin-tts: gsv weights route');
  ctx.effect(() => gsvTestDisposer, 'dsh-plugin-tts: gsv test route');
  ctx.effect(() => fsMkdirDisposer, 'dsh-plugin-tts: fs mkdir route');
  ctx.effect(() => fsOpenDisposer, 'dsh-plugin-tts: fs open route');
  ctx.effect(() => notifyDisposer, 'dsh-plugin-tts: notify route');
  ctx.effect(() => diagnoseDisposer, 'dsh-plugin-tts: diagnose route');
  ctx.effect(() => discoveryGetDisposer, 'dsh-plugin-tts: discovery store route');
  ctx.effect(() => discoveryActionDisposer, 'dsh-plugin-tts: discovery action route');
  ctx.effect(() => discoveryScanStartDisposer, 'dsh-plugin-tts: discovery scan route');
  ctx.effect(() => discoveryScanStatusDisposer, 'dsh-plugin-tts: discovery scan status route');
}

// Test hook: expose pure helpers for unit tests without a real server.
// (e.g. tests/smoke.mjs asserts splitText never cuts URLs/decimals mid-token,
// and drives ingestSessionEvent + the notify queue directly.)
export const __test = {
  isHardEdgeWorkerError,
  classifyHostError,
  countWorkerRetries,
  splitText,
  spanParts,
  splitCloudPackets,
  chunkCal,
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
  normVoicesDir,
  scanHostVoiceDir,
  resolveHostVoicePath,
  isLoopbackUrl,
  fsMkdirChild,
  gsvConfig,
  gsvTtsUrl,
  scanGsvModels,
  readGsvServiceWeights,
  fsPathCrumbs,
  loadHostServices,
  saveHostService,
  hostServiceStart,
  hostServiceStop,
  hostServiceState,
  SERVICE_PROVIDERS,
  pickGsvSplitMethod,
  parseGsvExtraBody,
  audioKindFromBytes,
  loadHostGsvSettings,
  saveHostGsvSettings,
  ttsHomeDir,
  configDir,
  dataDir,
  cacheDir,
  synthDir,
  gsvRefsDir,
  ensureHomeDirs,
  adoptHomeDir,
  pruneSynthCache,
  fsListDir,
  fsStatPath,
  // discovery helpers (tests use temp fixtures; no server needed)
  inspectRvcCheckpoint,
  inspectFaissIndex,
  detectGsvInstall,
  detectIndexInstall,
  detectCosyInstall,
  detectCloudCredential,
  buildCandidate,
  fileFingerprint,
  loadDiscoveryStore,
  saveDiscoveryStore,
  discoveryAddRoot,
  discoveryRemoveRoot,
  verifyDiscoveryCandidate,
  parseYamlScalars,
  zipEntriesOf,
  startDiscoveryScan,
  discoveryScanStatus,
  listDiscoveryVolumes,
  storeGsvRefFile,
  probeGsvEndpoint,
  scanGsvEndpoints,
  loadHostCloudSettings,
  saveHostCloudSettings,
  recordCloudUsage,
  getCloudUsageSummary,
  notify: () => ({
    seq: notifyState.seq,
    queued: notifyState.queue.length
  })
};
