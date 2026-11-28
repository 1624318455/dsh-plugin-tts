// Breeze TTS 2 provider contract: host config/audio helpers + client wiring.
// No network and no model needed — the live end-to-end check is done against a
// running breeze_infer.api service (see docs/BREEZE-GUIDE.md).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { __test } from '../lib/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8');
const hostSrc = readFileSync(path.join(here, '..', 'lib', 'index.mjs'), 'utf8');

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// 1) PCM -> WAV container: 44-byte canonical header, exact sizes/rates.
{
  const pcm = Buffer.from([0x01, 0x00, 0x02, 0x00, 0x03, 0x00]);
  const wav = __test.pcm16ToWav(pcm, 24000);
  check('pcm16ToWav writes a RIFF/WAVE header',
    wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE' &&
    wav.toString('ascii', 12, 16) === 'fmt ' && wav.toString('ascii', 36, 40) === 'data');
  check('pcm16ToWav sets mono/16-bit/24 kHz',
    wav.readUInt16LE(20) === 1 && wav.readUInt16LE(22) === 1 &&
    wav.readUInt32LE(24) === 24000 && wav.readUInt16LE(34) === 16 &&
    wav.readUInt32LE(28) === 48000);
  check('pcm16ToWav sizes match the payload',
    wav.readUInt32LE(40) === pcm.length && wav.length === 44 + pcm.length &&
    wav.readUInt32LE(4) === 36 + pcm.length);
  check('pcm16ToWav falls back to 24 kHz for a bad rate',
    __test.pcm16ToWav(Buffer.alloc(2), NaN).readUInt32LE(24) === 24000);
}

// 2) Config: defaults, clamping, transcript/instruction trimming.
{
  const d = __test.breezeConfig(null, '');
  check('breezeConfig defaults to :7860 and cfg 1.0',
    d.baseUrl === 'http://127.0.0.1:7860' && d.cfgScale === 1.0 && d.seed === 42);
  const c = __test.breezeConfig({
    baseUrl: 'http://127.0.0.1:7860/',
    voice: 'ref.wav',
    refText: '  你好  ',
    instruction: ' 温柔的年轻女性 ',
    cfgScale: 99,
    seed: 7
  }, '');
  check('breezeConfig trims slash/whitespace and clamps cfg',
    c.baseUrl === 'http://127.0.0.1:7860' && c.refText === '你好' &&
    c.instruction === '温柔的年轻女性' && c.cfgScale === 10 && c.seed === 7);
}

// 3) Host wiring: provider registered, /speak key + chunk sink + routes.
{
  check('host registers the breeze-tts2 provider',
    /registerProvider\('breeze-tts2'/.test(hostSrc) && /synthesizeBreeze/.test(hostSrc));
  check('host wraps PCM with the API sample rate',
    /x-sample-rate/.test(hostSrc) && /pcm16ToWav\(pcm, sampleRate\)/.test(hostSrc));
  check('host guards the reference transcript and empty mode',
    /host\.breezeNoRefText/.test(hostSrc) && /host\.breezeNoRef/.test(hostSrc));
  check('host proxies voices/upload/config routes',
    /'\/dsh-tts-api\/breeze-voices'/.test(hostSrc) &&
    /'\/dsh-tts-api\/breeze-upload'/.test(hostSrc) &&
    /'\/dsh-tts-api\/breeze-config'/.test(hostSrc) &&
    /'\/dsh-tts-api\/breeze-config-save'/.test(hostSrc));
  check('host diagnostics include the breeze server check',
    /breeze-server/.test(hostSrc) && /breeze-ref/.test(hostSrc));
  check('host exposes the Breeze local service launcher',
    /'breeze-tts-2'\]/.test(hostSrc) && /'breeze-tts-2': 7860/.test(hostSrc) &&
    /breeze_infer['"],\s*['"]api\.py/.test(hostSrc));
  check('client renders the Breeze service panel and model dir',
    /servicePanel\("breeze-tts-2"\)/.test(clientSrc) &&
    /breeze\.field\.modelDir/.test(clientSrc) &&
    /HOST_BREEZE_KEYS = \["baseUrl", "voicesDir", "modelDir"/.test(clientSrc));
  check('host discovery detects the Breeze repo and checkpoint',
    /function detectBreezeRepo/.test(hostSrc) && /function detectBreezeCheckpoint/.test(hostSrc) &&
    /detectBreezeRepo, detectBreezeCheckpoint/.test(hostSrc));
  check('host chunk policy covers breeze',
    __test.chunkCal('breeze-tts2').chunkSec === 15 &&
    __test.chunkCal('breeze-tts2').prewarm === 2);
}

// 4) Client wiring: picker option, payload branch, settings section, uploads.
{
  check('client provider select offers breeze-tts2',
    /\["breeze-tts2",\s*t\("provider\.breeze"\)/.test(clientSrc));
  check('client sends shared.breeze as custom',
    /useProvider === "breeze-tts2"[\s\S]{0,220}payload\.custom = Object\.assign\(\{\}, shared\.breeze/.test(clientSrc));
  check('client renders the breeze settings section',
    /const breezeSection = react\.createElement/.test(clientSrc) &&
    /provider === "breeze-tts2" \? breezeSection : null/.test(clientSrc));
  check('client preview requires a transcript when a clip is chosen',
    /hasVoice && !hasRefText/.test(clientSrc) && /breeze\.refText/.test(clientSrc));
  check('client supports drop-upload into the breeze ref dir',
    /provider === "breeze-tts2"\) uploadBreezeVoice\(f\)/.test(clientSrc));
  check('client persists breeze service keys to the Host file',
    /HOST_BREEZE_KEYS/.test(clientSrc) && /breeze-config-save/.test(clientSrc));
}

console.log(`\n${pass}/${pass + fail} breeze-contract checks passed`);
process.exit(fail === 0 ? 0 : 1);
