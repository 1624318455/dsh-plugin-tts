# Index-TTS2 指南（本地参考音频音色 / Index-TTS2 Guide）

> dsh-plugin-tts 的 Index-TTS2 能力专册。Index-TTS2 是纯本地合成：音色来自参考音频，不需要 Edge TTS 原声。
> 主 README：[中文](../README.zh.md) / [English](../README.md) · 使用手册：[《执行手册》](USER-GUIDE.md)

**目录**
- [Index-TTS2 是什么](#index-tts2-是什么)
- [开始前准备](#开始前准备)
- [启动本地 Index-TTS2 服务](#启动本地-index-tts2-服务)
- [设置面板配置](#设置面板配置)
- [参考音频与上传](#参考音频与上传)
- [长文本分块播放](#长文本分块播放)
- [设置项详解](#设置项详解)
- [Index-TTS2 疑难排查](#index-tts2-疑难排查)
- [隐私与版权提示](#隐私与版权提示)
- [English](#english)

---

<a name="index-tts2-是什么"></a>
## Index-TTS2 是什么

Index-TTS2 是本地运行的文本转语音服务：输入文本 + 一段参考音频，直接合成出带有该参考音色的朗读。

```
消息文本 + 参考音频 → 本机 Index-TTS2 服务 → wav → 播放
```

与 RVC 的区别：RVC 是“先合成再变声”（需要原声），Index-TTS2 是“直接按参考音色合成”（不需要原声）。
全程在本机完成，参考音频与合成文本不会上传到任何地方。

---

<a name="开始前准备"></a>
## 开始前准备

| 需要 | 是什么 | 必须吗 |
|---|---|---|
| 本地 Index-TTS2 服务包 | 提供 HTTP API 的本地合成服务 | ✅ 必须 |
| 参考音频 | 决定朗读是谁的声音的音频片段 | ✅ 必须（至少一段） |
| 独立显卡 | 加速合成；没有也能用 CPU 跑，只是更慢 | ❌ 可选 |

> 参考音频一般用清晰人声，数秒到数十秒即可；越干净、越接近目标说话人的日常语速，合成效果越稳定。

---

<a name="启动本地-index-tts2-服务"></a>
## 启动本地 Index-TTS2 服务

步骤是通行的三段式，与具体安装位置无关：

1. 解压 / 准备好本地服务包到任意位置；
2. 运行服务包内的 API 启动脚本（一般是一个一键启动脚本），保持启动后的窗口 / 终端**别关**；
3. 看到服务就绪提示（默认监听本地回环地址上的 Index-TTS2 端口）后再回到插件配置。

通用说明：

- **服务地址** 默认指向本地回环地址上的 Index-TTS2 端口；只有把服务改到其他端口 / 其他机器时才需要改；
- 想换参考音频不需要重启服务，在设置面板里重新选择即可；
- 提示端口被占用（`Address already in use` / 端口冲突）= 旧服务还在跑，先关旧的再启动；
- 首次合成较慢是正常的（模型加载 + 预热），之后会快。

服务至少提供三类接口（插件依次用到）：健康检查、参考音色列表、文本合成任务。
只要这三类接口可达，插件就能工作，不关心服务包具体放在哪个目录。

---

<a name="设置面板配置"></a>
## 设置面板配置

打开 **设置 → 插件 → 语音**：

- **TTS提供者** 选「**本地音色（Index-TTS2）**」；
- **服务地址**：一般保持默认（本地 Index-TTS2 服务的地址）；
- **参考音色**：点「**刷新音色**」拉取服务端的参考音频列表，然后选中一段；
- 点面板底部「试听测试」输入一句话试听，确认是想要的声音。

---

<a name="参考音频与上传"></a>
## 参考音频与上传

- **选择**：下拉列表来自服务端当前可用的参考音频；新增音频后点「刷新音色」同步；
- **上传**：面板提供上传入口，支持常见的语音容器格式（如 wav / mp3 / flac / m4a / ogg）；
  上传后自动存入服务端的参考音频区并可直接选用；
- **直接填写**：也支持直接粘贴服务端已有的参考音频文件名；
- **挑选建议**：优先用单人、安静、无背景音乐、无混响的人声片段；过短（1-2 秒）容易不稳定，
  过长（数分钟）会增加加载负担，中等长度最稳。

---

<a name="长文本分块播放"></a>
## 长文本分块播放

长回复会自动按句切块、边合成边播放：先合成前几块立即开播，其余块在播放的同时后台合成，
块间连续播放。首次长文本不需要额外的测速等待；播放期间按钮会显示 chunk 进度。
短文本走单文件链路，零额外开销。

---

<a name="设置项详解"></a>
## 设置项详解

| 设置项 | 作用 | 建议 |
|---|---|---|
| 服务地址 | 本地 Index-TTS2 服务的地址 | 一般保持默认 |
| 参考音色 | 决定朗读是谁的声音 | 用「刷新音色」同步列表后选择 |
| 朗读前清洗文本 | 去掉 Markdown / 链接 / HTML 等符号再合成 | 阅读类场景建议开启；读源码时关闭 |
| 情感控制 | `跟随参考音频` / `情感参考音频` / `情感向量` / `情感文本描述` | 默认跟随参考音频；有明确情绪需求再切换 |
| 情感参考音频 | 用另一段音频的情绪来读 | 仅在情感控制选对应模式时生效 |
| 情感强度 | 情感参考的影响强度 | 默认中等；越大越夸张 |
| 情感描述文本 | 用文字描述情绪（如“开心地朗读”） | 仅在对应模式下生效 |
| 随机情感 | 每次合成加入一点情感随机性 | 想要拟人感可开；要稳定复现则关闭 |
| 单段最大文本 | 长文本按语义切段时每段的最大文本量 | 默认即可；越大越连贯、越小越稳 |
| 随机性 / Top-P / Top-K | 采样发散程度与截断 | 默认即可；越大越发散、越小越稳定 |
| 试听文本 | 面板底部的试听输入 | 换参考音频后务必试听一句确认 |

> 高级采样参数（Top-P / Top-K / 温度 / beam / 重复惩罚等）一般不用改；只有在合成不稳定
> （吞字、复读、断句异常）时再小幅调整。

---

<a name="index-tts2-疑难排查"></a>
## Index-TTS2 疑难排查

> 💡 设置面板有「**诊断**」按钮：一键检查本地 Index-TTS2 服务与参考音色是否正常，
> 并按「连接 / 协议 / 音色」分类给出可读提示。

| 症状 | 最常见原因 | 怎么办 |
|---|---|---|
| 提示无法连接本地服务 | 服务窗口没开 / 被关了 / 服务地址不对 | 重新运行服务包的启动脚本并保留窗口；确认「服务地址」与服务实际端口一致 |
| 点「刷新音色」为空 | 服务端参考音频区没有音频 / 服务未就绪 | 往参考音频区放入音频或用面板上传后再刷新；确认服务已完全启动 |
| 提示参考音频列表读取失败 | 服务未就绪或接口异常 | 等服务就绪后重试；看服务端窗口的报错 |
| 合成失败 / 返回音频过小 | 文本为空、参考音频损坏、服务端异常 | 先换一段参考音频 + 短文本试听；仍失败看服务端窗口报错 |
| 首次合成等很久 | 正常：模型加载 + 预热 | 等它；之后会快 |
| 音色不像 / 情绪不对 | 参考音频质量差或情感模式选错 | 换更干净的参考音频；情感控制先用“跟随参考音频” |
| 反馈问题时请附带 | 定位需要的信息 | F12 控制台 `[tts]` 开头的行；`copy(JSON.stringify(__dshTtsDebug.dump()))` 的输出；服务端窗口的红色报错 |

---

<a name="隐私与版权提示"></a>
## 隐私与版权提示

Index-TTS2 全程本地合成，音频与文本不上传。只使用你有权使用的参考音频（自己录制的、
或已获授权的）；未经同意克隆他人声音可能涉及法律与平台规则问题。

---

<a name="english"></a>
## English

Index-TTS2 is local text-to-speech with reference-audio timbre: text + a reference clip
synthesizes directly into that voice, with no Edge TTS base voice needed — all on your own machine.

### Quick start
1. **Prepare**: a local Index-TTS2 service bundle and at least one reference clip (clean speech works best).
2. **Start the service** (keep the window open): run the bundle's API launcher, wait until it reports ready
   on its loopback port.
3. **Configure**: 设置 → 插件 → 语音 → provider = local Index-TTS2; keep the service URL default;
   click Refresh voices, pick a reference clip, and preview one sentence.

### Key capabilities
- **Reference-audio voices**: the voice list comes from the server; new clips appear after Refresh;
  the panel also uploads common audio containers into the server's reference area.
- **Chunked long reads**: long replies are sentence-split and play while the rest synthesize.
- **Emotion control**: follow the reference / emotion reference clip / emotion vector / emotion text,
  plus strength and an optional randomization toggle.

### Settings explained (abridged)
| Setting | Effect | Guidance |
|---|---|---|
| Service URL | Local Index-TTS2 address | keep default |
| Reference voice | Who reads | refresh then pick |
| Clean text | Strip Markdown/links/HTML before synthesis | on for reading |
| Emotion | How emotion is controlled | follow reference by default |

### Troubleshooting
- Cannot connect → the service window is closed or the URL/port mismatches; restart it and keep it open.
- Empty voice list → no reference clips on the server yet; add or upload one, then refresh.
- First synthesis is slow → normal (model load + warmup).

> ⚠️ Privacy & rights: fully local — nothing is uploaded. Only clone voices you have the right to use.
