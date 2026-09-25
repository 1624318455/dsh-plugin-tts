# 朗读跟随滚动 v2（Scroll-follow v2）——设计与分级实施

> 状态：P0、P1 实施完毕并全量测试通过；P2（文案/测试）完毕；真机验收待用户执行。
> 背景：v1（`lib/client.js` 跟随链）实测效果有问题：抖动/回拉、冻住、抢夺用户滚动。
> 本文档是唯一事实源：目标、非目标、架构、每一步的验收标准都在此；改完一项勾一项。

## 0. 术语

- **跟随（follow）**：朗读时自动滚动对话区，让"正在读的位置"保持可见。
- **块（chunk）**：服务端切分的一段合成单元（Edge 约 72 字/块）。
- **锚点（anchor）**：正在朗读的那条消息对应的 DOM 元素。
- **latch-off**：用户一旦手动滚动，跟随彻底停止，直到用户点"回到跟随"手动恢复。

## 1. 现状诊断（v1，`lib/client.js`，行号以 2026-09-26 版为准）

| # | 问题 | 位置 | 后果 |
|---|---|---|---|
| A | 块内插值按"全文等分成 N 份"估每块时长，实际各块变长 | `ttsLiveRatio` 3559–3564 | ratio 在块边界跳变/回拉，视图往前滑一段又弹回 |
| B | 暂停/倍速零补偿（`chunkStartedAt` 暂停期老化、`shared.rate` 未用） | 3563–3564，3577 | resume 跳变；1.25x/1.5x 全程落后猛追 |
| C | 针搜 fallback 找到 `<p>` 即缓存为整消息锚点复用 | 3662–3665 | `ratio×小元素高度`，跟随冻在第一段；短消息（<100 字）指纹重定位直接跳过（3607） |
| D | 5 秒让步后自动抢回 + 首次 tick 无条件居中 | 3576，3701–3712 | 拔河；auto-read 把正在翻历史的用户拽走 |
| E | `behavior:"auto"` 瞬时跳 + 永远拉回中线，250ms 纠偏 | 3721–3733 | 步进式 yank；无 smooth、无 reduced-motion |
| F | 每 tick `innerText` 全扫 + TreeWalker + `getBoundingClientRect`（4Hz 强制 reflow） | 3601–3656 | 长会话卡顿；手机上放大 |
| G | 流式增长回复：宿主自滚/布局位移被当用户滚动 → 长期 yield；`msgTop` 持续漂移 | 3747–3750，3670 | 边播边长的消息跟不住 |
| H | 无视觉锚点（句子高亮已删，client-load 还断言了"无高亮"） | 测试"sentence shadow highlight removed" | 用户看不出在追哪段 |
| I | 容器查找靠 class 子串 + 首个 overflow 元素，找不到就摆烂 | 3486–3504 | 窄布局/改版 DOM 下全程 `no-container` |

业界对照（Edge Read Aloud / Immersive Reader / 播放器类 App）：**仅目标出视口才动**（`block:"nearest"` 或到底翻半页）、**用户接管即 latch-off**（手动恢复）、**高亮与滚动同一开关**、**块/句级步进不做块内伪平滑**、
`prefers-reduced-motion` 直接关跟随、可见性用 IntersectionObserver（零轮询）。

## 2. 总体设计（v2）

```
播放进度（块索引，步进）
   → 锚点（整消息元素，唯一可信源；click/auto 建立，指纹重建）
   → 可见性判定（目标块是否出视口；Observer 事件驱动，无轮询）
   → 最小滚动（scrollIntoView block:"nearest" + smooth；reduced-motion 则 auto/关）
   → 用户接管即 latch-off（手动"回到跟随"恢复）
   ＋ 块级高亮（视觉锚点，与跟随同开关）
```

设计原则：

1. **信号只到块级**：`ratio = (readingIndex-1)/total` 步进式，不再块内插值。
   A/B 类伪平滑误差按构造消失（暂停/倍速不再影响位置）。
2. **锚点只认整消息**：click 攀爬与 auto 的消息元素是唯一可信源；针搜段落
   fallback 不再缓存为锚点（只用于单次兜底，且标记 `diag.anchor="fragile"`）。
3. **滚动最小干预**：目标块完全在视口内 → 什么都不做；出视口 →
   `scrollIntoView({block:"nearest", behavior:"smooth"})`；reduced-motion →
   behavior 取 `auto`，若用户要求减少动态则整功能静默关闭。
