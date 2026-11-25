# GPT-SoVITS 指南（GPT-SoVITS Guide）

> dsh-plugin-tts 的「GPT-SoVITS」提供者专册。
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

在整合包根目录启动 `api_v2.py`，保持窗口运行。三种安装形态各用各的写法，**不要照搬别人的命令**：

```bat
:: Windows 整合包（python 用包内嵌的那个）
set PYTHONUTF8=0
runtime\python.exe api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS\configs\tts_infer.yaml
```

```bash
# 源码 / conda 环境（先 conda activate 到你的环境，并确认当前目录是仓库根）
python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
```

```bash
# Docker（端口映射到宿主机，容器内路径按镜像实际情况）
docker run --gpus all -p 9880:9880 <你的镜像> python api_v2.py -a 0.0.0.0 -p 9880
```

> `-c` 是**相对路径**，不在 GPT-SoVITS 根目录起服务就会找不到配置 —— 这就是“命令没写错却起不来”的常见原因。
> 端口以启动窗口打印的为准（官方默认 `9880`，不少第三方整合包是 `9881`）。

**② 让插件自己找到服务与音色**

设置 → 内置插件 → 语音 → TTS提供者选「**GPT-SoVITS**」：

| 步骤 | 做什么 |
|---|---|
| **服务地址** | 一般不用改（默认 `http://127.0.0.1:9880`）；点右边的「**探测服务**」，插件会试 `9880 / 9881`，并识别出“你连的其实是 Gradio WebUI”这种最常见错误 |
| **音色** | 点开「**音色目录**」选择器挑一个有 wav 的文件夹，选择器里会列出音频，点一下即可加入音色；也可以直接把 wav 拖进「上传参考音频」区，插件复制到受管目录并自动登记 |
| **参考文本** | 这段音频说的原话，**逐字填写**。它跟着音色一起存，换回旧音色会自动带出来；V3/V4 内核留空会直接 400 |

模型权重由 `tts_infer.yaml` 决定 —— WebUI 里切好的模型，`api_v2.py` 起来就是同一套，插件里不用再切。

> **前提：插件与 GPT-SoVITS 在同一台机器上。** 插件只把 `ref_audio_path` 这个**字符串**发给
> `api_v2.py`，由它自己打开文件；跨机器时目录浏览和上传都拿不到对方的盘，只能手填那台机器上的路径。


**③ 在面板底部「试听测试」输入一句试听，或点「运行诊断」**

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
| 服务地址 | ✅ | `http://127.0.0.1:9880` | 只存本机 Host 配置，不写浏览器存储；右边有「探测服务」 |
| 音色参考 | ✅ | 空 | 下拉列出「音色目录」里的音频（与 Index/Cosy 一致）：一个音色 = 一段 wav + 它的逐字稿；文件多时可按名字搜索，每个选项带健康徽标 |
| 音色目录 | — | 空（默认用插件受管目录） | 目录选择器里的文件可以点一下加入音色（只列 wav/mp3/flac/m4a/ogg/aac）；换目录自动刷新。选择器带面包屑、最近路径、`📁 名字 · N 个音频` 计数，双击可直接进入；设置行的路径中间省略，保留盘符 + 末级目录 |
| 模型目录 | — | 空 | GPT-SoVITS 安装根目录；用于扫描 `GPT_weights*/SoVITS_weights*` 与服务端基础权重 |
| GPT 权重 / SoVITS 权重 | — | 服务端当前 | 选择后点「应用权重」，通过 `api_v2.py` 的 `/set_*_weights` 热切换，无需重启；服务重启后需重新应用。下拉按文件名自动提取的说话人分组，每组默认只显示最新 3 个（按修改时间），其余收进「显示全部」；顶部有搜索框（文件名 / 说话人 / 目录）。GPT 与 SoVITS 说话人不一致时会提示 |
| 参考文本 | ✅ | 空 | 选中音色时自动带出；**必须按顺序全文填写**。V3/V4 内核留空会直接 HTTP 400，V2 留空也会明显掉相似度 |
| 参考音频语言 | — | `zh` | `zh / en / ja / ko / yue`；`api_v2.py` 这里不接受 `auto` |
| 合成文本语言 | — | `auto` | GPT-SoVITS V4 起支持自动识别；旧版本改成 `zh` / `en` / `ja` |
| 输出格式 | — | `wav` | `api_v2.py` 的 `media_type`；**mp3 不被支持**，见下方踩坑 |
| 语速 | — | `1.0` | `0.25–4.0`，对应 `speed_factor` |
| 切分方式 | — | `auto` | 按每段长度自动选，见下 |
| 高级参数（展开） | — | 引擎默认 | 逐项调节：采样参数用滑块、种子用数字框、并行推理用开关 |

