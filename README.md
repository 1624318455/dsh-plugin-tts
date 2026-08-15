<p align="center">
  <img src="logo.png" alt="dsh-plugin-tts" width="140" />
</p>

<h1 align="center">dsh-plugin-tts</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="license"></a>
  <a href="https://github.com/awesome-dsh-plugin/awesome-dsh-plugin"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-22%2B-blue" alt="node"></a>
  <a href="tests/smoke.mjs"><img src="https://img.shields.io/badge/tests-27%20passed-success" alt="tests"></a>
  <a href="https://github.com/1624318455/dsh-plugin-tts"><img src="https://img.shields.io/github/stars/1624318455/dsh-plugin-tts" alt="stars"></a>
  <a href="https://github.com/1624318455/dsh-plugin-tts/commits/main"><img src="https://img.shields.io/github/last-commit/1624318455/dsh-plugin-tts" alt="last commit"></a>
</p>

<p align="center"><strong><a href="#中文">中文</a> | <a href="#english">English</a></strong></p>

---

<a name="中文"></a>

# dsh-plugin-tts — Edge TTS 语音大集成

基于 Microsoft Edge 在线 TTS（node-edge-tts 协议）的
DeepSeek Harness 语音插件：给 AI 回复加朗读，支持逐条手动朗读与自动朗读。

> 📖 **第一次用？看[《使用手册（执行手册）》](docs/USER-GUIDE.md)** —— 每一步都有
> "做什么 / 怎么做 / 怎么算成功"，从朗读、RVC 音色到音色包下载全覆盖。

## 功能

1. **消息朗读按钮**：每条 AI 回复左下角操作行（复制 / 好的回答 / 有问题的回答 / 在新对话中分支 之间）
   新增「朗读」按钮，点击朗读该条消息（按钮显示音柱跳动动画），再次点击停止。
2. **自动朗读开关**：输入框左下角、命令按钮与权限选择按钮之间的喇叭按钮；
   开启后每条新完成的 AI 回复自动朗读（按钮带圆形高亮），关闭则不自动朗读。
3. **语音设置面板**：侧边栏「设置 → 插件」新增「语音」标签页：
   - **TTS提供者**：Edge TTS（免费在线）/ 自定义音色（RVC）
   - **朗读音色**：22 个经实测可用的 Edge TTS 音色（默认 晓萱 zh-CN-XiaoxuanNeural）
   - **声音调节**：语速 / 音调 / 音量（0 = 默认）
   - **音色包**：从音色包仓库一键下载安装音色
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

## 自定义音色（RVC）

用你本地训练好的 **RVC 模型**做音色转换：设置面板把 TTS提供者切到「自定义音色（RVC）」，朗读链路变为
`Edge TTS 底噪 → 本机 RVC 推理服务（rvc-server.py）→ 转换后的 wav → 播放`，全程在本机 GPU/CPU 上完成。

### 启动本地 RVC 推理服务

```sh
# 任选一个 RVC-Project WebUI 安装（本机验证示例，azusa-test 仅本地使用）
E:\AI\RVC20240604Nvidia\RVC20240604Nvidia\runtime\python.exe rvc-server.py \
    --rvc-dir "E:\AI\RVC20240604Nvidia\RVC20240604Nvidia" \
    --model "E:\AI\RVC20240604Nvidia\RVC20240604Nvidia\assets\weights\azusa-test.pth" \
    --index "E:\AI\RVC20240604Nvidia\RVC20240604Nvidia\assets\indices\azusa-test_..._v2.index" \
    --port 4892
```

`rvc-server.py` 提供 `GET /health`（含 `gpu_name` / `vram_gb`）、`POST /load {model,index}`、
`POST /convert {audio_base64,params}`（JSON+base64，无额外依赖）、`GET /files?kind=pth|index`（本机模型/索引发现）、
`POST /compact-index {index, target_vectors}`（紧凑索引生成）；
自动使用环境内的 `ffmpeg.exe` 解码 mp3 底噪。设备自动选 `cuda:0`（NVIDIA）或 `cpu`，可 `--device` 指定。
转换时**缓存 faiss 索引对象**（按路径），分块模式下每块不再重复读取 ~400MB 索引文件；`/load` 时自动清空缓存。

### 便携运行时（免装 RVC WebUI）

