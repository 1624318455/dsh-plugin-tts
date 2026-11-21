<p align="center">
  <img src="https://raw.githubusercontent.com/1624318455/dsh-plugin-tts/main/logo.png" alt="dsh-plugin-tts" width="140" />
</p>

<h1 align="center">dsh-plugin-tts</h1>

<p align="center">
  给 DeepSeek Harness 的回复加朗读——开箱即用微软 Edge TTS，<br />
  想要自己的音色时再接本机克隆。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="license" /></a>
  <a href="https://github.com/1624318455/dsh-plugin-tts/actions/workflows/test.yml"><img src="https://github.com/1624318455/dsh-plugin-tts/actions/workflows/test.yml/badge.svg" alt="tests" /></a>
  <a href="https://www.npmjs.com/package/@memef1f1y/dsh-plugin-tts"><img src="https://img.shields.io/npm/v/@memef1f1y/dsh-plugin-tts" alt="npm" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-22%2B-blue" alt="node" /></a>
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome" /></a>
  <a href="https://github.com/1624318455/dsh-plugin-tts/stargazers"><img src="https://img.shields.io/github/stars/1624318455/dsh-plugin-tts" alt="stars" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <b>简体中文</b>
</p>

---

一个 Host + Web UI 双侧插件，给 DSH web 界面里的每条 AI 回复加朗读。默认走
Edge TTS，**零配置**就能用；想要特定音色时，再接本机链路——RVC 自己训练的模型、
Index-TTS2 / CosyVoice / GPT-SoVITS 的参考音频克隆。长回复**自适应分块渐进播放**，
不必等整段合成完才出声。

## 六种音色后端，一个设置面板

在 设置 → 插件 → 语音 里切换。只有第一行不需要装任何东西。

| 后端 | 合成在哪 | 前置条件 | 音色来源 |
|---|---|---|---|
| **Edge TTS**（默认） | 微软，在线，免费 | —— 什么都不用 | 22 个实测可用音色 |
| **Google Cloud TTS** | 谷歌，在线，按量付费 | 自备 API Key | 8 个 cmn-CN 音色，也可手输任意 voice id |
| **RVC** | 本机 | RVC 便携运行时 + `rvc-server.py`（4892） | 你自己训练的模型（`.pth`） |
| **Index-TTS2** | 本机 | 本机 `index-tts2` API 服务（7880） | 一段参考音频 |
| **CosyVoice 2.0** | 本机 | 本机 `cosy-server.py`（7890） | 提示音频 + 对应文字稿 |
| **GPT-SoVITS** | 本机 | 本机 `api_v2.py`（9880） | 一段参考音频 |

本地后端各自需要自己的服务包跑起来，Edge 与 Cloud 不需要。端口是默认值，面板里可改。
**不需要显卡**——CPU 就能跑，Apple Silicon 的 MPS 或 NVIDIA GPU 只是更快。

RVC 面板填这些：服务地址（默认 `http://127.0.0.1:4892`）、原声来源、模型 `.pth`、
可选 `.index`，以及一个折叠的高级参数面板（说话人 ID、f0 方法、变调、索引权重、
输出采样率、响度混合、辅音保护、滤波半径、F0 曲线文件）。免索引模式不填 `.index` 也能用。

→ 各后端指南：[Edge](docs/EDGE-GUIDE.md) · [RVC](docs/RVC-GUIDE.md) ·
[Index-TTS2](docs/INDEX-TTS2-GUIDE.md) · [CosyVoice](docs/COSYVOICE-GUIDE.md) ·
[GPT-SoVITS](docs/GPT-SOVITS-GUIDE.md) · [Cloud](docs/CLOUD-GUIDE.md)

## 安装

```sh
# npm 包（推荐）
dsh plugin --profile web add "@memef1f1y/dsh-plugin-tts"

# 或直接用 GitHub 源码
dsh plugin --profile web add "github:1624318455/dsh-plugin-tts#main"

# 或本地开发
dsh plugin --profile web add "file:/path/to/dsh-plugin-tts"
```

重启 `dsh web` 后作为 profile bundle 自动加载，无需手动启用。dsh-market 界面里搜包名安装也行。

