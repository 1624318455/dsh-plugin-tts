# Windows GPU 回归实测 Prompt（粘贴给 Windows 上的 LLM）

> 用法：把本文全文（从「# 任务」到文末）粘贴给 Windows 上的 LLM（或放入其工作目录让它读取）。
> 它是自包含的：Windows 上的 LLM 看不到 Mac/其他端的对话，一切信息都在下面。
> 目标：给 `dsh-plugin-tts` 的 **Windows + NVIDIA GPU 路径**做一次完整回归，如实上报（含失败）。

---

# 任务

你是运行在一台 **Windows 电脑**（NVIDIA GPU，例如 RTX 5070）上的 AI 助手。你的任务是**在真实 Windows + CUDA 环境里对 `dsh-plugin-tts` 做一次完整回归**，确认它的 RVC 变声服务在 GPU 上仍能端到端正常使用，并如实报告（包括失败、装不上的包、跑不通的步骤——这些全是正当产出，不要为了好看而掩盖）。

背景：该插件已在 macOS（Apple Silicon）上完整验证过（含 CPU 转换、边界加固、中英文国际化），本次要补的是 **Windows GPU（CUDA）路径**——因为 GPU 才用到 `is_half=True`、`--device cuda`、`torch 2.7+cu128` 这些分支，Mac 上没有动过。

# 被测对象

`dsh-plugin-tts`：一个文本转语音插件，「自定义音色（RVC）」模式：
1. 本地 HTTP 服务 `rvc-server.py` 包装 RVC 推理核心（`infer/` 目录，通常来自一套 RVC WebUI 安装）；
2. 插件把文字用 Edge TTS 读成原声，再 POST 给该服务做音色转换，拿回转好的 wav。

HTTP 协议（JSON + base64，无额外依赖）：
- `GET  /health` — 状态、设备、已加载模型
- `GET  /files?kind=pth|index` — 扫描模型/索引
- `POST /load {"model":"<路径>","index":"<路径或空>"}` — 加载音色
- `POST /convert {"audio_base64":"<wav的base64>","params":{...}}` — 转换（`f0_method` 默认 `rmvpe`）
- `POST /compact-index {"index":"<.index路径>","target_vectors":2000}` — 压缩大索引

在 **Windows + CUDA** 上：`--device cuda`（或 `auto` → 有 CUDA 自动选）应得到 `device=cuda`、`cuda_available=true`、`is_half=true`，转换走 GPU、比 CPU 快得多（正常现象，记录耗时即可）。

# 前置条件（Windows 侧一般已具备）

