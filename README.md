<p align="center">
  <img src="logo.png" alt="dsh-plugin-tts" width="140" />
</p>

<h1 align="center">dsh-plugin-tts</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="license"></a>
  <a href="https://github.com/awesome-dsh-plugin/awesome-dsh-plugin"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-22%2B-blue" alt="node"></a>
  <a href="tests/smoke.mjs"><img src="https://img.shields.io/badge/tests-4%20passed-success" alt="tests"></a>
  <a href="https://github.com/1624318455/dsh-plugin-tts"><img src="https://img.shields.io/github/stars/1624318455/dsh-plugin-tts" alt="stars"></a>
  <a href="https://github.com/1624318455/dsh-plugin-tts/commits/main"><img src="https://img.shields.io/github/last-commit/1624318455/dsh-plugin-tts" alt="last commit"></a>
</p>

<p align="center"><strong><a href="#中文">中文</a> | <a href="#english">English</a></strong></p>

---

<a name="中文"></a>

# dsh-plugin-tts — Edge TTS 语音大集成

基于 Microsoft Edge 在线 TTS（node-edge-tts 协议）的
DeepSeek Harness 语音插件：给 AI 回复加朗读，支持逐条手动朗读与自动朗读。

## 功能

1. **消息朗读按钮**：每条 AI 回复左下角操作行（复制 / 好的回答 / 有问题的回答 / 在新对话中分支 之间）
   新增「朗读」按钮，点击朗读该条消息（按钮显示音柱跳动动画），再次点击停止。
2. **自动朗读开关**：输入框左下角、命令按钮与权限选择按钮之间的喇叭按钮；
   开启后每条新完成的 AI 回复自动朗读（按钮带圆形高亮），关闭则不自动朗读。
3. **语音设置面板**：侧边栏「设置 → 插件」新增「语音」标签页：
   - **TTS提供者**：Edge TTS
   - **声色**：22 个经实测可用的 Edge TTS 音色（默认 晓萱 zh-CN-XiaoxuanNeural）
   - **试听测试**：输入文本 + 播放按钮（播放中显示旋转 loading，可点击停止；失败时红字提示）

## 要求

- DeepSeek Harness `web` profile（`dsh web`）
- Node.js ≥ 22（worker 使用原生 `WebSocket`）

## 安装

```sh
# 已发布到 GitHub 后：
dsh plugin --profile web add "github:1624318455/dsh-plugin-tts#main"
# 或本地开发：
dsh plugin --profile web add "file:/path/to/dsh-plugin-tts"
```

重启 `dsh web` 后作为 profile bundle 自动加载，无需手动启用。

## 可用音色（经实测）

| 区域 | 音色 |
|---|---|
| 简体中文 | 晓萱 Xiaoxuan · 晓伊 Xiaoyi · 云希 Yunxi · 云扬 Yunyang · 晓晓 Xiaoxiao · 云健 Yunjian · 云夏 Yunxia · 晓北(辽宁) liaoning-Xiaobei · 晓妮(陕西) shaanxi-Xiaoni |
| 台湾 | 曉臻 HsiaoChen · 曉雨 HsiaoYu · 雲哲 YunJhe |
| 香港 | 曉佳 HiuGaai · 曉曼 HiuMaan · 雲龍 WanLung |
| 英文 | Aria · Jenny · Guy · Sonia(英) |
| 日/韩/法 | 七海 Nanami · SunHi · Denise |

> 注：Xiaohan / Xiaomeng / Xiaorui / Xiaoshuang 等旧音色已被 Edge 端点移除（返回
> `1007 Unsupported voice`），未列入。

## 架构

| 层 | 位置 | 职责 |
|---|---|---|
| Host | `lib/index.mjs` | 注册 `POST /dsh-tts-api/speak`（合成）与 `GET /dsh-tts-audio/<id>`（音频）两条 webServer 路由；用 `node -e` 运行零依赖 worker |
| Client | `lib/client.js` | `shell.overlay` 隐藏 `<audio>` 宿主 + 三处 UI（朗读按钮 / 自动朗读开关 / 语音设置面板），通过 `fetch` 调 Host 路由 |

TTS 引擎：worker 协议镜像 [node-edge-tts@1.2.10](https://github.com/SchneeHertz/node-edge-tts)：
`Sec-MS-GEC` 查询参数（ticks 向下取整到 5 分钟边界）、
`Sec-MS-GEC-Version=1-143.0.3650.75`、二进制帧 `Path:audio` 前缀、
`xml:lang` 由音色 locale 推导、1006 异常关闭自动重试一次。音频输出
`audio-24khz-48kbitrate-mono-mp3`。

## 边界行为

- 自动朗读中点击同一消息朗读按钮 → 停止；点击另一消息 → 打断自动、改手动朗读。
- 手动朗读中关闭自动开关 → **不打断**手动；自动朗读中关闭 → 停止自动朗读。
- 新消息完成（自动开启）→ 打断当前、朗读最新；无文本消息跳过；切换会话只停自动来源。
- 合成/播放失败 → 静默清理状态并恢复图标（试听面板内会显示红字提示）。

## 疑难排查

- **403 / `Sec-MS-GEC` 被拒**：Edge 端点协议或版本校验变更，更新
  `lib/index.mjs` 内 worker 的 `CHROMIUM_FULL_VERSION` / `TRUSTED_CLIENT_TOKEN`。
- **`1007 Unsupported voice`**：所选音色已被端点移除，换用上表列出的音色。
- **无声音**：确认系统音量、浏览器自动播放策略（先与页面交互一次）或合成日志
  （`dsh web` 控制台 `[tts]` 前缀错误）。

## 开发

```sh
node tests/smoke.mjs   # 冒烟测试：fake ctx 注册路由 + 真实 Edge TTS 合成 + 音频回放断言
```

改 `lib/` 后的热更新（Windows 下 `file:` 安装是**复制**而非符号链接，
运行中的 dsh 读的是 profile 副本）：

```powershell
Copy-Item lib/* $env:USERPROFILE\.dsh\profiles\web\node_modules\@dsh-external\dsh-plugin-tts\lib\ -Recurse -Force
# 然后刷新浏览器即可（bundle 每次请求重新读盘；勿用 pnpm install --force 覆盖）
```

## 已知限制

- 音色 / 自动朗读开关状态保存在内存（动态设置面板，不落盘），刷新页面后复位默认值。
- 合成音频写入 OS 临时目录，由系统清理。

## License

MIT

---

<a name="english"></a>

# dsh-plugin-tts — Edge TTS voice integration for DeepSeek Harness

A dual-sided (Host + Web UI) DeepSeek Harness plugin that reads assistant
replies aloud using Microsoft Edge's online TTS (node-edge-tts protocol —
free, no API key).

