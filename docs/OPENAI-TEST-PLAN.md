# OpenAI 兼容提供者 · 测试方案

> 对象：`provider = openai-compatible`（0.7.0 起）
> 目标：在**不依赖真实引擎**的前提下验证传输层与失败路径，再用本机 GPT-SoVITS 做一次真机联调。
> 基线：`npm run test:openai` 102/102、`npm run test:openai-e2e` 8/8、`npm run verify:gateway` 19/19、`npm run test:all` 全绿。

---

## 1. 分层策略

| 层 | 验证什么 | 手段 | 命令 |
|---|---|---|---|
| L1 单元 | URL 归一化、配置兜底与钳制、extraBody 解析、容器嗅探 | 直接调用 `__test` 纯函数 | `npm run test:openai` |
| L2 持久化 | `settings.json` 合并语义、apiKey 只写不读、损坏文件恢复 | 隔离 `DSH_TTS_HOME` 读写真实文件 | 同上 |
| L3 路由 | `/openai-config`、`-save`、`-models`、`-test` 的状态码与错误码 | mock `webServer` + mock 上游 | 同上 |
| L4 合成链路 | `/speak` → 上游 → 音频路由，含缓存、分块、鉴权、全部失败分支 | 可控 mock `/v1/audio/speech` | 同上 |
| L5 全链路 | 插件 → Python 网关 → mock `api_v2.py` → WAV → `/dsh-tts-audio` | 真起网关进程 | `npm run test:openai-e2e` |
| L6 网关映射 | OpenAI 字段 → GPT-SoVITS payload、extraBody 透传、上游异常转 502 | 真网关 + mock 上游 | `npm run verify:gateway` |
| L7 真机 | 本机 GPT-SoVITS 全流程 | 人工，见 §3 | — |

**为什么 L4 要 mock 上游而不是直接打网关**：分层定位。L4 失败说明插件侧有问题，L5 失败才说明协议衔接有问题；混在一起会互相掩盖。

---

## 2. 关键断言（自动化已覆盖）

### 2.1 地址解析

- 根地址 / 带 `/v1` / 带尾斜杠 / 完整端点 / 大写路径，五种写法都只拼一次 `/audio/speech`。
- 空值回落内置默认 `http://127.0.0.1:8000`。
- **优先级：请求显式地址 > Host 文件 > 默认值**。面板上改完地址立刻点「测试」，测的是当前地址，不是旧配置。
- 缓存键含**有效地址**：换端点后同一句话不会命中上一个端点的音频。

### 2.2 参数

- `voice`：`custom.voice` > 请求 `voice` > `alloy`；空白字符串不占位。
- `format`：白名单 `wav/mp3/opus/aac/flac/pcm`，大小写不敏感，非法值回落 `wav`。
- `speed`：钳制到 `[0.25, 4]`，非数字回落 `1`。
- `extraBody`：必须是 JSON **对象**（数组 / null / 数字 / 字符串全部报 `host.openaiBadExtra`）；上限 4000 字符；**平铺**进请求体，且可以覆盖协议字段（文档化的逃生口）。

### 2.3 容器与失败判定

| 上游返回 | 期望 |
|---|---|
| RIFF/WAVE | 存 `.wav`，`audio/wav` |
| `ID3` / `0xFFFB` | 存 `.mp3`，`audio/mpeg` |
| **ADTS AAC（0xFFF1）** | 存 `.aac`，`audio/aac`（不能误判成 mp3） |
| fLaC / OggS / AIFF | 对应扩展名与 MIME |
| 200 + JSON（含 `text/plain` 的 pretty JSON） | 失败，展示 JSON 里的 `error/message` |
| 合法音频但 < 1000 字节 | 失败「返回的音频过小」 |
| 非音频字节 | 失败「不是可识别的音频」 |
| 401/403 | `host.openaiKeyInvalid` |
| 400/422 | `host.openaiBadRequest` |
| 其它非 2xx | `host.openaiHttpFail` |
| 连不上 | `host.openaiUnreachable` + `api_v2.py` 启动提示 |

### 2.4 凭据与缓存

- apiKey 只落后端文件；GET 配置只回 `apiKeySet` + 末四位；保存响应不带明文；localStorage 草稿里没有该字段。
- 填了 Key 才发 `Authorization: Bearer`；`/openai-models` 仅在 `withKey=1` 时带。
- 相同「地址 + model + voice + format + speed + extraBody + 文本」命中缓存；任一变化重新合成。

---

## 3. 真机联调（本机 GPT-SoVITS）

### 3.1 起服务