给"只有音色模型、不想装整套 RVC WebUI"的人：一个免安装文件夹，内含转换服务需要的一切
（Python + torch + 推理核心 + hubert/rmvpe + ffmpeg + `rvc-server.py`），双击 `启动服务.bat`
即用。**已在本机实测**（RTX 5070：模型加载 + 转换正常）。

打包（在已装 RVC WebUI 的机器上，**零下载**）：

```powershell
E:\...\RVC20240604Nvidia\runtime\python.exe tools\package-runtime.py `
  --rvc-dir "E:\...\RVC20240604Nvidia" --out "D:\rvc-portable" --skip-torch
```

- **RTX 50 系（Blackwell）可选提速**：官方 pytorch CDN 对部分网络极慢（实测 31KB/s），
  用国内镜像在可见终端里升级 torch 到 cu128：

  ```powershell
  D:\rvc-portable\runtime\python.exe -m pip install --upgrade `
    --extra-index-url https://mirrors.aliyun.com/pytorch-wheels/cu128 `
    torch==2.7.0+cu128 torchaudio==2.7.0+cu128
  ```

- 成品约 7-9GB，压缩 3-4GB（超出 GitHub 附件 2GB 上限，用网盘/对象存储分发，
  或只分享打包脚本让各自本机生成）。详见[使用手册 §10](docs/USER-GUIDE.md)。

### 长文本渐进播放（自适应分块）

RVC 是变声：输入音频长度 = 输出音频长度，长文本必须先合成整段底噪再转换。
旧链路"全部转换完再播放"会让长回复等待几十秒。本插件改为**自适应分块渐进播放**：

1. 首次使用长文本 RVC 时，Host 做一次 **5 秒探测**（转换固定短音频，测
   `速度比 = 转换耗时 / 音频时长`），按分档表选定**块大小**与**预热块数**；
2. 文本按句切块（每块 ≈ 6-20 秒音频，落在语义边界）；
3. 先转换预热块（GPU 2 块 / CPU 最多 4 块）立即开播，其余块由前端在播放期间
   通过 `GET /dsh-tts-api/rvc-next` 逐块拉取——**转换与播放重叠**；
4. **无感衔接**：rvc-server 转换时**裁剪每块头尾填充静音**（实测每块头 138ms/
   尾 538ms → 各保留 20ms/120ms 自然气息），前端用 **Web Audio 采样级精确拼接**
   （解码成 AudioBuffer 按 `start(prevEnd)` 首尾相接，块间零事件抖动、零重载延迟）；
5. 分档表：`ratio ≤ 0.4 → 20s/预热2`，`0.4-0.6 → 15s/2`，`0.6-0.9 → 10s/3`，
   `> 0.9（CPU）→ 6s/4`，探测失败兜底 `10s/3`；
6. 短文本（≤12 秒）与上传底噪模式**不切块**，仍走单 URL 链路，零额外开销；
7. **进度可见**：播放时朗读按钮 tooltip 与试听面板显示「第 x/y 段 · 边播边合成」；
8. **校准落盘**：探测结果存入 `~/.dsh/tts-rvc/calibration.json`（7 天有效，
   记录 GPU 名做设备指纹），dsh 重启后直接复用，换显卡自动重新探测。

> 完整设计见 [`docs/adaptive-chunked-playback.md`](docs/adaptive-chunked-playback.md)。

### 设置面板 RVC 配置

- **原声来源**：让 Edge TTS 先读一遍 / 上传音频文件（wav/mp3/m4a/ogg/flac）。选「上传」时不再经过 Edge TTS，语速/音调/音量不适用。
- **服务地址**（默认 `http://127.0.0.1:4892`）
- **模型路径 (.pth)** 与 **索引路径 (.index)**——输入框右侧有「浏览」按钮（RVC 服务自动扫描本机模型/索引文件，点击回填路径）；**索引留空 = 免索引模式**（index_rate 自动为 0，质量略降仍可用）；索引路径旁有「压缩索引」按钮（生成紧凑索引）
- **原声音色**（原声来源=Edge 时）：Edge 先合成再转换的原始音色
- **高级参数**（折叠，一般不用改）：原声语速/音调/音量（如 `+10%`）、说话人 ID spk_id（多说话人模型）、f0 方法（rmvpe 质量高 / pm 快）、变调、索引权重 index_rate、resample_sr、rms_mix_rate、protect、滤波半径 filter_radius（仅 harvest）、F0 曲线文件（手动指定音高）