> 换来源前先卸载已有的：三种方式注册的是同一个 loader 条目 id（`tts`），
> 安装器遇到重复 id 会直接回滚，不会覆盖。

## 能做什么

**朗读**

- 每条已完成的 AI 回复都有**朗读按钮**——点一下读该条（播放中显示音柱跳动），再点停止。
- 输入框那一行有**自动朗读开关**。开启：每条新完成的回复自动读；关闭：不主动读。
- **朗读选中文本**——在消息里选中文字会浮出「朗读选中」，点按只读这一段。
- 消息操作行有 **mini 播放器**：暂停 / 继续，倍速 1x / 1.25x / 1.5x。分块长读显示实时的「第 x/y 段」。
- **音频下载**——Edge / Cloud 读出的存 MP3，本地后端存 WAV（GPT-SoVITS 跟随其输出格式）。
  复用进程内缓存，刚读过的消息一点即下。
- `Esc` 或 `S`（不在输入框里时）停止当前朗读。

**长回复**

- **分块无缝播放**：探测校准块大小、边播边合成、Web Audio 采样级拼接，段与段之间听不出接缝。
  纯 Edge 长文本同样走这条流水线——第一块先响，其余边播边合成，不再干等。
- **智能分句**绝不切断 URL、邮箱、小数、版本号（如「3.14」）；硬切会滑到词/标点边界，
  末尾极短的句子并入前一块，避免听感像结巴。

**音色**

