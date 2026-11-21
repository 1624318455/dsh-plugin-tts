# UI 设计规格记录

> 维护者文档，不随 npm 包分发。记录设置面板每个控件的来源与测量值，
> 目的是「为什么这样写」在半年后还能查到，而不是让用户读。
> 英文版原文见本次重构前的 README.md（git 历史）。

设置面板里的控件是自绘的，规格逐条抄自 DSH 的 `Button` / `Input` / `Menu` / `Switch` /
`PermissionPresets` / `AgentPreset` / `SettingsGeneral` 源码，不是照截图仿制。

**两种下拉形态，别把位置搞混。** `dsh-client-ui-permission-presets` 里有两个同名「下拉」：
设置行右侧的是 `PermissionRow.module.css` 的 `.oY77xG_selector` —— 36px 高、`--dsw-radius-md`
圆角、**无边框但默认态就有 `--dsw-alias-bg-module-platform` 浅灰底**（浅色实测
`rgb(245,246,247)`）、14px/400 主墨色、`padding 0 14px`、与箭头 `gap 12px`，hover 换
`interactive-bg-hover`，禁用只改光标、不去掉底色；而 composer 里切换当前会话的
`PermissionSelect.trigger` / `AgentPresetSeat` 才是透明 28px seat，我们面板里没有这个位置。
只有表单字段行里的选择器才变成 *field*：和旁边的 `Input` 同盒（32px / `--dsw-radius-md` /
0.5px `border-l4` / `bg-layer-1`），并把 selector 的 12px 间距复位成 4px。菜单浮层用官方材质
（`--dsw-menu-surface-fill` 半透明底、`blur(40px) saturate(150%)`、`--dsw-elevation-prominent`
三层阴影、12px 圆角选项、选中项右侧打勾），设置行浮层按官方 `align:"end"` 右缘对齐触发器、
向左展开（长选项不会顶出弹窗），支持 `Esc` / 点外部关闭 / `↑↓` + `Enter` 选择，空间不足时自动上翻。

**行节奏抄设置页。** 每行 `padding:16px 0`、`0.5px border-l2` 细分隔、`gap:24px`，标题 14/20、
说明 12/18 次级墨色；成组的模块标题升到 16/24/500。紧跟 provider 卡片的那一行不画底线
（否则会和卡片上边框落在同一像素，看着像断线），两张连续卡片各自保留完整边框、中间留 12px 间距。

**按钮只有三变体。** `Button.sm`（28px / `radius-sm` / 0.5px `border-l3` / 12/18）、
图标按钮（28×28 / `radius-sm` / `button-primary-fill`）、禁用态 `opacity .4`。一行里只要有输入框，
同行按钮与选择器统一到 32px，避免 32 + 28 两个基线。

**开关**是 36 × 20，与 `Switch.module.css` 逐字一致 —— 含 `box-sizing:border-box` 和
`corner-shape:round`（后者用于退出 shell 的全局 superellipse，少了它 999px 圆角会被画成 squircle），
不用原生方框，因为原生 checkbox 由操作系统绘制。

**Toast** 用官方深色面（`toast-bg` + `toast-label` + `--dsw-shadow-lv3`、`radius-lg`、
`padding 12px 16px`），不画边框，状态靠前导圆点区分。

所有圆角都取自 `--dsw-radius-xs/sm/md/lg`，不写死像素。必填项只标一个红色 `*`，其余字段不加标记
（GOV.UK / USWDS 的「只标少数派」写法）。诊断结果是一张 hairline 列表：
状态图标 + 名称 + 右对齐状态，第二行是可执行建议，`跳过` 项保持灰色、不误报红。

样式表是一整条 `+` 拼接的字面量，一旦某个引号写坏会被静默截断（`node --check` 照样通过），
所以 `tests/client-load.mjs` 会真的跑一遍注入、再断言注入后的 `<style>` 长度与花括号配平。