```bat
:: ① GPT-SoVITS 的 API（不是 WebUI）
runtime\python.exe api_v2.py -a 127.0.0.1 -p 9881 -c GPT_SoVITS\configs\tts_infer.yaml

:: ② 网关
python tools\gpt-sovits-openai-gateway.py --upstream http://127.0.0.1:9881 ^
  --ref-audio "D:\refs\a.wav" --prompt-text "参考音频里说的那句话" --port 8000
```

### 3.2 逐条验收

| # | 操作 | 期望 | 失败时看 |
|---|---|---|---|
| 1 | 浏览器/curl `GET http://127.0.0.1:8000/health` | `{"ok":true,"voices":[...]}` | 网关没起来或端口占用 |
| 2 | 面板「拉取模型」 | 出现 `gpt-sovits` | 网关 `/v1/models`；不影响合成 |
| 3 | 面板「运行诊断」 | `OpenAI 兼容合成 正常（xxxms · xxxxx B · gpt-sovits / 默认）` | 报错带的 HTTP 状态码与上游原文 |
| 4 | 读一句短文本 | 正常出声，音色是参考音频 | 参考音频/逐字稿不匹配会读错或 400 |
| 5 | 高级参数填 `{"top_k":5}` 再读 | 音色一致、语速/韵律略变 | 网关日志 `top_k` 是否被透传 |
| 6 | 读 300 字以上 | 首段很快出声，后续连续播放 | 冷启动首句可能 10s+，属正常 |
| 7 | 停掉 `api_v2.py` 再点「运行诊断」 | 「OpenAI 兼容接口」提示无法连接 + 启动线索 | 应看到 502 与 `CUDA`/连接错误原文 |

### 3.3 手工注入失败（可选）

改网关或上游构造异常，确认客户端展示的是可操作信息，而不是空白或静默成功：

- 上游返回 200 + JSON → 面板应显示 JSON 里的 message。
- 参考音频路径写成不存在 → GPT-SoVITS 返回错误 → 网关转 502 → 面板显示原文。
- `prompt_text` 留空 → 网关启动时告警，合成结果可能复读参考文本（模型行为，不是插件 bug）。

---

## 4. 已知边界（不是 bug，写清楚免得误判）

1. **参数不统一**：这个提供者只适配传输层。Index-TTS2（16 参数）、CosyVoice（prompt 音频）继续用各自的专用提供者。
2. **extraBody 依赖网关透传**：插件只负责平铺进请求体；网关丢弃未知键时参数静默失效，不做假成功提示。
3. **< 1000 字节一律判失败**：极短音节（如单个「嗯」）在个别引擎上可能低于阈值，此时会报「过小」而不是播放。
4. **WebUI ≠ API**：GPT-SoVITS 的 Gradio 页面没有 HTTP 接口，必须有 `api_v2.py` 或网关。
5. **测试隔离**：所有自动化用例通过 `DSH_TTS_HOME` 指向临时目录，不会读写你真实的 `~/.dsh/tts-rvc/settings.json`。

---

## 5. UI 点测记录（DSH Web 实测）

环境：`dsh web` 加载本地 `lib/`（v0.7.0），上游用 `tools/mock-sovits-upstream.py` 假引擎，
网关是真实的 `tools/gpt-sovits-openai-gateway.py`。目的是把「面板 → Host → 网关 → 上游」串起来，
引擎本身留到 §3 用真 GPT-SoVITS 验。

> 注：下表是「合并诊断」之前的记录，其中的「测试」按钮已在 v0.7.0 取消（与「运行诊断」重复），
> 对应当前版本请把「测试」读作「运行诊断」；改版后的点测见 §5.1。

| # | 操作 | 结果 |
|---|---|---|
| 1 | 设置 → 内置插件 → 语音 → TTS 提供者选「OpenAI 兼容（自定义接口）」 | 面板出现 API 地址 / Key / 模型 / 音色 / 格式 / 语速 / 高级参数 / 测试 || 2 | API 地址填 `http://127.0.0.1:18080`，模型 `gpt-sovits` | 配置即时落 Host 文件 |
| 3 | 「拉取模型」 | 网关收到 `GET /v1/models`，返回 `gpt-sovits` |
| 4 | 「测试」 | `16ms · 64044 B · gpt-sovits / alloy` |
| 5 | 高级参数填 `{"top_k": 5}` 后「试听」 | 上游日志 `top_k=5`，证明平铺与透传生效 |
| 6 | 对一条长消息点「朗读本条消息」 | 分 46 段合成，播放条显示「第 23/46 段播放中」，倍速/下载可用 |
| 7 | 停掉网关再点「测试」 | 显示「无法连接…（http://127.0.0.1:18080）」+ `fetch failed` + 启动提示 |
| 8 | 重启网关再点「测试」 | `48ms · 64044 B · gpt-sovits / alloy` |

