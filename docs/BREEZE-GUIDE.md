# Breeze TTS 2 指南（本地参考音频克隆 / 声音设计）

> dsh-plugin-tts 的 Breeze TTS 2 能力专册。Breeze 是纯本地合成：音色来自参考音频 + 文字稿，
> 或者只用一段自然语言「声音描述」凭空设计音色。
> 主 README：[中文](../README.zh.md) / [English](../README.md) · 使用手册：[《执行手册》](USER-GUIDE.md)

**目录**
- [Breeze TTS 2 是什么](#breeze-tts-2-是什么)
- [开始前准备](#开始前准备)
- [启动本地 Breeze 服务](#启动本地-breeze-服务)
- [设置面板配置](#设置面板配置)
- [三种使用模式](#三种使用模式)
- [多语言与跨语言](#多语言与跨语言)
- [疑难排查](#疑难排查)
- [给 AI Agent 的落地附录](#给-ai-agent-的落地附录)

---

## Breeze TTS 2 是什么

Breeze TTS 2 是开源权重的实时语音合成模型（中英双语），本机运行：

```
参考音频 + 文字稿（或「声音描述」） + 文本 → 本机 Breeze API → 24 kHz PCM → wav → 播放
```

和 Index-TTS2 / CosyVoice 的区别：Breeze 的参考音频是**每次请求上传**给本地服务，
不需要服务端维护音色目录；它同时还支持不提供参考音频、仅用文字描述生成音色。

- 官方仓库：<https://github.com/breezeblue-ai/breeze-tts>
- 模型权重：<https://huggingface.co/BreezeBlue/Breeze-TTS-2>（约 7.7 GB）
- 权重许可是**研究 / 非商用**许可；商用需另行授权。

---

## 开始前准备

| 需要 | 是什么 | 必须吗 |
|---|---|---|
| NVIDIA 显卡 | 官方推荐 12 GB 显存（eager 推理约 7.7 GiB） | ✅ 必须 |
| Python 3.10+ | 建议 3.12 独立虚拟环境 | ✅ 必须 |
| Breeze 推理代码 + 权重 | 官方仓库 + Hugging Face checkpoint | ✅ 必须 |
| 参考音频 | 决定朗读是谁的声音（5–20 秒干净人声） | 克隆模式必须 |

Windows 上使用 `attn_implementation="eager"`（官方 API 已内置），不需要编译 flash-attn。

---

## 启动本地 Breeze 服务

以本仓库的落地方式为例（路径可换）：

```powershell
# 1) 取代码 + 建虚拟环境
git clone https://github.com/breezeblue-ai/breeze-tts.git
cd breeze-tts
uv venv --python 3.12 .venv

# 2) 安装 PyTorch（按显卡 CUDA 版本选 cu128 等）与依赖
uv pip install --python .venv\Scripts\python.exe torch torchaudio --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv\Scripts\python.exe -r requirements.txt

# 3) 下载权重（国内可用镜像）
$env:HF_ENDPOINT="https://hf-mirror.com"
uv tool run --from huggingface_hub hf download BreezeBlue/Breeze-TTS-2 --local-dir D:\breeze-tts-2

# 4) 启动 API（默认 7860 端口，保持窗口运行）
.venv\Scripts\python.exe -m breeze_infer.api D:\breeze-tts-2 --host 127.0.0.1 --port 7860
```

服务就绪的判据：`GET http://127.0.0.1:7860/health` 返回 `{"status":"ok","sample_rate":24000}`。
首次启动要加载模型，可能等几十秒到几分钟；`status=loading` 时插件诊断会显示「模型仍在加载」。

### 用面板启动（可选）

不想每次开终端时，可以在设置页展开 Breeze 的「**本机服务启动（可选）**」：

- 先点「**模型目录**」选中检查点目录（含 `config.json` / `audio_tokenizer`），供生成启动命令；
- 命令、工作目录、端口（默认 7860）保存后，点「启动」即可；
- 从「模型扫描」找到 Breeze 代码目录后点「使用」，插件会自动生成
  `<venv 或 PATH python> -m breeze_infer.api "<模型目录>" --host 127.0.0.1 --port 7860`，
  确认后保存并启动；
- 停止/重启只作用于插件启动的进程，不会杀掉你自己在终端里起的服务。

---

## 设置面板配置

打开 **语音设置页（设置 → dsh-plugin-tts）**：

- **TTS提供者** 选「**Breeze TTS 2**」；
- **服务地址**：默认 `http://127.0.0.1:7860`；
- **模型目录**：检查点目录（`config.json` / `audio_tokenizer` / `model*.safetensors`），用于「本机服务启动」生成命令；
- **参考音频目录**：选一个放参考音频的文件夹（wav / mp3 / flac / m4a / ogg），插件直接扫描；
- **参考音频**：点「刷新音色」后选择；
- **参考音频文字稿**：逐字填写这段音频里说的话（克隆模式必填）；
- **声音描述**（可选）：自然语言描述音色 / 语气 / 节奏；
- **CFG 强度**：纯克隆默认 1.0；带「声音描述」建议 4.0；
- 在顶部试听栏输入一句话试听。

### 音色库（音频 + 文字稿）

Breeze 克隆需要「参考音频 + 它的文字稿」同时提供，所以配对直接做在参考音频下拉里：

- 下拉每一项就是该目录里的音频文件，右侧标出状态：`缺文本`（还没配对文字稿）或识别到的语言（`zh` / `ja` / `en` …），当前项带勾；
- 选中一条会同时填入音频与该音频已保存的文字稿；
- 修改文字稿会自动写回这个音频（停止输入约 0.7 秒后保存）；清空文字稿即回到「缺文本」；
- 文件较多时下拉顶部出现「搜索音色（文件名）」；
- 条目存 Host 配置 `settings.json` 的 `voicePairs`（绝对路径 + 文字稿），与 **CosyVoice 共用同一份存储**；下拉显示各自配置目录里的音频，把两个引擎指向同一个目录即可互通。

---

## 三种使用模式

| 参考音频 | 文字稿 | 声音描述 | 模式 |
|---|---|---|---|
| ✅ | ✅ | 空 | **声音克隆**：复刻参考音频的嗓音 |
| ✅ | ✅ | 有 | **带指令的克隆**：保留音色，按描述调整语气 |
| ❌ | — | 有 | **声音设计**：凭空生成音色，无需参考音频 |

模式由面板自动判断并显示在「当前模式」一行；缺少必填项时试听按钮会提示。

---

## 多语言与跨语言

- **朗读文本（target text）**：这个本地检查点官方只支持 **中文 / 英语**（模型卡 `language: en, zh`）。日语、韩语等目标语言不在官方支持范围内。
- **参考音频语言没有硬限制**：克隆用的是音频里的声学 token，文字稿只用来对齐「这段音频在说什么」。所以「日语参考音频 + 日语文字稿 → 朗读中文」可以工作，属于跨语言克隆（cross-lingual cloning）。
- 本机实测（RTX 5070 / 官方 eager API）：
  - 日语参考（七海，5.7s）+ 日语文字稿 → 中文 5.36s，Whisper 回听与原文逐字一致；
  - 音高对比：参考 258 Hz → 输出 231 Hz（同一说话人区间），而中文参考 309 Hz → 输出 313 Hz，说明音色确实跟随了日语参考，没有退回默认音色。
- 仍要注意：
  - 参考文字稿必须与音频严格一致；语言超出训练分布时，稳定性不如中文参考音频。
  - 「声音描述」请用**目标文本的语言**写（读中文就用中文描述）。
  - 日语作为**朗读文本**时，本机实测能被识别，但时长会压缩、稳定性无保证，不建议依赖。
  - 需要日语等 51 种语言的**朗读输出**，要用 BreezeBlue 的在线多语言模型（`breeze-tts-2-multilingual`，仅托管 API/合作节点），当前开源权重里没有这个变体。

---

## 疑难排查

| 症状 | 最常见原因 | 怎么办 |
|---|---|---|
| 无法连接本地服务 | 服务没启动 / 端口不对 | 重新启动 `breeze_infer.api`，确认「服务地址」 |
| `/health` 一直 loading | 模型还在加载 | 等它加载完再试 |
| 合成失败 409 | Breeze 单并发，上一次还在跑 | 等上一次结束（插件按顺序分块，不会并发） |
| 克隆不像 | 文字稿和音频不一致 / 音频有噪声 | 逐字核对文字稿；换更干净的 5–20 秒人声 |
| 声音设计不听指令 | CFG 太低 | 把 CFG 调到 4.0 |
| 显存不足 | 模型 + 其他程序同占显存 | 关掉占显存的程序；不要开 `--fast-all`（需 ~14.4 GiB） |

诊断入口：设置页「一键诊断」，看 `breeze-server`（服务在线）与 `breeze-ref`（参考音频）两项。

---

## 给 AI Agent 的落地附录

- **provider id**：`breeze-tts2`（`/speak` 的 `provider` 字段）。
- **默认服务地址**：`http://127.0.0.1:7860`。
- **本地服务接口**（插件只依赖这些）：
  `GET /health` → `{ status, sample_rate }`；
  `POST /v1/audio/speech`（multipart：`text`、`ref_audio`、`ref_text`、`instruction`、`cfg_scale`、`seed`）
  → 流式 mono 24 kHz s16le PCM（无文件头，响应头 `X-Sample-Rate`）。
- **经插件 Host 中转**：
  参考音频列表 `GET /dsh-tts-api/breeze-voices?dir=<绝对路径>`；
  上传 `POST /dsh-tts-api/breeze-upload`（JSON：`dir` / `filename` / `audioBase64`）；
  服务地址持久化 `GET /dsh-tts-api/breeze-config` / `POST /dsh-tts-api/breeze-config-save`；
  合成 `POST /dsh-tts-api/speak` body `{ text, provider: "breeze-tts2", custom: { baseUrl, voicesDir, voice, refText, instruction, cfgScale, seed } }`
  → 短文本 `{ url }`，长文本 `{ jobId, chunks, total }`（后续块 `GET /dsh-tts-api/rvc-next?job=<jobId>`）。
- **Host 会做的事**：读取参考音频并以 multipart 上传给本地服务；把 PCM 包成标准 44 字节 WAV 再交给播放器。
- **验收标准**：`/health` 为 ok → 任选模式合成一句短文本能播 → 一句长文本能出 `chunks` 且首块可播。
