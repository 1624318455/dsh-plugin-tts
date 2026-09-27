# TODO（待办）

## 2026-09-27 Mac 交接前进度（已 push，工作区干净）

- [x] 五提供者指南：Edge / Index-TTS2 / CosyVoice / Cloud TTS / RVC per-provider guides + agent handoff header（`docs/`，2026-09-22）。
- [x] 分块播放：indexed chunk serve order、prewarm skip、starved chunk clamp、orphan sweep + overlap detector、fluency trio（cosy trim / chunk retry-skip / stall watchdog，2026-09-22）。
- [x] 诊断：diag log JSON 导出 + triage（calibration / cache / model / jobs）+ per-provider triage + chunk forensics（host build tag / job summaries / early-done，2026-09-25）。
- [x] 发布：npm `@memef1f1y/dsh-plugin-tts`，v0.6.1 chunk-order、v0.6.2 loader-name、v0.6.3 scroll-follow v2（2026-09-25~26）。
- [x] scroll-follow v2：stepwise signal + latch-off + highlight + spans；`ttsFollow` 提至 apply scope + ratio fallback 修复（HEAD `149fb9d`，v0.6.4，2026-09-26，已 push，`origin/main` 同步，工作区干净）。
- [ ] 待 Mac 端：`docs/scroll-follow-v2.md` 在 UTF-8 下读出乱码（疑似 GBK 存档），需确认源编码并转 UTF-8；`TODO.md` 此前停留在 08-17，本次已补齐。

> 交接注意：`dsh-plugin-TTS/` 外层（`edge-tts-worker.cjs` 旧独立 worker、`README.md` 旧版、6 个 `rvc-*.log`、`.npm-cache/`）不在 git 内，Mac 端只需 clone `plugin/` 本体（`https://github.com/1624318455/dsh-plugin-tts.git`，`main@149fb9d`）；外层文件无需带走，log 已被 `plugin/.gitignore` 的 `*.log` 排除。

## 发布与引流

- [x] **B站介绍视频已发布**，简介已放便携运行时网盘链接（`E:\rvc-portable-torch2.7-cu128.zip`，4.35GB）。
- [x] 便携运行时 zip 已上传个人网盘。
- [x] B站视频链接已填入 `docs/USER-GUIDE.md` §10（https://www.bilibili.com/video/BV1ukbQ6qECo/）。
- [x] macOS 实测：已在 Apple Silicon macOS 26 上完整跑通（`npm run test:all` 全绿），
      修复了 mac-verify.sh 的 od 空格 bug、darwin PyAV 补丁、rvc-server 边界 500→400，
      并新增 live/边界 标准测试（见 `tests/` 与 `tests/README.md`）。
- [x] 中英文国际化：设置面板/气泡/诊断/音色包/RVC 报错全部 zh/en，含语言切换与持久化
      （见 `lib/client.js` 的 i18n 层 + `tests/i18n-keys.mjs`、`tests/client-load.mjs`）。
- [x] CI：`.github/workflows/test.yml` 已加（Node 22/24，跑 smoke/i18n/client-load/patch；
      注：Edge TTS worker 依赖原生 `WebSocket`，需 Node ≥ 22，故矩阵不含 20）。

## 后续功能（按需启动）

- [ ] 校准文件（calibration.json）多机同步/备份。
- [ ] 多个音色包仓库并存（设置里保存多个仓库地址）。
- [ ] 试听 A/B（UI 内对比两个音色包输出）。
- [ ] 便携运行时 Linux 实测（macOS 用 `docs/macos-test-prompt.md` 同款流程）。
- [x] ~~Edge TTS 一键诊断~~（设置面板「诊断」，已上线）。
- [x] ~~便携运行时跨平台脚本泛化~~（`tools/package-runtime.py --platform`，代码已交付，待实测）。