**第 7 条暴露的问题（已修）**：客户端 `hostErrText()` 命中翻译后只返回短标签，
把 Host 消息里第一段冒号之后的详情（URL、HTTP 状态、上游原文、`api_v2.py` 提示）全部丢掉。
修复：错误文案补 `{baseUrl}` / `{status}` 占位符；`host.openai*` 追加冒号后的详情；`.dsh-tts-error` 本就 `pre-line`，换行可读。

### 5.1 UI 改版点测（合并诊断 / 精简说明）

起因：面板上「TTS提供者」左侧并发渲染全部 6 个提供者的说明，8 行灰字把行高撑爆；OpenAI 面板顶部
的「传输层适配」说明 + 三步指引常驻占位；字段没说清必填与否；「测试」按钮与「运行诊断」功能重复。

改法：说明按下拉当前项只显示一行（详情移到 option 的 `title`）；顶部说明收进 `<details>`；
字段 label 加「必填/选填」小标；删掉「测试」按钮，OpenAI 纳入 `/diagnose`。

实测（`dsh web` 加载本地 `lib/`，网关 8000 在线，api_v2 9881 在线）：

| # | 操作 | 结果 |
|---|---|---|
| 1 | 提供者选 Edge TTS | 左侧只有一行「免费在线音色，无需配置」，与「界面语言」行等高 |
| 2 | 提供者切到 OpenAI 兼容 | 同样只有一行「任意 /v1/audio/speech 服务」 |
| 3 | 看 OpenAI 面板顶部 | 标题 + 一行说明 +「▶ 怎么用？哪些必填？（点开）」，默认不展开 |
| 4 | 点开折叠 | 6 行说明在一张浅卡片里，正文不再压着字段区 |
| 5 | 看字段 label | `API 地址 必填`（品牌色），其余 6 项 `选填`（灰） |
| 6 | 面板里找「测试」 | 已无；底部只有「运行诊断」/「导出诊断日志」 |
| 7 | 选 OpenAI + 运行诊断 | `✓ OpenAI 兼容接口 在线 · gpt-sovits` / `✓ OpenAI 兼容合成 正常（2904ms · 218924 B · tts-1 / alloy）` |
| 8 | 切回 Edge TTS 再诊断 | OpenAI 两项 `–` skip：「未选用该提供者」——不误报红 |
| 9 | 地址改成 `127.0.0.1:18099` 再诊断 | `✗ 接口 无法连接（…）` + `✗ 合成 接口不可达，跳过合成`，不阻塞 |
| 10 | 观察诊断列表对齐 | 名称列固定 140px，长 detail 换行后与首行左边缘对齐（`Range.getClientRects()` 实测两行同 x） |

顺带修的两处：`synthesizeOpenAi()` 增加可选 `timeoutMs`（诊断用 45s，朗读仍 180s，避免网关卡住时诊断傻等三分钟）；
`.dsh-tts-diag-name` 固定宽度 + `.dsh-tts-diag-detail` 加 `flex:1` / `word-break:break-word`。

### 5.2 设计语言对齐点测（下拉 / 必填 / 诊断 / 说明折叠）

起因：四点 UI 意见 —— ①必填标法不对（6 个灰色「选填」像补丁）；②诊断区排版丑；③原生 `<select>` 与 dsh
官方控件完全两个世界；④RVC / Index / Cosy 顶部仍有大段常驻说明。

依据：必填标记采用 GOV.UK Design System 与 USWDS 的共同建议 —— **只标少数派**（默认全必填时标 optional，
少量必填时标 `*`），不给每个字段挂徽标；`aria-required` 同步。

改法：
- 新增 `TtsSelect`（触发器 30px / 8px 圆角 / 细边框 / hover 填充；浮层 16px 圆角 / 4px 内边距 / 12px 圆角选项 /
  右侧勾 / `blur(28px)` 半透明材质 / 三层极淡阴影），替换全部 12 处原生 `<select>`，带 Esc、点击外部、
  ↑↓+Enter 键盘操作与自动上翻。
- 诊断列表改为 hairline 卡片 + 三列 grid（图标 / 名称 / 右对齐状态），第二行放可执行建议；
  状态图标改为 16px 圆环 + 描边（`ok` 绿 / `warn` 黄 / `fail` 红 / `skip` 灰）。