### 紧凑索引（压缩 .index）

RVC 训练出的检索索引常达**数百 MB**（实测 azusa-test：408MB / 129,396 向量 / 768 维），
是分发音色包和冷启动加载的最大负担。设置面板「索引路径」右侧的**「压缩」按钮**可一键生成紧凑索引：

1. 点「压缩」→ 选择目标向量数（2k ≈ 6MB / 5k ≈ 15MB / 10k ≈ 31MB / 20k ≈ 61MB）→ 「生成」；
2. 原理：从原索引**子采样**向量，重建为**与源索引同度量**的精确 flat 索引——RVC 训练默认
   L2（pipeline 的 `square(1/score)` 加权即按 L2 设计），紧凑索引自动跟随源度量（源为内积则
   用 `IndexFlatIP`，否则 `IndexFlatL2`），RVC 管线（`read_index → reconstruct_n → search k=8`）
   零改动兼容；flat 精确检索比原 IVF `nprobe=1` 的近似检索**更准**，音色还原度基本不变；
3. 生成**不覆盖原文件**，输出为 `原文件名_compact_N.index`；成功后自动填入索引路径，立即可用；
4. 构建时短暂占用 ~1GB 内存（读取大索引 + 重建），约几秒到几十秒。

> 408MB → 6MB（2k）意味着分发音色包时索引不再是障碍；配合免索引模式（留空），
> 任何机器都能"选个音色直接用"。

**实测声音对比**（同一段真实语音，index_rate 0.75，样本级均差/RMS）：免索引 vs 完整索引 ≈ 37%
（索引确实在起作用）；完整 vs 紧凑 2k ≈ 37%（2k 样本的 8 近邻 ≠ 全量的 8 近邻，属正常抽样偏差）。
人耳听感上差异很小——训练良好的模型本身承载大部分音色，索引是"精修"。**分发音色包建议 10k
（31MB）**；想要更强索引特征可把 index_rate 调向 1.0。

### 音色包（注册表 + 下载）

从音色包仓库一键下载安装音色：设置面板 RVC 配置下方新增「音色包」模块——

1. 填入仓库地址（目录需包含 `manifest.json`），点「获取列表」；
2. 每个音色包卡片显示名称 / 描述 / 体积（模型 + 紧凑索引）/ 许可 / 作者；
3. 点「下载并启用」：插件代下载（规避 CORS）、**sha256 逐一校验**、安装到
   `~/.dsh/tts-rvc/packs/<包id>/`，自动填入模型/索引路径，并按清单设置底噪音色、
   f0 方法、索引权重——立即可用；
4. 已安装的包显示版本号，重复下载自动跳过；sha256 不符会中止并清理残留文件。

清单格式（`manifest.json`，schema 2；url 支持相对路径，自动按仓库地址解析）：

```json
{ "schema": 2, "packs": [ {
  "id": "pack-id", "name": "音色名", "description": "...",
  "version": "1.0.0", "author": "...", "license": "MIT",
  "baseVoice": "zh-CN-YunyangNeural", "f0Method": "rmvpe", "indexRate": 0.75,
  "model": { "url": "packs/pack-id/model.pth", "size": 55270272, "sha256": "..." },
  "indexes": [ { "id": "c10k", "name": "紧凑 10k（推荐）",
                 "url": "packs/pack-id/index_compact.index", "size": 30720045, "sha256": "..." } ]
} ] }
```

- `indexes` 为索引变体数组（可多个，UI 里选择）；省略时兼容旧的单个 `index` 字段；
- `url` 用相对路径（相对 manifest.json 所在目录）即可，同一个仓库本地/线上通用；
- 免索引的音色包：不写 `indexes` / `index`。

> 演示音色 azusa-test 受版权限制**不对外分发**，不出现在公开仓库；公开仓库只收录版权干净（可分发）的音色。
> 本地测试可用 `node tests/mock-registry.mjs <目录> [端口]` 起一个静态仓库。

### 设置项详解（参数作用与建议）

