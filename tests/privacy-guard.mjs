// privacy-guard.mjs — 开源仓库的隐私守卫
//
// 这是公开仓库。真机调试时很容易把 Windows 用户名、本机绝对路径、私人会话截图、
// 或临时 token 顺手提交进去。这类信息对别人没用，对作者是隐私泄露。
//
//   node tests/privacy-guard.mjs
//
// 扫描所有 git 已跟踪的文本文件；只做静态检查，不联网、不写盘。
// 允许的形式：~/.dsh/...、$env:USERPROFILE、C:/Users/<you>/... 这类通用占位，
// 以及 http://127.0.0.1:<port> 这类本地服务示例。

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'tests/privacy-guard.mjs';
const TEXT_EXT = /\.(md|mjs|cjs|js|py|yml|yaml|json|sh|txt|bat|ps1|toml|cfg)$/i;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

let tracked;
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .trim().split(/\r?\n/).filter(Boolean);
} catch (e) {
  console.error('FAIL  git ls-files 执行失败：' + (e.message || e));
  process.exit(1);
}

// ---- 不允许被跟踪的文件（真机产物 / 凭据） --------------------------------
const BAD_FILES = [
  [/^(?:Snipaste_|tests\/live-).*\.(png|jpe?g|webp)$/i, '真机 GUI 截图（含会话内容/本机路径/工作台状态）'],
  [/\.credentials\.|^credentials\.ya?ml$|\.env(\.|$)/i, '凭据文件'],
  [/^\.tmp-ui\//, '本地草稿目录'],
  [/\.(pth|index|wav|mp3)$/i, '模型/音频二进制产物'],
];
for (const [re, label] of BAD_FILES) {
  const hits = tracked.filter(f => re.test(f));
  check(`不跟踪 ${label}`, hits.length === 0, hits.length ? hits.join(', ') : undefined);
}

// ---- 正文里的本机/个人信息 -------------------------------------------------
// 用拼接构造，避免本文件自己命中自己的规则；同时仍排除自身以求稳。
const LOCAL_USER = ['meme', 'flyfly'].join('');
const RULES = [
  [new RegExp('C:[\\\\/]Users[\\\\/](?!<|\\$|%|\\{)[A-Za-z0-9._-]{2,}', 'gi'), 'Windows 用户名绝对路径'],
  [/[A-Za-z]:[\\/](?:Work|QuarkDownload|GPT-SoVITS)[\\/]/gi, '本机工作目录绝对路径'],
  [/\/[a-z]\/Work\/ForAI\//gi, 'MSYS 形式的工作区绝对路径'],
  [new RegExp('\\b' + LOCAL_USER + '\\b', 'g'), '本地用户名'],
  [/(?:token|secret|api[_-]?key|password)\s*[:=]\s*['"][A-Za-z0-9_-]{24,}['"]/gi, '疑似硬编码凭据'],
];

// Edge TTS 协议里 TRUSTED_CLIENT_TOKEN 是微软公开的客户端常量，所有 edge-tts
// 实现都用同一个值，不是任何人的私钥。别让守卫把它当成泄露的凭据。
const PUBLIC_CONSTANTS = [/TRUSTED_CLIENT_TOKEN/, /CHROMIUM_FULL_VERSION/];
const isPublicConstant = line => PUBLIC_CONSTANTS.some(re => re.test(line));

const textFiles = tracked.filter(f => f !== SELF && TEXT_EXT.test(f));
for (const [re, label] of RULES) {
  const hits = [];
  for (const f of textFiles) {
    const lines = readFileSync(path.join(root, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (isPublicConstant(line)) return;
      re.lastIndex = 0;
      if (re.test(line)) hits.push(`${f}:${i + 1}`);
    });
  }
  check(`正文不含 ${label}`, hits.length === 0, hits.length ? hits.slice(0, 8).join(', ') : undefined);
}

check(`已扫描 ${textFiles.length} 个文本文件`, textFiles.length > 0);

const bad = results.filter(r => !r.ok);
console.log(`\n${bad.length ? 'FAIL' : 'OK'}: ${results.length - bad.length}/${results.length} 通过`);
if (bad.length) process.exit(1);
