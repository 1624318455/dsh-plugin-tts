#!/usr/bin/env node
// make-pack.mjs — one-command voice-pack addition for a dsh-plugin-tts pack repo.
//
// Scans a folder for a model (.pth) + index files (.index), copies them into
// <repo>/packs/<id>/, computes size + sha256, and merges a manifest.json entry
// (schema 2, multi-index). No dependencies beyond Node.
//
// Usage:
//   node tools/make-pack.mjs --id azusa2 --name "Azusa 2" \
//       --dir D:/incoming/azusa2 --repo . \
//       [--desc "..."] [--author me] [--license author-owned]
//       [--base-voice zh-CN-YunyangNeural] [--f0-method rmvpe] [--index-rate 0.75]
//       [--version 1.0.0]
//
// Validate an existing repo (existence + sha256 + size for every pack):
//   node tools/make-pack.mjs --check --repo .
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync,
  readdirSync, statSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const repo = path.resolve(args.repo || '.');
const manifestPath = path.join(repo, 'manifest.json');

function sha256(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function loadManifest() {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return { schema: 2, updated: '', packs: [] };
  }
}

function saveManifest(m) {
  m.schema = 2;
  m.updated = new Date().toISOString();
  writeFileSync(manifestPath, JSON.stringify(m, null, 2));
}

// ---- --check: validate every pack in the manifest ---------------------------
if (args.check) {
  const m = loadManifest();
  let bad = 0;
  const checkFile = (packId, label, f) => {
    if (!f || !f.url) return;
    const fp = path.join(repo, f.url);
    if (!existsSync(fp)) { console.log(`MISSING  ${packId} ${label}: ${f.url}`); bad++; return; }
    const s = sha256(fp);
    if (s !== String(f.sha256).toLowerCase()) { console.log(`SHA-BAD  ${packId} ${label}: ${f.url}`); bad++; return; }
    if (f.size && statSync(fp).size !== f.size) { console.log(`SIZE-BAD ${packId} ${label}: ${f.url}`); bad++; }
    console.log(`ok       ${packId} ${label}: ${f.url}`);
  };
  for (const p of m.packs) {
    checkFile(p.id, 'model', p.model);
    for (const i of (p.indexes || [])) checkFile(p.id, 'index', i);
    checkFile(p.id, 'index', p.index);
  }
  console.log(bad ? `\nFAIL: ${bad} problem(s) in ${m.packs.length} pack(s)` : `\nOK: ${m.packs.length} pack(s) validated`);
  process.exit(bad ? 1 : 0);
}

// ---- add a pack ------------------------------------------------------------
const id = String(args.id || '').trim();
if (!id) { console.error('--id is required (e.g. --id azusa2)'); process.exit(1); }
const srcDir = path.resolve(String(args.dir || ''));
if (!existsSync(srcDir)) { console.error(`--dir not found: ${srcDir}`); process.exit(1); }

const files = readdirSync(srcDir);
const modelSrc = files.find(f => f.toLowerCase().endsWith('.pth'));
const indexSrcs = files.filter(f => f.toLowerCase().endsWith('.index')).sort();
if (!modelSrc) { console.error(`no .pth model found in ${srcDir}`); process.exit(1); }
if (!indexSrcs.length) console.log('note: no .index files found -> index-free pack');

const stem = id.replace(/[^\w.-]/g, '_');
const packDir = path.join(repo, 'packs', stem);
mkdirSync(packDir, { recursive: true });

// model
const modelName = stem + '.pth';
const modelDst = path.join(packDir, modelName);
copyFileSync(path.join(srcDir, modelSrc), modelDst);
const model = {
  url: `packs/${stem}/${modelName}`,
  size: statSync(modelDst).size,
  sha256: sha256(modelDst)
};

// indexes (each .index file becomes a selectable variant)
const indexes = [];
for (const src of indexSrcs) {
  const dst = path.join(packDir, src);
  copyFileSync(path.join(srcDir, src), dst);
  const size = statSync(dst).size;
  const base = path.basename(src, path.extname(src)).replace(/[^\w.-]/g, '_').slice(0, 24) || 'index';
  indexes.push({
    id: base,
    name: `${base}（${(size / 1048576).toFixed(0)}MB）`,
    url: `packs/${stem}/${src}`,
    size,
    sha256: sha256(dst)
  });
}

const entry = {
  id,
  name: String(args.name || id),
  description: String(args.desc || ''),
  version: String(args.version || '1.0.0'),
  author: String(args.author || ''),
  license: String(args.license || 'unknown'),
  baseVoice: String(args['base-voice'] || 'zh-CN-YunyangNeural'),
  f0Method: String(args['f0-method'] || 'rmvpe'),
  indexRate: Number(args['index-rate'] ?? 0.75),
  model,
  indexes
};
if (!indexes.length) delete entry.indexes;

const m = loadManifest();
if (!Array.isArray(m.packs)) m.packs = [];
const i = m.packs.findIndex(p => p && p.id === id);
if (i >= 0) m.packs[i] = entry;
else m.packs.push(entry);
saveManifest(m);

console.log(`\nadded pack "${entry.name}" (${id}):`);
console.log(`  model  ${model.url}  ${(model.size / 1048576).toFixed(1)}MB`);
for (const idx of entry.indexes || []) {
  console.log(`  index  ${idx.url}  ${(idx.size / 1048576).toFixed(1)}MB  (variant: ${idx.id})`);
}
console.log('\nnext steps:');
console.log(`  git -C "${repo}" add packs/${stem} manifest.json`);
console.log(`  git -C "${repo}" commit -m "add voice pack ${id}"`);
console.log(`  git -C "${repo}" push origin main`);
console.log('\nverify:');
console.log(`  node tools/make-pack.mjs --check --repo "${repo}"`);
