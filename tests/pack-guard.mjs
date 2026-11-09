// pack-guard.mjs — npm 发布包内容守卫
//
// 这个目录同时是「开发仓库」和「npm 发布源」。package.json 的 files 白名单决定
// 用户 npm install 到底拿到什么。没有守卫时，tests/、CI 配置、真机探针、截屏、
// 内部分析文档会悄悄混进 tarball（0.7.0 之前实测 70 个文件 / 739KB）。
//
//   node tests/pack-guard.mjs
//
// 只调 `npm pack --dry-run --json`：不写盘、不联网、不需要装依赖。

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// Windows 的 npm 是 npm.cmd，必须走 shell 才能被 execFile 找到。
let packed;
try {
  const stdout = execFileSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['pack', '--dry-run', '--json'],
    { cwd: root, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  packed = JSON.parse(stdout.trim())[0].files.map(f => f.path);
} catch (e) {
  console.error('FAIL  npm pack --dry-run --json 执行失败：' + (e.message || e));
  process.exit(1);
}
const has = f => packed.includes(f);

// ---- 运行时必需 ------------------------------------------------------------
const required = [
  'lib/index.mjs',
  'lib/client.js',
  'rvc-server.py',
  'cordis.patch.yml',
  'package.json',
  'README.md',
  'README.zh.md',
  'LICENSE',
  // 可选组件：GPT-SoVITS 用户唯一的对接方式，文档让用户直接跑它。
  'tools/gpt-sovits-openai-gateway.py',
];
for (const f of required) check(`必须包含 ${f}`, has(f));

// 用户向指南必须随包分发；设计稿、测试计划、验收清单、给 LLM 的测试 prompt
// 只对维护者有用，且内含本机实测记录，一律不进 tarball。用白名单反查，
// 以后往 docs/ 新增内部文档时默认被拦，不会又悄悄漏出去。
const requiredDocs = [
  'USER-GUIDE.md',
  'RVC-GUIDE.md',
  'EDGE-GUIDE.md',
  'CLOUD-GUIDE.md',
  'COSYVOICE-GUIDE.md',
  'INDEX-TTS2-GUIDE.md',
  'OPENAI-COMPAT-GUIDE.md',
];
for (const d of requiredDocs) check(`必须包含 docs/${d}`, has(`docs/${d}`));
const extraDocs = packed
  .filter(f => /^docs\/.*\.md$/.test(f))
  .filter(f => !requiredDocs.includes(f.slice('docs/'.length)));
check('docs/ 只含用户向指南', extraDocs.length === 0, extraDocs.length ? extraDocs.join(', ') : undefined);

// ---- exports / main 声明的每个目标都必须在包内 -----------------------------
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const declared = new Set([pkg.main].filter(Boolean));
(function walk(v) {
  if (typeof v === 'string' && v.startsWith('./')) declared.add(v.slice(2));
  else if (v && typeof v === 'object') Object.values(v).forEach(walk);
})(pkg.exports);
for (const f of [...declared].sort()) check(`声明路径在包内 ${f}`, has(f));

// ---- 开发专用内容一律不许进包 ----------------------------------------------
const forbidden = [
  [/^tests\//, '测试与真机探针'],
  [/^\.github\//, 'CI 配置'],
  [/^tools\/(?!gpt-sovits-openai-gateway\.py$)/, '维护者工具 / mock / 自检脚本'],
  [/^\.tmp-ui\//, '本地草稿'],
  [/^Snipaste_/, '临时截屏'],
  [/^(ANALYSIS|TODO|PR-REVIEW)\.md$/, '内部分析文档'],
  [/^pnpm-workspace\.yaml$/, '工作区配置'],
  [/\.pyc$|^__pycache__\//, 'Python 缓存'],
];
for (const [re, label] of forbidden) {
  const hits = packed.filter(f => re.test(f));
  check(`排除 ${label}`, hits.length === 0, hits.length ? hits.join(', ') : undefined);
}

// ---- 包内 Markdown 不能有指向包外文件的相对链接 ----------------------------
// npm 用户拿到的是 tarball，不是整个仓库。README 里的截图、设计稿、测试计划
// 一旦用相对路径引用，安装后就是死链。统一改成在线链接或文字说明。
const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<img[^>]+src="([^"]+)"/g;
const deadLinks = [];
for (const f of packed.filter(f => f.endsWith('.md'))) {
  const src = readFileSync(path.join(root, f), 'utf8');
  for (const m of src.matchAll(LINK_RE)) {
    const t = (m[1] || m[2]).split('#')[0].split('?')[0];
    if (!t || /^(https?:|mailto:|data:|#)/i.test(t)) continue;
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(f), t));
    if (!packed.includes(rel)) deadLinks.push(`${f} -> ${t}`);
  }
}
check('包内文档无相对死链', deadLinks.length === 0,
  deadLinks.length ? [...new Set(deadLinks)].slice(0, 8).join(', ') : undefined);

check(`包内文件数受控（${packed.length} ≤ 20）`, packed.length <= 20);

const bad = results.filter(r => !r.ok);
console.log(`\n${bad.length ? 'FAIL' : 'OK'}: ${results.length - bad.length}/${results.length} 通过；发布包 ${packed.length} 个文件`);
if (bad.length) process.exit(1);