1. Windows 10/11、NVIDIA GPU（RTX 50 系为佳）、已装 NVIDIA 驱动；
2. 一套 **RVC WebUI 安装**（目录里含 `runtime\python.exe` 与 `infer\`），例如 Windows 上已验证的 `E:\AI\RVC20240604Nvidia\RVC20240604Nvidia`（内含 `assets\weights`、`assets\indices`、`assets\hubert`、`assets\rmvpe`，以及一个音色 `.pth`+`.index`）；
3. `git`、`ffmpeg`（RVC runtime 自带或系统有）；
4. `node`（≥20）与 `npm`（跑插件自带测试用）。

# 步骤 1：获取被测代码

```powershell
git clone https://github.com/1624318455/dsh-plugin-tts.git C:\dsh-plugin-tts
cd C:\dsh-plugin-tts
$env:DSH_RVC = "E:\AI\RVC20240604Nvidia\RVC20240604Nvidia"   # 指向你的 RVC WebUI 根目录，下面都用这个变量
```

仓库内容（供参考）：`rvc-server.py`（被测服务）、`lib/`（插件 host/client，i18n 已zh/en）、`tools/mac-verify.sh`、`tools/package-runtime.py`、`tests/`（标准测试：smoke/live/patch/i18n/client）、`.github/workflows/test.yml`（CI，跑在 ubuntu，**不含 GPU**）。

> ⚠️ 重要说明：GitHub 的 CI（`.github/workflows/test.yml`）跑在 **ubuntu CPU** 上，**不是** Windows GPU 回归的载体；真正补 Windows GPU 的是你接下来手动执行的内容。

# 步骤 2：跑平台无关的自动测试（快速确认代码本身没坏）

```powershell
cd C:\dsh-plugin-tts
npm install --no-audit --no-fund
npm test              # smoke：43 项（真实 Edge TTS + mock RVC，不需要本地 GPU 服务）
npm run test:i18n     # i18n：6 项（zh/en 键集一致、无残留硬编码中文）
npm run test:client   # client-load：14 项（mock 浏览器渲染）
npm run test:patch    # patch：4 项（darwin-only 的 PyAV 补丁，Windows 不应受影响）
```

预期：这些全 PASS（它们平台无关）。若 smoke 因 Edge TTS 联网失败，记录报错即可（网络问题不算产品缺陷）。

# 步骤 3：启动 RVC 服务（GPU 路径，核心）

用你的 RVC runtime 的 python，**传 `--rvc-dir` 指到 RVC WebUI 根目录**，并显式用 cuda：

```powershell
cd C:\dsh-plugin-tts
$env:PY = "$env:DSH_RVC\runtime\python.exe"

& $env:PY rvc-server.py --rvc-dir $env:DSH_RVC --device cuda --port 4892 | Out-File server.log
```

> 若 `--device cuda` 报无 CUDA，先确认 torch 是 cu 版本（见「常见坑」）。`auto` 也会在有 CUDA 时自动选 cuda。

**成功的样子**：日志出现 `dsh-plugin-tts RVC server: http://127.0.0.1:4892  (device=cuda:0, half=True)`。
启动失败就贴完整报错，先排查再继续。

# 步骤 4：GPU 端到端回归（核心）

```powershell
# 任选一个你的真实音色模型/索引（换成实际存在的路径）
$MODEL = "$env:DSH_RVC\assets\weights\<你的模型>.pth"
$INDEX = "$env:DSH_RVC\assets\indices\<你的索引>.index"   # 可留空走免索引

$env:RVC_URL = "http://127.0.0.1:4892"
npm run test:live   # 场景(health/files/load/convert/compact-index) + 边界(坏base64/空音频/未知f0_method/并发)
```

`tests/rvc-server-live.mjs` 会自动连 `RVC_URL`，并从 `$RVC_WORK\assets\weights\model.pth`（默认 `~/rvc-work`，Windows 上可设 `RVC_WORK`）找模型/索引做场景测试。想让 **live 场景自动全跑**（别跳过），最省事是把它要的布局准备出来：

```powershell
$env:RVC_WORK = "C:\rvc-live-work"
New-Item -ItemType Directory -Force -Path "$env:RVC_WORK\assets\weights" | Out-Null
Copy-Item "$MODEL" "$env:RVC_WORK\assets\weights\model.pth"
# index 有就拷成 guanguanV1.index，没有就免（场景里 index 可选）
if (Test-Path $INDEX) { Copy-Item "$INDEX" "$env:RVC_WORK\assets\weights\guanguanV1.index" }
$env:RVC_URL = "http://127.0.0.1:4892"
npm run test:live
```
即使这样，也**务必**再按下面「手工核对」过一遍 GPU 专属点（健康响应/转换耗时/边界 400），不要只依赖自动化。

**务必手工核对以下 GPU 专属点**（这是 MAC 没测过的，最重要）：

1. `/health` 必须返回：
   ```json
   { "ok": true, "device": "cuda:0", "cuda_available": true, "is_half": true, "index_cache": true }
   ```