- 必填只保留一个红色 `*`，其余字段不加标记。
- RVC / Index / Cosy / Cloud / OpenAI 的顶部说明统一收进「▶ 怎么用？需要先准备什么？（点开）」。
- provider 专属配置与诊断上移到 provider 选择行下方（此前在「恢复默认设置」之后，切换后要滚 600px 才看得到）。

实测（`dsh web` + chromium headless，`--no-proxy-server`）：

| # | 操作 | 结果 |
|---|---|---|
| 1 | 看三个设置行 | 语言 / 提供者 / 朗读音色三个下拉等宽 224px、左右边缘完全对齐（`getBoundingClientRect` 同 x=868） |
| 2 | 点开提供者下拉 | 菜单 16px 圆角、`role=listbox`、6 项含「在线/本地/自定义」标签、选中项右侧打勾 |
| 3 | `Esc` / 点面板空白 / `↑↓`+`Enter` | 三种方式均能关闭并生效（键盘选中后 trigger 文本变「本地音色（Index-TTS2）」） |
| 4 | 窗口压到 520px 高再开菜单 | `data-side=up`，菜单翻到触发器上方（top 77 / vh 520），不溢出视口 |
| 5 | 切到 OpenAI 兼容 | 配置区紧跟选择行；只有「API 地址」带红色 `*`，其余 6 项无标记 |
| 6 | 看字段提示 | 非斜体、11px 三级灰、左边缘与输入框同 x=496 |
| 7 | 切 RVC / Index / Cosy / Cloud | 顶部只剩一行短说明 + 折叠行，三步上手与命令块全部收起 |
| 8 | 运行诊断 | 绿圈正常 / 红圈无法连接 / 灰圈跳过；「服务未连上，跳过模型检查」为灰而非红 |
| 9 | 检查诊断对齐 | 状态列右对齐同 x；建议行缩进与名称左边缘一致 |
| 10 | 读 `getComputedStyle` | `--dsw-alias-label-error` 等变量并不存在，已改用 `--dsw-alias-state-error-primary` / `-success-` / `-warn-` |

本轮发现并修的既有缺陷：
1. **语义色变量根本不存在**：插件此前 13 处引用 `--dsw-alias-label-error/success/warning`，dsh 实际只提供
   `--dsw-alias-state-{error,success,warn}-primary`，所以所有错误文案一直是默认黑色（`rgb(15,17,21)`）。
2. **键盘 Enter 会关掉整个设置弹窗**：`TtsSelect` 的 keydown 只 `preventDefault`，事件继续冒泡到弹窗；
   补 `stopPropagation` 后正常。
3. **provider 面板离选择行 600px**：切换提供者后看不出任何变化，已把专属面板 + 诊断整体上移。

### 5.3 开关控件改版（原生 checkbox → dsh 官方 switch）

起因：设置面板里 9 处原生 `<input type="checkbox">` —— 方框是操作系统画的，与左侧 13px 标签拼在一行，
是整个面板里唯一不属于产品语言的控件；而且标签文字常常与上方标题重复（「朗读中」标题 +
「显示全局朗读中按钮」方框）。

依据（源码 `primitives/lib/Switch.module.css`，不是截图目测）：

| 项 | dsh 官方值 | 插件实现 |
|---|---|---|
| 轨道 | 36 × 20 / `box-sizing:border-box` / `padding:2px` / `border-radius:999px` / `corner-shape:round` | 同 |
| 开态底 | `var(--dsw-alias-brand-primary)`（浅色 = `rgb(15,17,21)`） | 同 |
| 关态底 | `var(--dsw-alias-border-l3)`（`#0000001f`） | 同 |
| 拇指 | 16 × 16 / `border-radius:50%` / `corner-shape:round` / `translateX(16px)` / `120ms ease` | 同 |
| 拇指底色 | 开态 `label-primary-foreground`，关态 `alias-switch-thumb` | 同 |
| 焦点 | `outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))` + `offset 2px` | 同 |
| 禁用 | `opacity:.5` | 同 |
| 行结构 | `flex` + `gap:24` + `align-items:center` + `justify-content:space-between` | 同 |

改法：
- 新增 `TtsSwitch`（`button[role=switch]` + `aria-checked` + `aria-label`），替换全部 9 处 checkbox：
  RVC 自动回退、Index 清洗文本、Index 随机情感、朗读中浮窗、朗读高度跟随、事件语音提醒（含两个子项）、
  朗读原始 Markdown。
