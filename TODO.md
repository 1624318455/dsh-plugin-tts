# TODO（待办）

## 发布与引流

- [x] **B站介绍视频已发布**，简介已放便携运行时网盘链接（`E:\rvc-portable-torch2.7-cu128.zip`，4.35GB）。
- [x] 便携运行时 zip 已上传个人网盘。
- [x] B站视频链接已填入 `docs/USER-GUIDE.md` §10（https://www.bilibili.com/video/BV1ukbQ6qECo/）。
- [x] macOS 实测：已在 Apple Silicon macOS 26 上完整跑通（`npm run test:all` 全绿），
      修复了 mac-verify.sh 的 od 空格 bug、darwin PyAV 补丁、rvc-server 边界 500→400，
      并新增 live/边界 标准测试（见 `tests/` 与 `tests/README.md`）。
- [x] 中英文国际化：设置面板/气泡/诊断/音色包/RVC 报错全部 zh/en，含语言切换与持久化
      （见 `lib/client.js` 的 i18n 层 + `tests/i18n-keys.mjs`、`tests/client-load.mjs`）。
- [x] CI：`.github/workflows/test.yml` 已加（Node 20/22/24，跑 smoke/i18n/client-load/patch）。

## 后续功能（按需启动）

- [ ] 校准文件（calibration.json）多机同步/备份。
- [ ] 多个音色包仓库并存（设置里保存多个仓库地址）。
- [ ] 试听 A/B（UI 内对比两个音色包输出）。
- [ ] 便携运行时 Linux 实测（macOS 用 `docs/macos-test-prompt.md` 同款流程）。
- [x] ~~Edge TTS 一键诊断~~（设置面板「诊断」，已上线）。
- [x] ~~便携运行时跨平台脚本泛化~~（`tools/package-runtime.py --platform`，代码已交付，待实测）。
