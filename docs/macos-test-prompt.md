# macOS 跨平台实测 Prompt（粘贴给 Mac 上的 LLM）

> 用法：把本文全文（从「# 任务」到文末）粘贴给 Mac 上的 LLM（或放入其工作目录让它读取）。
> 它是自包含的：Mac 上的 LLM 看不到 Windows 这边的对话，一切信息都在下面。

---

# 任务

你是运行在一台 **macOS 电脑** 上的 AI 助手。你的任务是**在真实 macOS 环境里验证一个开源语音插件的 RVC 变声服务能否跨平台运行**，并如实报告结果（包括失败）。这个插件叫 `dsh-plugin-tts`，Windows 上已完整验证通过（RTX 5070 GPU），但 **macOS 从未实测**——本次就是要补上这个测试，发现任何问题都算有价值的产出。

# 背景：被测对象是什么

`dsh-plugin-tts` 是一个文本转语音插件，其中「自定义音色（RVC）」模式的工作方式是：

1. 一个本地 HTTP 服务 `rvc-server.py` 包装 RVC 的推理核心（一个叫 `infer/` 的代码目录）；
2. 插件把文字先用微软 Edge TTS 读成原声，再把原声音频 POST 给这个服务做音色转换；
3. 服务把转换后的音频返回给插件播放。

`rvc-server.py` 的 HTTP 协议（JSON + base64，无其他依赖）：

- `GET  /health` — 服务状态、设备、已加载模型
- `GET  /files?kind=pth|index` — 扫描本机模型/索引文件
- `POST /load {"model": "<绝对路径>", "index": "<绝对路径或空>"}` — 加载音色模型
- `POST /convert {"audio_base64": "<wav 的 base64>", "params": {...}}` — 转换（`f0_method` 默认 `rmvpe`）
- `POST /compact-index {"index": "<.index 路径>", "target_vectors": 2000}` — 把大索引压缩成小索引

macOS 上设备会自动选 **CPU**（`device=cpu, is_half=false`），转换比 Windows GPU 慢是**正常现象**，不算失败。

# 本机已验证的环境组合（Windows，务必尽量复刻）

| 组件 | 版本 |
|---|---|
| Python | 3.9.13 |
| torch / torchaudio | 2.0.0 / 2.0.1 |
| fairseq | 0.12.2（PyPI 官方版） |
| numpy / numba / llvmlite | 1.23.5 / 0.56.4 / 0.39.1 |
| librosa / scipy | 0.9.1 / 1.9.3 |
| soundfile / pyworld / resampy | 0.11.0+ / 0.3.2 / 0.4.2 |
| fastapi / uvicorn | 0.88.0 / 0.20.0 |
| faiss | faiss-cpu |

> 这组版本已被证实与 `rvc-server.py` + 这套 `infer/` 代码兼容。macOS 上**优先按这个表装**；个别包在 macOS 装不上时，见「常见坑」。

# 前置条件检查

1. macOS 12 或更新（Apple Silicon 或 Intel 均可，推荐 ≥16GB 内存、≥10GB 空闲磁盘）；
2. 已安装：`git`、`ffmpeg`（`brew install ffmpeg`）、Xcode Command Line Tools（`xcode-select --install`）；
3. Python 3.9：推荐用 pyenv（`brew install pyenv && pyenv install 3.9.18 && pyenv local 3.9.18`）。系统自带的 python3 版本若 ≥3.10 也可以先试，但依赖装不上时必须回到 3.9。

# 步骤 1：准备 RVC 推理核心 `infer/`

`rvc-server.py` 要求旁边有一个 `infer/` 目录（RVC 的推理核心，纯 Python 代码，约 0.7MB）。二选一：

- **方案 A（推荐，与已验证代码完全一致）**：用户会从 Windows 机器把 `infer/` 目录和 `requirements.txt` 拷给你（会放在某个约定路径，比如 `~/rvc-transfer/infer/`）。如果没找到，先问用户。
- **方案 B（拿不到 Windows 文件时）**：
  ```bash
  git clone --depth 1 https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI.git rvc-src
  cp -r rvc-src/infer ~/rvc-work/infer
  cp rvc-src/requirements.txt ~/rvc-work/requirements.txt
  ```
  注意：新版 RVC 仓库的 `infer/` 可能改了 hubert 资产的路径。**用 `grep -rn "hubert" ~/rvc-work/infer/ | grep -i "assets\|\.pt"` 检查代码实际引用的路径**，按它建目录（老版是 `assets/hubert/hubert_base.pt`，新版可能是 `assets/hubert_base/pytorch_model.bin` + config.json + preprocessor_config.json）。