4. **让步改 latch-off**：任何确认的用户滚动 → 跟随锁死 off，浮条/按钮出现
   "回到跟随"手动恢复；取消 5 秒自动抢回与首次无条件居中（点击发起的朗读
   保留"首次居中"，auto-read 永不主动拽屏）。
5. **高亮回归**：当前块对应段落加 `.dsh-tts-sentence-active`（与跟随同开关，
   暂停时保留，停止时清除；沿用被删 CSS 类名以便老测试语义延续）。
6. **移动端四 guard**（mobile-access 是手机浏览器直连同一套 web UI，一套代码）：
   - touch 惯性：`touchstart/touchend` 跟踪 + `scrollend` 事件（不支持则回退计时器），惯性余波不刷新让步/不误判自滚；
   - `visualViewport.resize`：地址栏收放导致视口变化时重算容器几何；
   - 容器回退 `document.scrollingElement`（窄布局无内层 overflow div 时）；
   - 小屏 overlay 浮条位置复查（compact bar 已收窄，大概率无事，动手时目检）。
7. **诊断可观测**：沿用 `window.__dshTtsFollowDiag`，计数键更新为
   `in-view / nearest-scrolled / latched-off / fragile / centred /
   reduced-motion / no-anchor / bad-target`（旧 `user-yield/scrolled/
   tiny-skip` 退役）。

## 3. 与旧行为的差异（给用户看的）

| 场景 | v1（旧） | v2（新） |
|---|---|---|
| 块内平滑 | 按等长切片估时长插值，块边界跳变 | 步进：整块一切换才动，无伪平滑 |
| 暂停/倍速 | 暂停后时间轴继续老化，倍速全程落后 | 步进位置与时间/倍速无关，暂停即冻结 |
| 手动滚动 | 停 5 秒后自动抢回 | 彻底停跟，浮条出现"回到跟随"，点才恢复 |
| 自动朗读 | 首 tick 无条件居中，可能把正在翻历史的用户拽走 | auto-read 永不主动拽屏；只有点击朗读才居中一次 |
| 滚动幅度 | 永远拉回中线，250ms 纠偏 | 出视口才动，最小位移（nearest），smooth |
| 减少动态 | 无视系统设置 | 开启后跟随静默关闭 |
| 当前段提示 | 无（高亮已删） | 当前块段落软背景高亮，随块迁移 |
| 手机惯性滚动 | 余波刷新 5 秒窗口≈永久让步 | touch/scrollend 识别，余波不误判 |
| 长会话性能 | 4Hz 全 DOM 扫描 | 事件驱动，零轮询 |

## 4. 测试计划

- 自动化（已全绿）：smoke 133/133（含 spans 断言）、client-load 73/73
  （跟随段重写为 v2 契约：步进信号、无轮询、latch-off、手势源、reduced-motion、
  spans 接线、高亮回归）、i18n 6/6（`follow.resume` 中英齐）。
- 真机验收（用户侧，HEADLESS 覆盖不到）：
  - [ ] 桌面：长文跟随无跳变回拉；手动滚动后停跟出 pill；点 pill 恢复
  - [ ] 桌面：auto-read 新回复不拽屏；暂停/1.5x 不漂移
  - [ ] 桌面：开系统减少动态，跟随全程静默
  - [ ] 手机浏览器：跟随不断；惯性滑动不误判；pill 位置不挡内容
  - [ ] 高亮随块迁移；停止/新读清除无残留

## 5. 实施步骤（分级）——已完成 ✅

- [x] **P0-1 信号**：块索引步进；删块内插值。
- [x] **P0-2 锚点**：停缓存段落；针搜标 fragile。
- [x] **P0-3 滚动+让步**：nearest + latch-off + 手动恢复 pill；居中仅 manual。
- [x] **P0-4 无障碍**：reduced-motion 门控。
- [x] **P1-1 高亮**：软背景回归，随块迁移，停止/新读清除。
- [x] **P1-2 移动端 guard**：touch/scrollend、visualViewport、容器回退。
- [x] **P1-3 服务端 spans**：`spanParts` + `/speak` 双分支下发 + `__test` 导出。
- [x] **P2 收尾**：设置文案改行为承诺（中英）+ `follow.resume` 键；诊断计数键换新；
  client-load 跟随段重写；smoke 加 spans 断言。