| 设置项 | 作用 | 建议 |
|---|---|---|
| 底噪来源 | 转换前基础语音：Edge TTS 自动合成，或上传自己的音频文件 | 上传模式忽略声音调节；wav/mp3/m4a/ogg/flac |
| 语速 / 音调 / 音量 | Edge TTS 朗读属性；RVC 模式下作用于转换前底噪，语调会透传到最终音色 | `0` = 默认；语速 ±10-20% 听感自然 |
| 服务地址 | 本地 RVC 推理服务地址 | 默认 `http://127.0.0.1:4892` |
| 模型路径 (.pth) | RVC 模型文件，即音色来源 | 必填；可用「浏览」从本机选择（.pth） |
| 索引路径 (.index) | 音色检索索引，提升音色还原度 | 留空 = 免索引（还原度略降，仍可用）；「浏览」限 .index |
| 底噪音色 | 转换前的原始语音，决定语调/停顿 | 男声/女声按喜好选 |
| 说话人 ID (spk_id) | 多说话人模型选择说话人 | 单说话人模型保持 0 |
| f0 方法 | 音高检测算法：rmvpe 效果最好；pm 最快；harvest 低音好但慢；crepe 吃 GPU | 默认 rmvpe；CPU 建议 pm |
| 变调 (f0_up_key) | 对音高整体升降，单位半音 | 0 默认；±2-3 可微调声线 |
| 索引权重 (index_rate) | 越高音色越接近模型训练者，越低越接近底噪原声 | 0.5-0.75 常用 |
| 输出采样率 (resample_sr) | 输出音频采样率，越高细节越好、文件越大 | 40000 默认 |
| 响度混合 (rms_mix_rate) | 输出音量包络混合比例，越高越接近训练者响度习惯 | 0.25 默认 |
| 辅音保护 (protect) | 保护清辅音与呼吸声，过高保留更多原声细节 | 0.33 默认 |
| 滤波半径 (filter_radius) | 音高平滑滤波（仅 harvest 有效），越大曲线越平滑 | ≥3 启用平滑 |
| F0 曲线文件 | 手动指定音高曲线文件，覆盖自动提取 | 留空 = 自动提取 |

### 实测延迟（NVIDIA GPU，服务常驻）

| 场景 | 延迟 |
|---|---|
| 热转换（短句） | 带 index ~1s / 免 index ~0.4s |
| 完整链路（Edge 合成 + 转换） | ~2-6s |
| 首次请求（含 hubert/模型加载） | 数秒到十余秒 |

### 版权提示

演示用音色（azusa-test）**仅限本机开发验证，请勿对外分发**（声音版权）。对外发布的音色包必须使用版权干净的声音。

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

> 📖 **First time? See the [user guide (执行手册)](docs/USER-GUIDE.md)** — every step
> covers "what / how / how to tell it worked": read-aloud, RVC voices and
> voice-pack downloads.

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

## Custom voice (RVC)

Use your locally trained **RVC model** for voice conversion: switch the TTS
provider to "自定义音色（RVC）" in the settings panel and the read pipeline
becomes `Edge TTS base audio → local RVC inference server (rvc-server.py) →
converted wav → playback`, all computed on the user's own GPU/CPU.

### Start the local RVC inference server

```sh
# any RVC-Project WebUI install (azusa-test below is a local dev example only)
E:\AI\RVC20240604Nvidia\RVC20240604Nvidia\runtime\python.exe rvc-server.py \
    --rvc-dir "E:\AI\RVC20240604Nvidia\RVC20240604Nvidia" \
    --model "E:\AI\RVC20240604Nvidia\RVC20240604Nvidia\assets\weights\azusa-test.pth" \
    --index "E:\AI\RVC20240604Nvidia\RVC20240604Nvidia\assets\indices\azusa-test_..._v2.index" \
    --port 4892
```

`rvc-server.py` exposes `GET /health` (includes `gpu_name` / `vram_gb`),
`POST /load {model,index}`, `POST /convert {audio_base64,params}` (JSON + base64,
no extra deps), `GET /files?kind=pth|index` (local model/index discovery) and
`POST /compact-index {index, target_vectors}` (compact-index builder);
mp3 base audio is decoded with the env's bundled `ffmpeg.exe`. Device
auto-selects `cuda:0` (NVIDIA) or `cpu`; override with `--device`. Loaded faiss
index objects are **cached by path** (cleared on `/load`), so chunked conversion
no longer re-reads the ~400MB index file per chunk.

### Portable runtime (no RVC WebUI needed)

For users who have voice models but do not want to install the whole RVC WebUI:
a no-install folder with everything the conversion service needs (Python + torch
+ inference core + hubert/rmvpe + ffmpeg + `rvc-server.py`); double-click
`启动服务.bat` and it runs. **Verified locally** (RTX 5070: model load + convert).

