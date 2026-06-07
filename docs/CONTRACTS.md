# 跨层契约（Cross-Layer Contracts）

TS game-server、Python worker、LLM Prompt、`@aetherlife/game-actions` 之间的 **硬契约**。  
变更任一层时，**同一任务**内必须更新本表相邻行并实现/测试。

权威动作 schema：[packages/game-actions](../packages/game-actions/README.md)。  
多人不变量：[INVARIANTS-MULTIPLAYER.md](./INVARIANTS-MULTIPLAYER.md)。

---

## C-01 — NL 相对移动（「到我下方 / 旁边」）

| 层 | 契约 |
|----|------|
| **身份来源** | Colyseus `speak` → `playerId` → job payload `playerId` |
| **状态读取** | `GET /rooms/:id/state` + header `X-Player-Id` → `roomStateForInitiator` → `state.player` = 发起者实时格 |
| **Prompt** | 「我 / 下方 / 旁边」仅相对 **本次** `state.player`（见 `workers/.../prompt.py`） |
| **执行** | `POST .../apply-actions` body: `actingNpcId`, `actions[]`, `initiatorPlayerId` |
| **碰撞** | `collectPlayerCells`（所有 Colyseus 玩家 + map 快照） |
| **吸附** | `moveAnchorCell` = `findPlayerCellByPlayerId(initiatorPlayerId)`；`snapNpcMoveDest` 优先四邻 |
| **LLM 出口** | `tool_calls` → `tool_calls_to_actions()` → 仅 `{type,x,y}` 等 strict 字段 |
| **禁止** | 单独使用 `RoomState.player` 或 `map.player` 作发起者坐标 |

**验证：** 双人分别对 npc-1 / npc-2 说「移动到我的下方」；`pnpm --filter @aetherlife/game-server test`；`pytest tests/test_action_sanitize.py`。

**锚点文件：** `bridge.ts`, `routes/rooms.ts`, `executor.ts`, `npc_loop.py`, `action_sanitize.py`.

---

## C-02 — Speak / 异步 Job

| 层 | 契约 |
|----|------|
| **入口** | Colyseus `onMessage("speak")` 不阻塞；`startNpcChatTurn` → Redis job |
| **内容安全** | speak 与 `POST /chat` 在入队前经 `@aetherlife/shared` `checkContentBlocked`（与 gateway blocklist 同规则）；拒绝 `{ code: "content_blocked" }`。**不**替代 gateway Moderation API |
| **队列** | 按 `npcId` 互斥（`npcSpeakJobs`），不同 NPC 可并行 |
| **事件** | worker → `POST /internal/jobs/:id/events` → SSE / `speakAck` / `speakIdle` |
| **禁止** | Room handler 内同步 LLM；房间级 speak 全局锁 |

**验证：** 两玩家同时对不同 NPC speak，均进入 thinking 且互不阻塞；`verify:phase8` 断言 injection 文本 → `content_blocked`；`verify:phase5` 断言 `/nl/parse` → `content_blocked`。

---

## C-03 — Game Action 变更（mutation）

| 层 | 契约 |
|----|------|
| **唯一写入口** | `applyGameAction` / `POST apply-actions`（worker 或内部路由） |
| **校验** | `GameActionSchema` Zod **strict** — 未知键 → 400 |
| **Worker** | 必须 `action_sanitize` 后再 POST；无效 `interact.objectId` **跳过**而非整批失败 |
| **审计** | 成功 mutation → `recordSuccessfulMutation` |

**验证：** `packages/game-actions` tests；`test_action_sanitize.py`；curl 带 `reason` 字段应被 worker 剥掉后成功。

---

## C-04 — 玩家实时位置（Colyseus）

| 层 | 契约 |
|----|------|
| **权威** | `GameRoomState.players[]` 每连接 `(x,y,playerId)` |
| **移动** | 客户端预测 + 服务端 `move-handler` 裁决；`canStepTo` / `buildMoveGrid` |
| **地图写回** | `syncMapPlayerPosition` 仅最后移动者 — **不得**用于 worker 视图 |
| **监听** | 禁止 `removeAllListeners()`；`onMessage` 用返回的 `off()` |

**验证：** `move-handler.test.ts`；ISSUE-001 Guardrails。

---

## C-05 — 记忆分桶

| 层 | 契约 |
|----|------|
| **Per-player 叙事记忆** | `roomId` + `npcId` + `playerId` → `npc_memories`（既有） |
| **Collective 事件** | `roomId` + `npcId` + `playerIds[]` → `collective_events`；**禁止**写入 `npc_memories` 双写 speak 全文 |
| **态度分** | `roomId` + `npcId` + `playerId` → `npc_attitudes.reputation`；speak 取 **initiator** 行 |
| **Worker 读** | `fetch_memory_context` / `GET .../memory-context` 返回含 `collective.{band,allowedTools,effectiveScore}` |
| **Worker 写** | Speak 社交 event **仅 worker**（Phase 12.1 `source=worker`，structured `SocialTurnOut` 权威）；action **rule** 行仍由 game-server；legacy **llm_refine** tail 不对 speak 生效 |
| **Speak 社交** | Server **禁止** `detectSpeak` / rude 词表；LLM parse 失败 → `ignore`（不写 event），**不回退** server 词表 |
| **Reset** | `POST /rooms/:id/reset` 删除该 `roomId` 下所有 `collective_events` + `npc_attitudes` + 既有 per-player memories |
| **与空间** | Witness 距离用 **当前** `RoomState` NPC 格；Chebyshev ≤2 |
| **禁止** | `playerId=__room__` 伪玩家桶；禁止 collective 表存 speak 全文 |

---

## 变更检查清单（PR / Agent 自检）

- [ ] 本 PR 触及上表哪几条 C-xx？
- [ ] 相邻层文件是否同 PR 更新？
- [ ] INVARIANTS / ISSUE-LOG Guardrails 是否需要新条目？
- [ ] 是否增加或更新自动化/手动验证步骤？