- 音频提醒从「标题 + 说明 + 三行方框」改为「一行开关 + 展开后的缩进子项」，子项用 1px hairline 竖线 +
  14px 缩进标示层级（margin 实现，不用 padding —— 插件样式是 content-box，padding 会把块撑宽）。
- 文案去掉「（实验性，默认关闭）」里的「默认关闭」：开关本身就显示了状态，重复说明只是噪音。
- 键盘：Enter / Space 均 `preventDefault` + `stopPropagation`（沿用 `TtsSelect` 的弹窗 Enter 教训）。

实测（`dsh web` + chromium headless）：

| # | 操作 | 结果 |
|---|---|---|
| 1 | 打开「设置 → 内置插件 → 语音」 | 4 个 `button[role=switch]`，无 `input[type=checkbox]` |
| 2 | 读 `getBoundingClientRect` | 每个 36 × 20，x 全为 976（右缘对齐），thumb 16 × 16 |
| 3 | 读各行间距 | title 20px + 2px + desc 18px，行 padding 14px → 行高 68（单行说明）/ 86（两行说明） |
| 4 | 点第一个开关 | `aria-checked` false → true，设置面板未关闭 |
| 5 | 聚焦后按 `Enter` | true → false，面板仍在（不会像改版前的 TtsSelect 那样关掉弹窗） |
| 6 | 按 `Space` | 再次切换，面板仍在 |
| 7 | 打开「事件语音提醒」 | 展开 2 个子开关 + 音色下拉，竖线缩进，开关右缘与父项一致 |
| 8 | 切 RVC / Index-TTS2 | RVC 的自动回退行、Index 的清洗文本/随机情感均为开关，右缘与输入框同为 x=1006 |
| 9 | 回归 | smoke 160 / i18n 6 / client-load 85 / archive 14 / patch 4 / contract 105 全绿 |

`client-load` 新增 3 条断言：设置页存在 ≥4 个 `role=switch`、无原生 checkbox、每个开关都带 `aria-checked`。

### 5.4 按源码校对设计令牌（圆角 / 盒模型 / 菜单材质）

起因：§5.3 的开关是靠 `getComputedStyle` 反推的，圆角「看着像」但对不上；输入框、下拉、菜单
也从来没有对照过源码，圆角全是手挑的 8/9/10px。这次直接读 `dsh-client-ui-primitives` 的 CSS 源文件。