## Features

1. **Read-aloud button** on every finalized assistant message (in the
   copy / feedback / branch action row): click to speak that message (the
   button shows an animated equalizer), click again to stop.
2. **Auto-read toggle** in the composer tool row (between the command and the
   access-mode buttons): when on, every newly completed assistant reply is
   read aloud automatically (the toggle gets a circular highlight); when off,
   nothing is auto-read.
3. **Voice settings panel** under 设置 → 插件 → 语音:
   - **TTS provider**: Edge TTS (free, no API key)
   - **Voice**: 22 live-verified Edge TTS voices (default 晓萱 zh-CN-XiaoxuanNeural)
   - **Preview**: type text and press the play (triangle) button — a spinning
     loader shows while it is synthesizing/playing (click again to stop),
     failures show an inline message.

## Requirements

- DeepSeek Harness `web` profile (`dsh web`)
- Node.js >= 22 (the worker uses the native `WebSocket`)

## Install

```sh
# published form:
dsh plugin --profile web add "github:1624318455/dsh-plugin-tts#main"
# or local development:
dsh plugin --profile web add "file:/path/to/dsh-plugin-tts"
```

Restart `dsh web`; the plugin then loads automatically as a profile bundle.

## Voices (live-verified)

| Region | Voices |
|---|---|
| Simplified Chinese | Xiaoxuan 晓萱 · Xiaoyi 晓伊 · Yunxi 云希 · Yunyang 云扬 · Xiaoxiao 晓晓 · Yunjian 云健 · Yunxia 云夏 · liaoning-Xiaobei 晓北 · shaanxi-Xiaoni 晓妮 |
| Taiwan | HsiaoChen 曉臻 · HsiaoYu 曉雨 · YunJhe 雲哲 |
| Hong Kong | HiuGaai 曉佳 · HiuMaan 曉曼 · WanLung 雲龍 |
| English | Aria · Jenny · Guy · Sonia (UK) |
| Other | Nanami 七海 (ja-JP) · SunHi (ko-KR) · Denise (fr-FR) |

> Note: legacy voices such as Xiaohan / Xiaomeng / Xiaorui / Xiaoshuang were
> removed by the Edge endpoint (`1007 Unsupported voice`) and are not listed.

## Architecture

| Layer | Location | Role |
|---|---|---|
| Host | `lib/index.mjs` | Registers `POST /dsh-tts-api/speak` (synthesis) and `GET /dsh-tts-audio/<id>` (audio) webServer routes; runs a zero-dependency worker via `node -e` |
| Client | `lib/client.js` | Hidden `<audio>` host in `shell.overlay` + the three UI entries; talks to the Host through `fetch` |

The TTS worker mirrors [node-edge-tts@1.2.10](https://github.com/SchneeHertz/node-edge-tts):
`Sec-MS-GEC` query params (ticks rounded to the 5-minute boundary),
`Sec-MS-GEC-Version=1-143.0.3650.75`, `Path:audio` binary framing, `xml:lang`
derived from the voice locale, one retry on abnormal (1006) closures. Audio is
`audio-24khz-48kbitrate-mono-mp3`.

## Edge cases handled

- Clicking the read button of the message being auto-read stops it; another
  message's button switches to manual reading.
- Disabling auto-read never interrupts a manual read; it stops auto reads.
- A newly completed message (auto on) interrupts the current read; text-less
  messages are skipped; session switches only stop auto reads.
- Synthesis / playback failures silently reset the icon state (the preview
  panel shows an inline error message).

## Troubleshooting

- **403 / `Sec-MS-GEC` rejected**: the Edge endpoint protocol or version check
  changed; update `CHROMIUM_FULL_VERSION` / `TRUSTED_CLIENT_TOKEN` inside the
  worker in `lib/index.mjs`.
- **`1007 Unsupported voice`**: the selected voice was removed from the
  endpoint; pick one from the table above.
- **No sound**: check system volume, the browser autoplay policy (interact
  with the page once), or the synthesis logs (`[tts]` errors in the `dsh web`
  console).

## Development

```sh
node tests/smoke.mjs   # fake-ctx route registration + real Edge TTS synthesis + audio serve assertions
```

Hot-reload after editing `lib/` (on Windows a `file:` install is a COPY, not a
symlink, so the running dsh reads the profile copy):

```powershell
Copy-Item lib/* $env:USERPROFILE\.dsh\profiles\web\node_modules\@dsh-external\dsh-plugin-tts\lib\ -Recurse -Force
# then refresh the browser (bundles are re-read from disk per request; never use pnpm install --force)
```

## Known limits

- Voice / auto-read toggle state is in-memory (dynamic settings, no disk
  persistence); a page refresh resets the defaults.
- Synthesized audio is written to the OS temp dir and cleaned by the OS.

## License

MIT
