# Cloud TTS 指南（谷歌付费在线音色 / Cloud TTS Guide）

> dsh-plugin-tts 的 Cloud TTS 能力专册。Cloud TTS 是谷歌付费在线合成：音质与语种覆盖最好，但需要自备 API Key 并按量计费。
> 主 README：[中文](../README.zh.md) / [English](../README.md) · 使用手册：[《执行手册》](USER-GUIDE.md)

**目录**
- [Cloud TTS 是什么](#cloud-tts-是什么)
- [开始前准备](#开始前准备)
- [获取 API Key 并启用接口](#获取-api-key-并启用接口)
- [设置面板配置](#设置面板配置)
- [用量与计费口径](#用量与计费口径)
- [长文本分块播放](#长文本分块播放)
- [设置项详解](#设置项详解)
- [Cloud TTS 疑难排查](#cloud-tts-疑难排查)
- [安全与隐私提示](#安全与隐私提示)
- [English](#english)

---

<a name="cloud-tts-是什么"></a>
## Cloud TTS 是什么

Cloud TTS（Google Cloud Text-to-Speech）是谷歌的在线合成服务：把文本发送到谷歌端点，
按所选 voice 合成后返回音频播放。

```
消息文本 → Google Cloud TTS 端点 → mp3 → 播放
```

与 Edge TTS 的区别：Edge 免费、无 Key；Cloud 需要自备 API Key，且超出免费额度后按量计费，
但中文标准 / 波形 / 神经网络等档位的音质与稳定性通常更好。
不需要本地服务与模型，只要本机能访问谷歌端点即可用。

---

<a name="开始前准备"></a>
## 开始前准备

| 需要 | 是什么 | 必须吗 |
|---|---|---|
| 可访问谷歌端点的网络 | 合成请求需要到达 Cloud TTS 端点 | ✅ 必须 |
| Google Cloud 项目 | 用于启用 Text-to-Speech API 并创建凭据的容器 | ✅ 必须 |
| API Key | 插件调用端点时的身份凭据 | ✅ 必须 |
| 本地服务 / 模型文件 | 不需要 | ❌ 不需要 |

> 免费额度按自然月重置（见下文）；超出后按谷歌账单计费，用量以谷歌控制台为准。

---

<a name="获取-api-key-并启用接口"></a>
## 获取 API Key 并启用接口

通行步骤（界面文案可能随控制台改版变化，认准同名入口即可）：

1. 登录 Google Cloud Console，创建或选择一个项目；
2. 在「API 和服务」中找到 Text-to-Speech API 并**启用**它（未启用会报无权限）；
3. 在「API 和服务 → 凭据」中**创建 API Key**（类型选 API Key 即可）；
4. （可选）给 Key 设置应用限制 / API 限制，并记下项目 ID 备用；
5. 回到插件面板粘贴保存（见下一节），然后用「测试连接」验证。

通用说明：

- Key 与具体机器、目录、环境变量无关，任何一台能联网的机器粘贴同一个 Key 都能用；
- 如长期在服务端 / 共享机器使用，建议给 Key 加上调用方限制并定期轮换；
- 当前版本只用 API Key 调用，不需要服务账号 JSON。

---

<a name="设置面板配置"></a>
## 设置面板配置

打开 **设置 → 插件 → 语音**：

- **TTS提供者** 选「**Cloud TTS（谷歌付费）**」；
- **Cloud 音色**：从中文组下拉选择（默认推荐波形档），或直接输入完整的 voice id
  （如其他语种 / Neural2 / Chirp 系）；
- **API Key**：粘贴后点「**保存配置**」；输入框会清空，这是正常的——Key 只存本机 Host 文件，
  不回显、不进浏览器存储；
- **Project ID（可选）**：当前版本仅做记录，不填也能用；
- 点「**测试连接**」：成功会合成一句测试语音（其字符会计入本月用量）；
- 点面板底部「试听测试」输入一句话试听，确认音色与语速。

---

<a name="用量与计费口径"></a>
## 用量与计费口径

插件面板自带「本月用量（本地计数）」，按档位分别统计：

| 档位 | 本地计数口径 | 免费额度（每月） |
|---|---|---|
| Standard | 发送字符数（含 SSML 标签） | 前 400 万字符 |
| Wavenet / Neural2 / Chirp 3 | 发送字符数（含 SSML 标签） | 各前 100 万字符 |

通用说明：

- 档位按 voice 名称自动归档（名称含 `wavenet` / `neural2` / `chirp` 即归入对应档，否则按 Standard 计）；
- 本地计数每月 1 号自动清零，仅供参考；**实际账单以谷歌控制台为准**；
- 测试连接与试听同样会消耗字符，频繁试听大段文本会显著增加用量；
- 长文本会被切成多个小包逐包合成，每包独立计费，总和即本次朗读的消耗。

---

<a name="长文本分块播放"></a>
## 长文本分块播放

Cloud TTS 的同步接口对单包大小有硬上限，长回复会被自动切包：

1. 文本先按句切分并避开 URL / 邮箱 / 小数 / 版本号等原子 token，再按字节与字符双上限
   打包，保证每包都不超限；
2. 第一包合成完成后立即开播，其余包在播放的同时后台合成——**边播边合成**；
3. 单包失败只重试该包，不会整段重来；极少数坏包会被跳过并提示，不中断整段播放；
4. 短文本只发一包，走单文件链路，零额外开销。

---

<a name="设置项详解"></a>
## 设置项详解

| 设置项 | 作用 | 建议 |
|---|---|---|
| Cloud 音色 | 决定朗读是谁的声音 | 中文优先用中文组波形档；跨语种直接输入完整 voice id |
| 语速 / 音调 / 音量 | 与 Edge 共用的声音调节，映射为 Cloud 音频参数 | `0` = 默认；小幅调整即可 |
| API Key | 调用谷歌端点的凭据 | 粘贴后保存；输入框清空 = 已存入本机文件 |
| Project ID | 项目标识，仅记录 | 可留空；不影响合成 |
| 测试连接 | 用最小成本验证 Key 与网络 | 换 Key / 换网络后必点一次 |
| 本月用量 | 本地按档位计数的字符消耗 | 每月 1 号清零；对账以谷歌控制台为准 |
| 清除 Key | 删除本机保存的 Key | 换 Key / 停用 Cloud 前使用；清除后 Cloud 不可用 |

---

<a name="cloud-tts-疑难排查"></a>
## Cloud TTS 疑难排查

> 💡 设置面板有「**诊断**」按钮与「**测试连接**」按钮：先点测试连接，再看红字分类提示。

| 症状 | 最常见原因 | 怎么办 |
|---|---|---|
| 提示未配置 API Key | 还没保存 Key，或 Key 被清除 | 粘贴 Key 后点「保存配置」，再点「测试连接」 |
| 提示 Key 无效 / 未启用 API（401 / 403） | Key 粘贴不完整 / Text-to-Speech API 未启用 / Key 有调用限制 | 检查粘贴是否完整；去控制台确认 API 已启用；确认 Key 的限制允许该 API |
| 提示请求被拒绝（400） | voice id 无效或单包超限 | 换用列表内音色或检查手输的 voice id；长文本由插件自动切包，一般无需处理 |
| 合成失败 / 网络错误 | 到谷歌端点的网络不通、代理拦截 | 检查网络 / 代理后重试；瞬时抖动会自动重试 |
| 返回音频异常 / 过小 | 服务端异常或文本为空 | 换短文本重试；仍失败看红字详情并反馈 |
| 用量涨得比预期快 | 本地口径含 SSML 标签；试听与测试连接同样计费 | 减少大段试听；以谷歌控制台账单为准对账 |
| 反馈问题时请附带 | 定位需要的信息 | F12 控制台 `[tts]` 开头的行；`copy(JSON.stringify(__dshTtsDebug.dump()))` 的输出；**不要**粘贴你的 API Key |

---

<a name="安全与隐私提示"></a>
## 安全与隐私提示

- API Key 只保存在本机 Host 文件，不进浏览器存储、不回显；任何「导出诊断日志」都不会包含 Key，
  反馈问题时也**不要**把 Key 发给任何人；
- Cloud TTS 会把要朗读的文本发送到谷歌端点合成，涉密文本请评估后再用；
- 合成音频写入系统临时目录，由系统自动清理；同文本 + 同音色在同一会话内会复用缓存。

---

<a name="english"></a>
## English

Cloud TTS (Google Cloud Text-to-Speech) is the paid online provider: best coverage and quality,
but it needs your own API key and bills past the free tier. No local service or model needed —
just network access to Google's endpoint.

### Quick start
1. **Prepare**: a Google Cloud project with the Text-to-Speech API enabled, plus an API key.
   (Console → APIs & Services → enable the API → Credentials → Create API key.)
2. **Configure**: 设置 → 插件 → 语音 → provider = Cloud TTS; pick a voice (or type a full voice id);
   paste the key → Save (the input clears — the key lives in the local Host file only);
   click Test connection, then preview one sentence.
3. **Read**: same entries as every provider (message button / auto-read toggle / selection chip).

### Usage & billing caliber
- Local monthly counters per tier (SSML-inclusive chars): Standard free 4M/month;
  Wavenet / Neural2 / Chirp 3 free 1M/month each; resets on the 1st.
- Tier is auto-detected from the voice name; the local count is indicative only —
  **Google Cloud Billing is authoritative**.
- Test clips and previews also consume characters.

### Key capabilities
- **Packetized long reads**: long replies are sentence-split and packed under the sync byte limit;
  the first packet plays while the rest synthesize; per-packet retry only.
- **Key hygiene**: write-only input, Host-file-only storage, never echoed, never exported in logs.

### Troubleshooting
- No key configured → paste and save the key, then test the connection.
- 401/403 → key truncated, API not enabled, or key restrictions block the API.
- 400 → invalid voice id or over-limit packet; use a listed voice.
- Never paste your API key when reporting issues.
