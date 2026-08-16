# 测试标准（dsh-plugin-tts）

统一测试入口，分三层：**烟测（smoke）→ 场景+边界（live）→（可选）真实链路**。
所有测试用 `node` 跑，`PASS/FAIL` 逐行输出 + 末尾汇总 + 退出码（0=全过，1=有失败）。

## 快速开始

```bash
npm test            # 烟测：43 项，纯 mock + 真实 Edge TTS，无需本地 RVC 服务
npm run test:live   # 场景 + 边界：需要本地 rvc-server.py（可自启），见下
npm run test:patch  # 边界：package-runtime.py 的 darwin PyAV 补丁逻辑（纯临时目录，无需 RVC）
npm run test:all    # 三者都跑
```

## 各层说明

| 层 | 文件 | 依赖 | 覆盖 |
|---|---|---|---|
| 烟测 | `tests/smoke.mjs` (`npm test`) | 无需本地 RVC；会用真实 Edge TTS 联网合成 | 路由注册、Edge 合成、mock RVC 链路、上传底噪、分块渐进播放、文件代理、compact-index 代理、诊断、音色包注册表（sha256/代理/进度/多索引/卸载）、make-pack 工具 |
| 场景+边界 | `tests/rvc-server-live.mjs` (`npm run test:live`) | 本地 RVC 服务（见下） | 真实 `health/files/load/convert/compact-index` 场景 + 协议边界（坏 base64、空音频、未知 f0_method、缺失模型/索引、并发转换、未知路由） |
| 打包边界 | `tests/package-runtime-patch.mjs` (`npm run test:patch`) | 仅 python3（临时目录） | `package-runtime.py` 的 darwin PyAV 补丁：`av.open` `rb/wb→r/w`、不动 Python `open(file,"rb")`、幂等 |

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

## 历史遗留

`tests/e2e-*.mjs`（`e2e-real-rvc` / `e2e-index-ab` / `e2e-compact-index`）是
**为 Windows 一次性写的真实链路脚本**（硬编码 `E:/AI/.../azusa-test.pth`），不可移植，
已被 `tests/rvc-server-live.mjs` 取代并标记 deprecated，仅作 Windows 参考保留。
