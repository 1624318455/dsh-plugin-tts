# UI 设计语言 · 审计与点测记录

> 从原 `OPENAI-TEST-PLAN.md` 的 §5 抽出。0.7.0 的「OpenAI 兼容」通用入口已移除，
> 取而代之的是直连 `api_v2.py /tts` 的 GPT-SoVITS 专用提供者；原 §1–§4 / §6 是
> 网关时代的联调记录，随网关一起删除。
>
> **本文是历史存档，不是当前实现说明。** 下方正文里的字段名、provider 名称、组件名、
> 网关脚本与操作路径都来自当时的「OpenAI 兼容 + 网关」版本，现已全部移除。保留原文
> 是为了留下「问题长什么样 / 怎么判定算 bug / 怎么复测」的过程证据，请勿据此判断
> 当前 UI 或接口。当前实现以 `lib/`、`docs/GPT-SOVITS-GUIDE.md` 与 `tests/` 为准。
>
> 当前自动化：`tests/client-load.mjs`（源码级）、`tests/live-ui-audit.mjs`（真机 DOM）、
> `tests/gpt-sovits-contract.mjs` 与 `tests/e2e-gpt-sovits.mjs`（provider 契约）。
> 本文保留的是「按 dsh 官方源码校对设计语言」的过程记录，数值以当时实测为准。

---

## UI 点测记录（DSH Web 实测）

环境（**历史**，以下脚本均已删除）：`dsh web` 加载本地 `lib/`（v0.7.0），上游用
`tools/mock-sovits-upstream.py` 假引擎，网关是当时的 `tools/gpt-sovits-openai-gateway.py`。
目的当时是把「面板 → Host → 网关 → 上游」串起来，引擎本身留到 §3 用真 GPT-SoVITS 验。

> 注：下表是「合并诊断」之前的记录，其中的「测试」按钮已在 v0.7.0 取消（与「运行诊断」重复），
> 对应当前版本请把「测试」读作「运行诊断」；改版后的点测见 §5.1。

| # | 操作 | 结果 |
|---|---|---|
| 1 | 设置 → 内置插件 → 语音 → TTS 提供者选「本地音色（GPT-SoVITS）」 | 面板出现 API 地址 / Key / 模型 / 音色 / 格式 / 语速 / 高级参数 / 测试 || 2 | API 地址填 `http://127.0.0.1:18080`，模型 `gpt-sovits` | 配置即时落 Host 文件 |
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
| 2 | 提供者切到 GPT-SoVITS | 同样只有一行「任意 /v1/audio/speech 服务」 |
| 3 | 看 OpenAI 面板顶部 | 标题 + 一行说明 +「▶ 怎么用？哪些必填？（点开）」，默认不展开 |
| 4 | 点开折叠 | 6 行说明在一张浅卡片里，正文不再压着字段区 |
| 5 | 看字段 label | `API 地址 必填`（品牌色），其余 6 项 `选填`（灰） |
| 6 | 面板里找「测试」 | 已无；底部只有「运行诊断」/「导出诊断日志」 |
| 7 | 选 OpenAI + 运行诊断 | `✓ GPT-SoVITS接口 在线 · gpt-sovits` / `✓ GPT-SoVITS合成 正常（2904ms · 218924 B · tts-1 / alloy）` |
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
| 5 | 切到 GPT-SoVITS | 配置区紧跟选择行；只有「API 地址」带红色 `*`，其余 6 项无标记 |
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
| 3 | 下拉触发器 | 32px 高 / radius 12px / `0.5px rgba(0,0,0,.16)` / `rgb(255,255,255)` / 14px / `padding-left 8px`（**设置行上的最终形态见 §5.5：36px 无边框、默认态 `bg-module-platform` 浅灰底**） |
| 4 | RVC 输入框 + 浏览按钮 | 均 32px 高 / radius 12px，底部对齐（§5.5 把这条从「只对 RVC 行生效」扩到所有路径行） |
| 5 | 下拉浮层 | radius 16px / padding 4px / `rgba(248,249,250,.58)` / `blur(40px) saturate(1.5)` / 三层阴影 |
| 6 | 菜单项 | `min-height 34px` / `padding 6px 8px` / radius 12px / `gap 6px` / 13px |
| 7 | Index-TTS2 面板开关 | 36×20 / border-box / round，与 Edge 面板一致 |
| 8 | 回归 | smoke 160 / i18n 6 / client-load 102 / archive 14 / patch 4 / contract 105 / live-ui 15 全绿 |

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
| `dsh-client-ui-permission-presets` | `PermissionRow.module.css` `.oY77xG_selector` | **设置行**下拉：36px / `radius-md` / 默认态 `bg-module-platform` 浅灰底 / 14px primary |
| 同上 | `PermissionSelect.module.css` `.iWlSmW_trigger` | **composer 当前会话**选择器：透明 28px seat，不是设置行规格 |
| `dsh-client-ui-agent-preset` | `.cubgiG_seat` | 同上，composer seat 的另一处独立实现 |
| `dsh-client-ui-settings-general` | `.Pt1bsG_row / _title / _description` | 设置行节奏：16px 0 / `0.5px border-l2` / gap 24 / 12px 说明 |
| `dsh-client-ui-theme` | 令牌表 | `--dsw-radius-*`、`--dsw-alias-*`、`--dsw-shadow-lv3` |

