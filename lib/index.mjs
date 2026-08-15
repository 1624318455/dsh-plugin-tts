// @dsh-external/dsh-plugin-tts — Host half.
// Registers two webServer routes:
//   POST /dsh-tts-api/speak  { text, voice } -> { url } | { error }
//   GET  /dsh-tts-audio/<id>                -> audio/mpeg bytes
// Synthesis runs a zero-dependency Edge TTS worker via `node -e`
// (Sec-MS-GEC query-param protocol, mirroring node-edge-tts@1.2.10).
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
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
function synthesizeOnce(voice, text, outPath, lang) {
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
      const ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="' + lang + '">' + '<voice name="' + xmlEscape(voice) + '">' + '<prosody rate="default" pitch="default" volume="default">' + xmlEscape(text) + '</prosody></voice></speak>';
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
function findVoiceArg() {
  const args = process.argv;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--' || a === '-e') continue;
    if (a.indexOf('.cjs') >= 0 || a.indexOf('.mjs') >= 0 || a.indexOf('edge-tts-worker') >= 0) continue;
    return a;
  }
  return 'zh-CN-XiaoxuanNeural';
}
async function main() {
  const voice = findVoiceArg();
  const text = (await readStdin()).trim();
  if (!text) return fail('empty text');
  const vparts = String(voice).split('-');
  const lang = (vparts.length >= 2 ? vparts[0] + '-' + vparts[1] : 'zh-CN');
  const outPath = path.join(os.tmpdir(), 'dsh-tts-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.mp3');
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const size = await synthesizeOnce(voice, text, outPath, lang);
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
function synthesize(text, voice) {
  return new Promise((resolve, reject) => {
    const outPath = path.join(os.tmpdir(), `dsh-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
    const child = spawn(process.execPath, ['-e', WORKER_SRC, '--', voice], {
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
        const key = voice + '|' + text;
        const hit = cache.get(key);
        if (hit) {
          writeJson(res, 200, { url: hit });
          return;
        }
        const absPath = await synthesize(text, voice);
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
