# 测试标准（dsh-plugin-tts）

统一测试入口，分三层：**烟测（smoke）→ 场景+边界（live）→（可选）真实链路**。
所有测试用 `node` 跑，`PASS/FAIL` 逐行输出 + 末尾汇总 + 退出码（0=全过，1=有失败）。

## 快速开始

```bash
npm test            # 烟测：43 项，纯 mock + 真实 Edge TTS，无需本地 RVC 服务
npm run test:live   # 场景 + 边界：需要本地 rvc-server.py（可自启），见下
npm run test:patch  # 边界：package-runtime.py 的 darwin PyAV 补丁逻辑（纯临时目录，无需 RVC）
npm run test:i18n   # i18n 回归：所有 t(key) 都有中英文、无缺失/多余、UI 无残留硬编码中文
npm run test:client # 客户端加载+渲染：mock 浏览器环境跑 lib/client.js，验证国际化后 UI 不崩
npm run test:all    # 以上全部
```

## 各层说明

| 层 | 文件 | 依赖 | 覆盖 |
|---|---|---|---|
| 烟测 | `tests/smoke.mjs` (`npm test`) | 无需本地 RVC；会用真实 Edge TTS 联网合成 | 路由注册、Edge 合成、mock RVC 链路、分块渐进播放、文件代理、compact-index 代理、诊断、音色包注册表（sha256/代理/进度/多索引/卸载）、make-pack 工具 |
| 场景+边界 | `tests/rvc-server-live.mjs` (`npm run test:live`) | 本地 RVC 服务（见下） | 真实 `health/files/load/convert/compact-index` 场景 + 协议边界（坏 base64、空音频、未知 f0_method、缺失模型/索引、并发转换、未知路由） |
| 打包边界 | `tests/package-runtime-patch.mjs` (`npm run test:patch`) | 仅 python3（临时目录） | `package-runtime.py` 的 darwin PyAV 补丁：`av.open` `rb/wb→r/w`、不动 Python `open(file,"rb")`、幂等 |
| i18n 回归 | `tests/i18n-keys.mjs` (`npm run test:i18n`) | 无 | 中英文词典键集一致、所有 `t(key)` 有双语定义、UI 区无残留硬编码中文、无死键 |
| 客户端加载/渲染 | `tests/client-load.mjs` (`npm run test:client`) | 无（mock 浏览器） | `lib/client.js` 在 mock 环境加载、`apply()` 运行、4 个组件（auto-read/read/xml/设置面板）渲染不抛错 |
| 设置入口兼容 | `tests/bundle-slot.mjs` | 无（mock slots 服务） | 标准壳（有插件标签页）/ 新版壳（无标签页）/ 两者兼具 / 恶意壳：面板只出现一次；无标签页时注册为设置一级「语音」（order 25，Agent 预设之后、插件市场之前） |
| 模型扫描 / 候选库 | `tests/discovery.mjs` | 无（临时目录 + 自建 zip） | RVC 内容指纹（zip+pickle 键）、`D_` 判别器降级、外来 `.pth` 不误判、GSV/Index/Cosy 安装识别、Cloud 凭据、内容 id 跨改名/搬家稳定、目录扫描、候选持久化、精确校验 |

## test:live 的环境约定（跨平台友好）

`tests/rvc-server-live.mjs` 是**环境感知**的：

- 优先连已运行的服务：`RVC_URL`（默认 `http://127.0.0.1:4892`）；
- 没有服务时，尝试从 `RVC_WORK`（默认 `~/rvc-work`，macOS 实测目录）用
  `venv/bin/python rvc-server.py` 自启；
- 两者都不可用时打印 `SKIP` 并以 0 退出（CI 安全，不会误报失败）。

```bash
RVC_URL=http://127.0.0.1:4892 npm run test:live   # 连已启动的服务
RVC_WORK=/path/to/rvc-work npm run test:live      # 指定工作目录
```

## 可移植性约定

这是开源项目：**源码与测试里不能出现本机绝对路径或具体模型/说话人文件名**（如 `D:\...`、`E:/AI/...`、某个真实角色名）。

- 需要真实服务时用环境变量（`RVC_URL` / `RVC_WORK`）或打印 `SKIP` 后 0 退出；
- 目录/文件类测试一律用 `mkdtempSync(os.tmpdir())` 里的临时 fixture；
- 引擎权重、音色目录等运行时数据只存 Host 配置，不写进代码或测试夹具。
