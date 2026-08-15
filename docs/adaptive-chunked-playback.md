# 自适应分块渐进播放方案（Adaptive Chunked Progressive Playback）

> RVC 长文本朗读的"先全部转换、后整体播放"改造成"边转换、边播放"的设计与实现说明。
> 核心思想：**性能开销摊在用户本机**，不同机器自动校准块大小与预热数量，做到"即点即听、长文不卡顿"。

## 1. 问题

RVC 是**变声**而非 TTS：输入音频长度 = 输出音频长度，所以"长文本朗读"必须
先把整段文本用 Edge TTS 合成底噪，再交给 RVC 转换。旧链路是：

```
整段文本 → Edge 合成整段底噪 → RVC 整段转换 → 返回 → 播放
```

对短句（≤12 秒音频）这是最优解；但对长回复（数百字、几分钟音频）会变成：

- 用户点击后**干等**：合成 + 转换整段（几十秒甚至几分钟）完成才出声；
- 期间没有任何反馈，体验像"卡死"；
- 内存峰值高（整段音频一次性进出 RVC）。

曾考虑"只读前 20 字"来缩短等待 —— 但这会**丢掉正文内容**，被否决。
正确方向是：内容一字不丢，但**让第一块尽快出声，其余在播放的同时后台合成**。

## 2. 方案总览

```
Edge 合成整段底噪? 不 —— 改成：
1) 文本按句切块（每块 ≈ 10-20 秒音频）
2) 先转换预热块（2-4 块）→ 立即返回给前端开始播放
3) 播放第 n 块的同时，后台转换第 n+1、n+2 块（转换/播放重叠）
4) 前端队列快见底时向 Host 拉取下一块，无缝续播
```

关键比率：**速度比 ratio = 转换耗时 / 音频时长**。

- GPU（RTX 5070 实测）：15 秒音频 ≈ 3-4 秒转换 → ratio ≈ 0.25
  → 转换永远追得上播放，队列不会饿死，**天然无缝**。
- CPU 用户：ratio 可能 > 1 → 必须缩小块、加大预热，把"卡顿点"压到最少。

## 3. 自适应校准（probe + 分档）

首次使用长文本 RVC 时，Host 做一次 **5 秒探测**：

1. Edge 合成一段固定探测文本（≈3.6 秒音频）；
2. 本机 RVC 转换，测出 `ratio = 转换耗时 / 音频秒数`（含每块 Edge 合成耗时，
   与真实分块流水线口径一致，偏保守）；
3. 按分档表决定 `chunkSec`（每块音频秒数）与 `prewarm`（先转换几块再开播）；
4. 结果按配置指纹持久化到 `~/.dsh/tts-rvc/calibration.json`：
   - **7 天有效**，dsh 重启后直接复用，连那一次 ~7s 探测都省掉；
   - 同时记录 `device`（RVC 服务 `/health` 上报的 GPU 名）；换显卡/切 CPU 时
     自动重新探测，不会拿旧的 GPU 数据给 CPU 用；
   - 探测失败不覆盖磁盘上的旧有效条目（会话内 2 分钟用保守档兜底）。

| ratio | 块大小 | 预热块数 | 适用 |
|---|---|---|---|
| ≤ 0.4 | 20 秒 | 2 | 强 GPU，几乎无缝 |
| 0.4 – 0.6 | 15 秒 | 2 | 中端 GPU |
| 0.6 – 0.9 | 10 秒 | 3 | 入门 GPU / 快 CPU |
| > 0.9 | 6 秒 | 4 | CPU，尽量平滑 |
| 探测失败 | 10 秒 | 3 | 保守兜底（60 秒内不重复探测） |

块大小换算：中文 ≈ 3.6 字/秒 → `maxChars ≈ chunkSec × 3.6`（拉丁文本按 12 字/秒）。

### 为什么分档而不是固定值？

同一套代码要在"4090 用户"和"核显用户"上都成立。固定大块在 CPU 上会频繁断流，
固定小块在 GPU 上是浪费。**按本机实测速度自适应**才是"即选即用"的根基。

## 4. 文本切块

`splitText(text, maxChars)`：

1. 按句号/感叹/问号/分号（含中英文）切句；
2. 超长句再按逗号/顿号切段；
3. 仍超长的硬切（每段 ≤ maxChars）；
4. 尽量让每块落在语义边界，避免在句中切断导致听感断裂。

## 5. 协议：任务队列（Host 侧）

`POST /dsh-tts-api/speak`（RVC + Edge 底噪 + 预估 > 12 秒时）：

```jsonc
// 请求不变；响应变为：
{ "jobId": "j1", "chunks": ["/dsh-tts-audio/c1", "/dsh-tts-audio/c2"], "total": 6,
  "ratio": 0.24, "chunkSec": 20 }
// chunks 只含"预热块"；总块数在 total
```