**音色（voice）怎么来**：与 Index-TTS2 / CosyVoice 同一套模型 —— **目录选择器只选目录，
「音色参考」下拉负责列出该目录里的音频**。

1. 点开「音色目录」选出参考音频所在文件夹：目录里的 wav/mp3/flac/m4a/ogg 会直接出现在
   「音色参考」下拉（文件多时会出现搜索框）；
2. 把 wav 拖进「上传参考音频」，插件复制到受管目录 `~/.dsh/dsh-plugin-tts/data/refs/`
   并把该目录设为当前音色目录，文件随即出现在下拉里；
3. 直接在下拉旁的空输入框里粘贴路径（跨机器或整合包被移动时的兜底）。

换音色 = 在下拉里点名字，参考文本与语言一起回来（逐字稿按绝对路径保存，换目录不会丢）。
若文件被移走或删掉，面板会直接指名说「这个音色的音频文件不在了」，而不是合成时抛一个引擎错误。

**音色库（管理音色）**：点「音色参考」旁的「管理音色」打开音色库，每个音色带健康徽标：

- **文件丢失**：wav 路径不存在（Host 读取音色库时统一标记 `exists`，不用逐个探测）；
- **缺文本**：没有逐字稿，V3/V4 内核会直接 400；
- 语言：`zh` / `en` / `ja` 等，来自该音色的「参考语言」。

顶部可按「全部 / 缺文本 / 文件丢失」筛选并显示数量；每一行可以「使用 / 重命名 / 重新定位 / 删除」。
「重新定位」同样是**选目录**：在弹层里选到新位置的文件夹，插件会在里面找同名的 wav，
找到就更新路径并保留原来的逐字稿；找不到会提示「没找到同名文件」。删除需要二次确认。
所有徽标只依据音色记录本身（`path` / `promptText` / `promptLang` / `exists`），不针对任何具体音色名。

「缺文本」的数据不在音频文件里，也不是 `api_v2.py` 返回的：插件在 Host 的音色库里（`config/settings.json` 的 `gsv.voices`）按**绝对路径**保存每个音色的 `path + promptText + promptLang`。下拉列表先用目录里的文件名拼出绝对路径，再用路径去音色库配对：配到就自动带出逐字稿和语言，配不到就显示「缺文本」。所以在插件里换目录、再换回来，文本都还在；在文件管理器里直接改名会让配对丢失，请用音色库的「重新定位」。

### 训练权重（可选，但很像）

GPT-SoVITS 的零样本只需要“权重 + 参考 wav + 逐字稿”。权重可以是你自己训练的
（`GPT_weights_v4/*.ckpt` + `SoVITS_weights_v4/*.pth`），也可以是整合包自带的基础权重：