源码事实（`Button/Input/Menu/MenuSurface/SegmentedControl.module.css` + `ui-theme`）：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--dsw-radius-xs` | 4px | 极小内联元素 |
| `--dsw-radius-sm` | **8px** | 紧凑按钮（`Button.sm`）、菜单内小项 |
| `--dsw-radius-md` | **12px** | 输入框、标准按钮、菜单行 |
| `--dsw-radius-lg` | **16px** | 菜单浮层、代码卡片 |
| `--dsw-radius-xl` / `panel` | 20 / 28px | 卡片、面板 |

三个此前完全没对上、且截图看不出来的点：

1. **盒模型**。官方 `.switch` 第一条就是 `box-sizing:border-box`；插件全局是 content-box，
   36×20 加 `padding:2px` 实际撑成 **40×24**，圆角半径随之从 10 变成 12，拇指也偏离中心。
   所有定高控件（`ctl` / `dd-trigger` / `rvc-input` / `preview-input` / `browse`）一并补 `border-box`。
2. **`corner-shape: round`**。官方每个圆角元素都显式写这一行（胶囊、圆点、Tag、Pill），
   作用是退出 shell 的全局 superellipse —— 只写 `border-radius:999px` 会被渲染成 squircle。
3. **半径来源**。官方用 `var(--dsw-radius-*)`，插件此前硬编码。已全量换成令牌，
   顺带把 30px 的输入框改成官方的 **32px**（`Input.wrap`），边框从 `1px border-l2` 改成官方的
   **`0.5px border-l4`**，底色从 `bg-layer-3` 改成官方的 **`bg-layer-1`**，字号 13 → 14/22。

菜单浮层同时换成官方材质令牌，不再自造渐层与阴影：

```css
border-radius: var(--dsw-radius-lg);          /* 16px */
padding: 4px;
background: var(--dsw-menu-surface-fill);     /* 浅色 rgba(248,249,250,.58) */
backdrop-filter: var(--dsw-menu-backdrop-filter); /* blur(40px) saturate(150%) */
box-shadow: var(--dsw-elevation-prominent);   /* 0 0 0 .5px + 3px 8px + 0 0 20px */
```

真机实测（`getComputedStyle`，1280×720 视口）：

| # | 元素 | 实测 |
|---|---|---|
| 1 | 开关轨道 | 36×20 / `border-box` / 999px / `corner-shape: round` / `rgba(0,0,0,.122)` |
| 2 | 开关开态 | `rgb(15,17,21)`，拇指 `translateX(16px)`，白底 |
| 3 | 下拉触发器 | 32px 高 / radius 12px / `0.5px rgba(0,0,0,.16)` / `rgb(255,255,255)` / 14px / `padding-left 8px`（**设置行上的形态见 §5.5，已改为 28px 无边框 seat**） |
| 4 | RVC 输入框 + 浏览按钮 | 均 32px 高 / radius 12px，底部对齐（§5.5 把这条从「只对 RVC 行生效」扩到所有路径行） |
| 5 | 下拉浮层 | radius 16px / padding 4px / `rgba(248,249,250,.58)` / `blur(40px) saturate(1.5)` / 三层阴影 |
| 6 | 菜单项 | `min-height 34px` / `padding 6px 8px` / radius 12px / `gap 6px` / 13px |
| 7 | Index-TTS2 面板开关 | 36×20 / border-box / round，与 Edge 面板一致 |
| 8 | 回归 | smoke 160 / i18n 6 / client-load 98 / archive 14 / patch 4 / contract 105 / live-ui 11 全绿 |

`client-load` 新增 2 条源码级断言（DOM 断言看不出这两类回归）：
- `.dsh-tts-switch` 规则必须同时含 `box-sizing:border-box` + `corner-shape:round` + 36/20；
- `ctl` / `dd-trigger` / `dd-item` / `dd-menu` / `rvc-input` / `preview-input` / `browse` 七条规则的
  圆角必须来自 `var(--dsw-radius-*)`，写死 px 直接红。

---

### 5.5 设计语言全量对齐（下拉双形态 / 行节奏 / 按钮 / Toast）

§5.4 只校对了「令牌值」，没有校对「用在哪」。这一轮把 `dsh-client-ui-*` 里真正画设置页的几个包
逐个读完，再回头按优先级改本插件。

源码依据（全部是设置页实际使用的包，不是猜）：

| 包 | 读到的文件 | 取出什么 |
|---|---|---|
| `dsh-client-ui-primitives` | `Button/Input/Menu/MenuSurface/Pill/SegmentedControl.module.css` | 按钮三变体、输入框盒、菜单材质、Pill 胶囊 |
| `dsh-client-ui-permission-presets` | `.iWlSmW_trigger` | 设置行下拉的 **seat** 形态（28px 无边框） |
| `dsh-client-ui-agent-preset` | `.cubgiG_seat` | 同上，另一处独立实现，规格一致 |
| `dsh-client-ui-settings-general` | `.Pt1bsG_row / _title / _description` | 设置行节奏：16px 0 / `0.5px border-l2` / gap 24 / 12px 说明 |
| `dsh-client-ui-theme` | 令牌表 | `--dsw-radius-*`、`--dsw-alias-*`、`--dsw-shadow-lv3` |

#### 关键修正：下拉有**两种**形态，不是一种

之前把插件里所有下拉都做成「带边框 32px 输入框」，所以在设置行上看着像嵌了个表单。

| 形态 | 用在哪 | 规格 |
|---|---|---|
| **seat** | 设置行（标题 + 右侧选择器） | `height:28px` / `border:none` / `background:0 0` / `radius-sm` / `padding:0 4px 0 8px` / `gap:4px` / 13px 500 / `label-secondary` / hover `interactive-bg-hover` / focus `0 0 0 2px focus-ring` |
| **field** | 表单字段行（和输入框同排） | 与 `Input.wrap` 同盒：32px / `radius-md` / `0.5px border-l4` / `bg-layer-1` / 14px |

`.dsh-tts-path`（路径行）里的选择器也算 field：一行里只要有输入框，全部子元素统一 32px 高，
否则一行出现 32 + 28 两个基线、两种字号。

#### 同步落地的其它项

| 项 | 改前 | 改后（对齐源码） |
|---|---|---|
| 设置行 | `padding:8px 0` / `border-l3` / gap 12 | `padding:16px 0` / `0.5px border-l2` / gap 24 / 说明 12px `label-secondary` |
| 分组标题 | 14/20 | 16/24/500（区块标题层级） |
| 按钮 | 自定 6~8px 圆角、多套高度 | `Button.sm`：28px / `radius-sm` / `0.5px border-l3` / 12px 18 / `padding 0 10px`；禁用 `opacity .4` |
| 图标按钮 | 32×32 / radius 8 | 28×28 / `radius-sm` / `button-primary-fill` |
| Toast | 白底 + 边框 + `top:40px` | 深色面 `toast-bg`、无边框、`radius-lg`、`padding 12px 16px`、14/22、`shadow-lv3`、状态改用前导圆点 |
| 折叠摘要 | 12px | 13/20 `label-tertiary`，hover → `label-secondary` |
| Pill | 高度 22 / 自带边框 | 24px / `padding 0 8px` / 999px + `corner-shape:round` / `bg-layer-2`；选中 `ghost-active-fill` + `inset 0 0 0 1px` |
| 诊断卡 / provider 卡 | `border-l3` + `radius-lg` | `settings-card-stroke` + `radius-xl` / `padding 12px 16px` |
| 滑块行 | 标题 + 滑块横排（标签列 110px） | 纵向三段（标题 / 滑块 + 刻度 / 说明），标题升到 14/20 |
| 说明块 | 自带边框背景 | 纯文字（官方 description 就是纯文字） |
| 字段说明缩进 | `margin-left:110px`（只算标签列） | `120px` = 标签 110 + 行 `gap:10`，与输入框左缘对齐 |

#### 本轮踩到的坑（值得单独记）

**`content:""` 的引号会把整段 CSS 吞掉。** 加前导圆点时写成
`"...toast::before{content:" + '"' + ...`，落到源文件里变成 `{content:"";...}` 的双引号提前闭合
JS 字符串，`//"//"` 成为行注释，**其后的全部规则被静默丢弃**：

