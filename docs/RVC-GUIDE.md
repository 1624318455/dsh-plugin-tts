# RVC 自定义音色指南（Custom Voice / RVC Guide）

> dsh-plugin-tts 的 RVC 能力专册。RVC 部分上手门槛较高，故从主 README 抽出单独成册。
> 主 README：[中文](../README.zh.md) / [English](../README.md) · 使用手册：[《执行手册》](USER-GUIDE.md)

**目录**
- [RVC 是什么](#rvc-是什么)
- [开始前准备](#开始前准备)
- [启动本地 RVC 服务](#启动本地-rvc-服务)
- [设置面板 RVC 配置](#设置面板-rvc-配置)
- [长文本渐进播放（自适应分块）](#长文本渐进播放自适应分块)
- [紧凑索引（压缩 .index）](#紧凑索引压缩-index)
- [音色包（注册表 + 下载）](#音色包注册表--下载)
- [便携运行时（免装 RVC WebUI）](#便携运行时免装-rvc-webui)
- [设置项详解](#设置项详解)
- [实测延迟](#实测延迟)
- [RVC 疑难排查](#rvc-疑难排查)
- [版权提示](#版权提示)
- [English](#english)

---

<a name="rvc-是什么"></a>
## RVC 是什么

RVC（Retrieval-based-Voice-Conversion）是**声音转换**，不是 TTS：输入音频长度 = 输出音频长度。
所以"用自定义音色朗读"的链路是：

```
Edge TTS 朗读（原声）→ 本机 RVC 推理服务（rvc-server.py）→ 转换后的 wav → 播放
```

全程在你自己的 GPU/CPU 上完成，你的音色模型不会上传到任何地方。

---

<a name="开始前准备"></a>
## 开始前准备

| 需要 | 是什么 | 必须吗 |
|---|---|---|
| RVC 模型文件（`.pth`） | 你的音色本体（几 MB ~ 几十 MB） | ✅ 必须 |
| 索引文件（`.index`） | 让音色更像原声的辅助文件 | ❌ 可选（留空 = 免索引） |
| RVC WebUI 安装 或 便携运行时 | 转换服务跑在它里面 | ✅ 二选一（见下） |

> 没有 RVC WebUI？用**便携运行时**（[见下文](#便携运行时免装-rvc-webui)）：免安装文件夹，双击即用。

---

<a name="启动本地-rvc-服务"></a>
## 启动本地 RVC 服务

打开 PowerShell / 命令提示符，启动服务（**不需要指定模型/索引**——模型在设置面板里点「浏览」
选择，首次朗读自动加载；`--model/--index` 只是可选的预载参数）：

- **推荐**：把 `rvc-server.py` 复制到 RVC 根目录（与 `runtime/` 同级），然后：

  ```powershell
  <你的RVC目录>\runtime\python.exe <你的RVC目录>\rvc-server.py --port 4892
  ```

- 或者 rvc-server.py 放在别处时，用 `--rvc-dir` 指定 RVC 根目录：

  ```powershell
  <你的RVC目录>\runtime\python.exe <rvc-server.py的路径> --rvc-dir "<你的RVC目录>" --port 4892
  ```

- ⚠️ `<你的RVC目录>` = RVC WebUI 根目录（含 `runtime`/`assets`/`logs`）；`<rvc-server.py的路径>` = rvc-server.py
  文件所在位置（插件源码目录，或从 GitHub 仓库 `1624318455/dsh-plugin-tts` 下载，**不在** node_modules 里）；
- 想要"启动即预载某个音色"再额外加：
  `--model "<RVC目录>\assets\weights\xxx.pth" --index "<RVC目录>\logs\xxx.index"`；
- **成功的样子**：窗口出现 `dsh-plugin-tts RVC server: http://127.0.0.1:4892 ...`，然后**这个窗口别关**；
- 换模型：直接在设置面板「浏览」里选（无需重启服务）；提示 `[Errno 10048]` = 端口被占用，先关旧的再启动。

`rvc-server.py` API：`GET /health`（含 `gpu_name` / `vram_gb`）、`POST /load {model,index}`、
`POST /convert {audio_base64,params}`（JSON+base64，无额外依赖）、`GET /files?kind=pth|index`（本机模型/索引发现）、
`POST /compact-index {index, target_vectors}`（紧凑索引生成）。
自动使用环境内 `ffmpeg.exe` 解码 mp3 原声；设备自动选 `cuda:0`（NVIDIA）或 `cpu`（可 `--device` 指定）；
转换时**缓存 faiss 索引对象**（按路径），分块模式每块不再重读大索引文件，`/load` 时清空缓存。

---

<a name="设置面板-rvc-配置"></a>
## 设置面板 RVC 配置

打开 **设置 → 插件 → 语音**：

- **TTS提供者** 选「**自定义音色（RVC）**」；
- **服务地址**：保持默认 `http://127.0.0.1:4892`（刚才那个服务的地址）；
- **原声来源**：让 Edge TTS 先读一遍（推荐）/ 上传自己的音频（wav/mp3/m4a/ogg/flac）；
- **原声音色**（原声来源=Edge 时）：转换前的朗读音色，决定语气与停顿；
- **模型路径 (.pth)**：你的音色模型，用「浏览」选或直接粘贴路径；
- **索引路径 (.index)**：可留空（免索引）；「浏览」选 .index；「压缩索引」把大索引缩小；
- **高级参数**（折叠，一般不用改）：见[设置项详解](#设置项详解)。

---

<a name="长文本渐进播放自适应分块"></a>
## 长文本渐进播放（自适应分块）

RVC 是变声，长文本必须先合成整段原声再转换；"全部转换完再播放"会让长回复等待几十秒。
本插件改为**自适应分块渐进播放**：

1. 首次长文本 RVC 时做一次 **5 秒探测**（转换固定短音频，测
   `速度比 = 转换耗时 / 音频时长`），按分档表选定**块大小**与**预热块数**；
2. 文本按句切块（每块 ≈ 6-20 秒音频，落在语义边界）；
3. 先转换预热块（GPU 2 块 / CPU 最多 4 块）立即开播，其余块播放期间通过
   `GET /dsh-tts-api/rvc-next` 逐块拉取——**转换与播放重叠**；
4. **无感衔接**：服务端转换时**裁剪每块头尾填充静音**（实测每块头 138ms / 尾 538ms →
   各保留 20ms/120ms 自然气息），前端用 **Web Audio 采样级精确拼接**
   （AudioBuffer 按 `start(prevEnd)` 首尾相接，块间零事件抖动、零重载延迟）；
5. 分档表：`ratio ≤ 0.4 → 20s/预热2`，`0.4-0.6 → 15s/2`，`0.6-0.9 → 10s/3`，
   `> 0.9（CPU）→ 6s/4`，探测失败兜底 `10s/3`；
6. 短文本（≤12 秒）与上传原声模式**不切块**，走单 URL 链路，零额外开销；
7. **进度可见**：朗读按钮 tooltip 与试听面板显示「第 x/y 段 · 边播边合成」；
8. **校准落盘**：探测结果存入 `~/.dsh/tts-rvc/calibration.json`（7 天有效 + GPU 名设备指纹），
   dsh 重启后直接复用，换显卡自动重新探测。

> 完整设计见 [`adaptive-chunked-playback.md`](adaptive-chunked-playback.md)。

---

<a name="紧凑索引压缩-index"></a>
## 紧凑索引（压缩 .index）

RVC 训练出的检索索引常达**数百 MB**（实测示例 408MB / 129,396 向量 / 768 维），
是分发音色包和冷启动加载的最大负担。设置面板「索引路径」右侧的**「压缩索引」按钮**可一键生成：

1. 点「压缩索引」→ 选目标向量数（2k ≈ 6MB / 5k ≈ 15MB / 10k ≈ 31MB / 20k ≈ 61MB）→ 「生成」；
2. 原理：从原索引**子采样**向量，重建为**与源索引同度量**的精确 flat 索引——RVC 训练默认 L2
   （pipeline 的 `square(1/score)` 加权即按 L2 设计），紧凑索引自动跟随源度量
   （源为内积则用 `IndexFlatIP`，否则 `IndexFlatL2`），RVC 管线（`read_index → reconstruct_n → search k=8`）
   零改动兼容；flat 精确检索比原 IVF `nprobe=1` 近似检索**更准**，音色还原度基本不变；
3. 生成**不覆盖原文件**，输出为 `原文件名_compact_N.index`；成功后自动填入索引路径，立即可用；
4. 构建时短暂占用 ~1GB 内存（读取大索引 + 重建），约几秒到几十秒。

**实测声音对比**（同一段真实语音，index_rate 0.75，样本级均差/RMS）：免索引 vs 完整索引 ≈ 37%
（索引确实在起作用）；完整 vs 紧凑 2k ≈ 37%（2k 样本的 8 近邻 ≠ 全量 8 近邻，属正常抽样偏差）。
人耳听感差异很小——训练良好的模型承载大部分音色，索引是"精修"。分发音色包建议 10k（31MB）；
想要更强索引特征可把 index_rate 调向 1.0。

> 已有索引本身不大（如 30-40MB）时**不必压缩**——更小的紧凑版反而可能降低还原度。

---

<a name="音色包注册表--下载"></a>
## 音色包（注册表 + 下载）

从音色包仓库**一键下载安装音色**：设置面板 RVC 配置下方「音色包」模块——

1. 填入仓库地址（目录需包含 `manifest.json`），点「获取列表」；
2. 每个音色包卡片显示名称 / 描述 / 体积（模型 + 索引）/ 许可 / 作者；多索引包可选装哪个；
3. 点「下载并启用」：插件代下载（规避 CORS）、**sha256 逐一校验**、安装到
   `~/.dsh/tts-rvc/packs/<包id>/`（文件名为 `<包id>.pth` / `<包id>.index`），自动填入模型/索引路径，
   并按清单设置原声音色、f0 方法、索引权重——立即可用；
4. 已安装显示版本号与「卸载」按钮；重复下载自动跳过；sha256 不符中止并清理残留；
5. 删除文件后状态自动校正（失效记录自动清除）；仓库地址/代理/进行中的下载会记忆，重开面板自动恢复。

清单格式（`manifest.json`，schema 2；url 支持相对路径，按仓库地址自动解析）：

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
- 免索引的音色包：不写 `indexes` / `index`。

> 公开仓库示例：[github.com/1624318455/rvc-for-tts](https://github.com/1624318455/rvc-for-tts)
> （仓库地址填 `https://raw.githubusercontent.com/1624318455/rvc-for-tts/main`）。
> 本地测试：`node tests/mock-registry.mjs <目录> [端口]` 起一个静态仓库。

---

<a name="便携运行时免装-rvc-webui"></a>
## 便携运行时（免装 RVC WebUI）

给"只有音色模型、不想装整套 RVC WebUI"的人：一个免安装文件夹，内含转换服务需要的一切
（Python + torch + 推理核心 + hubert/rmvpe + ffmpeg + `rvc-server.py`），双击 `启动服务.bat` 即用。
**已在本机实测**（RTX 5070：模型加载 + 转换正常）。

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
  或只分享打包脚本让各自本机生成）。详见[使用手册 §10](USER-GUIDE.md)。
- **跨平台**：`--platform auto|windows|linux|darwin`——Windows 生成 `启动服务.bat`，
  Linux/macOS 生成 `start-rvc-server.sh`（macOS 自动跳过 torch 升级）。
  **macOS（Apple Silicon）已实测通过**：`package-runtime.py --platform darwin` 打包后，
  `mac-verify.sh` 全链路 PASS，CPU 转换**快于实时**（热约 0.45× / 冷约 0.8×，见下）。

### macOS 实测要点（Apple Silicon，macOS 26.x）

Darwin 打包时 `package-runtime.py` 会自动对 `infer/lib/audio.py` 打一个
**macOS 专用补丁**：把 `av.open(..., "rb"/"wb")` 改成 `av.open(..., "r"/"w")`。
现代 PyAV（≥10，macOS arm64 唯一可装的 wheel 版本）拒绝 `"rb"/"wb"` 文件模式，
不打这个补丁 `/convert` 会报 `ValueError: mode must be 'r', 'w', or None, got: rb`。
Windows 的 RVC WebUI 自带旧 PyAV 不受影响，所以只在 darwin 分支打补丁。

手动跑（不打包，直接用 `~/rvc-work`）时，除锁定版本清单外**还需**：

- `pip install av praat-parselmouth torchcrepe`（旧版 infer 的隐式依赖）
- `faiss-cpu==1.7.3`（最新 1.13 要求 `numpy>=1.25`，与锁定 `numpy==1.23.5` 冲突）
- 装 `fairseq==0.12.2` 前把 pip 降到 **<24.1**（其依赖 omegaconf 的 `PyYAML>=5.1.*`
  元数据在新 pip 里被拒）；并保持 `setuptools<81`（否则缺 `pkg_resources`，librosa 0.9.1 导入失败）
- **方案 B 拉 infer 时务必用旧版 tag**（如 `2.2.231006`）：新版 RVC 已把 `infer/`
  整体重构为 `infer/vc/ + infer/module/`，与 `rvc-server.py` 期望的
  `infer/modules/vc/ + infer/lib/infer_pack/models.py` 完全不兼容

> 🐛 若用旧版 `mac-verify.sh` 遇到"第 5 步 RIFF 校验误报 FAIL"：这是脚本自身 bug
> （macOS 的 `od` 字节间双空格导致 `grep "52 49 46 46"` 匹配不到），已改为
> 去空格比较十六进制，输出实为合法 RIFF。（旧版会造成 `exit 1` 假失败。）

---

<a name="设置项详解"></a>
## 设置项详解

| 设置项 | 作用 | 建议 |
|---|---|---|
| 原声来源 | 转换前基础语音：Edge TTS 自动合成，或上传自己的音频文件 | 上传模式忽略声音调节；wav/mp3/m4a/ogg/flac |
| 语速 / 音调 / 音量 | Edge TTS 朗读属性；RVC 模式下作用于转换前原声，语调会透传到最终音色 | `0` = 默认；语速 ±10-20% 听感自然 |
| 服务地址 | 本地 RVC 推理服务地址 | 默认 `http://127.0.0.1:4892` |
| 模型路径 (.pth) | RVC 模型文件，即音色来源 | 必填；可用「浏览」从本机选择（.pth） |
| 索引路径 (.index) | 音色检索索引，提升音色还原度 | 留空 = 免索引（还原度略降，仍可用）；「浏览」限 .index |
| 原声音色 | 转换前的原始语音，决定语调/停顿 | 男声/女声按喜好选 |
| 说话人 ID (spk_id) | 多说话人模型选择说话人 | 单说话人模型保持 0 |
| f0 方法 | 音高检测算法：rmvpe 效果最好；pm 最快；harvest 低音好但慢；crepe 吃 GPU | 默认 rmvpe；CPU 建议 pm |
| 变调 (f0_up_key) | 对音高整体升降，单位半音 | 0 默认；±2-3 可微调声线 |
| 索引权重 (index_rate) | 越高音色越接近模型训练者，越低越接近原声 | 0.5-0.75 常用 |
| 输出采样率 (resample_sr) | 输出音频采样率，越高细节越好、文件越大 | 40000 默认 |
| 响度混合 (rms_mix_rate) | 输出音量包络混合比例，越高越接近训练者响度习惯 | 0.25 默认 |
| 辅音保护 (protect) | 保护清辅音与呼吸声，过高保留更多原声细节 | 0.33 默认 |
| 滤波半径 (filter_radius) | 音高平滑滤波（仅 harvest 有效），越大曲线越平滑 | ≥3 启用平滑 |
| F0 曲线文件 | 手动指定音高曲线文件，覆盖自动提取 | 留空 = 自动提取 |

---

<a name="实测延迟"></a>
## 实测延迟（NVIDIA GPU，服务常驻）

| 场景 | 延迟 |
|---|---|
| 热转换（短句） | 带 index ~1s / 免 index ~0.4s |
| 完整链路（Edge 合成 + 转换） | ~2-6s |
| 首次请求（含 hubert/模型加载） | 数秒到十余秒 |

---

<a name="rvc-疑难排查"></a>
## RVC 疑难排查

> 💡 设置面板有「**诊断**」按钮：一键检查 Edge TTS 在线合成、本地 RVC 服务、模型加载状态，
> 并按「连接 / 协议 / 音色」分类给出可读提示。

| 症状 | 最常见原因 | 怎么办 |
|---|---|---|
| 提示"无法连接本地 RVC 推理服务" | 服务窗口没开 / 被关了 | 重新启动服务（见[启动本地 RVC 服务](#启动本地-rvc-服务)），别关窗口 |
| 提示"未配置 RVC 模型路径" | 模型路径为空 | 填 .pth 路径（或点浏览） |
| 首次朗读等十几秒 | 正常：加载模型 + 自动测速 | 等它；之后会快 |
| 音色不够像 | 没填索引，或索引权重太低 | 填 .index；「索引权重」调向 100% |
| 索引选择列表里看不到下载的包 | — | 已支持：`~/.dsh/tts-rvc/packs` 会出现在浏览列表（需重启 rvc-server 生效） |

---

<a name="版权提示"></a>
## 版权提示

只发布/使用**你有权分发**的音色（自己训练的、或已获授权的）。
演示音色 azusa-test 受版权限制，仅限本机开发验证，不在任何公开仓库。

---

<a name="english"></a>
## English

RVC is voice **conversion** (input length == output length), not TTS. The custom-voice
pipeline is `Edge TTS base audio → local RVC inference server (rvc-server.py) →
converted wav → playback`, all on the user's own GPU/CPU.

### Quick start
1. **Prepare**: an RVC model (`.pth`, required) + optional index (`.index`), and either
   an RVC WebUI install or the [portable runtime](#便携运行时免装-rvc-webui).
2. **Start the service** (keep the window open):
   ```powershell
   E:\...\RVC20240604Nvidia\runtime\python.exe rvc-server.py `
     --rvc-dir "E:\...\RVC20240604Nvidia" --model "E:\...\xxx.pth" `
     --index "E:\...\xxx.index" --port 4892
   ```
3. **Configure**: 设置 → 插件 → 语音 → TTS提供者 = 自定义音色（RVC）；keep 服务地址 default;
   fill 模型路径 (browse or paste); index optional (empty = index-free).

### Key capabilities
- **Adaptive chunked progressive playback**: long reads are sentence-split into
  ~6-20s chunks; a one-shot probe picks chunk size + prewarm count from the machine's
  convert/play speed; chunks stream with **gapless joins** (server trims per-chunk edge
  silence, client chains AudioBuffers at `start(prevEnd)`); progress shows "chunk x/y".
- **Compact index tool**: sub-samples a huge `.index` (hundreds of MB) into an exact
  same-metric flat index (2k≈6MB / 10k≈31MB / 20k≈61MB) with essentially unchanged
  identity — only needed for very large indexes.
- **Voice-pack registry**: one-click install of model + index from a `manifest.json`
  registry (`schema 2`, relative URLs, sha256-pinned, multi-index variants, uninstall,
  state reconciliation). Public example: `github.com/1624318455/rvc-for-tts`.
- **Portable runtime**: `tools/package-runtime.py` builds a no-install folder (copy the
  proven env; optional torch cu128 upgrade for RTX 50-series; use a mirror if the
  official CDN is slow). See [user guide §10](USER-GUIDE.md).
- **Server API**: `GET /health` · `POST /load {model,index}` · `POST /convert
  {audio_base64,params}` · `GET /files?kind=pth|index` · `POST /compact-index`.

### Settings explained (abridged)
| Setting | Effect | Guidance |
|---|---|---|
| Service URL | Local RVC service address | default `http://127.0.0.1:4892` |
| Model path (.pth) | Your voice model | required |
| Index path (.index) | Retrieval index; improves identity | empty = index-free (slightly lower fidelity) |
| Base voice | Voice synthesized before conversion | decides prosody/pauses |
| f0 method | Pitch detection | rmvpe default; pm on CPU |
| Index rate | Higher = closer to the trained voice | 0.5-0.75 common |

### Troubleshooting
- "无法连接本地 RVC 推理服务" → the service window is closed; restart it and keep it open.
- "未配置 RVC 模型路径" → fill the `.pth` path.
- First read is slow (10s+) → normal (model load + one-shot calibration).
- Voice doesn't sound like the target → add an index or raise index rate.

> ⚠️ Copyright: only publish/use voices you have the right to distribute.
> The demo voice (azusa-test) is local-development only and is not in any public registry.
