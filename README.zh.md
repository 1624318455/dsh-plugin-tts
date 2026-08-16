<p align="center">
  <img src="logo.png" alt="dsh-plugin-tts" width="140" />
</p>

<h1 align="center">dsh-plugin-tts</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="license"></a>
  <a href="https://github.com/awesome-dsh-plugin/awesome-dsh-plugin"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-22%2B-blue" alt="node"></a>
  <a href="tests/smoke.mjs"><img src="https://img.shields.io/badge/tests-37%20passed-success" alt="tests"></a>
  <a href="https://github.com/1624318455/dsh-plugin-tts"><img src="https://img.shields.io/github/stars/1624318455/dsh-plugin-tts" alt="stars"></a>
  <a href="https://github.com/1624318455/dsh-plugin-tts/commits/main"><img src="https://img.shields.io/github/last-commit/1624318455/dsh-plugin-tts" alt="last commit"></a>
</p>

## 跳转

- **[English README](README.md)**（English）
- **[RVC 自定义音色指南](docs/RVC-GUIDE.md)**（自定义音色 · 分块渐进播放 · 紧凑索引 · 音色包 · 便携运行时）
- **[使用手册（执行手册）](docs/USER-GUIDE.md)**（第一次用，逐步骤上手）
- **[自适应分块设计文档](docs/adaptive-chunked-playback.md)**（长文无缝朗读的设计与实测）

---

# dsh-plugin-tts — Edge TTS + RVC 语音大集成

DeepSeek Harness 语音插件：给 AI 回复加朗读——开箱即用微软免费在线音色（Edge TTS），
也能用**你自己训练的 RVC 音色**朗读；长回复**自适应分块渐进播放、段间无缝**；
音色可**从音色包仓库一键安装**；还提供**免装 RVC WebUI 的便携运行时**。

> 📖 **第一次用？看[《使用手册（执行手册）》](docs/USER-GUIDE.md)**——每一步都有
> "做什么 / 怎么做 / 怎么算成功"，从朗读、RVC 音色到音色包下载全覆盖。


## 单条朗读和自动朗读
![alt text](Snipaste_2026-08-16_13-29-01.png)
![alt text](Snipaste_2026-08-16_13-29-11.png)

## RVC配置
![alt text](Snipaste_2026-08-16_13-28-10.png)

## RVC高级参数
![alt text](Snipaste_2026-08-16_13-28-23.png)

## RVC音色包
![alt text](Snipaste_2026-08-16_13-28-37.png)

## 功能

1. **消息朗读按钮**：每条 AI 回复左下角操作行新增「朗读」按钮，点击朗读该条消息
   （按钮显示音柱跳动动画），再次点击停止。
2. **自动朗读开关**：输入框左下角的喇叭按钮；开启后每条新完成的 AI 回复自动朗读
   （按钮带圆形高亮），关闭则不自动朗读。
3. **语音设置面板**：侧边栏「设置 → 插件」新增「语音」标签页：
   - **TTS提供者**：Edge TTS（免费在线）/ 自定义音色（RVC）
   - **朗读音色**：22 个经实测可用的 Edge TTS 音色（默认 晓萱 zh-CN-XiaoxuanNeural）
   - **声音调节**：语速 / 音调 / 音量（0 = 默认）
   - **音色包**：从音色包仓库一键下载安装音色
   - **试听测试**：输入文本 + 播放按钮（播放中显示旋转 loading，可点击停止；失败时红字提示）
4. **RVC 自定义音色**：用你自己训练的 RVC 模型朗读，全程本机计算，支持上传原声、
   免索引模式、高级参数（详见[《RVC 指南》](docs/RVC-GUIDE.md)）。
5. **长文本无缝朗读**：自适应分块渐进播放——探测校准块大小、边播边合成、Web Audio
   采样级拼接、段间无停顿（详见[设计文档](docs/adaptive-chunked-playback.md)）。

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

## 可用音色（经实测，Edge TTS）

| 区域     | 音色                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 简体中文 | 晓萱 Xiaoxuan · 晓伊 Xiaoyi · 云希 Yunxi · 云扬 Yunyang · 晓晓 Xiaoxiao · 云健 Yunjian · 云夏 Yunxia · 晓北(辽宁) liaoning-Xiaobei · 晓妮(陕西) shaanxi-Xiaoni |
| 台湾     | 曉臻 HsiaoChen · 曉雨 HsiaoYu · 雲哲 YunJhe                                                                                                                    |
| 香港     | 曉佳 HiuGaai · 曉曼 HiuMaan · 雲龍 WanLung                                                                                                                     |
| 英文     | Aria · Jenny · Guy · Sonia(英)                                                                                                                                 |
| 日/韩/法 | 七海 Nanami · SunHi · Denise                                                                                                                                   |

> 注：Xiaohan / Xiaomeng / Xiaorui / Xiaoshuang 等旧音色已被 Edge 端点移除（返回
> `1007 Unsupported voice`），未列入。

## 架构

| 层     | 位置            | 职责                                                                                                                                                                              |
| ------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host   | `lib/index.mjs` | 注册 `/dsh-tts-api/speak`（合成/分块队列）、`/dsh-tts-audio/<id>`（音频）、`/dsh-tts-api/rvc-*`（RVC 推理/文件/紧凑索引/音色包）等 webServer 路由；用 `node -e` 运行零依赖 worker |
| Client | `lib/client.js` | `shell.overlay` 隐藏 `<audio>` 宿主 + UI（朗读按钮 / 自动朗读开关 / 语音设置面板），通过 `fetch` 调 Host 路由                                                                     |

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

## RVC 自定义音色

用你本地训练的 **RVC 模型**做音色转换：设置面板把 TTS提供者切到「自定义音色（RVC）」
即可。涵盖**服务启动、面板配置、长文无缝播放、紧凑索引、音色包一键安装、便携运行时、
设置项详解与排查**——完整内容见 **[《RVC 自定义音色指南》](docs/RVC-GUIDE.md)**。

> 公开音色仓库示例：[rvc-for-tts](https://github.com/1624318455/rvc-for-tts)
> （设置 → 语音 → 音色包 → 仓库地址填 `https://raw.githubusercontent.com/1624318455/rvc-for-tts/main`）。

## 疑难排查（Edge TTS）

- **403 / `Sec-MS-GEC` 被拒**：Edge 端点协议或版本校验变更，更新
  `lib/index.mjs` 内 worker 的 `CHROMIUM_FULL_VERSION` / `TRUSTED_CLIENT_TOKEN`。
- **`1007 Unsupported voice`**：所选音色已被端点移除，换用上表列出的音色。
- **无声音**：确认系统音量、浏览器自动播放策略（先与页面交互一次）或合成日志
  （`dsh web` 控制台 `[tts]` 前缀错误）。

> RVC 相关排查见 [《RVC 指南》疑难排查](docs/RVC-GUIDE.md#rvc-疑难排查)。

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

- 音色 / 自动朗读开关状态保存在内存（动态设置面板，不落盘），刷新页面后复位默认值；
  音色包相关设置（仓库地址/代理/进行中下载）会记忆在 localStorage。
- 合成音频写入 OS 临时目录，由系统清理。

## License

MIT