Build on any machine with an RVC WebUI (**zero downloads**):

```powershell
E:\...\RVC20240604Nvidia\runtime\python.exe tools\package-runtime.py `
  --rvc-dir "E:\...\RVC20240604Nvidia" --out "D:\rvc-portable" --skip-torch
```

- **Optional RTX 50-series (Blackwell) speed-up**: the official pytorch CDN is
  very slow on some networks (measured 31KB/s); use a mirror in a visible
  terminal to upgrade torch to cu128:

  ```powershell
  D:\rvc-portable\runtime\python.exe -m pip install --upgrade `
    --extra-index-url https://mirrors.aliyun.com/pytorch-wheels/cu128 `
    torch==2.7.0+cu128 torchaudio==2.7.0+cu128
  ```

- Result is ~7-9GB (zip 3-4GB, over GitHub's 2GB asset limit) — distribute via
  cloud drive/object storage, or share the build script instead.
  See [user guide §10](docs/USER-GUIDE.md).

### Adaptive chunked progressive playback (long RVC reads)

RVC is voice conversion (input length == output length), so long text must be
fully synthesized as base audio before conversion. Instead of converting
everything before playing (a long silent wait), the plugin:

1. Probes the machine once (converts a ~3.6s clip; measures
   `ratio = convert_time / audio_seconds`) and picks **chunk size (6-20s)** and
   **prewarm count (2-4)** from a ratio tier table;
2. Splits the text into sentence-aligned chunks;
3. Converts the prewarm chunks, starts playback immediately, and the client
   pulls further chunks via `GET /dsh-tts-api/rvc-next` while playing —
   **conversion overlaps playback**;
4. **Gapless joins**: the server trims each chunk's edge padding silence
   (measured ~138ms lead / ~538ms tail → keep a 20ms/120ms natural breath), and
   the client plays chunks with **Web Audio sample-accurate scheduling**
   (AudioBuffers chained at `start(prevEnd)` — no event jitter, no reload gap);
5. Tiers: `ratio ≤ 0.4 → 20s/prewarm 2`, `0.4-0.6 → 15s/2`, `0.6-0.9 → 10s/3`,
   `> 0.9 (CPU) → 6s/4`, probe failure falls back to `10s/3`;
6. Short text (≤12s) and upload-base mode stay on the single-URL path (zero
   extra overhead);
7. **Visible progress**: the read button tooltip and preview panel show
   "chunk x/y · playing while converting";
8. **Persistent calibration**: results are stored in
   `~/.dsh/tts-rvc/calibration.json` (7-day validity, GPU-name fingerprint) —
   reused across dsh restarts, re-probed automatically when the GPU changes.

> Full design: [`docs/adaptive-chunked-playback.md`](docs/adaptive-chunked-playback.md).

### Settings-panel RVC config

- **Service URL** (default `http://127.0.0.1:4892`)
- **Model path (.pth)** and **Index path (.index)** — **leave index empty =
  index-free mode** (index_rate forced to 0; slightly lower quality, still works)
- **Base voice**: the Edge voice synthesized before conversion
- **Advanced** (collapsible): base voice rate/pitch/volume (e.g. `+10%`),
  speaker id spk_id (multi-speaker models), f0 method (rmvpe quality / pm
  speed), pitch shift, index_rate, resample_sr, rms_mix_rate, protect,
  filter_radius (harvest only), F0 curve file (manual pitch)

### Compact index (shrink .index)

Trained RVC retrieval indexes are often **hundreds of MB** (measured azusa-test:
408MB / 129,396 vectors / 768-dim) — the biggest burden for distributing voice
packs and cold-start loading. The **"压缩" (compress)** button next to the index
path builds a compact index in one click:

1. Click 压缩 → pick a target vector count (2k ≈ 6MB / 5k ≈ 15MB / 10k ≈ 31MB /
   20k ≈ 61MB) → 生成;
2. It **sub-samples** the original index's vectors and rebuilds an exact flat
   index with the **same metric as the source** (RVC trains with L2 by default —
   the pipeline's `square(1/score)` weighting is designed for L2 — so the
   compact index uses `IndexFlatL2`, or `IndexFlatIP` when the source is
   inner-product). The RVC pipeline (`read_index → reconstruct_n → search k=8`)
   needs zero changes; flat exact search is *more* accurate than the original
   IVF `nprobe=1` approximation, so voice identity is essentially unchanged;
