# PR #2 审查记录 — dsh-plugin-tts

> ✅ **已完成合入**（2026-08-25）：CI 批准后 Node 22/24 双 job success → squash 合入 main
> （merge commit `9dcd7c7`，PR 状态 closed/merged）。本地已验证测试全绿。
>
> 目标：https://github.com/1624318455/dsh-plugin-tts/pull/2
> 交付：这个 PR 是做什么的 · 是否需要合入 · 是否可以合入
> 证据状态：GitHub 公开 API（pulls/2、commits、diff、actions/runs、check-runs、status）已全部直取核实 ✅
> （本文档取代 2026-08-25 旧版，旧版在 API 不可达时误判 PR #2 = Phase 1-3 批次，已被 API 事实推翻。）

## 0. 事实速览（API 核实，2026-08-24 创建）

| 项 | 值 |
|---|---|
| 标题 | `feat(tts): add Russian voices (ru-RU-Svetlana/Dmitry) to voice picker` |
| 作者 | drfenixion（外部贡献者，fork：drfenixion/dsh-plugin-tts，author_association=NONE） |
| 状态 | open，未合入，无评论 / 无 review |
| 规模 | 1 commit · +6 / -0 · 1 文件（`lib/client.js`） |
| 基础 | base `1624318455:main` @ `136ed935`（= 本地 HEAD，无冲突：`mergeable: true`、`rebaseable: true`） |
| CI | head sha 有 1 条 workflow run（test），结论 **action_required**（首次贡献者需管理员批准才执行）；base 分支自身最近一次 run 为 success |
| 合并状态 | `mergeable_state: unstable`（= 无冲突但存在"未通过/待定"的 check 状态；个人仓库无强制保护，不影响点 Merge） |

## 1. 这个 PR 是做什么的

给设置面板的 **Edge TTS 音色选择列表**（`lib/client.js` 的 `VOICES` 数组）新增两个俄语音色：

- `ru-RU-SvetlanaNeural`（斯维特拉娜，女声）
- `ru-RU-DmitryNeural`（德米特里，男声）

并同步补充 i18n 标签：zh 字典（简体音译「斯韦特兰娜 / 德米特里」）与 en 字典（`Svetlana / Dmitry`）。
纯增量：+6 行、零删除、零新增依赖、不改任何现有行为。两个音色名均为微软 Edge TTS 长期在线的合法俄语 neural 音色。

> ⚠️ 与旧版 PR-REVIEW.md 的结论完全不同：PR #2 **不是** Phase 1-3 批次（那是直接 push 上 main 的），
> 而是一个小功能增强 PR。

## 2. 是否需要合入 —— 建议：合入 ✅

- **有真实功能价值**：Edge 语音列表是唯一的 Edge 音色选择入口（"自定义"仅指 RVC provider，与 Edge 列表无关），
  新增俄语音色填补了列表里 zh / en / ja / ko / fr 之外的空白，让俄语用户开箱即用。
- **改动极小且风格一致**：音色条目格式（`[voiceId, t(key)]`）、i18n 键命名（`voice.svetlana`）、
  字典摆放位置都与现有条目完全一致；俄语名音译正确。
- **零风险**：无运行时逻辑变化、无依赖、无公共接口变更，现有用户零影响。
- 小瑕疵（非阻塞，可合入后顺手处理）：
  - zh 字典中存在 Phase 1-3 遗留的 `voice.*` 键**重复定义**（L63-78 与 L277-285 两处，值相同、后者覆盖前者），
    与本次 PR 无关，但建议单独清理；
  - 中文标签用简体音译，与 zh-TW/HK 条目用繁体不冲突（zh-CN 条目本就简体），风格上没问题。

## 3. 是否可以合入 —— 可以 ✅（已验证）

- **无冲突**：`mergeable: true`，base = 本地 HEAD `136ed935`，patch 可干净应用（`git apply --check` OK）。
- **本地实测全绿**（将 PR diff 应用后运行，跑完已回退，工作区恢复原状）：
  - `test:i18n`：6/6（zh=en 各 233 键、键集一致、无死键、无 CJK 直出）
  - `test:client`：29/29（含设置面板渲染）
  - `test`（smoke）：50/50；`test:patch`：4/4
- **CI 侧面**：head 的 workflow run 处于 `action_required`——GitHub 对外部首次贡献者的 Actions 默认需维护者批准。
  合入前建议在 PR 页点 "Approve and run"，等 Node 22/24 矩阵绿了再合；若不想等，个人仓库无强制 check 保护，技术上不阻塞。

**合入动作建议**：approve CI → 等 test 跑绿 → Merge（squash）→ 顺手清理 zh 字典重复 voice.* 键（可选）。

## 4. 结论

1. **做什么**：给 Edge TTS 音色列表新增 2 个俄语音色（Svetlana / Dmitry）+ zh/en 标签，+6/-0 的纯增量小功能。
2. **是否需要合入**：需要，小而有价值、零风险、风格一致。
3. **是否可以合入**：可以——无冲突、本地 4 套测试全绿（i18n 6/6 · client 29/29 · smoke 50/50 · patch 4/4）；
   注意首次贡献者的 CI 需管理员先批准才会跑。

## 5. 证据命令（可复现）

```bash
curl -s https://api.github.com/repos/1624318455/dsh-plugin-tts/pulls/2
curl -s https://github.com/1624318455/dsh-plugin-tts/pull/2.diff
curl -s "https://api.github.com/repos/1624318455/dsh-plugin-tts/actions/runs?head_sha=62bae53bf6685d29a70fd13e030655b80f66f1cc"
curl -sL https://github.com/1624318455/dsh-plugin-tts/pull/2.diff -o /tmp/pr2.diff && git apply --check /tmp/pr2.diff
npm run test:i18n && npm run test:client && npm run test && npm run test:patch
```