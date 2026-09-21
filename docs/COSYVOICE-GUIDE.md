# CosyVoice 指南（本地提示音频克隆 / CosyVoice Guide）

> dsh-plugin-tts 的 CosyVoice 能力专册。CosyVoice 是纯本地零样本克隆：用一段提示音频 + 它的文字稿，直接按该音色朗读任意新文本。
> 主 README：[中文](../README.zh.md) / [English](../README.md) · 使用手册：[《执行手册》](USER-GUIDE.md)
>
> 🤖 **给 AI Agent 的说明**：本文档可直接喂给 AI Agent 照着落地。如果觉得晦涩难懂，或想直接脱手实现，
> 把本文档全文粘贴给你的 AI Agent，让它按文末「给 AI Agent 的落地附录」一步步执行验证即可。

**目录**
- [CosyVoice 是什么](#cosyvoice-是什么)
- [开始前准备](#开始前准备)
- [启动本地 CosyVoice 服务](#启动本地-cosyvoice-服务)
- [设置面板配置](#设置面板配置)
- [提示音频与文字稿（最关键）](#提示音频与文字稿最关键)
- [长文本分块播放](#长文本分块播放)
- [设置项详解](#设置项详解)
- [CosyVoice 疑难排查](#cosyvoice-疑难排查)
- [隐私与版权提示](#隐私与版权提示)
- [给 AI Agent 的落地附录](#给-ai-agent-的落地附录)
- [English](#english)

---

<a name="cosyvoice-是什么"></a>
## CosyVoice 是什么

CosyVoice 是本地运行的零样本语音克隆：给它一段提示音频（告诉它“是谁的声音”），
再给新文本，它就用同一个声音读出新文本。

```
新文本 + 提示音频（+ 提示音频的文字稿）→ 本机 CosyVoice 服务 → wav → 播放
```

与 Index-TTS2 的区别只在配套方式：CosyVoice 要求同时提供提示音频的**文字稿**（transcript），
且对多语提示稿的完整性更敏感；与 RVC 的区别：不需要 Edge TTS 原声，直接合成。
全程在本机完成，不上传。

---

<a name="开始前准备"></a>
## 开始前准备

| 需要 | 是什么 | 必须吗 |
|---|---|---|
| 本地 CosyVoice 服务包 | 提供 HTTP API 的本地合成服务 | ✅ 必须 |
| 提示音频 | 决定朗读是谁的声音的音频片段 | ✅ 必须（至少一段） |
| 提示音频的文字稿 | 提示音频里说的内容，按顺序全文 | ✅ 必须（多语必须全语种写全） |
| 独立显卡 | 加速合成；没有也能用 CPU 跑，只是更慢 | ❌ 可选 |

> 提示音频一般用 5-20 秒清晰人声最佳；单人、安静、无背景音乐、无混响最稳。

---

<a name="启动本地-cosyvoice-服务"></a>
## 启动本地 CosyVoice 服务

步骤是通行的三段式，与具体安装位置无关：

1. 解压 / 准备好本地服务包到任意位置；
2. 运行服务包内的 CosyVoice 启动脚本（一般是一个一键启动脚本），保持启动后的窗口 / 终端**别关**；
3. 看到服务就绪提示（默认监听本地回环地址上的 CosyVoice 端口）后再回到插件配置。

通用说明：

- **服务地址** 默认指向本地回环地址上的 CosyVoice 端口；只有把服务改到其他端口 / 其他机器时才需要改；
- 想换提示音频不需要重启服务，在设置面板里重新选择即可；
- 提示端口被占用（`Address already in use` / 端口冲突）= 旧服务还在跑，先关旧的再启动；
- 首次合成较慢是正常的（模型加载 + 预热），之后会快。

服务至少提供四类接口（插件依次用到）：健康检查、提示音频列表、提示音频上传、文本合成。
只要这四类接口可达，插件就能工作，不关心服务包具体放在哪个目录。

---

<a name="设置面板配置"></a>
## 设置面板配置

打开 **设置 → 插件 → 语音**：

- **TTS提供者** 选「**本地克隆（CosyVoice）**」；
- **服务地址**：一般保持默认（本地 CosyVoice 服务的地址）；
- **提示音频**：点「**刷新音色**」拉取服务端的提示音频列表，然后选中一段；
- **提示音频文字稿**：填写所选提示音频里说的内容（见下一节）；
- 点面板底部「试听测试」输入一句话试听，确认是想要的声音。

---

<a name="提示音频与文字稿最关键"></a>
## 提示音频与文字稿（最关键）

这是 CosyVoice 用好与否的分水岭：

1. **提示音频怎么选**
   - 优先单人、安静、无音乐、无混响的人声；
   - 5-20 秒最稳；过短容易不稳定，过长增加加载负担；
   - 新增音频后点「刷新音色」同步；也可用面板上传常见语音格式，上传后自动存入服务端的提示音频区。
2. **文字稿怎么写**
   - 按**顺序**、**全文**填写提示音频里说的内容，不要只写一半；
   - **多语提示音频必须把每个语种都写全**：例如提示音频里中英日三段都有，就必须中英日三段全写，
     缺一段模型会把缺的那段复读一遍再读新文字；
   - 不确定的地方宁可换一段内容明确的提示音频，也不要留空蒙混。
3. **直接填写**：也支持直接粘贴服务端已有的提示音频文件名；上传入口支持常见语音容器格式。

---

<a name="长文本分块播放"></a>
## 长文本分块播放

长回复会自动按句切块、边合成边播放：先合成前几块立即开播，其余块在播放的同时后台合成，
块间连续播放。短文本走单文件链路，零额外开销。播放期间按钮会显示 chunk 进度。

---

<a name="设置项详解"></a>
## 设置项详解

| 设置项 | 作用 | 建议 |
|---|---|---|
| 服务地址 | 本地 CosyVoice 服务的地址 | 一般保持默认 |
| 提示音频 | 决定朗读是谁的声音 | 用「刷新音色」同步列表后选择 |
| 提示音频文字稿 | 提示音频的内容全文 | 必须按顺序写全；多语全写 |
| 语速 | 合成语速 | `1.0` = 正常；`0.5` 慢速 ~ `2.0` 快速 |
| 随机种子 | 控制合成随机性 | `0` = 每次随机；填固定值可复现同一次合成 |
| 试听文本 | 面板底部的试听输入 | 换提示音频 / 改文字稿后务必试听一句确认 |

> 语速只改变合成节奏，不改变音色；种子只影响可复现性，不影响音质。

---

<a name="cosyvoice-疑难排查"></a>
## CosyVoice 疑难排查

> 💡 设置面板有「**诊断**」按钮：一键检查本地 CosyVoice 服务与提示音频是否正常，
> 并按「连接 / 协议 / 音色」分类给出可读提示。

| 症状 | 最常见原因 | 怎么办 |
|---|---|---|
| 提示无法连接本地服务 | 服务窗口没开 / 被关了 / 服务地址不对 | 重新运行服务包的启动脚本并保留窗口；确认「服务地址」与服务实际端口一致 |
| 点「刷新音色」为空 | 服务端提示音频区没有音频 / 服务未就绪 | 往提示音频区放入音频或用面板上传后再刷新；确认服务已完全启动 |
| 提示音频列表读取失败 | 服务未就绪或接口异常 | 等服务就绪后重试；看服务端窗口的报错 |
| 合成失败 / 返回音频过小 | 文本为空、提示音频损坏、服务端异常 | 先换一段提示音频 + 短文本试听；仍失败看服务端窗口报错 |
| 模型把提示稿复读一遍再读新文字 | 多语提示音频的文字稿没写全 | 把提示音频里每个语种的内容都补全到文字稿 |
| 首次合成等很久 | 正常：模型加载 + 预热 | 等它；之后会快 |
| 反馈问题时请附带 | 定位需要的信息 | F12 控制台 `[tts]` 开头的行；`copy(JSON.stringify(__dshTtsDebug.dump()))` 的输出；服务端窗口的红色报错 |

---

<a name="隐私与版权提示"></a>
## 隐私与版权提示

CosyVoice 全程本地合成，音频与文本不上传。只使用你有权使用的提示音频（自己录制的、
或已获授权的）；未经同意克隆他人声音可能涉及法律与平台规则问题。

---

<a name="给-ai-agent-的落地附录"></a>
## 给 AI Agent 的落地附录

> 以下契约对所有机器通用，不含任何个人路径。按顺序执行即可打通本地服务与 dsh 的联通。

- **provider id**：`cosyvoice`（`/speak` 的 `provider` 字段就填这个）。
- **默认服务地址**：`http://127.0.0.1:7890`（回环地址 + 默认端口；只有改过端口 / 远端部署才改）。
- **本地服务最小接口**（插件只依赖这四个，目录位置不重要）：
  `GET /health`（存活）、`GET /voices` → `{ voices: [] }`（提示音频列表）、
  `POST /upload`（上传提示音频）、`POST /tts`（合成，body 含 `text` / `prompt` / `prompt_text` / `speed` / `seed`，
  返回 `{ audio_base64 }`）。
- **经插件 Host 中转的调用**（前端不直连本地服务）：
  提示音频列表 `GET /dsh-tts-api/cosy-voices?baseUrl=<服务地址>`；
  上传提示音频 `POST /dsh-tts-api/cosy-upload`；
  服务地址持久化 `GET /dsh-tts-api/cosy-config` / `POST /dsh-tts-api/cosy-config-save`；
  合成 `POST /dsh-tts-api/speak` body `{ text, provider: "cosyvoice", custom: { baseUrl, voice, promptText, speed, seed } }`
  → 短文本 `{ url }`，长文本 `{ jobId, chunks, total }`（后续块 `GET /dsh-tts-api/rvc-next?job=<jobId>`）。
- **文字稿必填校验**：`promptText` 必须与所选提示音频的内容按序全文一致；多语提示音频缺任一段都会复读，
  这是联通成功但“读错”的头号原因，先查它再查服务。
- **诊断验证**：`POST /dsh-tts-api/diagnose` body `{ cosyBaseUrl }` → 看 `checks` 里
  `cosy-server`（服务是否在线）与 `cosy-voice`（提示音频是否非空）。
- **验收标准**：提示音频列表非空 → 任选一段 + 写对文字稿合成一句短文本能播 → 一句长文本能出 `chunks` 且首块可播。

---

<a name="english"></a>
## English

CosyVoice is local zero-shot voice cloning: a prompt clip (+ its transcript) defines the voice,
and any new text is read in that voice — all on your own machine, no Edge TTS base voice needed.

### Quick start
1. **Prepare**: a local CosyVoice service bundle, at least one prompt clip (5-20s of clean speech works best),
   and its transcript.
2. **Start the service** (keep the window open): run the bundle's launcher, wait until it reports ready
   on its loopback port.
3. **Configure**: 设置 → 插件 → 语音 → provider = local CosyVoice; keep the service URL default;
   click Refresh voices, pick a prompt clip, fill its **full transcript in order**, and preview one sentence.

### The transcript rule (most important)
- Write **everything** the prompt clip says, **in order**.
- **Multilingual prompts must include every language part**: if the clip speaks three languages,
  all three transcripts are required — otherwise the model re-reads the missing part before the new text.
- When in doubt, switch to a clip whose content you can transcribe exactly.

### Settings explained (abridged)
| Setting | Effect | Guidance |
|---|---|---|
| Service URL | Local CosyVoice address | keep default |
| Prompt audio | Who reads | refresh then pick |
| Prompt transcript | What the prompt clip says | full, in order, all languages |
| Speed | Synthesis pace | 1.0 normal (0.5 slow ~ 2.0 fast) |
| Seed | Randomness | 0 = random each time; fixed = reproducible |

### Troubleshooting
- Cannot connect → the service window is closed or the URL/port mismatches; restart it and keep it open.
- Empty prompt list → no prompt clips on the server yet; add or upload one, then refresh.
- Model repeats the prompt before new text → the transcript is incomplete; complete every language part.
- First synthesis is slow → normal (model load + warmup).

> ⚠️ Privacy & rights: fully local — nothing is uploaded. Only clone voices you have the right to use.