3. The original file is **never overwritten**; output is
   `原文件名_compact_N.index`, and the new path is filled into the index field
   automatically;
4. Build takes a few seconds to tens of seconds with a ~1GB memory peak.

> 408MB → 6MB (2k) means the index is no longer a barrier to shipping a voice
> pack; combined with index-free mode (empty path), any machine can pick a voice
> and go.

### Voice packs (registry + download)

One-click voice install from a pack registry: the "音色包" module below the RVC
config in the settings panel —

1. Enter a registry URL (its directory must contain `manifest.json`), click
   "获取列表";
2. Each pack card shows name / description / size (model + compact index) /
   license / author;
3. Click "下载并启用": the plugin downloads on your behalf (avoids CORS),
   **verifies every file's sha256**, installs to `~/.dsh/tts-rvc/packs/<id>/`,
   fills the model/index paths and applies the pack's base voice, f0 method and
   index rate — ready to use immediately;
4. Installed packs show their version; re-downloading skips silently; a sha256
   mismatch aborts and cleans up partial files.

Manifest format (`manifest.json`, schema 2; `url` may be relative — resolved
against the registry base, so the same manifest works locally and online):

```json
{ "schema": 2, "packs": [ {
  "id": "pack-id", "name": "Voice Name", "description": "...",
  "version": "1.0.0", "author": "...", "license": "MIT",
  "baseVoice": "zh-CN-YunyangNeural", "f0Method": "rmvpe", "indexRate": 0.75,
  "model": { "url": "packs/pack-id/model.pth", "size": 55270272, "sha256": "..." },
  "indexes": [ { "id": "c10k", "name": "Compact 10k (recommended)",
                 "url": "packs/pack-id/index_compact.index", "size": 30720045, "sha256": "..." } ]
} ] }
```

- `indexes` is an array of index variants (the UI lets you pick one); the legacy
  single `index` field still works;
- `url` can be a relative path; omit `indexes`/`index` for an index-free pack.

> The demo voice (azusa-test) is **not redistributable** and is not listed in a
> public registry; public registries must only contain copyright-clean voices.
> For local testing: `node tests/mock-registry.mjs <dir> [port]` serves a folder
> as a static registry.

### Settings explained (meaning & guidance)

| Setting | Effect | Guidance |
|---|---|---|
| Rate / Pitch / Volume | Edge TTS properties; in RVC mode they shape the base audio and the prosody carries into the final voice | `0` = default; ±10-20% rate sounds natural |
| Service URL | Local RVC inference service address | default `http://127.0.0.1:4892` |
| Model path (.pth) | The RVC model — your voice source | required |
| Index path (.index) | Voice retrieval index; improves identity | empty = index-free (slightly lower fidelity) |
| Base voice | Original voice before conversion; decides prosody/pauses | pick male/female as you like |
| Speaker id (spk_id) | Picks the speaker for multi-speaker models | keep 0 for single-speaker models |
| f0 method | Pitch detection: rmvpe best; pm fastest; harvest good bass but slow; crepe GPU-heavy | rmvpe default; pm on CPU |
| Pitch shift (f0_up_key) | Global pitch shift in semitones | 0 default; ±2-3 to tune the voice |
| Index rate | Higher = closer to the trained voice; lower = closer to the base | 0.5-0.75 common |
| Resample sr | Output sample rate; higher = more detail, bigger files | 40000 default |
| RMS mix rate | Output volume-envelope mix; higher = closer to the trainer's loudness | 0.25 default |
| Protect | Protects unvoiced consonants/breath; too high keeps more of the source | 0.33 default |
| Filter radius | Pitch smoothing (harvest only); larger = smoother curve | ≥3 enables smoothing |
| F0 curve file | Manual pitch curve, overrides auto extraction | empty = auto |

### Measured latency (NVIDIA GPU, warm server)

| Scenario | Latency |
|---|---|
| Warm conversion (short clip) | with index ~1s / index-free ~0.4s |
| Full chain (Edge synth + conversion) | ~2-6s |
| First request (hubert/model load) | seconds to ~15s |

### Copyright note

The demo voice (azusa-test) is **for local development only — do not
redistribute** (voice copyright). Published voice packs must use
copyright-clean voices.

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

