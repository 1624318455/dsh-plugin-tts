// Paired reference voices (audio + transcript) — Host store contract.
// The same pair must be saveable once and reused by Breeze / CosyVoice.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.DSH_TTS_HOME = mkdtempSync(path.join(os.tmpdir(), 'dsh-voice-pairs-'));
const home = process.env.DSH_TTS_HOME;

const { __test } = await import('../lib/index.mjs');
const hostSrc = readFileSync(path.join(here, '..', 'lib', 'index.mjs'), 'utf8');
const clientSrc = readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

try {
  const refs = path.join(home, 'refs');
  mkdirSync(refs, { recursive: true });
  const wav = path.join(refs, 'voice_a.wav');
  writeFileSync(wav, Buffer.alloc(2048, 1));

  const t1 = __test.saveVoicePair({ name: '音色A', path: wav, refText: '你好，我是音色A。', source: 'breeze' });
  check('saveVoicePair stores a pair', t1.ok && t1.pairs.length === 1 && t1.pair.refText === '你好，我是音色A。');
  check('saved pair carries a stable id', /^[0-9a-f]{12}$/.test(t1.pair.id));

  const t2 = __test.saveVoicePair({ name: '音色A改名', path: wav, refText: '你好，我是音色A。', source: 'breeze' });
  check('re-saving the same audio+transcript updates in place',
    t2.ok && t2.pairs.length === 1 && t2.pair.id === t1.pair.id && t2.pair.name === '音色A改名');

  const t3 = __test.saveVoicePair({ path: wav, refText: '' });
  check('a pair without a transcript is rejected', !t3.ok);
  const t4 = __test.saveVoicePair({ path: 'relative/voice.wav', refText: 'x' });
  check('a relative audio path is rejected', !t4.ok);
  const t5 = __test.saveVoicePair({ path: path.join(refs, 'missing.wav'), refText: 'x' });
  check('a missing audio file is rejected', !t5.ok);

  const wav2 = path.join(refs, 'voice_b.wav');
  writeFileSync(wav2, Buffer.alloc(2048, 2));
  __test.saveVoicePair({ name: '音色B', path: wav2, refText: '我是音色B。', source: 'cosyvoice' });
  check('the library is shared across engines', __test.loadVoicePairs().length === 2);

  const listed = JSON.parse(readFileSync(path.join(home, 'config', 'settings.json'), 'utf8'));
  check('pairs persist in settings.json under voicePairs', Array.isArray(listed.voicePairs) && listed.voicePairs.length === 2);

  const del = __test.deleteVoicePair(t1.pair.id);
  check('deleteVoicePair removes only that entry',
    del.ok && del.removed && del.pairs.length === 1 && del.pairs[0].name === '音色B');
  const del2 = __test.deleteVoicePair(t1.pair.id);
  check('deleting an unknown id is a no-op', del2.ok && !del2.removed);

  // Wiring: routes exist and both provider sections render the shared picker.
  check('host exposes pair list/save/delete routes',
    /'\/dsh-tts-api\/voice-pairs'/.test(hostSrc) &&
    /'\/dsh-tts-api\/voice-pairs-save'/.test(hostSrc) &&
    /'\/dsh-tts-api\/voice-pairs-delete'/.test(hostSrc));
  check('the reference picker itself lists pair status for both engines',
    /voicePickRows\("breeze", breezeVoices\.list\)/.test(clientSrc) &&
    /voicePickRows\("cosy", cosyVoices\.list\)/.test(clientSrc) &&
    /pairHint\(x\.text \|\| live\)/.test(clientSrc));
  check('picking a row fills clip + transcript for both engines',
    /applyPickedVoice\("breeze", v\)/.test(clientSrc) &&
    /applyPickedVoice\("cosy", v\)/.test(clientSrc) &&
    /setBreeze\("refText", text\)/.test(clientSrc) &&
    /setCosy\("promptText", text\)/.test(clientSrc));
  check('transcript edits write through to the pair',
    /saveVoicePairFor\("breeze", v\)/.test(clientSrc) &&
    /saveVoicePairFor\("cosy", v\)/.test(clientSrc) &&
    /voice-pairs-delete/.test(clientSrc));
  check('transcript boxes grow between 2 and 3 lines',
    /AutoGrowTextarea/.test(clientSrc) &&
    /\.dsh-tts-rvc-textarea\{[^}]*min-height:53px[^}]*max-height:75px/.test(clientSrc) &&
    /minRows: 2,[\s\S]{0,40}maxRows: 3/.test(clientSrc));
  check('no separate voice-library row remains',
    !/voicePairField/.test(clientSrc));
} finally {
  try { rmSync(home, { recursive: true, force: true }); } catch (e) {}
}

console.log(`\n${pass}/${pass + fail} voice-pairs checks passed`);
process.exit(fail === 0 ? 0 : 1);
