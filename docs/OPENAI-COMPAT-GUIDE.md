# OpenAI 兼容 TTS 指南（自定义接口 / OpenAI-Compatible Guide）

> dsh-plugin-tts 的「OpenAI 兼容」提供者专册。这一路只对接 **说 `/v1/audio/speech` 协议的服务**：
> OpenAI 官方、Fish Speech、SiliconFlow、vLLM-TTS、GPT-SoVITS 网关、各类自建/中转服务。
> 主 README：[中文](../README.zh.md) / [English](../README.md) · 使用手册：[《执行手册》](USER-GUIDE.md) · 维护者测试方案：[《测试方案》](https://github.com/1624318455/dsh-plugin-tts/blob/main/docs/OPENAI-TEST-PLAN.md)（仅源码仓库）
>
> 🤖 **给 AI Agent 的说明**：想给某个本地引擎接上朗读，先读「这是传输层，不是参数层」一节，
> 再按「GPT-SoVITS 落地」照做。参数映射永远写给网关，不要试图塞进插件的 OpenAI 字段里。

**目录**
- [这是传输层，不是参数层](#这是传输层不是参数层)
- [什么时候用它 / 什么时候别用](#什么时候用它--什么时候别用)
- [请求契约](#请求契约)
- [设置面板配置](#设置面板配置)
- [高级参数 extraBody：唯一能传私有参数的口子](#高级参数-extrabody唯一能传私有参数的口子)
- [GPT-SoVITS 落地（含现成网关）](#gpt-sovits-落地含现成网关)
- [长文本分块播放](#长文本分块播放)
- [疑难排查](#疑难排查)
- [English](#english)

---

<a name="这是传输层不是参数层"></a>
## 这是传输层，不是参数层

OpenAI 的音频协议只有 5 个字段：

```
model · voice · input · response_format · speed
```

它表达不了这些引擎真正需要的东西：

| 引擎 | 它要的参数 | OpenAI 协议里有位置吗 |
|---|---|---|
| Index-TTS2 | `prompt_audio` 参考音频路径、`emo_control_method`、`top_k`、`num_beams` … 共 16 项 | ❌ 没有。`voice` 是枚举名（alloy/nova），不是文件路径 |
| CosyVoice2 | `prompt` 参考音频、`prompt_text` 逐字稿、`seed` | ❌ 逐字稿无处安放 |
| GPT-SoVITS | `ref_audio_path`、`prompt_text`、`text_lang`、`top_k`、`repetition_penalty` … | ❌ 同上 |

三套参数的交集只有 `speed` 一项。

所以这个提供者的定位是：

- ✅ **统一传输**：一个 `fetch`、一套超时、一套错误归类、一套音频校验（按真实文件头判断 wav/mp3，不信 `response_format`）
- ❌ **不统一参数**：私有参数走 `extraBody`，由网关决定透传，插件不猜

**推论（重要）**：Index-TTS2 / CosyVoice 请继续用它们各自的专用提供者，那里有 16 项参数的原生面板。
把它们折叠进 OpenAI 入口只会丢参数。要接一个**新**引擎，写网关比改插件划算。

---

<a name="什么时候用它--什么时候别用"></a>
## 什么时候用它 / 什么时候别用

**用它**
- 你已经有（或愿意写）一个把引擎包成 `/v1/audio/speech` 的网关
- 目标服务本身就是 OpenAI 协议：OpenAI 官方、Azure-compat 中转、Fish Speech、SiliconFlow、vLLM-TTS
- 引擎参数很少（只要音色 + 语速），网关一层就能表达

**别用它**
- 引擎参数密集（Index-TTS2、CosyVoice、GPT-SoVITS 原生 /tts）→ 用专用提供者，或写网关后用本提供者
- 你不想维护网关进程 → 用已有的专用提供者

---

<a name="面板字段"></a>
## 面板字段：只有 API 地址必填

| 字段 | 必填 | 留空时 | 说明 |
| --- | --- | --- | --- |
| API 地址 | **必填** | — | 服务根地址；插件自动补 `/v1/audio/speech`，带 `/v1` 或完整端点也认 |
| API Key | 选填 | 不带 `Authorization` 头 | 只存本机 Host 配置，不写浏览器存储、不回显明文 |
| 模型 | 选填 | `tts-1` | 本地网关常忽略此值 |
| 音色 | 选填 | `alloy` | 网关自定义的音色名；GPT-SoVITS 网关切 `voice` 即切角色 |
| 输出格式 | 选填 | `wav` | 只告诉服务端要什么；真实容器按返回字节判断 |
| 语速 | 选填 | `1` | 0.25–4.0 |
| 高级参数（面板上显示为「高级参数」，即 extraBody） | 选填 | 空 | JSON 对象，平铺进请求体传引擎私有参数 |

面板上只有「API 地址」带一个红色星号，其余字段不带任何标记 —— 这是 GOV.UK Design System 与 USWDS 都推荐的写法：只标少数派（必填），别给每个选填项挂徽标，否则整屏都是标签噪声。字段下方的灰色小字就是它的留空语义，不需要另外的图例。

填完点「运行诊断」，没有单独的「测试」按钮 —— 从 0.7.0 起两者合并：诊断会一次测完接口连通和真实合成（未选用本提供者时这两项自动跳过，不会误报红）。

---

<a name="请求契约"></a>
## 请求契约

插件发出（`POST {API 地址}/v1/audio/speech`，`Content-Type: application/json`）：

```json
{
  "model": "tts-1",
  "voice": "alloy",
  "input": "要朗读的文本",
  "response_format": "wav",
  "speed": 1.0
}
```

地址处理（三种写法都认）：

```
http://127.0.0.1:8000                    → http://127.0.0.1:8000/v1/audio/speech
http://127.0.0.1:8000/v1                 → http://127.0.0.1:8000/v1/audio/speech
http://127.0.0.1:8000/v1/audio/speech    → 原样使用
```

响应要求：
- 状态 200 + **二进制音频**，容器为 wav / mp3 / aac / flac / ogg / aiff 之一（插件按 magic bytes 判断，不看 header）
- 小于 1000 字节视为失败（避免上游异常返回一段空音频还播"成功"）
- **200 + JSON 会被判为失败**，并把 JSON 里的 `error/message` 显示出来——本地网关最常见的坑就是这个：上游 4xx 被包成 200 返回

鉴权：填了 API Key 就带 `Authorization: Bearer <key>`，没填就不带（本地服务一般不校验）。
Key 只存在本机 Host 配置文件 `~/.dsh/tts-rvc/settings.json` 的 `openai.apiKey`，**不写浏览器存储、不回显明文**，GET 只返回 `apiKeySet` 和末四位。

地址优先级：**请求里带的 API 地址 > Host 文件里保存的地址 > 内置默认值**。所以面板上改了地址马上点「运行诊断」，测的一定是当前这个地址，不会被旧配置劫持；Host 文件只在请求没带地址时兜底（长文分块任务、旧版客户端）。
缓存也按「有效地址 + model + voice + format + speed + extraBody」隔离：换端点后同一句话不会命中上一个端点合成的音频。

容器识别补充：0xFFF 同步头同时属于 MP3 和 ADTS AAC，插件按 layer 位区分（layer=00 判为 AAC），不会把 AAC 存成 `.mp3` 后播不出来。

---

<a name="设置面板配置"></a>
## 设置面板配置

| 配置项 | 默认 | 说明 |
|---|---|---|
| API 地址 | `http://127.0.0.1:8000` | 服务根地址；带 `/v1` 或完整端点也认 |
| API Key | 空 | 留空不带鉴权；只存 Host 文件 |
| 模型 | `tts-1` | 请求体 `model`；本地网关常忽略，随便填 |
| 音色 | `alloy` | 请求体 `voice`；自建网关一般自定义（常见 `default`） |
| 输出格式 | `wav` | 请求体 `response_format`；只是告诉服务端要什么，插件仍按真实字节判断 |
| 语速 | `1.0` | 协议 `speed` 倍率 0.25–4.0；网关不支持会 400，调回 1.0 |
| 高级参数 | 空 | 见下一节 |

面板上另有两个按钮：
- **拉取模型**：GET `{地址}/v1/models`，把返回的 id 填成下拉候选。网关不实现该端点时会提示「手动填写」，不算错。
- **测试**：真实合成一句「你好，这是一个语音测试。」，返回耗时 + 字节数 = 通了。

---

<a name="高级参数-extrabody唯一能传私有参数的口子"></a>
## 高级参数 extraBody：唯一能传私有参数的口子

填一个 JSON 对象，插件会把它**平铺**进请求体（和 OpenAI Python SDK 的 `extra_body` 约定一致）：

```
高级参数：{"top_k": 15, "text_lang": "zh", "repetition_penalty": 1.35}
实际发出：{model, voice, input, response_format, speed, top_k, text_lang, repetition_penalty}
```

三条硬规则：

1. **平铺，不嵌套**。不要写成 `{"extra_body": {...}}`，那会被当成一个叫 `extra_body` 的普通键。
2. **只有网关透传才生效**。严格校验字段的服务（OpenAI 官方）会直接 400；本地网关要显式把未知键并进引擎调用。
3. **能覆盖标准字段**。`extraBody` 里写 `voice` 会盖掉面板上的音色，可用于网关的别名映射。

插件对映射**零责任**：它不知道 `top_k` 该翻译成什么。这就是把参数层交给网关的含义。

---

<a name="gpt-sovits-落地含现成网关"></a>
## GPT-SoVITS 落地（含现成网关）

GPT-SoVITS 的两个事实，先记住：
- **Gradio WebUI 没有 HTTP 接口**。浏览器里能点合成 ≠ 插件能连上。要额外起同目录的 `api_v2.py`。
- `api_v2.py` 的 `/tts` 入参是 GPT-SoVITS 自己的形状，不是 OpenAI 协议。所以需要一层网关。

仓库里带了一个零依赖网关：`tools/gpt-sovits-openai-gateway.py`（只用 Python 标准库）。

> **这是可选组件，不是插件本体。** 只用 Edge / 云端 TTS 的用户完全不用碰它，
> 也不需要装 Python —— 插件运行时只加载 `lib/` 与 `cordis.patch.yml`。
> 从仓库根目录跑时用下面的 `tools\...` 路径；通过 npm / dsh-market 安装的用户，
> 脚本在 `node_modules/@memef1f1y/dsh-plugin-tts/tools/gpt-sovits-openai-gateway.py`。
> 它是单文件、不引用仓库里任何其他文件，单独拷到任意目录也能跑。
> `verify-openai-gateway.py`、`mock-sovits-upstream.py` 和 `tests/` 属于维护者自检，
> **不在 npm 发布包里**，只在仓库源码中。

**① 起 GPT-SoVITS 的 API**

```bat
:: 在 GPT-SoVITS 整合包根目录，用包内嵌的 python（直接敲 python 往往不是它）
:: 部分第三方整合包需要 PYTHONUTF8=0，原因见下面「坑 1」
set PYTHONUTF8=0
runtime\python.exe api_v2.py -a 127.0.0.1 -p 9881 -c GPT_SoVITS\configs\tts_infer.yaml
```

**② 起网关**（任意 python3.8+ 都行）

```bat
python tools\gpt-sovits-openai-gateway.py ^
  --upstream http://127.0.0.1:9881 ^
  --ref-audio "<参考音频.wav>" ^
  --prompt-text "参考音频里说的那句话" ^
  --prompt-lang zh --text-lang zh --port 8000
```

多个角色音色（插件里的「音色」填名字即可切换）：

```json
// voices.json
{
  "默认":  {"ref_audio": "D:/refs/a.wav", "prompt_text": "……", "prompt_lang": "zh"},
  "角色B": {"ref_audio": "D:/refs/b.wav", "prompt_text": "……", "prompt_lang": "zh"}
}
```

```bat
python tools\gpt-sovits-openai-gateway.py --voices voices.json --port 8000
```

网关做的映射：

| OpenAI 字段 | GPT-SoVITS 字段 |
|---|---|
| `input` | `text` |
| `voice`（名字/路径） | `ref_audio_path` + 该音色的 `prompt_text` |
| `response_format` | `media_type` |
| `speed` | `speed_factor` |
| `extraBody` 里的键 | 原样并入 payload（`top_k`、`text_split_method`、`repetition_penalty`、`emo_*` …） |
| `text_split_method`（**默认自动**） | 网关按文本选：≤1 句 `cut0`、多句 `cut1`、>120 字 `cut5`；`--split-method` 可强制 |

**③ 插件里填**

提供者选「OpenAI 兼容」→ API 地址 `http://127.0.0.1:8000` → 模型 `gpt-sovits` → 音色填 `默认` 或 `角色B` → 点面板下方的「运行诊断」，看到「OpenAI 兼容接口 在线」+「OpenAI 兼容合成 正常（…ms · … B）」即成功。

冷启动首句约 10 秒以上，插件对这条链路给的是 180 秒超时，不会误杀。
权重由 `tts_infer.yaml` 的 `custom` 段决定：WebUI 里切好的模型，`api_v2.py` 起来就是同一套，不需要在插件里再切。

**自检网关**（维护者改网关时用；最终用户不需要，不需要真模型，mock 上游跑通映射）：

```bat
python tools\verify-openai-gateway.py
```

### 真机实测踩到的五个坑（GPT-SoVITS V4 整合包 + NVIDIA GPU）

**坑 1 · 整合包的 python 起不来（`Fatal Python error: init_import_site`）**

报错长这样：

```text
UnicodeDecodeError: 'utf-8' codec can't decode byte 0xbd in position 31: invalid start byte
  File "...\env\lib\site.py", line 179, in addpackage
```

原因不在 GPT-SoVITS，而在整合包的 `env\Lib\site-packages\users.pth` 是 **GBK 编码**（里面写着整合包自己的绝对路径）。
你的 shell / 环境变量里一旦有 `PYTHONUTF8=1`，Python 会强制用 UTF-8 去解析 `.pth`，当场崩。
**解法：`set PYTHONUTF8=0` 再启动**（或在启动该进程的环境里删掉 `PYTHONUTF8`）。不要改那个 `.pth`，改了可能影响启动器。

**坑 2 · 系统代理劫持本地请求（已在新版网关内修掉）**

Windows 上开着 Clash / V2Ray 时，系统会设全局 `HTTP_PROXY`。Python 的 `urllib` 默认照单全收，
于是网关连 `127.0.0.1:9881` 也先发给代理：
- 每次合成多一跳，白加几十到几百毫秒；
- `api_v2.py` 没起来时，你收到的是代理的 502 和 `upstream connect failed (os error 10061)`，
  完全看不出该去启什么。

现在网关对 **loopback 地址强制不走代理**（`opener_for()`），于是断链时能直接告诉你「api_v2.py 起来了吗」。
自检里加了回归用例：把 `HTTP_PROXY` 指向死端口，网关仍必须正常合成。

**坑 3 · `response_format` 只认 wav**

`api_v2.py` 的输出格式由 `media_type` 决定，传 `mp3` / `aac` 会直接 400：

```json
{"error": {"message": "GPT-SoVITS /tts 返回 HTTP 400：{\"message\":\"media_type: mp3 is not supported\"}"}}
```

插件会把上游原文一并显示出来。**面板里输出格式保持 `wav`**；需要 mp3 就自己转，或换一个会转码的网关。

**坑 4 · `extraBody` 写错键名不会报错**

`api_v2.py` 对未知字段是静默忽略（实测 `{"not_a_real_param":123}` 返回 200）。
所以「参数没生效」时不要先怀疑插件，先对照 GPT-SoVITS 的 `/tts` 字段名逐个核对。
另注：诊断里的合成探测发的是固定中文探针（`你好，这是一个语音测试。`），
纯日文/英文音色配 `--text-lang ja` 时这句会读得很怪，属正常现象，不代表链路有问题。

**坑 5 · 句尾「气口没说完就断了」（已改默认值）**

现象：试听「你好，这是一个语音测试。」，最后的「试」像被掐掉，气口没收完就静音了。

先排除误判：把合成出的 wav 下载下来丢进 Audacity，**文件末尾其实还有 260–405ms 静音**——
不是容器被裁，也不是插件打断播放（客户端单文件走 `<audio>` + `onended`，没有按估算时长截停）。
是模型在 EOS 处提前收尾。

真正的原因在网关：原先写死 `text_split_method: "cut5"`，它会按标点把句子切成
「你好，」+「这是一个语音测试。」两段**独立合成**，每段重新起调、各自收尾，最后半句成了孤立的短段，
收尾自然短。而插件本身已经按 15 秒把文本切块，这次切分属于**二次切分**，纯属多余。

实测（同一句各 4 次采样，结构完全稳定）：

| 切分 | 总长 | 语音结束 | 尾部静音 | 句间硬插 |
|---|---|---|---|---|
| `cut5`（旧默认） | 2.280s | 1.875s | 405ms | ~380ms |
| `cut0`（现默认·单句） | 2.320s | 2.059s | 261ms | — |

现默认按文本自动选：≤1 句 `cut0`（整句合成，尾音完整）、多句 `cut1`（按句切，句子内部连贯、句间保留自然停顿）、
>120 字 `cut5`（超长段才标点级细切）。要退回旧行为：`--split-method cut5`，
或面板「高级参数」填 `{"text_split_method":"cut5"}` 单次覆盖。

顺带一个反直觉的结论：这台机器上 **`seed` 不生效**。同一请求连发两次 md5 不同，
显式 `seed: 1234` 也一样，只是时长和收尾位置不变（结构确定、细节随机）。
所以「每次试听语气都略有差别」是正常现象，锁不住；长文分块时每块都是独立采样，块间音色会轻微漂移。
`temperature` 同理：1.1 和 1.2 出来的长度完全一致，调它没用。

---

<a name="长文本分块播放"></a>
## 长文本分块播放

预计朗读超过 12 秒的文本会自动分块：每块 15 秒音频、预生成 2 块、**首块合成完立即返回**（其余后台预热），
所以 TTFB 只等一次请求。和 Edge / Cloud 同一条流水线：播放按块序号严格顺序，单块失败只跳过该块，不会中断整篇。

> 冷启动：第一块要等模型加载（10 秒级），此时还没开始播放，不会「卡顿」；后续块在上一块播放期间预热完。

---

<a name="疑难排查"></a>
## 疑难排查

**`ECONNREFUSED` / 无法连接**
地址或端口不对，或服务没起。先手动验证：
```bash
curl -s http://127.0.0.1:8000/v1/models
```
返回 404 是正常的（很多网关不实现 /models）；返回 connection refused 就是没起。
把 GPT-SoVITS 的 WebUI 当成 API 是最常见的错：WebUI 不开 HTTP 接口，要 `api_v2.py`。

**HTTP 400**
请求体被拒。依次排查：`model` 是不是网关认识的；`voice` 是不是它认识的；`response_format` 是不是它支持的容器（很多网关只出 wav）；`speed` 是否支持（不支持就调回 1.0）；`extraBody` 里的键是否被严格校验拒绝。

**HTTP 401 / 403**
Key 没填 / 填错 / 没生效。API Key 保存后要重新点「运行诊断」，旧请求不会带新 Key。

**测试成功但没有声音 / 朗读报"没有返回有效音频"**
上游 200 但返回的是 JSON 错误体，插件已经拦下来了（会显示 JSON 内容）。按 JSON 里的 message 修网关。

**消息很短也报错**
单块合成失败。这条链路没有 Edge 那种「改用 Edge 重读」之外的回退，看诊断日志里的 `speak` 记录，注意状态码。

**改了参数没效果**
`extraBody` 里的键网关没透传。本地网关要显式 merge 未知字段进引擎调用——参考 `tools/gpt-sovits-openai-gateway.py` 的 `build_payload()`。

---

## English

> OpenAI-compatible provider guide. It adapts the **transport**, not the parameters.

**What it is**: one provider that speaks `POST {baseURL}/v1/audio/speech` to any service implementing the OpenAI audio shape — OpenAI itself, Fish Speech, SiliconFlow, vLLM-TTS, a GPT-SoVITS gateway.

**What it is not**: a universal parameter layer. The protocol has only `model / voice / input / response_format / speed`; Index-TTS2 needs 16 parameters, CosyVoice2 needs a prompt transcript, and `voice` is an enum name rather than a file path. The intersection of all three engines is `speed` alone. Use the dedicated Index-TTS2 / CosyVoice providers for those engines.

**Advanced parameters (`extraBody`)**: a JSON object flattened into the request body (the SDK's `extra_body` convention). It only works if the gateway forwards unknown keys to the engine; a strict server answers 400. The plugin never maps engine parameters — that is the gateway author's job.

**GPT-SoVITS**: its Gradio WebUI exposes no HTTP API; run `api_v2.py` and put `tools/gpt-sovits-openai-gateway.py` in front of it:

```bat
runtime\python.exe api_v2.py -a 127.0.0.1 -p 9881 -c GPT_SoVITS\configs\tts_infer.yaml
python tools\gpt-sovits-openai-gateway.py --upstream http://127.0.0.1:9881 --ref-audio ref.wav --prompt-text "transcript" --port 8000
```

Then select the OpenAI-compatible provider, set the URL to `http://127.0.0.1:8000`, model `gpt-sovits`, and the voice to a name from `voices.json` (or leave it to fall back to the default voice). Verify the gateway mapping without a real model via `python tools\verify-openai-gateway.py`.

**Troubleshooting**: connection refused = wrong port or the service is down (a WebUI is not an API); 400 = model/voice/format/speed not accepted by the gateway, or `extraBody` keys rejected; "no valid audio" = upstream returned 200 with a JSON error body, which the plugin detects instead of playing silence.

**Privacy**: audio stays local when the gateway and engine are local. With a cloud endpoint, the text you read is sent to that endpoint.
