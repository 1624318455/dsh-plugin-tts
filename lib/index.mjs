// @dsh-external/dsh-plugin-tts — Host half.
// Registers two webServer routes:
//   POST /dsh-tts-api/speak  { text, voice } -> { url } | { error }
//   GET  /dsh-tts-audio/<id>                -> audio/mpeg bytes
// Synthesis runs a zero-dependency Edge TTS worker via `node -e`
// (Sec-MS-GEC query-param protocol, mirroring node-edge-tts@1.2.10).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
    cfg.model, cfg.index, cfg.baseVoice, cfg.baseRate, cfg.basePitch, cfg.baseVolume,
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

/** RVC chain: Edge TTS base mp3 -> local RVC conversion -> wav file path. */
async function synthesizeRvc(text, voice, custom) {
  const cfg = rvcConfig(custom);
  if (!cfg.model) throw new Error('未配置 RVC 模型路径（设置 → 插件 → 语音 → RVC 配置）');
  const baseVoice = cfg.baseVoice || voice;
  const mp3Path = await synthesize(text, baseVoice, {
    rate: cfg.baseRate,
    pitch: cfg.basePitch,
    volume: cfg.baseVolume
  });
  const mp3Bytes = readFileSync(mp3Path);
  await ensureRvcLoaded(cfg);
  let wavBytes;
  try {
    wavBytes = await rvcConvertBytes(cfg, mp3Bytes);
  } catch (e) {
    // one retry with a fresh /load (the server may have unloaded the model)
    rvcLoadedKey = '';
    await ensureRvcLoaded(cfg);
    wavBytes = await rvcConvertBytes(cfg, mp3Bytes);
  }
  const wavPath = path.join(os.tmpdir(), `dsh-tts-rvc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
  writeFileSync(wavPath, wavBytes);
  return wavPath;
}

export function apply(ctx) {
  const webServer = ctx.get('webServer');
  if (!webServer) return;

  const files = new Map();   // id -> absolute mp3 path
  const cache = new Map();   // voice|text -> url
  let seq = 0;

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
        const providerKey = provider === 'rvc' ? 'rvc|' + rvcFingerprint(rvcConfig(custom)) : provider;
        const key = providerKey + '|' + voice + '|' + text;
        const hit = cache.get(key);
        if (hit) {
          writeJson(res, 200, { url: hit });
          return;
        }
        const absPath = provider === 'rvc'
          ? await synthesizeRvc(text, voice, custom)
          : await synthesize(text, voice);
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

  ctx.effect(() => speakDisposer, 'dsh-plugin-tts: speak route');
  ctx.effect(() => audioDisposer, 'dsh-plugin-tts: audio route');
}