- **音色包一键安装**：填仓库地址 →「获取列表」→「下载并启用」，不用手工搬文件。
  公开示例：[rvc-for-tts](https://github.com/1624318455/rvc-for-tts)
  （仓库地址填 `https://raw.githubusercontent.com/1624318455/rvc-for-tts/main`）。
- **试听**任意音色：输入文本点播放，播放中显示旋转 loading，失败红字内联提示。
- **声音调节**：语速 / 音调 / 音量（0 = 提供者默认），Edge 与 Cloud 共用。

**设置、语言与安全**

- **设置面板**带**搜索框**，按关键字过滤配置项，无命中的分区自动折叠。
- **界面语言**：自动（跟随浏览器）/ 中文 / English，切换立即生效并持久化。
- **一键诊断**覆盖所有后端，结果可一键复制；也可导出诊断 JSON，报 issue 时直接附上。
- **审批语音提醒**（opt-in，默认关闭）：审批请求会朗读并**打断当前朗读**——Agent 正在等你决定；
  审批结果只在空闲时播报。固定走 Edge TTS、用自己的提醒音色、按审批 id 去重。
- **干净朗读**：朗读前清洗消息 Markdown（代码块、表格、链接、引用、任务列表），
  可选开关保留逐字朗读原始符号（适合读源码）。
- **默认安静**：Edge 模式下整个 RVC 区块收在「需要克隆音色？」一行入口后面，
  普通朗读零配置零感知。

## Edge TTS 音色（经实测）

22 个音色实测可用，默认 晓萱 `zh-CN-XiaoxuanNeural`。

| 区域 | 音色 |
|---|---|
| 简体中文 | 晓萱 Xiaoxuan · 晓伊 Xiaoyi · 云希 Yunxi · 云扬 Yunyang · 晓晓 Xiaoxiao · 云健 Yunjian · 云夏 Yunxia · 晓北(辽宁) liaoning-Xiaobei · 晓妮(陕西) shaanxi-Xiaoni |
| 台湾 | 曉臻 HsiaoChen · 曉雨 HsiaoYu · 雲哲 YunJhe |
| 香港 | 曉佳 HiuGaai · 曉曼 HiuMaan · 雲龍 WanLung |
| 英文 | Aria · Jenny · Guy · Sonia(英) |
| 其他 | 七海 Nanami (ja-JP) · SunHi (ko-KR) · Denise (fr-FR) |

Cloud TTS 另有 8 个 cmn-CN 音色（默认 `cmn-CN-Wavenet-A`），也可手输任意 voice id。

> 旧音色（Xiaohan / Xiaomeng / Xiaorui / Xiaoshuang）已被 Edge 端点移除
> （`1007 Unsupported voice`），未列入。若某个音色这样消失，插件会把它从选择列表剔除
> 并自动回退默认音色。

## 要求

- DeepSeek Harness `web` profile（`dsh web`）
- Node.js ≥ 22（worker 使用原生 `WebSocket`）
- Edge 与 Cloud 之外不需要任何东西。本地后端各自需要自己的服务包先跑起来，
  见上表与各后端指南。

## 行为说明

- 自动朗读中点击同一消息的朗读按钮 → 停止；点击另一消息 → 改为手动朗读该条。
- 手动朗读中关闭自动开关 → **不打断**手动；自动朗读中关闭 → 停止自动朗读。
- 新消息完成（自动开启）→ 打断当前、朗读最新；无文本消息跳过；切换会话只停自动来源。
- 停止或换消息时**立即取消** Host 上正在跑的分块 job，本地转换服务停止调度后续块、
  及时释放 GPU / 内存，不必等惰性回收。
- 同一段文本 + 同一音色重复朗读 → **复用进程内缓存**；若缓存文件被系统清理，
  会自动重新合成，而不是返回失效的 404。
- 分块严格按序号供应：后台预热绝不会超过按需请求；某块重试一次仍失败会弹
  「某段加载失败，已跳过 (x/y)」并继续播下一块，顺序永不错乱。
- **首次用户手势即解锁自动播放**（resume Web Audio 上下文 + 播放静音片段），
  不会被浏览器自动播放策略静默拦截。空闲时会重新挂起上下文，不再占用系统音频端点
  （这是 Windows 能正常空闲休眠的前提）。
- 合成 / 播放失败弹主题化 toast，不再静默失败。RVC 模式下 toast 带**一键「改用 Edge TTS 朗读」**；
  另有一个实验性开关可自动降级（默认关闭——RVC 为纯本地处理，自动降级会把文本发给微软）。
- **归档正在朗读的会话会停止朗读**：继续为一个用户已经看不到的对话出声是不对的；
  已被归档的会话也不会开始新的朗读。不绑定会话的朗读（设置试听、选区朗读、审批提醒）不受影响。
- 审批提醒：页面加载后第一次轮询只做基线同步，刷新不会重播旧提醒；播报失败静默，
  避免 Agent 循环期间刷屏。

## 设置持久化

分两层，是刻意的：

- **Host 文件** `~/.dsh/tts-rvc/settings.json`——
  `{ version: 1, rvc: …, index: …, cosy: …, cloud: … }`。服务类配置：RVC 服务地址 / 模型 /
  索引路径、Index-TTS2 与 CosyVoice 服务地址、Cloud API Key（+ 可选 Project ID）。
  多浏览器共享，清浏览器数据与无痕模式都不丢。经 `GET /dsh-tts-api/rvc-config` +
  `POST /dsh-tts-api/rvc-config-save`（以及对应的 `index-config`、`cosy-config`、
  `cloud-config`）读写。老 `localStorage` 值一次性上迁，之后以文件为准。
- **localStorage** `dsh-tts-settings`——只存 UI 偏好：音色、自动朗读开关、提供者、
  声音调节、原始 Markdown 开关、审批提醒与其余 RVC 偏好。**不存**服务地址 / 模型 / 索引。
- `dsh-tts-lang` 存界面语言。

「恢复默认设置」一键复位并清除两层（Host 文件为 best-effort）。

## 疑难排查

**Edge TTS**

- **403 / `Sec-MS-GEC` 被拒**——Edge 端点协议或版本校验变了，更新 `lib/index.mjs` 里 worker 的
  `CHROMIUM_FULL_VERSION` / `TRUSTED_CLIENT_TOKEN`。
- **`1007 Unsupported voice`**——所选音色已被端点移除，换用上表列出的音色。
- **`websocket error … code=1006`**——连接在没收到 close frame 的情况下被切断。这是传输层问题、
  不是插件错误：通常是代理不稳或中间设备重置了 WSS 连接。试试不走代理，或换成任一本机后端来二分。
- **无声音**——确认系统音量、浏览器自动播放策略（先与页面交互一次）、
  以及 `dsh web` 控制台里 `[tts]` 前缀的错误。

**其他一切**——设置 → 语音 → **诊断**（一键跑完所有后端）。仍然复现就导出诊断 JSON 附在 issue 里：
里面有构建号、provider 设置、逐项检查结果和最近错误日志，通常一轮就能定位，不用来回问。

→ [RVC 疑难排查](docs/RVC-GUIDE.md#rvc-疑难排查) · 各后端指南都有自己的排查节。

## 常见问题

**体积大吗？**
- 只用 Edge TTS：插件本体很小（MB 级），不需要下载任何服务或模型。
- 体积只在你主动选自定义音色时才出现。RVC 便携包自包含离线 Python 运行时、
  推理依赖与预训练模型：

  | 平台 | 压缩包 | 解压后 |
  |---|---:|---:|
  | macOS（Apple Silicon） | ~660 MB | ~1.3 GB |
  | Windows（纯 CPU 精简版） | ~1–2 GB | ~2–3 GB |
  | Windows（保留 NVIDIA GPU 加速） | ~6 GB | ~7 GB |

  对比一下：完整版 RVC WebUI 是 7.8 GB，这里只带朗读真正用到的那部分。
- Index-TTS2 / CosyVoice / GPT-SoVITS 同样是本地包，体积随版本变，见各自指南的准备节。

**好装吗？**
- 插件本身一条命令（见上）。
- 自定义音色：下载对应平台的便携包 → 解压 → 运行启动脚本（mac 双击 `.command`，
  Windows 双击 `.bat`）→ 把 `.pth` 放进 `assets/weights` → 面板里选它。
  Index-TTS2 / CosyVoice / GPT-SoVITS 是同样的三步：备包 → 保持服务运行 → 面板填参考音频。
- 无需编译，无需手动装 Python / ffmpeg。注意 **mac 首次启动会慢几十秒**
  （macOS 首次扫描解压出的运行库），之后只要几秒。

**需要付费 API 或本地模型吗？**
- Edge TTS：免费、无 API Key、无模型。
- RVC / Index-TTS2 / CosyVoice / GPT-SoVITS：完全本地推理、免费，但各自需要服务包先跑起来。
  GPT-SoVITS 尤其**不需要**任何 OpenAI / 第三方 API Key。
- Google Cloud TTS：按量付费、需自备 Key。中文标准音色每月前 400 万字符免费，
  Wavenet / Neural2 / Chirp 每月前 100 万（本地计数，官方以 Google Cloud Billing 为准），
  详见 [Cloud 指南](docs/CLOUD-GUIDE.md)。
- 参考音频类后端给的是几秒清晰人声，不是训练好的模型。

**改动 DSH 本体了吗？**
- 没有。这是独立插件，通过 dsh 的插件机制加载，不修改 DSH 主程序，
  可随时安装 / 停用 / 卸载，不影响 DSH 与其它插件。

**其他**
- **需要显卡吗？** 不需要，CPU 能跑。Apple Silicon 的 MPS 或 NVIDIA GPU（Windows，需 CUDA 版 torch）更快。
- **隐私？** RVC / Index-TTS2 / CosyVoice / GPT-SoVITS 完全本地转换，音频不出机器；
  Edge TTS 与 Cloud TTS 会把要朗读的文本发到各自在线端点合成。
- **只支持 Apple Silicon？** macOS 版目前是 arm64（M1–M5）；Intel Mac 需另行提供 x86_64 版。

## 架构

| 层 | 位置 | 职责 |
|---|---|---|
| Host | `lib/index.mjs` | 注册 webServer 路由：`/dsh-tts-api/speak`（全链路合成 / 分块队列）、`/dsh-tts-audio/<id>`（音频字节）、`/dsh-tts-api/rvc-next`（取下一块 / 取消）、`/dsh-tts-api/rvc-files` + `/rvc-compact-index` + `/rvc-packs*`（RVC 代理 / 音色包）、`/dsh-tts-api/index-*` 与 `/dsh-tts-api/cosy-*`（本地服务代理 + 配置）、`/dsh-tts-api/cloud-*`（Cloud Key / 用量 / 连通测试）、`/dsh-tts-api/gsv-*`（GPT-SoVITS 配置 / 试听）、`/dsh-tts-api/notify`（审批提醒队列）、`/dsh-tts-api/diagnose`（一键诊断）。Edge worker 用 `node -e` 跑，零依赖。 |
| Client | `lib/client.js` | `shell.overlay` 里的 Web Audio 分块播放器（采样级拼接，`<audio>` 降级）+ UI（朗读按钮 / 自动朗读开关 / 设置面板），通过 `fetch` 调 Host 路由。 |

Edge worker 的协议镜像 [node-edge-tts@1.2.10](https://github.com/SchneeHertz/node-edge-tts)：
`Sec-MS-GEC` 查询参数（ticks 向下取整到 5 分钟边界）、
`Sec-MS-GEC-Version=1-143.0.3650.75`、二进制帧 `Path:audio` 前缀、
`xml:lang` 由音色 locale 推导、1006 异常关闭自动重试一次。
音频输出 `audio-24khz-48kbitrate-mono-mp3`。

## 开发

```sh
node tests/smoke.mjs    # fake ctx 注册路由 + 真实 Edge 合成 + 音频回放断言
npm run test:all        # 全量：smoke / live / patch / i18n / client / archive / gsv / gsv-e2e / pack / privacy / slots / audio
npm run test:pack       # 发布包内容守卫（哪些文件会被 npm install 装到用户机器上）
npm run test:privacy    # 隐私守卫（本机用户名 / 绝对路径 / 真机截图 / 凭据不许进仓库）
```

测试只能在源码仓库里跑。npm 发布包按 `package.json` 的 `files` 白名单裁剪：
`lib/`、`rvc-server.py`、`cordis.patch.yml`、`docs/` 下 7 份用户指南、两个 README 与许可证。
设计稿、UI 审计记录、验收清单、`docs/maintainer/` 下的维护者文档都留在源码仓库，
`test:pack` 守着这条边界。GPT-SoVITS 直连本机 `api_v2.py`——**没有网关进程、
没有 Python 适配层、没有 API Key**。

改 `lib/` 后的热更新（Windows 下 `file:` 安装是**复制**而非符号链接，运行中的 dsh 读的是 profile 副本）：

```powershell
Copy-Item lib/* $env:USERPROFILE\.dsh\profiles\web\node_modules\@memef1f1y\dsh-plugin-tts\lib\ -Recurse -Force
# 然后刷新浏览器即可（bundle 每次请求重新读盘；勿用 pnpm install --force 覆盖）
```

## 已知限制

- 音频缓存仅进程内（文件在 OS 临时目录，由系统清理），完全重启后每段文本第一次朗读会重新合成。
  设置本身跨重启保留（见上文）。
- 中英文**布局**适配（英文文本更长，可能换行或溢出）需在装好插件的真实 dsh 界面里人工确认。
  本插件没有独立 HTML，UI 由 dsh web 宿主注入 slot 渲染，
  所以 `tests/client-load.mjs` 只断言内存渲染，不涉及真实 DOM/CSS。

## 文档

| 文档 | 内容 |
|---|---|
| [使用手册](docs/USER-GUIDE.md) | 第一次用：做什么 / 怎么做 / 怎么算成功 |
| [RVC 指南](docs/RVC-GUIDE.md) | 自定义音色、分块播放、紧凑索引、音色包、便携运行时 |
| [Index-TTS2 指南](docs/INDEX-TTS2-GUIDE.md) | 本机参考音频音色 |
| [CosyVoice 指南](docs/COSYVOICE-GUIDE.md) | 本机零样本提示克隆（CosyVoice-2.0-0.5B） |
| [GPT-SoVITS 指南](docs/GPT-SOVITS-GUIDE.md) | 直连本机 `api_v2.py /tts`、参考克隆、字段契约 |
| [Cloud 指南](docs/CLOUD-GUIDE.md) | 谷歌付费音色、API Key、用量与计费 |
| [Edge 指南](docs/EDGE-GUIDE.md) | 默认在线链路 |
| [分块播放设计](https://github.com/1624318455/dsh-plugin-tts/blob/main/docs/adaptive-chunked-playback.md) | 长文无缝朗读怎么做的（仅源码仓库） |
| [Host 契约](https://github.com/1624318455/dsh-plugin-tts/blob/main/docs/HOST-CONTRACT.md) | Host 侧路由契约，给要扩展接口的人（仅源码仓库） |
| [更新日志](https://github.com/1624318455/dsh-plugin-tts/blob/main/CHANGELOG.md) | 各版本变更（仅源码仓库） |

## License

MIT
