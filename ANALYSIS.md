# dsh-plugin-tts 优化 · 升级 · 新增 路线图（分析 + 提案）

> 结论：本插件在"长文分块无缝播放 / RVC 变声 / 音色包分发 / 便携运行时"上已领先同类；
> 真正的差距在 **状态落盘、可发现性、UI/UX 体验护栏（逐句高亮、速度/暂停、选区朗读、快捷键、a11y）**，
> 以及少量**边界健壮性**（显式取消、音色下线自愈、自动播放解锁、网络退避）。

## 0. 现状盘点

- **路由**：`/dsh-tts-api/speak`(合成/分块队列)、`/dsh-tts-audio/<id>`、`rvc-next`(逐块拉取)、
  `rvc-files`、`rvc-compact-index`、`rvc-packs`/`-installed`/`-install`/`-uninstall`/`-progress`、`diagnose`。
  零依赖 worker 镜像 node-edge-tts 协议（`Sec-MS-GEC`、`Path:audio` 帧、1006 重试一次）。
- **Client**：`shell.overlay` 隐藏 `<audio>` 宿主 + 4 个 slot（shell.overlay / input.left /
  assistant-actions / settings.plugins.tab）；Web Audio `start(prevEnd)` 采样级拼接；i18n 双层持久化。
- **自适应分块**：probe→ratio 分档(6–20s/预热2–4)→`calibration.json`(7天+设备指纹)；短文本≤12s/上传原声走单 URL。
- **音色包生态**：manifest schema 2、sha256 校验、代理、多索引变体、卸载、便携运行时。
- **已知限制（README）**：① 音色/自动朗读开关**内存态、不落盘**；② 音频写 OS 临时目录；③ 中英文视觉只能真机确认。

## 1. 同类产品调研（基于既有领域知识）

| 类别 | 代表 | 本插件差距 / 可借鉴 |
|---|---|---|
| Edge TTS 桌面/CLI | edge-tts、各类 GUI | 只有"选音色→播放"；本插件远超。可借鉴**速度控制、导出 MP3、逐句高亮** |
| 浏览器朗读扩展 | Read Aloud、Speechify | 强项：**卡拉OK式逐句高亮 + 语速 + 选区朗读 + 快捷键**——本插件最缺 |
| 桌面朗读工具 | Balabolka、NaturalReader | **格式朗读、批量朗读、波形可视化** → 批量读多消息、导出 |
| 聊天类 App 朗读 | ChatGPT/Claude/豆包/Kimi | **打断/续播策略、播放进度圈** |
| 开源多后端 TTS | Piper/espeak-ng/ChatTTS/CosyVoice/GPT-SoVITS | 本插件只有 Edge；本地高质量 TTS 可作底噪/RVC 补充 |
| RVC 生态 | RVC WebUI、AI Hobbyist、SUPERSING | **批量转换、音色 A/B 对比、成品导出** |

## 2. 新增模块（能力扩展）

- **M1. TTS 后端抽象层（Provider 接口）**：Edge/RVC 迁入可插拔接口，新增本地 Piper/espeak、OpenAI/Azure、离线中文 TTS(ChatTTS/CosyVoice)，让 RVC 底噪不再依赖在线。
- **M2. 原生流式合成（SSE/WebSocket）**：Edge 长文"边合成边推"，降低 TTFP，复用 Web Audio 拼接管线。
- **M3. 导出/下载/复读缓存**：音频附件下载（原声+变声对）；文本 hash+voice 的 LRU 缓存，重播不重合成。
- **M4. 音色包生态增强**：多仓库并存、下载前试听、A/B 对比、离线 zip 导入、断点续传。
- **M5. 多模型库与参数画像**：每个模型记住最优参数（f0/index_rate/原声音色/spk），切换即载入。

## 3. 功能升级