#### 关键修正：一个包里有两个「下拉」，位置不同、规格相反

`dsh-client-ui-permission-presets` 里同时存在两个下拉触发器：

- `PermissionRow.module.css` 的 `.oY77xG_selector` —— 通用设置里「未来会话默认预设」行右侧，
  **默认态就有浅灰底**（`--dsw-alias-bg-module-platform`）；
- `PermissionSelect.module.css` 的 `.iWlSmW_trigger` —— composer / `/permission` 切换**当前会话**
  的透明 28px seat。

第一轮把两者弄反了：把 composer 的透明 seat 套到了设置行，用户直接指出「dsh 官方的下拉默认态
就是有背景色的 我们的现在没有」。回到 `PermissionRow.module.css` 逐条复核后改回，并新增两条源码
断言把「默认态必须有填充」钉死。

| 形态 | 用在哪 | 规格 |
|---|---|---|
| **selector** | 设置行（标题 + 右侧选择器） | `height:36px` / `border:none` / `background:var(--dsw-alias-bg-module-platform)`（浅色实测 `rgb(245,246,247)`）/ `radius-md` 12px / `padding:0 14px` / `gap:12px` / 14px 400 / `label-primary` / hover `interactive-bg-hover` / `:disabled` 只改 cursor、保留底色 / chevron 继承 primary |
| **field** | 表单字段行（和输入框同排） | 与 `Input.wrap` 同盒：32px / `radius-md` / `0.5px border-l4` / `bg-layer-1` / 14px；并把 selector 的 12px gap 复位成 4px |
| ~~seat~~ | composer 当前会话控件 | 28px / 透明 / radius-sm / 13px 500 —— **我们面板里没有这个位置，不得套用** |

`.dsh-tts-path`（路径行）里的选择器也算 field：一行里只要有输入框，全部子元素统一 32px 高，
否则一行出现 32 + 28 两个基线、两种字号。

浮层方向同样要抄：`PermissionRow` 的 `PopupSelect` 传了 `align:"end", portal:true`，即浮层右缘
对齐触发器右缘、向左展开。我们原来写死 `left:0`，长选项（如「本地音色（GPT-SoVITS）」）会
顶出设置弹窗右边界。现在只对 `.dsh-tts-module>.dsh-tts-dd` 的下拉加 `left:auto;right:0`，
字段行仍左对齐到所属输入框；真机实测浮层右缘 1176 = 触发器右缘 1176，弹窗右缘 1200。

#### 卡片前的横线要去掉（用户指出，顺带查出第二种情况）

设置面板是 `display:flex;flex-direction:column` 且**没有 gap**，模块之间靠各自的 `padding:16px 0`
撑开。于是「TTS提供者」行的 `border-bottom` 与紧随其后 provider 卡片的 `border-top` 落在同一
像素上，看起来像一根断线 / 双线（用户原话：「框和线重叠感觉有问题吧 这里应该不用这根横线了」）。

第一版写了 `.dsh-tts-module:has(+ .dsh-tts-rvc){border-bottom:none}`，真机 dump 立刻暴露第二
种情况：RVC / Index-TTS2 面板会**连续渲染两张卡片**，第一张卡片也满足 `:has(+ .dsh-tts-rvc)`，
底边框被一并抹掉，变成「一张没封口的盒子被一根线切开」。最终拆成两条：

```css
.dsh-tts-module:not(.dsh-tts-rvc):has(+ .dsh-tts-rvc){border-bottom:none}
.dsh-tts-rvc + .dsh-tts-rvc{margin-top:12px}
```

`:not()` 保证只有普通行被抑制、卡片保留完整边框；12px 是官方 settings 包里出现 11 次的合法
间距。`client-load` 两条源码断言 + `live-ui-audit` 三条真机断言分别钉住：卡片前那行 `0px`、
相邻卡片 `gap>=10` 且上下两条边框都在、其余普通行仍是 1px（防一刀切）。

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
| 卡片边界 | 行底 0.5px 线 + 卡片 0.5px 上边框贴在同一像素（`gap:0`），看着像断线 | 卡片前的**普通行**不再画底线；两张相邻卡片各自保留完整边框、中间 12px 间距（官方 settings 的 `gap:12px`） |

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