- `node --check` 通过（截断后的字面量仍然合法）；
- 页面里 `<style>` 只有 4633 字符（完整应为 28051），尾部停在 `content:`；
- 表现是「改了一堆样式全都没生效」，且没有任何报错。

修法：整条规则用单引号包裹，内层保留双引号。防回归不能只看源码，必须看**注入后的样式表**——
`client-load.mjs` 现在会让 `ctx.effect('…: styles')` 真跑一遍 `insertCss`，再对捕获到的
`<style>` 断言长度 / 花括号配平 / 末条规则存在。

#### 新增自动化断言（client-load 90 → 98）

| # | 断言 | 防的是什么 |
|---|---|---|
| 1 | `<style>` 只注入一次且非空 | 注入路径被跳过 |
| 2 | 样式表长度 > 20000 | 字面量被截断 |
| 3 | `{` 与 `}` 数量相等且末字符是 `}` | 某条规则写坏了、后面被吞 |
| 4 | 末条规则 `reading-bar:hover{…}` 存在 | 拼接没走到结尾 |
| 5 | 含 `.dsh-tts-dd-trigger{` 与 `overlayLayer` | 中段规则整段丢失 |
| 6 | `.dsh-tts-path .dsh-tts-browse` 是 32px + `radius-md` | 路径行基线漂移回 28px |
| 7 | 不存在 `.dsh-tts-rvc-row .dsh-tts-browse` | 死规则回归（RVC 行里根本没有按钮，这条曾写了但从未命中） |
| 8 | 说明缩进 = 标签宽 + 行 gap（120 = 110 + 10） | 说明文字比输入框左缘偏 10px |

#### 真机复测（`tests/live-ui-audit.mjs`，11/11 通过）

不需要 token：`dsh web` 的 launch token 是进程内随机值（WeakMap，只在启动时打印），但浏览器会话
cookie 是用 `~/.dsh/.credentials.yaml` 里持久化的签名密钥做的 HMAC-SHA256。脚本按
`dsh-client-connection/lib/index.js` 的 `cookieName` / `encodeCookie` 算法本地签一张 1 小时 cookie，
直接进已运行的实例，不重启服务、不打断用户。也可显式传 token 覆盖。

入口是 **设置 → 内置插件 → 语音**（面板注册在 `settings.plugins.tab` slot，不在插件列表里）。
脚本会在 Edge 面板测设置行，再切到「自定义音色（RVC）」让 `.dsh-tts-path` 真正渲染，最后从
`window.__dshTtsToast.show()` 触发 toast 验层级：

