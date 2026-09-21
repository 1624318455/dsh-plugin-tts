# Edge TTS 指南（默认在线朗读 / Edge TTS Guide）

> dsh-plugin-tts 的 Edge TTS 能力专册。Edge TTS 是插件的默认提供者，开箱即用，无需本地服务与模型。
> 主 README：[中文](../README.zh.md) / [English](../README.md) · 使用手册：[《执行手册》](USER-GUIDE.md)

**目录**
- [Edge TTS 是什么](#edge-tts-是什么)
- [开始前准备](#开始前准备)
- [设置面板配置](#设置面板配置)
- [长文本流式播放](#长文本流式播放)
- [设置项详解](#设置项详解)
- [Edge TTS 疑难排查](#edge-tts-疑难排查)
- [隐私与使用提示](#隐私与使用提示)
- [English](#english)

---

<a name="edge-tts-是什么"></a>
## Edge TTS 是什么

Edge TTS 是微软提供的免费在线合成端点：把要朗读的文本发送过去，返回一段朗读音频后播放。

链路只有一步：

```
消息文本 → Edge TTS 在线合成 → mp3 → 播放
```

特点是零配置：不需要本地服务、不需要下载模型、不需要 API Key，只要本机能访问外网即可用。
它是其他本地音色（如 RVC）的“原声”来源，也是审批语音提醒的固定通道。

---

<a name="开始前准备"></a>
## 开始前准备

| 需要 | 是什么 | 必须吗 |
|---|---|---|
| 可访问外网的网络 | 合成请求需要到达在线端点 | ✅ 必须 |
| 任意现代浏览器 | 播放与自动播放解锁在浏览器内完成 | ✅ 必须 |
| 本地服务 / 模型文件 | 不需要 | ❌ 不需要 |

> 如果网络无法访问在线端点，请改用纯本地的提供者（Index-TTS2 / CosyVoice / RVC）。

---

<a name="设置面板配置"></a>
## 设置面板配置

打开 **设置 → 插件 → 语音**：

- **TTS提供者** 选「**Edge TTS**」（默认即此项）；
- **朗读音色**：从下拉列表选一个喜欢的声音（中文 / 繁体 / 英文 / 日韩法等分组）；
- **声音调节**：语速 / 音调 / 音量，`0` 表示默认，直接作用于本次合成；
- **试听测试**：在面板底部输入一句话点 ▶，马上听效果。

日常朗读入口与所有提供者共用：

- 每条 AI 回复左下角的喇叭按钮 = 朗读本条 / 再点停止；
- 输入框旁的喇叭开关 = 新回复自动朗读；
- 选中消息内一段文本 = 悬浮「朗读选中」只读该片段。

---

<a name="长文本流式播放"></a>
## 长文本流式播放

长回复不会等整段合成完才出声。插件把文本按句切成多块：

1. 第一块合成完成后立即开播，其余块在播放的同时后台合成——**边播边合成**；
2. 切分会避开 URL / 邮箱 / 小数 / 版本号等原子 token，不会把它们从中间切断；
3. 末尾的极短句会并入前一块，避免听感像结巴；
4. 播放期间按钮会显示 chunk 进度；停止 / 切换消息会立即取消后续块的合成。

短文本（预估朗读时长较短）走单文件链路，零额外开销。

---

<a name="设置项详解"></a>
## 设置项详解

| 设置项 | 作用 | 建议 |
|---|---|---|
| 朗读音色 | 决定朗读是谁的声音 | 按语种偏好选；列表外的旧音色可能已被端点移除 |
| 语速 | 朗读快慢 | `0` = 默认；±10-20% 听感自然 |
| 音调 | 声音高低 | `0` = 默认；负值更低沉，正值更明亮 |
| 音量 | 朗读响度 | `0` = 默认；负值更轻，正值更响 |
| 朗读原始 Markdown 符号 | 默认清洗代码块 / 表格 / 链接等符号后朗读；开启后逐字读出原始符号 | 阅读类场景保持关闭；读源码时开启 |
| 播放速度（mini 播放器） | 播放中的变速（1x / 1.25x / 1.5x），不重新合成 | 按听感切换 |
| 审批语音提醒的提醒音色 | 审批事件播报用的独立音色，不跟随主朗读音色 | 选一个辨识度高的声音 |

> 合成音频为 `audio-24khz-48kbitrate-mono-mp3`；同一文本 + 同一音色在同一会话内会复用缓存，不重复合成。

---

<a name="edge-tts-疑难排查"></a>
## Edge TTS 疑难排查

> 💡 设置面板有「**诊断**」按钮：一键检查 Edge TTS 在线合成是否正常，并按「连接 / 协议 / 音色」分类给出可读提示。

| 症状 | 最常见原因 | 怎么办 |
|---|---|---|
| 点朗读没声音 | 浏览器自动播放限制 / 系统音量 | 先在页面任意处点一下再试；检查系统音量与浏览器标签页静音状态 |
| 报 403 / 合成失败 | 在线端点协议或版本校验变更，或网络 / 代理拦截 | 过一会儿重试；仍失败则检查网络 / 代理设置，并反馈诊断日志 |
| 提示 `1007 Unsupported voice` | 所选音色已被端点移除 | 换用列表内的现行音色；插件会自动回退到默认音色 |
| 合成超时（约 45 秒） | 端点无响应或网络黑洞 | 检查网络 / 代理后重试；瞬时抖动会自动重试一次 |
| 试听按钮一直转 | 网络不通或合成未返回 | 看红字提示；确认网络可达后再试 |
| 反馈朗读问题时请附带 | 定位需要的信息 | 页面按 F12 打开控制台，复制 `[tts]` 开头的行；再运行 `copy(JSON.stringify(__dshTtsDebug.dump()))` 一并提供 |

---

<a name="隐私与使用提示"></a>
## 隐私与使用提示

Edge TTS 会把要朗读的文本发送到微软在线端点作合成（个人使用没问题；商用 / 高并发请留意微软服务条款）。
合成音频写入系统临时目录，由系统自动清理；同一会话内的重复朗读会复用缓存，重启后首次朗读会重新合成。

---

<a name="english"></a>
## English

Edge TTS is the default provider: free online synthesis, no local service, no model, no API key —
just network access to the online endpoint.

### Quick start
1. **Prepare**: network access to the online endpoint. Nothing to install.
2. **Configure**: 设置 → 插件 → 语音 → provider = Edge TTS; pick a voice; rate/pitch/volume `0` = default.
3. **Read**: the speaker button under a message reads it; the composer toggle auto-reads new replies;
   selecting text shows a "read selection" chip.

### Key capabilities
- **Progressive long reads**: long replies are sentence-split; the first chunk plays while the rest
  synthesize; atomic tokens (URLs / emails / decimals / versions) are never split mid-token.
- **Clean reads**: message Markdown (code blocks, tables, links, quotes, task lists) is cleaned before
  synthesis; an opt-in toggle reads raw Markdown verbatim for source code.
- **In-session cache**: repeating the same text + voice reuses the cached audio instead of re-synthesizing.

### Troubleshooting
- No sound → browser autoplay policy / system volume; interact with the page once first.
- 403 / synthesis failure → endpoint protocol check changed or network/proxy interception; retry later.
- `1007 Unsupported voice` → the voice was removed by the endpoint; pick a listed voice.

> ⚠️ Privacy: Edge TTS sends the text-to-read to Microsoft's endpoint for online synthesis.
> Check Microsoft's terms for commercial / heavy usage.
