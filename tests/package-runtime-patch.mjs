// Boundary test for tools/package-runtime.py's macOS-only PyAV patch helper
// (patch_infer_for_pyav): it must rewrite av.open("rb"/"wb") -> "r"/"w" in the
// packaged infer/lib/audio.py on darwin, but leave a normal Python `open(
// file, "rb")` (a real file open) untouched. Verified end-to-end too by
//   node tests/rvc-server-live.mjs  (live /convert)
// Run: node tests/package-runtime-patch.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(repo, 'tools', 'package-runtime.py');
// sample = the unpatched (as-released) audio.py
const sample = [
  'import av',
  'import numpy as np',
  'def wav2(i, o, format):',
  '    inp = av.open(i, "rb")',
  '    out = av.open(o, "wb", format=format)',
  '    return inp, out',
  'def audio2(i, o, format, sr):',
  '    inp = av.open(i, "rb")',
  '    out = av.open(o, "wb", format=format)',
  '    return inp, out',
  'def load_audio(file, sr):',
  '    with open(file, "rb") as f:',
  '        pass',
  ''
].join('\n');

const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-tts-pyav-'));
try {
  const libDir = path.join(dir, 'infer', 'lib');
  mkdirSync(libDir, { recursive: true });
  const audioPath = path.join(libDir, 'audio.py');
  writeFileSync(audioPath, sample);

  const driver = path.join(dir, 'driver.py');
  writeFileSync(driver, `
import importlib.util
spec = importlib.util.spec_from_file_location("prt", ${JSON.stringify(pkg)})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.patch_infer_for_pyav(${JSON.stringify(path.join(dir, 'infer'))})
`);
  execFileSync('python3', [driver], { encoding: 'utf8' });

  const out = readFileSync(audioPath, 'utf8');
  check('darwin patch replaces av.open rb/wb', !/av\.open\([^)]*"(rb|wb)"/.test(out), out.split('\n').filter(l => l.includes('av.open')).join(' | '));
  check('darwin patch keeps Python open(file,"rb")', out.includes('with open(file, "rb") as f:'));
  check('darwin patch converts to r/w', out.includes('av.open(i, "r")') && out.includes('av.open(o, "w", format=format)'));

  // idempotency: running twice changes nothing
  execFileSync('python3', [driver], { encoding: 'utf8' });
  check('patch idempotent (second run unchanged)', readFileSync(audioPath, 'utf8') === out);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} patch checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