- **F1. 设置落盘（最高优先）**：音色/自动朗读/provider/音量语速持久化（UI→localStorage，Host→`~/.dsh/tts-rvc/settings.json`），消 README Known-limits ①；加"恢复默认"。
- **F2. 自动朗读策略**：每条/仅长消息自动读、新消息打断或排队、不打断手动读。
- **F3. 朗读播放器升级**：暂停/继续、倍速(0.5–2x)、上/下一条、mini 进度条。
- **F4. 选区/从光标朗读**：朗读选中、从第 N 段继续。
- **F5. 诊断增强**：音色表新鲜度自检、calibration 信息、RVC 健康、网络/代理连通。

## 4. UI/UX 设计优化（基于真实截图）

1. **Auto-read 图标歧义 + 状态不可见**：喇叭易被误读为语音输入(ASR)、开关态只能靠 hover tooltip。→ 换独立图标（耳机/波形+A 徽标）、明显视觉态（填充/斜杠/pill"自动朗读·开"）。
2. **朗读进度显性化**：tooltip 之外，加**逐句/逐段高亮** + 细进度条。
3. **Tooltip 主题化**：统一 `--dsw-*` token，避免系统默认白底黑字；所有图标补 tooltip。
4. **设置面板信息密度**：值放把手旁小框、统一缩放/单位、加"恢复默认"、子导航（Edge/RVC/音色包/诊断）。
5. **首次上手引导**：设置面板内嵌分 OS 启动步骤 + ✓ 就绪清单。
6. **无障碍(a11y)**：aria-label/aria-pressed、focus 样式、键盘快捷键（Space 暂停/续播、S 停止、R 朗读）。

## 5. 边界处理与健壮性

- **E1. 显式取消/打断释放资源**：停止时立即通知 Host 提前结束 job 串行链并释放 GPU/内存（不必等 10 分钟惰性回收）。
- **E2. 音色下线自愈**：`1007` 时动态剔除 + 自动回退默认音色，而非只报错。
- **E3. 自动播放解锁**：用户首次交互即预热 `AudioContext`。
- **E4. 网络抖动**：Edge 1006 改指数退避重试(≤3)+超时；RVC /convert 超时；`rvc-next` 短暂重试再报错。
- **E5. 服务掉线中播**：RVC 中途断→暂停等待/自动重连，恢复后续播。
- **E6. 消息形态边界**：空白/emoji-only 判定；超长消息限并发、入队。
- **E7. 磁盘与清理**：显式缓存清理入口 + 满盘告警；音频 LRU 上限。
- **E8. 校准健壮性**：`calibration.json` 多机同步/备份、模型更换重校、2 分钟兜底保留。
- **E9. 包安装安全**：下载 size 预检、断点续传、in-flight 恢复。
- **E10. 竞态回归**：换消息/切会话/刷新/新消息 5 态矩阵持续强化。

## 6. 测试与验收

- 沿用现有分层（smoke/live/i18n/client-load/patch/make-pack）。
- 新增：E1 取消、E3 解锁、E4 退避；M1 provider 契约；M3 导出+缓存；F1 落盘往返+恢复默认；UI 新组件 mock 渲染 + a11y 断言；i18n 新键并入回归。
- 验收：`npm run test:all` 全绿；每个新能力有绿色用例；不破坏现有 5 态矩阵；README/zh、RVC-GUIDE、adaptive-chunked-playback 文档同步。

## 7. 分期

- **Phase 1（低风险先做）**：F1 设置落盘+恢复默认 · E1 显式取消 · E3 自动播放解锁 · E2 音色下线自愈 · 部分 a11y（aria/快捷键） · F5 诊断增强的一部分 · 音频 LRU 缓存(F 前置)。
- **Phase 2（UX 体验护栏）**：auto-read 图标+状态重做 · 逐句高亮/进度显性化 · mini 播放器 · tooltip 主题化 · 面板密度整理 · 首次上手引导。
- **Phase 3（能力扩展）**：M1 Provider 抽象+本地 Piper · M2 原生流式 · M3 导出/下载 · F4 选区朗读。
- **Phase 4（规模/生态）**：M4 多仓库+A/B+离线安装+断点续传 · M5 多模型库 · E8 校准多机同步 · 便携运行时 Linux 实测 · E4/E5 网络与服务健壮性。