**「下拉」不是一种组件。** `PermissionRow.selector`（设置行，36px 带底）和
`PermissionSelect.trigger`（composer，28px 透明）在同一个 npm 包里，名字都叫 picker。
只搜关键词、不看组件挂在哪个 slot，就会把 composer 的规格抄进设置页。判断依据是
`PermissionRow` 的 JSX：`anchor` 那个 `<button className={...selector}>` 明确挂在设置行右侧，
而 `conversation.input.permission` slot 才是 composer seat。后续所有控件都先确认「用在哪」，
再抄「长什么样」。

#### 源码级断言清单（client-load 共 102 条，节选设计语言相关项）

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
| 9 | 设置行 picker 抄 `PermissionRow.selector`：36px / 默认 `bg-module-platform` / 14px / gap 12 / 无边框 | 把 composer 透明 seat 套到设置行（本轮用户指出的回归） |
| 10 | `:disabled` 与 `:hover:not(:disabled)` 都不清空填充 | 透明底从状态规则悄悄回流 |
| 11 | 两条 field 覆盖规则都把 gap 复位成 4px | selector 的 12px 间距污染字段行 |
| 12 | `.dsh-tts-module>.dsh-tts-dd .dsh-tts-dd-menu` 是 `left:auto;right:0` | 浮层向右溢出设置弹窗（官方 `align:"end"`） |
| 13 | `:not(.dsh-tts-rvc):has(+ .dsh-tts-rvc)` 是 `border-bottom:none` | 卡片前那行的横线与卡片上边框重叠 |
| 14 | `.dsh-tts-rvc + .dsh-tts-rvc` 有 `margin-top:12px` | 两张卡片边框贴在一起 / 首张卡片底边被误删 |

#### 真机复测（`tests/live-ui-audit.mjs`，15/15 通过；selector 与卡片边界修正后已重跑）

不需要 token：`dsh web` 的 launch token 是进程内随机值（WeakMap，只在启动时打印），但浏览器会话
cookie 是用 `~/.dsh/.credentials.yaml` 里持久化的签名密钥做的 HMAC-SHA256。脚本按
`dsh-client-connection/lib/index.js` 的 `cookieName` / `encodeCookie` 算法本地签一张 1 小时 cookie，
直接进已运行的实例，不重启服务、不打断用户。也可显式传 token 覆盖。

入口是 **设置 → 内置插件 → 语音**（面板注册在 `settings.plugins.tab` slot，不在插件列表里）。
脚本会在 Edge 面板测设置行，再切到「自定义音色（RVC）」让 `.dsh-tts-path` 真正渲染，最后从
`window.__dshTtsToast.show()` 触发 toast 验层级：

| # | 实测 | 结果 |
|---|---|---|
| 1 | 注入样式表 | 28830 字符、`{` / `}` 各 243、尾部末条规则在 |
| 2 | 三个设置行 selector | 均 36px / `0px` 边框 / radius 12px / 14px 400 / `rgb(245,246,247)` 填充 / gap 12px（computed 背景非透明） |
| 2a | 展开一个设置行下拉 | 浮层右缘 1176 = 触发器右缘 1176，左缘 996，弹窗右缘 1200 —— `align:"end"` 生效，长选项不再溢出 |
| 3 | 设置行节奏 | 4 行 `16px/16px` + gap 24；2 个 stack 容器 column + gap 10 |
| 4 | hairline | 源码 `0.5px`，DPR=1 下 computed 归一为 `1px`（官方同理）——断言读 CSSOM 原文，不读 computed |
| 5 | 独立按钮 / 开关 | 28px；36×20 `border-box` + `corner-shape:round` |
| 6 | RVC 路径行 | 3 行，每行全部子元素 32px / radius 12px（含 2~3 个按钮） |
| 7 | 字段 picker / 输入框 | 3 个 picker、7 个输入框全部 32px / radius 12px |
| 8 | 字段说明对齐 | 10 条说明与控件左缘 delta 全为 0 |
| 8a | 卡片前那一行 | 「TTS提供者」`border-bottom:0px`、卡片 `border-top:1px`、间距 0 —— 不再有断线 |
| 8b | 相邻两张 provider 卡片 | `gap:12px`，前卡 `border-bottom:1px` + 后卡 `border-top:1px` 都在 |
| 8c | 其余普通行 | 9 行仍为 `1px` 分隔线，规则没有一刀切 |
| 9 | Toast | `overlayLayer` z 从 20 升到 1100，`elementFromPoint` 命中 toast 自身，完整在视口内 |
| 10 | Toast 材质 | 深色 `rgb(53,54,56)` / radius 16px / 无边框 |

运行方式（Windows）：

```sh
CHROME_PATH="C:/Users/<you>/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe" \
  node tests/live-ui-audit.mjs [base] [token]
# AUDIT_SHOT=/abs/path.png 可附带截图
```

脚本会从 `~/.npm-global/node_modules/@playwright/mcp/node_modules` 回退加载 playwright /
playwright-core（该全局包不在本仓库的解析路径上），`PLAYWRIGHT_PATH` 可显式覆盖。