# 步骤 2：搭工作目录和模型资产

```bash
mkdir -p ~/rvc-work/assets/hubert ~/rvc-work/assets/rmvpe ~/rvc-work/assets/weights
cd ~/rvc-work
```

下载 RVC 必需的两个推理模型（共约 360MB；HuggingFace 在国内可能慢，用 `hf-mirror.com` 镜像）：

```bash
# hubert 特征提取模型（约 181MB）——路径必须与 infer/ 代码引用一致（本套代码是 assets/hubert/hubert_base.pt）
curl -L -o assets/hubert/hubert_base.pt \
  https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/hubert_base.pt
# 若上面失败/太慢：
#   https://hf-mirror.com/lj1995/VoiceConversionWebUI/resolve/main/hubert_base.pt

# rmvpe 音高提取模型（约 173MB）
curl -L -o assets/rmvpe/rmvpe.pt \
  https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt
# 镜像：https://hf-mirror.com/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt
```

下载测试音色包（公开仓库 `1624318455/rvc-for-tts`，作者自己训练的音色，许可见仓库 manifest）：

```bash
curl -L -o assets/weights/model.pth \
  https://raw.githubusercontent.com/1624318455/rvc-for-tts/main/packs/guanguanV1/model.pth        # 52.5MB
curl -L -o assets/weights/guanguanV1.index \
  https://raw.githubusercontent.com/1624318455/rvc-for-tts/main/packs/guanguanV1/guanguanV1.index   # 32MB（可选）
# raw.githubusercontent 慢/失败时可用 ghproxy 类镜像，或请用户从 Windows 机器拷
```

# 步骤 3：建 Python 环境（锁定已验证版本）

```bash
cd ~/rvc-work
python3.9 -m venv venv          # 或 pyenv 的 3.9
source venv/bin/activate
pip install -U pip setuptools wheel Cython

pip install \
  torch==2.0.0 torchaudio==2.0.1 \
  numpy==1.23.5 numba==0.56.4 llvmlite==0.39.1 \
  librosa==0.9.1 scipy==1.9.3 \
  soundfile>=0.12.1 pyworld==0.3.2 resampy==0.4.2 \
  fastapi==0.88.0 uvicorn==0.20.0 \
  fairseq==0.12.2 faiss-cpu
```

装完立即验证关键依赖能 import（fairseq 是 hubert 加载的依赖，最容易出问题）：

```bash
python -c "import torch, fairseq, faiss, numpy, librosa; from fairseq import checkpoint_utils; print('deps ok', torch.__version__, numpy.__version__)"
```

- 若 `fairseq` 装不上（源码编译失败）：先 `pip install --no-build-isolation fairseq==0.12.2`；还不行就试 RVC 官方用的 fork：`pip install "fairseq @ git+https://github.com/One-sixth/fairseq.git"`；都失败就**记录完整报错并继续**（这本身就是测试要收集的信息）。
- 若报 `np.float` / `np.int` 之类 numpy 兼容错误：`pip install "numpy<1.24"` 强制降回。
- 若新版 macOS 上 torch 2.0.0 装不上：改 `torch==2.6.0 torchaudio==2.6.0`（`rvc-server.py` 已内置 torch≥2.6 的 `weights_only=False` 补丁，Windows 侧 torch 2.7 验证过）。

# 步骤 4：获取被测代码并启动服务

```bash
git clone https://github.com/1624318455/dsh-plugin-tts.git ~/dsh-plugin-tts
cp ~/dsh-plugin-tts/rvc-server.py ~/rvc-work/
cp ~/dsh-plugin-tts/tools/mac-verify.sh ~/rvc-work/

cd ~/rvc-work
nohup venv/bin/python rvc-server.py --port 4892 > server.log 2>&1 &
sleep 8
tail -20 server.log
```

**成功的样子**：日志出现 `dsh-plugin-tts RVC server: http://127.0.0.1:4892 (device=cpu, half=False)`。
（不要传 `--device cuda`——macOS 没有 CUDA，`--device auto` 默认就是 cpu。）
启动失败就贴完整报错，先排查再继续。