## 8. 假设与前置说明

- 本文件即分析交付物；实时 web_search 在本环境因无 API Key 不可用，同类调研基于既有领域知识。
- 所有改动沿用现有模式（Host 路由 + `ctx.effect` 清理、零依赖 worker、client sprite+rpc、i18n 双层、dsh bundle/patch 装配），不引入新框架。

## 9. Phase 1 落地记录（已完成，test:all 全绿）

- **E1 显式取消**：`/dsh-tts-api/rvc-next?cancel=1` + Host `cancelJob`，client `stopSpeaking` 即时通知释放本地 GPU/内存。（`tests/smoke.mjs` 取消用例）
- **E3 自动播放解锁**：apply 内首次手势 resume Web Audio 上下文 + 播放静音片段解锁 `<audio>`。
- **E2 音色下线自愈**：`pruneRemovedVoice()` 检测 `1007/unsupported voice`，剔除音色并回退默认；设置面板过滤已移除音色；新增 `voice.removed` i18n 键。
- **F1 设置持久化**：音色/自动朗读/提供者/RVC 配置写入 `localStorage['dsh-tts-settings']`，加载时恢复；面板新增「恢复默认设置」按钮；暴露 `window.__dshTtsSettings` 测试钩子。（`tests/client-load.mjs` round-trip 测试）
- **a11y**：`Esc`/`S`（非输入框内）停止朗读的全局快捷键。
- **音频 LRU 缓存**：确认进程内 `cache`/`files` LRU 缓存（60/300 上限）；缓存命中时校验底层文件是否被系统清理，失效则回退重合成（避免 404）。（`tests/smoke.mjs` 重复朗读复用 URL 用例）
- 运行：`smoke 47 · live 18 · patch 4 · i18n 6 · client-load 28`，`npm run test:all` 全绿；README/README.zh「边界行为」「已知限制」已同步。

> 说明：音频缓存为**进程内**缓存（音频在 OS 临时目录，由系统清理）；完全跨重启的磁盘级缓存列为后续项。

## 10. Phase 2 落地记录（已完成，test:all 全绿）

- **P2-1 auto-read 图标+状态重做**：换用独立的 `HeadphonesIcon`（耳机，区别于"语音输入/麦"语义）；自动朗读从仅有喇叭图标改为**带文字的 pill**（`自动朗读` + 状态圆点 + 品牌色高亮 + `aria-pressed`）；新增 `autoRead.label` i18n 键。`tests/client-load.mjs` 增加"渲染为 labeled pill"结构化断言。
- **P2-2 朗读进度显性化**：分块朗读时在消息操作行显示可见计数 pill「第 x/y 段」（`dsh-tts-chunk-pill`，tabular-nums）。说明：宿主渲染的消息正文 DOM 不在插件控制内，故不做正文内逐句高亮，改用可见段计数（tooltip 仍保留细分）。
- **P2-3 mini 播放器（暂停/继续 + 倍速）**：播放中的消息操作行新增「播放/暂停 + 倍速(1x/1.25x/1.5x)」控制；暂停/继续对 Web Audio 用 `ctx.suspend()/resume()`（无隙安全）、对单 URL 用 `el.pause()/play()`；倍速对单 URL 设 `el.playbackRate`、对 Web Audio 按 `rate` 调度（`nextStart += duration/rate`）并设 `source.playbackRate`；停止/打断时复位。新增 `mini.*` i18n 键。
- **P2-4 tooltip 主题化 + slider 值整理**：为 auto-read / 朗读 / 暂停 / 倍速 / 段计数按钮改用 `data-tts-tip` + CSS `::after/::before` **主题化 tooltip**（`--dsw-*` token，深色友好），保留 `aria-label` 供屏幕阅读器；RVC 高级参数 slider 的当前值从"居中与把手重叠"改为**最右侧独立读数**（`dsh-tts-slider-value` 右对齐）。
- **P2-5 首次上手引导**：RVC 设置面板顶部内嵌「首次使用 RVC？三步上手」引导块（`dsh-tts-onboard`）：需求说明 + 分 OS 启动命令（Windows/macOS/Linux + 便携运行时）+ 就绪步骤 + 一键「运行诊断」按钮。新增 `onboard.*` i18n 键。
- 运行：`smoke 47 · live 18 · patch 4 · i18n 6 · client-load 29`，`npm run test:all` 全绿。

