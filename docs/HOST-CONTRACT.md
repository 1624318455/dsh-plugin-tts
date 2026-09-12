# DSH 宿主插槽契约（实测记录）

> 本文件是 2026-09 用控制台日志反推出的真实契约，不是官方文档。
> 宿主升级后可能漂移——插件代码已按“多形态兼容 + DOM 兜底”来写，
> 漂移时看控制台 `[tts]` 日志即可重新定位（方法见末尾）。

## 1. 涉及的插槽与 props

| 插槽 | props（含标准钩子） |
|---|---|
| `conversation.chat.assistant-actions`（单条朗读按钮） | `inputActions, messageId, sessionId, useChat, useConversation, useInput, usePanelInfo, useProjection, useResource, useSession, useSessionPendingInteraction, useSessions, useTrajectory, useWorkspaces` |
| `conversation.input.left`（自动朗读开关） | 同上（无 `messageId`） |

`messageId` 与下述 `eventNodes[].messageId` 精确对应，是按钮定位正文的主键。

## 2. 快照形状（`hook(s => s)` 所见）

- **`useSession`**：`{sessionId, queue, pendingSubmissions, running, subagent, removed, openState, openError, hasMore, loadingOlder, promptError, blank}`——**只有队列/运行状态，没有消息**。切勿用它找正文。
- **`useTrajectory`**：`{eventNodes, eventLocations, requests, callSchemas, partial, runningCalls}`——**正文主数据源**。`eventNodes[]` 形如 `{kind, seq, messageId, time, turn, step, blocks, usage, …}`，`kind` 区分 `assistant/user`，AI 正文在 `blocks: [{kind: "text", text}]`，`seq` 单调递增。`partial` 非空表示正在流式。
- **`useChat`**：`{order: string[]（id 顺序）, nodes: 内部 store（`byKey` 实测为空）, locations, navigation, timeline{turnOrder, turns}, legacy{nodes（与 eventNodes 同源的数组镜像）}}`——备用链路。
- **`useConversation`**：`{views: {eventDefinitions, viewDefinitions, contexts, contextsByKind, contextsBySeq, contextsByTarget, inputs, locationIndex, …}, activeTargets}`——视图元数据，不是消息。
- **`useProjection`**：实测返回空。
- **`useResource`**：`{status, value, failure}`。

## 3. 客户端据此实现的规则（`lib/client.js`）

- 按钮：`messageId` 跨所有快照按 id 找 → `blocks` 正文 → 找不到走 DOM 逐层上爬（首个 ≥20 字祖先即气泡）；按钮永不 `disabled`，真没文本弹 toast。
- 自动朗读：只看 `useTrajectory.eventNodes`（优先）等内容源的新增；**切会话静默重建基线；一次新增 >3 条按历史同步静默跟进；朗读必须过活体闩**（本页面生命周期内见过 `running/queue/pending/partial`，或用户侧增长已陈化 ≥2 秒）——三者缺一即历史，必须安静。
- 空会话基线记为 -1，保证新会话首条回复正常朗读。

## 4. 契约漂移时的取证方法

1. 确认构建号：控制台应有 `[tts] client build <tag> loaded`（没有 = 跑的是旧包，先硬刷新/重启 `dsh web`）。
2. 挂载形状：`[tts] slot: <插槽> props: …` 行列出各钩子的数据形状（只含键名/数量/首节点正文长度，不含正文）。
3. 自动朗读判决：每次触发会打 `[tts] auto-read speak key=… fresh=… src=… seq=…`，`src` 即放行的 feeder。
4. 一键打包：控制台运行 `copy(JSON.stringify(__dshTtsDebug.dump()))`，把剪贴板内容贴到 issue。