`GET /dsh-tts-api/rvc-next?job=j1`（前端逐块拉取）：

```jsonc
{ "url": "/dsh-tts-audio/c3", "more": true }   // 还有后续
{ "done": true }                               // 已到末尾
{ "error": "后续段落合成失败：..." }            // 某块失败
```

Host 内部：

- 每 job 一个**串行转换链**（`job.tail`），并发拉取自动排队，RVC 服务不被并发打爆；
- 每块 = Edge 合成该块文本 → RVC 转换 → 临时 wav → 音频路由 URL；
- job 惰性回收：完成 2 分钟后 / 创建 10 分钟后清理，上限 50 个；
- 单块失败不影响已缓冲的块，只把错误带给前端，前端提示后停止。

## 6. 前端渐进播放

`playChunks(jobId, chunks, total, token)`：

- 维护一个**缓冲队列**；播放第 n 块的同时，若"剩余缓冲 < 2 块"就向
  `/rvc-next` 拉下一块（**转换与播放重叠**）；
- 块与块之间 `onended` 无缝衔接，同一 `<audio>` 换 src；
- 停止/打断：`speakToken` 全局令牌，任何新朗读或停止都会使旧队列立即退出；
- **进度可见**：`shared.chunkProgress = { index, total }` 随每块开播更新——
  朗读按钮 tooltip 显示「第 x/y 段播放中」，试听面板显示
  「正在播放 第 x/y 段 · 后续段落边播边合成…」（"下一段合成中…"不再只是动画，
  有明确数字，绝不静默丢内容）；
- 失败：某块加载失败 → 跳过继续；后续块合成失败 → 红字提示并停止。

## 7. RVC 服务端配套

`rvc-server.py` 本次新增：

1. **`/health` 上报 `gpu_name` / `vram_gb`** —— 校准持久化的设备指纹来源；
2. **faiss 索引缓存**：RVC pipeline 每次转换都会 `faiss.read_index` 重新读一遍
   ~400MB 索引文件（每块一次，代价可观）。现在按路径缓存加载好的 Index 对象，
   `/load` 时清空 —— 分块模式下每块省掉一次 400MB 磁盘读。

## 8. 边界与回退

| 情况 | 行为 |
|---|---|
| 短文本（≤12 秒） | 不进队列，走原来的单 URL 链路（零额外开销） |
| 上传底噪模式 | 单段音频不可分块，走单 URL 链路 |
| 探测失败 | 保守档（10 秒 / 预热 3），会话内 2 分钟不重复探测 |
| 某块转换失败 | 已缓冲的继续播，后续报错并停止 |
| 停止 / 换消息 / 切会话 | 令牌失效，队列立即退出，无残留播放 |
| 刷新页面 | 队列随页面消失；Host job 按时回收 |

## 10. 实测（RTX 5070 + azusa-test）

| 场景 | 结果 |
|---|---|
| 短句链路 | ~4.6-5.4s（含 Edge 合成） |
| 长文本首响 | 探测 + 预热 2 块 ≈ 6-7s（**此后 7 天内从 calibration.json 直接复用，不再探测**） |
| 长文本全链 | 6/6 块取完，迟到块 RIFF 476KB；块间无感知停顿 |
| 索引缓存收益 | ratio 0.62 → 0.48（省掉每块 400MB 索引重读），档位 10s/3 → 15s/2 |

## 11. Phase 2 预留

- 紧凑索引生成工具（免 index / 紧凑 index 二选一已支持），减少首块延迟；
- 便携运行时打包（torch ≥ 2.7 cu128 适配 Blackwell），新用户开箱即用；
- 音色包注册表 + 下载 UI（版权干净音色）。

> 已完成：`calibration.json` 落盘（`~/.dsh/tts-rvc/`，7 天有效 + 设备指纹，跨会话复用探测结果）。

---

## English summary

RVC is voice **conversion** (input length == output length), not TTS, so a long
read must first synthesize the whole base audio with Edge TTS. Instead of
converting everything before playing (long silent wait), the plugin now:

1. **Probes** the local machine once (convert a ~3.6s clip, measure
   `ratio = convert_time / audio_seconds`); results persist to
   `~/.dsh/tts-rvc/calibration.json` (7-day validity, GPU-name fingerprint,
   re-probes on device change), so the probe is paid only once per config;
2. Picks **chunk size (6–20s) and prewarm count (2–4)** from a ratio tier table;
3. Splits the text into sentence-aligned chunks, converts the prewarm chunks,
   and returns a **job queue** immediately;
4. The client **plays while prefetching**: each next chunk is converted during
   the current chunk's playback (`GET /rvc-next`), so long reads stream
   seamlessly on GPU and degrade gracefully on CPU (smaller chunks, more
   prewarm);
5. The RVC server reports GPU name/VRAM in `/health` and **caches the faiss
   index** so each chunk no longer re-reads the ~400MB index file.
