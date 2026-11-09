# GPT-SoVITS 指南（GPT-SoVITS Guide）

> dsh-plugin-tts 的「本地音色（GPT-SoVITS）」提供者专册。
> 插件**直接调用**本机 `api_v2.py` 的 `/tts`，用参考音频的音色朗读 —— 不需要网关、不需要 OpenAI 协议、不需要 API Key。
> 主 README：[中文](../README.zh.md) / [English](../README.md) · 使用手册：[《执行手册》](USER-GUIDE.md)

**目录**
- [三步上手](#三步上手)
- [为什么不用 Gradio WebUI](#为什么不用-gradio-webui)
- [设置面板字段](#设置面板字段)
- [请求契约](#请求契约)
- [高级参数](#高级参数)
- [长文本分块播放](#长文本分块播放)
- [真机实测踩到的坑](#真机实测踩到的坑)
- [疑难排查](#疑难排查)
- [English](#english)

---

<a name="三步上手"></a>
## 三步上手

**① 起 GPT-SoVITS 的 HTTP API**

在整合包根目录用**包内嵌的 python** 启动 `api_v2.py`（直接敲 `python` 往往不是它），保持窗口运行：

```bat
set PYTHONUTF8=0
runtime\python.exe api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS\configs\tts_infer.yaml
```

> 端口以启动窗口打印的为准。官方默认 `9880`，部分第三方整合包改成 `9881` 等，
> 把设置面板里的「服务地址」改成实际值即可。

**② 在插件里填两项必填内容**

设置 → 内置插件 → 语音 → TTS提供者选「**本地音色（GPT-SoVITS）**」：

| 字段 | 填什么 |
|---|---|
| **服务地址** | `http://127.0.0.1:9880`（插件自动补 `/tts`） |
| **参考音频** | GPT-SoVITS 所在机器上的 wav 绝对路径，例如 `D:\GPT-SoVITS\refs\voice.wav` |
| 参考文本 | 这段参考音频里说的原话，**逐字填写**（强烈建议，留空会明显影响音色相似度） |

参考音频路径是给 `api_v2.py` 用的本机路径，插件只原样转发，不上传、不转 base64；换音色就换这段音频。
模型权重由 `tts_infer.yaml` 决定 —— WebUI 里切好的模型，`api_v2.py` 起来就是同一套，插件里不用再切。

**③ 点「试听一句」或面板下方的「运行诊断」**

看到「**GPT-SoVITS 合成 正常（…ms · … B）**」就能用了。冷启动首句要等模型加载（10 秒级），
插件对这条链路给的是 300 秒超时，不会误杀。

---

<a name="为什么不用-gradio-webui"></a>
## 为什么不用 Gradio WebUI

**WebUI 不提供 HTTP 接口。** 浏览器里能点合成 ≠ 插件能连上。必须启动同目录的 `api_v2.py`，
它是 GPT-SoVITS 自带的 FastAPI 服务，暴露 `/tts`。插件说的就是这个接口的原生形状：

```
text · text_lang · ref_audio_path · prompt_text · prompt_lang
media_type · speed_factor · text_split_method · top_k / top_p / temperature …
```

这也正是本提供者与 Index-TTS2 / CosyVoice 一样属于「**专用提供者**」的原因：参数密集的本地引擎，
用各自的原生面板才不会丢参数。本项目早期曾用过一个「OpenAI 兼容」通用入口 + 中间网关的方案，
0.7.0 之后已移除 —— 现在少一跳、少一个进程、少一层字段映射。

---

<a name="设置面板字段"></a>
## 设置面板字段

| 面板字段 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| 服务地址 | ✅ | `http://127.0.0.1:9880` | 只存本机 Host 配置，不写浏览器存储 |
| 参考音频 | ✅ | 空 | 本机绝对路径；不设会明确报「还没有设置参考音频」 |
| 参考文本 | — | 空 | 参考音频的原话，上限 2000 字 |
| 参考音频语言 | — | `zh` | `zh / en / ja / ko / yue`；`api_v2.py` 这里不接受 `auto` |
| 合成文本语言 | — | `auto` | GPT-SoVITS V4 起支持自动识别；旧版本改成 `zh` / `en` / `ja` |
| 输出格式 | — | `wav` | `api_v2.py` 的 `media_type`；**mp3 不被支持**，见下方踩坑 |
| 语速 | — | `1.0` | `0.25–4.0`，对应 `speed_factor` |
| 切分方式 | — | `auto` | 按每段长度自动选，见下 |
| 高级参数（展开） | — | 引擎默认 | 逐项调节：采样参数用滑块、种子用数字框、并行推理用开关 |

**切分方式**：插件已经把长文按约 15 秒切好块了，再按标点细切就是二次切分，
会把句尾气口切断。所以 `auto` 按每段内容选：单句 `cut0`（整句合成）、多句 `cut1`（按句切、
句内连贯）、超过 120 字 `cut5`。除非你明确知道要什么，不要强制 `cut5`。

---

<a name="请求契约"></a>
## 请求契约

`POST {服务地址}/tts`，`Content-Type: application/json`，成功时直接返回音频字节流。
插件按**真实文件头**判断容器（RIFF / OggS / ID3 / ADTS / fLaC），不信返回的 `Content-Type`；
200 却返回 JSON、音频过小、或不是可识别的音频，都会明确报错而不是写一个坏文件。

| 面板字段 | `/tts` 字段 |
|---|---|
| 朗读文本 | `text` |
| 合成文本语言 | `text_lang` |
| 参考音频 | `ref_audio_path` |
| 参考文本 | `prompt_text` |
| 参考音频语言 | `prompt_lang` |
| 输出格式 | `media_type` |
| 语速 | `speed_factor` |
| 切分方式 | `text_split_method` |
| 高级参数里改动过的项 | 原样并入（可覆盖上面任何一项） |

插件另附一组标准采样参数（`top_k: 15`、`top_p: 1`、`temperature: 1`、`batch_size: 1`、
`seed: 42`、`parallel_infer: true`、`repetition_penalty: 1.35`、`streaming_mode: false`）。
展开「高级参数」即可逐项调节；**只把改动过的项写进请求体**，没动过的面板等价于不传采样参数。

---

<a name="高级参数"></a>
## 高级参数

面板底部「**高级参数（一般不用改）**」默认收起，展开后**每一项一个控件**，
不用再手写 JSON：

| 控件 | `/tts` 字段 | 默认 | 范围 |
|---|---|---|---|
| Top-K 采样数（滑块） | `top_k` | 15 | 1–50 |
| Top-P 采样（滑块） | `top_p` | 1.0 | 0–1 |
| 随机性（滑块） | `temperature` | 1.0 | 0–1.5 |
| 重复惩罚（滑块） | `repetition_penalty` | 1.35 | 0.5–2 |
| 批大小（滑块） | `batch_size` | 1 | 1–20 |
| 随机种子（数字框） | `seed` | 42 | -1–999999 |
| 并行推理（开关） | `parallel_infer` | 开 | 开 / 关 |

语速也是滑块（0.25–4.0，步长 0.05）。这些值只改动时才写入请求体，其余沿用
引擎默认；之前手填过 JSON 的话，表里没有的键会原样保留，不会被覆盖掉。

两点提醒：

1. `api_v2.py` 对未知字段**静默忽略**（实测返回 200）。某个旋钮看起来没反应时，
   先确认整合包版本是否支持该字段，别先怀疑插件。
2. `seed` / `temperature` 在部分整合包里会被推理配置覆盖，改了听不出差别属正常，
   详见[真机实测踩到的坑](#真机实测踩到的坑)。

---

<a name="长文本分块播放"></a>
## 长文本分块播放

预计朗读超过 12 秒的文本自动分块：每块约 15 秒音频、后台预生成 2 块、**首块合成完立即返回**，
所以等待时间只等于一次请求。播放按块序号严格顺序，单块失败只跳过该块，不会中断整篇。
权重只在 `api_v2.py` 启动时加载一次，后续块不会再有冷启动开销。

---

<a name="真机实测踩到的坑"></a>
## 真机实测踩到的坑（GPT-SoVITS V4 整合包 + NVIDIA GPU）

**坑 1 · 整合包的 python 起不来（`Fatal Python error: init_import_site`）**

```text
UnicodeDecodeError: 'utf-8' codec can't decode byte 0xbd in position 31: invalid start byte
  File "...\env\lib\site.py", line 179, in addpackage
```

原因不在 GPT-SoVITS，而在整合包的 `env\Lib\site-packages\users.pth` 是 **GBK 编码**。
环境里一旦有 `PYTHONUTF8=1`，Python 会强制用 UTF-8 解析 `.pth`，当场崩。
**解法：`set PYTHONUTF8=0` 再启动**。不要改那个 `.pth`，改了可能影响启动器。

**坑 2 · `media_type` 不认 mp3**

传 `mp3` 会直接 400：`{"message":"media_type: mp3 is not supported"}`。
面板里保持 `wav`；`ogg` / `aac` 取决于整合包构建，不确定就用 `wav`，需要 mp3 自行转码。

**坑 3 · 句尾「气口没说完就断了」**

现象：试听「你好，这是一个语音测试。」，最后的「试」像被掐掉。
先排除误判：把 wav 下载到 Audacity，文件末尾其实还有 260–405ms 静音 —— 不是容器被裁，
也不是插件打断播放，是模型在 EOS 处提前收尾。真正原因是 `text_split_method: "cut5"`
按标点把句子切成两段独立合成，每段重新起调。实测：

| 切分 | 总长 | 语音结束 | 尾部静音 | 句间硬插 |
|---|---|---|---|---|
| `cut5`（旧默认） | 2.280s | 1.875s | 405ms | ~380ms |
| `cut0`（现默认·单句） | 2.320s | 2.059s | 261ms | — |

所以现在 `auto` 默认单句 `cut0`、多句 `cut1`、超长 `cut5`。

**坑 4 · `seed` / `temperature` 在这台机器上不生效**

同一请求连发两次 md5 不同，显式 `seed: 1234` 也一样，只是时长和收尾位置不变。
所以「每次试听语气都略有差别」是正常现象；长文分块时每块独立采样，块间音色会轻微漂移。

---

<a name="疑难排查"></a>
## 疑难排查

| 现象 | 排查 |
|---|---|
| 无法连接 / `ECONNREFUSED` | `api_v2.py` 没起，或端口不对。看启动窗口打印的实际端口，别把 WebUI 端口当 API 端口 |
| 「还没有设置参考音频」 | 填本机 wav 绝对路径 |
| HTTP 400 | 看报错里的上游原文：常见是 `media_type` / `text_lang` 不被该版本接受，或参考音频路径不存在 |
| HTTP 500 | 引擎侧异常（模型未加载 / 显存不足），看 `api_v2.py` 窗口的输出 |
| 试听成功但没声音 | 上游 200 却返回 JSON 错误体，插件已拦截并显示内容；按里面的 message 修 |
| 改了参数没效果 | 键名写错被静默忽略；对照上面的字段映射表核对 |
| 诊断里的探针读得很怪 | 诊断固定发中文短句「你好，这是一个语音测试。」；纯日文/英文音色读这句很怪是正常的 |

---

## English

> Dedicated guide for the **Local voice (GPT-SoVITS)** provider.

The plugin calls the local `api_v2.py` `/tts` endpoint **directly** — no gateway,
no OpenAI-shaped request, no API key. The Gradio WebUI is not an HTTP API; start
`api_v2.py` from the bundle and keep it running (default `http://127.0.0.1:9880`).

In Settings → Built-in plugins → Voice, pick **Local voice (GPT-SoVITS)** and fill
the two required fields: **Service URL** and **Reference audio** (an absolute wav
path on the machine running GPT-SoVITS). **Prompt transcript** is the word-for-word
text of that clip — leaving it empty noticeably hurts voice similarity. Everything
else has sensible defaults (`auto` text language, `wav`, speed `1.0`, automatic
split method). Click **Test one line** or **Run diagnosis**; a cold GPU start can
take over 10 seconds.

The request body uses the engine's native names: `text`, `text_lang`,
`ref_audio_path`, `prompt_text`, `prompt_lang`, `media_type`, `speed_factor`,
`text_split_method`, plus the standard sampling knobs. Speed is a slider
(0.25-4.0). **Advanced** is a collapsed panel with one control per knob:
sliders for `top_k` / `top_p` / `temperature` / `repetition_penalty` /
`batch_size`, a number field for `seed` and a switch for `parallel_infer`.
Only fields you actually change are added to the payload; anything else keeps
the engine default, and custom keys from an older hand-written JSON survive.
Unknown keys are silently ignored by `api_v2.py`, so check your bundle version
before assuming a bug in the plugin.

The host already chunks long reads into ~15s packets; `auto` therefore picks
`cut0` for a single sentence, `cut1` for several and `cut5` only for very long
packets. Forcing `cut5` re-splits each packet and clips sentence tails. `mp3`
is not a supported `media_type` on the V4 bundles — keep `wav`.

Container detection reads the actual file magic, never the response header; a
200 response containing JSON, a tiny file or unrecognisable bytes is reported as
a clear error rather than written out as a broken audio file.