2. `/convert` 成功：返回 `sample_rate` 与 `audio_base64`，输出是合法 RIFF wav（下载出来 `ffprobe`/听一下/看时长≈输入），**记录 wall 秒数与「几倍实时」**（GPU 应远快于实时，如 0.05–0.2×）。
3. 边界：`/convert` 传坏 `audio_base64`、空音频、未知 `f0_method`，应分别返回 **400**（不是 500 崩溃）——这是本轮 macOS 上补的加固，Windows GPU 上必须同样生效。
4. `/compact-index` 成功：返回 `reduction_pct`（几十 %）。

可用一段 PowerShell/Node 快速 curl（等效 `tests/rvc-server-live.mjs` 的场景）：
```powershell
# health
curl.exe -s http://127.0.0.1:4892/health
# load
curl.exe -s -X POST http://127.0.0.1:4892/load -H "Content-Type: application/json" -d "{\"model\":\"$MODEL\",\"index\":\"$INDEX\"}"
# convert：把任意 ~2-3s 的 wav 转 base64 发过去（可用 ffmpeg 生成测试音，或录一段话）
```

# 步骤 5（可选但推荐）：打包脚本的 Windows 分支

```powershell
python C:\dsh-plugin-tts\tools\package-runtime.py --rvc-dir $env:DSH_RVC --out C:\rvc-portable --skip-torch
```
- 产物应含 `runtime\python.exe`、`infer\`、`rvc-server.py`、`启动服务.bat`；
- **重点核对**：`C:\rvc-portable\infer\lib\audio.py` 里 `av.open(...)` 应**保持原样 `"rb"/"wb"`**（darwin-only 的 PyAV 补丁不能误伤 Windows——若被改成 `"r"/"w"` 说明打包逻辑有 bug，请报）。
- 用产物启动并重测一遍 `/health` + `/convert`。

# 必须汇报的内容（最终报告格式）

1. **环境**：Windows 版本、GPU 型号/驱动版本、显存、Python 版本、torch 版本（确认是 cu 版）、numpy 版本、Node/npm 版本；
2. **步骤 2**：smoke/i18n/client/patch 各自的 PASS/FAIL + 项数；
3. **步骤 3**：rvc-server 是否 GPU 启动成功，日志里 `device=`/`half=` 那行；
4. **步骤 4**：`/health` JSON、`/convert` 的 **wall 秒数与几倍实时**、输出 wav 是否合法、边界三步是否 400、`/compact-index` 结果；
5. **任何报错**：完整堆栈/响应体/服务端日志，不要截断；
6. **步骤 5**：执行/跳过；执行了就报产物结构 + 重测结果 + `audio.py` 是否被误改；
7. **结论**：Windows GPU 上能否端到端使用；哪里需要作者修复或改文档。

**重要**：如实汇报。失败、异常都是正当产出。

# 常见坑速查

- **torch 无 CUDA**（`/health` 显示 `cuda_available:false` 或 `--device cuda` 报错）→ 说明 torch 是 CPU 版。用官方 pytorch 索引装 cu 版（RTX 50 系用 cu128）：
  `runtime\python.exe -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128`
  国内慢可换 `https://mirrors.aliyun.com/pytorch-wheels/cu128`。
- **`av` 报 `mode must be 'r','w', or None, got: rb`**（Windows 上若用现代 PyAV 会遇到）→ 这是老 infer 与新 PyAV 的兼容问题；Windows RVC WebUI 自带的旧 PyAV 一般没这问题。若遇到，记录并在报告里标注「发生在 Windows 的 PyAV 版本是 X」。
- **fairseq 装不上** → 用 RVC runtime 自带环境即可；若自装，`pip<24.1` 再 `pip install fairseq==0.12.2`。
- **端口占用** → `--port 4893`，并让 `RVC_URL` 跟着改。
- **/convert 报 `no model loaded`** → 先 `/load` 再 `/convert`。
- **/convert 极慢或无响应** → 看 server.log；GPU 首次加载 hubert/rmvpe 要少许时间。