## 11. Phase 3 落地记录（进行中）

- **M3 音频导出/下载（已完成）**：
  - Host `GET /dsh-tts-audio/<id>?download=1` → 返回 `Content-Disposition: attachment; filename="dsh-tts-<id>.mp3"`，可保存合成音频（Edge 原声或 RVC 变声）。
  - 客户端在每条消息操作行新增**下载按钮**（`DownloadIcon`），点按后经 `rpcSpeak` 合成（复用进程内缓存，已读消息秒下），触发浏览器下载。
  - **长 RVC 分块朗读**（无单一输出文件）在前置拦截并提示"暂不支持导出为单个文件"，避免白白启动探测+预热 job。
  - 新增 `download.*` i18n 键；`tests/smoke.mjs` 增加"`?download=1` 设置 Content-Disposition attachment"用例（48/48）。
- **M1 TTS Provider 抽象（基础层，已完成）**：
  - Host 引入**提供者注册表**（`registerProvider`/`getProvider`）：`edge-tts` 与 `rvc` 各自实现
    `synthesizeShort(text, voice, prosody, custom) -> 音频路径`，`/speak` 的短路径统一经注册表分发；
    长 RVC 分块仍是 `rvc` 专属路径。行为零变更，现有 edge / rvc / upload / chunked / cancel 测试全绿（48/48）。
  - 收益：后续新增本地后端（如 Piper/CosyVoice）只需 `registerProvider('local-piper', {...})` +
    UI 侧 provider 选项，无需改动 `/speak` 主逻辑。
- **M1+ 本地 Piper 提供者（脚手架，已完成）**：注册第三个可插拔 provider `local-piper`，经同一抽象
  在 `/speak` 短路径分发；配置了 `piperBinary`+`piperModel` 时 `spawn piper --model … --output_file …`，
  未配置时返回本地化错误 `host.piperUnconfigured`（不崩溃）。`tests/smoke.mjs` 增加未配置用例（49/49）。
  （真实端到端合成需用户放好 Piper 二进制与 .onnx 模型，本环境无二进制无法实跑。）
- **F4 选区朗读（已完成）**：`setupSelectionRead` 监听 `mouseup`，在会话中出现非空文本选区时于选区上方
  显示一个「朗读选中文本」悬浮 chip（`speakText(sel, 'manual')`）；自动忽略 input/textarea 内选择，
  点击外部/滚动自动隐藏。新增 `sel.read` i18n 键与 `dsh-tts-sel-*` 主题化 CSS；preview 屏验证 chip 渲染正常。
- **待续**：M2 原生流式合成（SSE/WebSocket + 客户端流式播放适配——较大且需真实宿主交互验证）。
- **M2 原生流式合成的可行子集（已完成）**：把**自适应分块渐进播放**扩展到泛 Edge 长读——长文本不再"整段合成完再播"，而是走同一分块队列"边合成边播"。`/speak` 的 `convertChunk` 改为按 `job.sink` 分发（RVC=逐块变声，Edge=逐块 Edge 合成）；长 Edge 文本 >12s 时返回 `jobId+chunks`，前端复用现有 `playChunks` 无感续播。`tests/smoke.mjs` 增加"long edge read returns chunked job"用例（50/50）。