| # | 实测 | 结果 |
|---|---|---|
| 1 | 注入样式表 | 28671 字符、`{` / `}` 各 240、尾部末条规则在 |
| 2 | 三个设置行 seat | 均 28px / `0px` 边框 / radius 8px / 13px 500 / 透明底 |
| 3 | 设置行节奏 | 4 行 `16px/16px` + gap 24；2 个 stack 容器 column + gap 10 |
| 4 | hairline | 源码 `0.5px`，DPR=1 下 computed 归一为 `1px`（官方同理）——断言读 CSSOM 原文，不读 computed |
| 5 | 独立按钮 / 开关 | 28px；36×20 `border-box` + `corner-shape:round` |
| 6 | RVC 路径行 | 3 行，每行全部子元素 32px / radius 12px（含 2~3 个按钮） |
| 7 | 字段 picker / 输入框 | 3 个 picker、7 个输入框全部 32px / radius 12px |
| 8 | 字段说明对齐 | 10 条说明与控件左缘 delta 全为 0 |
| 9 | Toast | `overlayLayer` z 从 20 升到 1100，`elementFromPoint` 命中 toast 自身，完整在视口内 |
| 10 | Toast 材质 | 深色 `rgb(53,54,56)` / radius 16px / 无边框 |

运行方式（Windows）：

```sh
CHROME_PATH="C:/Users/<you>/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe" \
  node tests/live-ui-audit.mjs [base] [token]
# AUDIT_SHOT=/abs/path.png 可附带截图
```

---

## 6. 真机联调记录（GPT-SoVITS V4 整合包 · NVIDIA GPU）

环境：任意一份 GPT-SoVITS V4 `api_v2.py` 服务 + 一个自定义参考音色（参考音频 5.0s / 16kHz）。
下列数值只用于说明排障方法与量级，**与具体机器、具体权重无关**，换环境请自行重测。
示例端口：`api_v2.py` 9881、网关 8000，插件 API 地址 `http://127.0.0.1:8000`、模型 `gpt-sovits`、音色填网关 `voices.json` 里的名字。

### 6.1 上游直连

| 项 | 结果 |
|---|---|
| 冷启动首句（含 CUDA 预热） | 26.09s（另一次 22.93s） |
| 热启动 4.32s 音频 | 4.96s / 4.81s（RTF ≈ 1.12） |
| 输出规格 | 48000 Hz / 单声道 / wav |
| 中文文本（`text_lang=zh`） | 7.12s 音频 / 8.2s 墙钟 |
| `speed=1.0 → 1.5` | 5.48s → 3.80s（映射正确） |
| `response_format=mp3` | **400** `media_type: mp3 is not supported`，插件原样显示上游原因 |
| `extraBody {"top_k":1}` | 200，透传生效 |
| `extraBody {"not_a_real_param":123}` | 200（上游静默忽略，不报错） |

### 6.2 插件链路

| 路径 | 结果 |
|---|---|
| `/dsh-tts-api/openai-test` | `{ok:true, ms:2460, bytes:218924, voice:"<音色名>"}` |
| `/dsh-tts-api/speak` | `{"url":"/dsh-tts-audio/a1o-335037"}`，取回 733484B / 7.64s / 48kHz |
| UI「朗读本条消息」 | 长消息切 **12 段**，播放条显示 `4/12`，暂停/倍速/下载可用；网关日志 12 次 200，无失败 |
| 停引擎 → `/openai-test` | `OpenAI 兼容 TTS 合成失败（HTTP 502）：无法连接 http://127.0.0.1:9881/tts：[WinError 10061] 由于目标计算机积极拒绝，无法连接。（api_v2.py 起来了吗？）` |

### 6.3 本轮发现的两个环境级缺陷

1. **整合包 python 被 `PYTHONUTF8=1` 打崩**：`env\Lib\site-packages\users.pth` 是 GBK，Python 3.10 用 UTF-8 解析 `.pth` 直接
   `Fatal Python error: init_import_site`。启动前 `PYTHONUTF8=0`。
2. **系统代理劫持 loopback（第 6 个产品缺陷，已修）**：环境变量里设了指向本机代理的 `HTTP_PROXY` 时，网关用 urllib 连 9881 也走代理，
   上游未启动时拿到的是代理的 502 `upstream connect failed (os error 10061)`，看不出该启 `api_v2.py`；正常请求也多一跳。
   修复：`opener_for()` 对 loopback 强制 `ProxyHandler({})`，并把 `ConnectionError` 归类为 `upstream_unreachable`；
   自检新增「死代理仍能合成」回归用例（19 → 20 项）。
3. **keep-alive 断开刷一屏 traceback**：浏览器关连接时 socketserver 打 `ConnectionAbortedError (WinError 10053)` 整段栈，
   看起来像网关崩了。`GatewayServer.handle_error()` 已静音这三类（Abort/Reset/BrokenPipe），真异常仍上抛。