# 步骤 5：端到端验证（核心）

跑验证脚本（它会依次测 `/health` → `/files` → `/load` → `/convert` → 输出文件 → `/compact-index`）：

```bash
cd ~/rvc-work
PY=~/rvc-work/venv/bin/python bash mac-verify.sh \
  ~/rvc-work/assets/weights/model.pth \
  ~/rvc-work/assets/weights/guanguanV1.index
```

预期：

- `/health`：`ok:true`、`device:"cpu"`、`cuda_available:false`、`index_cache:true`；
- `/files`：列出下载的 model.pth；
- `/load`：`ok:true`，返回模型绝对路径（首次会打印 `Loaded model ... (v2, f0=1, ...)`）；
- `/convert`：首次要加载 hubert+rmvpe（约 30~90 秒，之后快），返回 `sample_rate` 与转换后 wav；输出文件是 RIFF，时长≈输入（约 3 秒）；
- `/compact-index`：返回 `reduction_pct`（几十 %，因为源索引本身不大）。

脚本会自己判断 PASS/FAIL。**如果脚本某步失败，不要只报"失败"**——手工复现那一步（curl / python），把 HTTP 状态码、响应体、服务端日志（server.log 尾部）都收集进报告。

# 步骤 6（可选）：打包脚本 `package-runtime.py` 的 darwin 分支

**仅当这台 Mac 上已有一个 RVC WebUI 安装（目录里含 `runtime/` 和 `infer/`）时执行**；没有就跳过并在报告里注明「无 RVC 安装，跳过」。

```bash
python3 ~/dsh-plugin-tts/tools/package-runtime.py \
  --rvc-dir <RVC安装目录> --out ~/rvc-portable-mac --platform darwin
```

验证产物：

1. 结构正确：`~/rvc-portable-mac/runtime/bin/python` 存在、`infer/`、`assets/hubert/`、`assets/rmvpe/`、`rvc-server.py`、`start-rvc-server.sh`（且 `ls -l` 有 x 权限）；
2. 用产物启动并重测一遍核心链路：
   ```bash
   ~/rvc-portable-mac/start-rvc-server.sh &   # 或 ~/rvc-portable-mac/runtime/bin/python ~/rvc-portable-mac/rvc-server.py --port 4893
   PY=~/rvc-portable-mac/runtime/bin/python bash mac-verify.sh \
     ~/rvc-portable-mac/assets/weights/model.pth "" 127.0.0.1:4893
   ```

# 必须汇报的内容（最终报告格式）

1. **环境**：macOS 版本、芯片（`uname -m`）、Python 版本、torch 版本、numpy 版本；
2. **步骤 1-4 的产物**：用了方案 A 还是 B、各文件是否就位（ls 大小）；
3. **步骤 5 结果**：mac-verify.sh 每步 PASS/FAIL + 关键输出（/health 的 JSON、/convert 的耗时与 sample_rate、out.wav 时长）；
4. **耗时数据**：`/convert` 的 wall 耗时与「几倍实时」（CPU 慢正常，记录下来即可）；
5. **任何报错**：完整堆栈/响应体/服务端日志，不要截断；
6. **步骤 6**：执行了/跳过了；执行了就给产物结构 + 重测结果；
7. **结论**：macOS 上能否端到端使用；哪些地方需要作者修复或改文档。

**重要**：如实汇报。失败、装不上的包、跑不通的步骤都是本次测试的正当产出——宁可报失败，也不要为了让报告好看而省略或掩盖。

# 常见坑速查

- **HuggingFace 下载慢/超时** → 换 `https://hf-mirror.com/...` 前缀；
- **GitHub raw 下载慢** → ghproxy 类镜像或让用户拷文件；
- **fairseq 装不上** → `--no-build-isolation` → One-sixth fork（见步骤 3）；
- **numpy 2.x 报错** → `pip install "numpy<1.24"`；
- **端口被占用** → 换 `--port 4893`，verify 脚本第三个参数跟着改；
- **/convert 报 `no model loaded`** → 先 /load 成功再 /convert；
- **/convert 报 `audio decode failed`** → 确认系统 ffmpeg 可用（`ffmpeg -version`）；
- **/convert 超时/极慢** → CPU 推理正常慢，等；若 15 分钟无响应再查 server.log。
