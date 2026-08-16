// i18n regression: every t("key") used in lib/client.js must exist in both zh
// and en dictionaries; both dictionaries must be identical in key sets; and
// no CJK UI literal may remain outside the dictionary.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const client = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js'), 'utf8');
const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); }

function extractDict(lang) {
  const lineMarker = `          ${lang}: {`;
  const start = client.indexOf(lineMarker);
  if (start < 0) throw new Error('no dict.' + lang);
  const bodyStart = client.indexOf('{', start);
  let i = bodyStart, depth = 0;
  for (; i < client.length; i++) {
    if (client[i] === '{') depth++;
    else if (client[i] === '}') { depth--; if (depth === 0) break; }
  }
  const block = client.slice(bodyStart, i + 1);
  const re = /"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/g;
  const out = {};
  let m;
  while ((m = re.exec(block))) out[m[1]] = m[2];
  return out;
}
let zh, en, zhKeys, enKeys;
try {
  zh = extractDict('zh'); en = extractDict('en');
  zhKeys = new Set(Object.keys(zh)); enKeys = new Set(Object.keys(en));
  check('i18n dictionaries exist & non-empty', zhKeys.size > 0 && enKeys.size > 0, `zh=${zhKeys.size} en=${enKeys.size}`);
  const missingEn = [...zhKeys].filter(k => !enKeys.has(k));
  const missingZh = [...enKeys].filter(k => !zhKeys.has(k));
  check('zh and en have identical key sets', missingEn.length === 0 && missingZh.length === 0,
    missingEn.length ? 'en missing: ' + missingEn.join(',') : (missingZh.length ? 'zh missing: ' + missingZh.join(',') : undefined));
} catch (e) {
  check('i18n dictionaries parse', false, String(e.message));
  zhKeys = new Set(); enKeys = new Set();
}

// every real t("key") usage (word-boundary t call) must be defined in both
const used = new Set();
const tRe = /(^|[^A-Za-z0-9_$.])t\(\s*"([^"]+)"\s*(?:\)|,)/g;
let mm;
while ((mm = tRe.exec(client))) used.add(mm[2]);
const missingDef = [...used].filter(k => !zhKeys.has(k) || !enKeys.has(k));
check('all t("key") usages have zh+en definitions', missingDef.length === 0, missingDef.length ? 'missing: ' + missingDef.join(',') : `${used.size} keys used`);

// no CJK literal remains outside the dictionary (UI fully localized)
const i18nEnd = client.lastIndexOf('// ------------------------------------------------------------ /i18n');
const render = client.slice(i18nEnd + 1);
const cjkRe = /"[^"\n]*[\u4e00-\u9fff][^"\n]*"/g;
const cjk = [];
let c;
while ((c = cjkRe.exec(render))) {
  const lineStart = render.lastIndexOf('\n', c.index) + 1;
  const line = render.slice(lineStart, c.index);
  if (!line.trim().startsWith('//')) cjk.push(c[0]);
}
check('no CJK UI literal left outside dictionary', cjk.length === 0, cjk.length ? cjk.slice(0, 10).join(' | ') : undefined);

// dictionary has no dead keys (excluding voice.*/baseVoice.* data labels and lang labels used only in the switcher)
// host.* keys are resolved DYNAMICALLY (hostErrText(t(i18n.code)) and
// t("host.phase." + phaseKey)) so they won't appear as literal t("host.x")
// calls; they are part of the host<->client i18n contract. Exclude them here.
const dead = [...zhKeys].filter(k =>
  used.has(k) ? false
  : /^voice\.|^baseVoice\.|^host\./.test(k) ? false
  : true);
check('dictionary has no dead keys (excluding voice/baseVoice/host data)', dead.length === 0, dead.length ? 'dead: ' + dead.join(',') : undefined);
// host.* keys form a complete bi-dictionary set (already covered by the
// identical-key-sets check); also ensure the handful the client references
// statically are present.
const hostStatic = ["host.phase.model", "host.phase.index", "host.phase.prepare"];
check('host.* phase keys present in both langs', hostStatic.every(k => zhKeys.has(k) && enKeys.has(k)));

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} i18n checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