- 选「模型目录」= GPT-SoVITS 安装根目录，插件会扫描两组权重目录和基础权重；
- 选好「GPT 权重」「SoVITS 权重」后点「应用权重」：插件依次调用
  `/set_sovits_weights`、`/set_gpt_weights`，**不需要重启服务**（服务自己重启后要再点一次）；
  为什么不像 Index-TTS2 那样“下拉选完就生效”：Index 的参考音频是**每次合成请求**随任务传给服务端的，不会改服务端状态；GPT-SoVITS 的 GPT / SoVITS 权重是**服务进程级**的模型，`api_v2.py` 需要先把 ckpt/pth 读进显存（通常要几秒），之后所有请求共用这组权重。所以这里用「先选、再应用」两步；
  应用时按钮会变成「加载中…」，下方实时显示已等待秒数；成功后显示「权重已生效（x.xs）」和本次应用的两个文件名，加载期间点试听会提示先等待。耗时取决于权重大小、磁盘和显存，通常几秒到几十秒，首次加载可能更久（Host 最多等 180 秒）。`api_v2.py` 的接口是同步加载，不能真正后台切换；但不需要重启服务，界面也不会卡住；
  应用成功会清掉之前的短文本合成缓存；设置里的「试听」本身也总是重新合成，所以不会再用旧权重缓存的声音；服务重启后会回到 `tts_infer.yaml` 里的启动权重，需要再点一次；
- 下拉按说话人分组（组名从文件名推导，如 `xxx-e15` / `xxx_e2_s220_l32` → `xxx`），
  每组默认只显示最新 3 个（按文件修改时间倒序），其余用「显示全部（还有 N 个，共 M）」展开；
  当前选中的权重即使不在最新 3 个里也会固定显示并打勾，不会出现空白触发器；
- 顶部搜索框按「文件名 / 说话人 / 目录」过滤，两个下拉共用；
- 「当前服务权重（启动配置）」读取 `GPT_SoVITS/configs/tts_infer.yaml` 的 `custom:` 段
  （`api_v2.py` 启动时就是用这一段加载的），显示服务实际加载的 `t2s_weights_path` +
  `vits_weights_path`；热切换不会回写这个文件，所以它代表**启动时**的权重，读不到就显示「未知」；
- 「使用基础权重」= 扫描结果里标记为「基础权重」的那组组合，适合任意参考音色（不偏向某个训练说话人）；
- 想更像某个人：用该说话人的训练权重 + 他自己的参考 wav + 逐字稿，效果通常比纯零样本更稳；
- 注意：面板的「音色参考」只保存参考音频和文字稿，不复制权重；换机器时权重仍要在那台机器上。

**插件的数据目录**（`~/.dsh/dsh-plugin-tts/`，从 0.7.5 的 `~/.dsh/tts-rvc/` 自动迁移；启动 `dsh web` 前设置 `DSH_TTS_HOME` 可整体改到其他盘）：

| 目录 | 内容 | 能不能删 |
|---|---|---|
| `config/settings.json` | 服务地址、音色库、最近目录 | 删了丢音色库，建议备份 |
| `data/refs/` | 上传的参考音频 | 不建议 |
| `data/packs/` | RVC 音色包 | 不建议 |
| `data/calibration.json` / `data/cloud-usage.json` | 校准结果 / 计费台账 | 不建议 |
| `cache/synth/` | 合成出来的临时音频（2 小时过期、上限 200 个，自动清理；设置页可查看占用并一键清理） | 可以整体删 |


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
折叠状态下标题会显示「高级参数（N 项已修改）」，展开后可用「恢复本节默认」一键回到引擎默认值；
该按钮只清理面板托管的原生键，手写 JSON 里的其他字段仍然保留。

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

> Dedicated guide for the **GPT-SoVITS** provider.

The plugin calls the local `api_v2.py` `/tts` endpoint **directly** — no gateway,
no OpenAI-shaped request, no API key. The Gradio WebUI is not an HTTP API; start
`api_v2.py` from the bundle and keep it running (default `http://127.0.0.1:9880`).

In Settings → Built-in plugins → Voice, pick **GPT-SoVITS** and fill
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
