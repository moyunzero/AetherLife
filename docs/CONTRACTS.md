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
| **状态读取** | speak 热路径：`GET /internal/rooms/:id/worker-state?skipNearbyLore=1`（默认）+ header `X-Player-Id` → `roomStateForInitiator` → `state.player` = 发起者实时格（无 memoryCounts）；NARRATIVE + lore markers 可 lazy `skipNearbyLore=0`；legacy/debug：`GET /rooms/:id/state` 仍可用 |
| **Pre-LLM 降级** | worker `fetch_state` 超时后返回进程内 stale snapshot（`_stale` / `_stale_age_ms`），**不得** hard-fail job；move 仍 `invalidateWorkerStateForPlayer` |
| **Memory 热路径** | `GET .../memory-context`：`skipEmbed=1` 用于 CASUAL/SOCIAL_EDGE/NARRATIVE；RECALL 须 full embed；5s 进程内 cache；header `X-Speak-Hot-Path: 1` 优先 embed 队列 |
| **Prompt** | 「我 / 下方 / 旁边」仅相对 **本次** `state.player`（见 `workers/.../prompt.py`） |
| **执行** | 唯一 HTTP 写入口：`POST /internal/rooms/:id/apply-actions`（Bearer `INTERNAL_WORKER_TOKEN` + header `X-Player-Id`；body `initiatorPlayerId` 仅 header 缺失时 fallback）。公开 `/rooms/.../apply-actions` 已移除。body: `actingNpcId`, `actions[]` |
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
| **npcId** | `validateChatNpcId` 仅接受 `COUNCIL_NPC_IDS`（Phase 26：12 席）；非法 id 拒绝 |
| **schema 可见** | speak 进行中 `NpcEntityState.isThinking` / `isSpeaking` 经 `setNpcSpeakPhase` 广播全员（D-MAP-SCHEMA-08） |
| **内容安全** | speak 与 `POST /rooms/:roomId/chat`（gateway：`POST /v1/rooms/{room_id}/chat`）在入队前经 `@aetherlife/shared` `checkPlayerMessageContent`（与 gateway blocklist 同规则）；拒绝 `{ code: "content_blocked" }`。**不**替代 gateway Moderation API |
| **队列** | 按 `npcId` 互斥（`npcSpeakJobs`），不同 NPC 可并行 |
| **事件** | worker → `POST /internal/jobs/:jobId/emit` → SSE / `speakAck`（`{ jobId, npcId }`）/ `speakIdle` / `speakPartial`（流式 reply 增量，非 terminal） |
| **done 安全** | worker `audit_reply` 为 speak 回复唯一 guard；**禁止** game-server `done` emit 同步调用 gateway `check-reply`（ISSUE-045 提速） |
| **可观测（可选）** | job `done` 可含 `llmCallSummary: { calls[], total }`（Phase 12.2；客户端可忽略）；`speakIntent`、`phaseTimingMs`（Speak 提速 Slice 0/3） |
| **记忆回调（可选）** | job `done` 可含 `memoryQuote?: string` — worker 从 `retrieved_memories` 最高分条目选取（PLAY-03）；无检索命中时不传 |
| **客户端 speak UX** | 方案 A（life-sim）：同 NPC in-flight 时 UI 禁用 composer，`sendMessage` 不 enqueue；server `speakBusy` 时内部 FIFO drain 仍保留（Phase 12.2 STAB-04） |
| **禁止** | Room handler 内同步 LLM；房间级 speak 全局锁 |

**验证：** 两玩家同时对不同 NPC speak，均进入 thinking 且互不阻塞；`verify:phase8` 断言 injection 文本 → `content_blocked`；`verify:phase5` 断言 `/nl/parse` → `content_blocked`。

---

## C-03 — Game Action 变更（mutation）

| 层 | 契约 |
|----|------|
| **唯一写入口** | `applyGameAction` / `POST /internal/rooms/:id/apply-actions`（worker + Bearer；禁止公开路由） |
| **Body（可选）** | `jobId?` — worker 审计 `recordSuccessfulMutation` 关联 speak job |
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
| **被挡转向** | `clientCanStep` 失败时客户端 `onBlockedFace` + 无 `clientSeq` 的 `{ dx, dy }` move；服务端 `applyPlayerMove` 仍更新 `player.facing`（坐标不变），`facingUpdated` 时 `bumpStateVersion` |
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

## C-06 — Ambient intent cache（Phase 16）

| 层 | 契约 |
|----|------|
| **触发** | game-server 每分钟 ambient tick：`segment_change`（日程段变化）或 `speak_end`（`clearSpeakInFlight` 后）→ Redis queue `npc-ambient-intent` |
| **Worker** | `ambient_intent.py`：`LLM_PROVIDER_REFLECT` / `LORE` 结构化 JSON；**禁止** `tool_calls_to_actions` |
| **写回** | `POST /internal/rooms/:roomId/npc-intent`（`requireWorkerAuth`）→ in-memory `setIntent` + `clearPendingNpcIntentJob` |
| **Schema** | `@aetherlife/shared` `AmbientIntentSchema`：`target {gx,gy}` **或** `zoneId`；`reasonZh` ≤32；`untilGameMinute`；可选 `joinVicinity` |
| **Tick 消费** | `ambient/tick.ts` 读 cache：target 格或 zone-bias wander；过期/缺失 → zone-wander **且不得清空**已有 `intentReasonZh`（segment fallback 保留）；**位移**另受 `NpcState.maxRadius` 约束（`===0` 钉死；`>0` soft leash — Phase **26.2** / MAP-06）；走步资格为 **per-NPC 概率门**（`shouldStepThisTick`：hash `ambient-step:{npcId}:{gameMinute}` % 100 < wander **55** / linger **30**；resting/idle 经 `shouldSkipMovement` 为 0）；**同 tick 可多名 NPC 移动**（26.2 / B2，取代 Phase 26 独占分桶） |
| **reasonZh 语义** | **动机层**（情绪/社交/短期打算，12–18 字）；禁止与 `activityDisplayZh` 同义复述；segment 开始时 **同步** rule fallback（`intent-fallback.ts`），LLM 异步 **静默替换** |
| **Dedupe** | `@aetherlife/shared` `isReasonZhRedundantWithActivity`；server `applyIntentToLiveRoom` + client `effectiveIntentReasonZh` |
| **Join** | `joinVicinity` → 8s 窗口内 NPC 朝发起者邻近格移动；该窗口内该 NPC **绕过概率门与 soft leash**（D-11）；`maxRadius===0` 钉死仍优先于 join；worker 每 NPC 每 game-day bucket（480 分钟）最多 2 次 |
| **Colyseus** | `npc{N}IntentReasonZh`、`JoinVicinityActive/Until/StartedAt` 同步至客户端 |
| **UI** | 玩家可见 **永久两行**（名 + activity）；**禁止**渲染 `intentReasonZh` 第三行；`updateIntentLabels` 恒隐藏；L2 `reasonZh` 仅 registry/debug/speak 引用；**禁止** spinner / thought bubble；frozen：`entityLabels.ts`、`useNpcChat.ts` |

**验证：** `pnpm --filter @aetherlife/game-server test -- intent-cache npc-ambient-intent ambient/tick src/world/council-spawn-radius.test.ts`；`cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_ambient_intent.py -q`；`pnpm --filter @aetherlife/web test -- RoomScene.activity`；`pnpm dev:stack` → `pnpm verify:phase16`（真实 LLM，≤45s intent 断言）。

**锚点文件：** `ambient/intent-cache.ts`, `queue/npc-ambient-intent.ts`, `routes/internal-ambient-intent.ts`, `ambient/tick.ts`, `workers/.../ambient_intent.py`, `apps/web/src/game/intentLabels.ts`.

---

## C-07 — Council memory scope (`__council__`) [Phase 23 — finalized Phase 25]

| 层 | 契约 |
|----|------|
| **Scope 常量** | `@aetherlife/shared` `COUNCIL_MEMORY_PLAYER_ID = '__council__'` |
| **存储** | `npc_memories` + `memory_summaries` 沿用 C-05 表；键 `(roomId, npcId, playerId='__council__')` |
| **种子** | 房间 **首次创建**（`getOrCreate` 新 record）异步 `seedCouncilMemoriesIfNeeded`：每 npc 写入 `stanceManifestoShort` + `ltmSeeds[]`；**禁止** LLM 生成种子；per-npc `getMemoryCount` 门闩防重复 |
| **Speak 读** | 玩家 speak `GET .../memory-context` **必须** 真实 `playerId`；`MemoryService.buildMemoryContext` **拒绝** `playerId=__council__` |
| **Speak 写** | `persist_turn_memory` 写 `(roomId, initiatorPlayerId, npcId)` — **禁止** 写入 `__council__` |
| **Council 读（PERSONA-04）** | `buildCouncilMemoryContext(roomId, npcId, query)` + worker `fetch_council_memory_context`（`X-Player-Id: __council__`）；HTTP 路由对 `__council__` 走 council helper；Phase 25 vote/debate + speak dual-RAG 消费者 |
| **Council 写** | Phase 23: seed only；**Phase 25 shipped:** `world_vote.py` debate/vote 理由经 `append_council_memory` append 至 `__council__`（每轮 quote + 表决 reason）；**禁止** `onMessage("speak")` 或 Colyseus tick 内写入 |
| **Reset** | `POST /rooms/:id/reset` 删除 **initiator** per-player memories (C-05)；**不**删除 `__council__` room-shared seeds（room-wide wipe defer Phase 24/25） |
| **隔离** | 个人时间线 (`npc_personal_timeline`, D-RESERVE-BIO-02) 与 `__council__` 互斥 |
| **禁止** | `playerId=__room__`；council 种子混入玩家 speak RAG；Colyseus schema 12-NPC（Phase 26） |

**验证：** `pnpm --filter @aetherlife/game-server test -- councilSeed service.test` · `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_council_memory_context.py tests/test_world_vote.py -q` · `pnpm verify:phase25` · `pnpm agent:verify`

**锚点文件：** `memory/councilSeed.ts`, `memory/service.ts`, `room/store.ts`, `workers/.../council/memory_context.py`, `docs/CONTRACTS.md` C-05 交叉引用。

---

## C-07b — World history chronicle [Phase 24]

| 层 | 契约 |
|----|------|
| **表** | `world_history` room 共享、append-only；`(room_id, sequence)` 有序；`(room_id, vote_epoch)` 唯一（vote 行；genesis `vote_epoch` NULL） |
| **种子** | 房间 **首次创建**（`getOrCreate`）异步 `seedWorldHistoryIfNeeded`：3 条 `entry_kind=genesis`、`status=accepted`；`minutes.kind=genesis_signatories`；**禁止**假票决 |
| **公开读** | `GET /rooms/:roomId/world-history?…` 返回 `WorldHistoryListEntry[]`（**无** `minutes`）；`GET /rooms/:roomId/world-history/:entryId` 返回完整 `WorldHistoryPublicEntry`；`X-Player-Id` + `assertScopedPlayerRequest`；**无** embedding / 内部字段 |
| **查询** | `status` = `accepted` \| `rejected` \| `all`（默认 `accepted`）；`pageSize` clamp 5–8（默认 6） |
| **内部写** | `POST /internal/rooms/:roomId/world-history`；`requireWorkerAuth` + Bearer `INTERNAL_WORKER_TOKEN`；body Zod + `checkPlayerMessageContent` / `validateWorldHistoryStrings` |
| **写回字段** | `entryKind` genesis \| vote；vote 行 **必须** `voteEpoch`；`gameYear` 由 `chronicleGameYearFromMinute(gameMinuteSnapshot)` 派生；vote 行 `minutes.kind=vote_minutes` **必须** 含 **11** 条 `ballots[]`（非提案人；`yes` \| `no` + `reasonZh`）；提案人见 entry `proposerDisplayName`；**可选** `debateExcerpts[]`（`fullText` ≤180、`feedQuote` ≤80，辩论完整摘录 — ISSUE-094 / [25-FEED-DUAL-OUTPUT.md](../.planning/phases/25-council-vote-debate/25-FEED-DUAL-OUTPUT.md)） |
| **Reset** | `POST /rooms/:id/reset` **不得**删除 `world_history`（room-shared append-only chronicle；跨 session / per-player reset 存活，与 C-06 `__council__` seed 同类 room-wide 保留） |
| **Colyseus** | `worldHistorySync` payload `{ entry: WorldHistoryPublicEntry }`；`broadcastWorldHistorySync`；客户端 `onMessage` + `off()` |
| **Phase 25** | Worker 写 `entry_kind=vote`；通过后 `status=accepted`；debate minutes `kind=vote_minutes`（提案全文上 / **11** 票决下，提案人单独标注不计票）；`verify:phase25` 断言 `world-history-minutes-ballots` **11** 卡 |
| **隔离** | 编年史与 C-07 `__council__` memory 读模型分离；禁止 council 种子混入 chronicle GET |

**验证：** `pnpm --filter @aetherlife/game-server test -- index.test.ts world-history` · `pnpm agent:verify`

**锚点文件：** `world/world-history-repository.ts`, `world/world-history-seed.ts`, `world/world-history-broadcast.ts`, `routes/world-history.ts`, `routes/internal-world-history.ts`, `room/store.ts`, `packages/shared/src/worldHistory.ts`, `packages/shared/src/colyseus.ts`（`worldHistorySync`）。

---

---

## C-08 — Colyseus council NPC MapSchema [Phase 26 — complete]

| 层 | 契约 |
|----|------|
| **Schema** | `GameRoomState.npcs: MapSchema<NpcEntityState>` keyed by `npcId` (`npc-1`…`npc-12`)；`schemaVersion=2`（breaking；**无** flat `npc1*` / `bgNpc*` shim） |
| **字段** | `NpcEntityState` 镜像 x/y、activityKey、intentReasonZh、joinVicinity*、**isThinking**、**isSpeaking**（多人可见铭牌/VIS-04） |
| **Server 写** | `syncColyseusFromMap` 按 `RoomState.npcs` 增量 `set`/`delete`；权威坐标在 server `RoomState`；`GameRoom.acquireNpcSpeakJob` / speak done 写入 thinking/speaking 标志 |
| **Web 读** | **仅** `useColyseusRoom` → `roomNpcs[]` 派生；`colyseusAmbientSnapshot` 消费派生快照；Phaser/React **禁止**直读 Colyseus `npcs` Map |
| **Breaking** | 移除 flat `npc1*` / `bgNpc*` 槽；web 无兼容 shim；旧三槽房间在 `getOrCreate` / `setState` 时自动 `migrateRoomCouncilNpcs`（亦可用 `scripts/migrate-room-council-npcs.mjs` 离线校验） |
| **Spawn** | `createDefaultRoom` 一次 12 席；`beginning-fields@v1/spawns.json` 的 `councilSpawns[]`（12 **分区分散**锚点，bake 可走格 + 间距断言）+ `shuffleCouncilSpawnAssignments(roomId)`；详见 [BEGINNING-FIELDS.md](./BEGINNING-FIELDS.md) §议会出生点 |
| **不变量** | 同房所有客户端见相同 12 NPC 位置与 speak 标志 — [INVARIANTS-MULTIPLAYER.md](./INVARIANTS-MULTIPLAYER.md) **MP-11** |

**验证：** `pnpm --filter @aetherlife/game-server test -- bridge.test` · `pnpm --filter @aetherlife/web test -- colyseusAmbientSnapshot` · `pnpm verify:phase26`（真实 LLM，禁止 `LLM_MOCK`）· `pnpm verify:phase13`（铭牌 VIS-04 回归）

**锚点文件：** `apps/game-server/src/colyseus/schema.ts`, `apps/game-server/src/colyseus/bridge.ts`, `packages/shared/src/council/spawn.ts`, `packages/shared/src/council/migrate.ts`, `apps/game-server/src/room/council-migrate.ts`, `apps/web/src/hooks/useColyseusRoom.ts`, `apps/web/src/lib/colyseusAmbientSnapshot.ts`, `scripts/migrate-room-council-npcs.mjs`

---

## C-09 — Runtime NPC relationships (`npc_relationships`) [Phase 25 — complete]

| 层 | 契约 |
|----|------|
| **表** | `npc_relationships` room 共享；无向边 `npc_a_id < npc_b_id`（字符串序）；`UNIQUE (room_id, npc_a_id, npc_b_id)`；`affection` −100…100；`trust` 0…100 |
| **种子** | 房间 **首次创建**（`getOrCreate`）异步 `seedCouncilRelationshipsIfNeeded`：从 registry `relationships[]` 映射 `base_tag` + 初始 `affection`/`trust`；**66 条边**（`COUNCIL_NPC_IDS` 全对）；幂等 `countRelationshipsForRoom >= 66` 跳过 |
| **Registry 映射** | 种子读 registry 时用 `councilIndexEdgeIds`（席位序 npc-1…12）；**存储**仍用 `normalizeEdgeIds`（字符串序，满足 CHECK） |
| **Worker 读** | `GET /internal/rooms/:roomId/npc-relationships`；`requireWorkerAuth`；可选 `?npcId=` + `limit` 返回 top-N by `|affection|` |
| **Worker 写** | `POST /internal/rooms/:roomId/npc-relationships/apply-deltas`；body `{ deltas: RelationshipDeltaInput[], voteEpoch? }` → `{ linkedEdges }`；单次 `|affectionDelta| ≤ 15`；server clamp affection/trust；**仅** worker `world_vote` job 异步调用 — **禁止** Colyseus `onMessage` |
| **UI linkedEdges** | Worker **全量** apply-deltas 后，`councilDeliberationSync.linkedEdges` 仅广播 `filter_linked_edges_for_ui(top_k=8, min_abs=8)` 子集；名册 hint 用 broadcast 子集，**非** apply 响应全边 |
| **Reset** | `POST /rooms/:id/reset` **不得**删除 `npc_relationships`（room-shared，与 `world_history` / `__council__` 同类保留） |
| **UI** | 客户端 **无**公开 REST；`linkedEdges` 仅经 `councilDeliberationSync` 广播；名册 `council-roster-relationship-hint`（`linkedEdges` 上次 vote job）subtle hint only |
| **C-07 辩论记忆** | Phase 25 `world_vote.py` debate/vote 理由同步 append `__council__`（见 C-07 Council 写）；关系 delta 与 council memory 同 job 串行 |
| **REL-08 drift** | `npc_leaning_drift` 表（room_id + npc_id PK，drift −30…30）；**仅** worker speak memory tail `apply_speak_leaning_drift` 写入；`world_vote` 读 `effective_voting_leaning(registry + drift)`；玩家 UI **不可见** drift 数值；验证：`cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_leaning_drift.py -q` |

**验证：** `pnpm --filter @aetherlife/shared test -- councilDeliberation` · `pnpm --filter @aetherlife/game-server test -- npc-relationships councilRelationshipSeed world-vote` · `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_world_vote.py -q` · `pnpm verify:phase25`（REL-05 affection delta）· `pnpm verify:phase26`（REL-08 drift unit 子进程，非 LLM 硬断言）

**锚点文件：** `world/npc-relationships-repository.ts`, `memory/councilRelationshipSeed.ts`, `routes/internal-npc-relationships.ts`, `room/store.ts`, `packages/shared/src/councilRelationships.ts`, `packages/shared/src/councilDeliberation.ts`, `packages/npc-memory/migrations/0009_npc_relationships.sql`, `packages/npc-memory/migrations/0010_npc_leaning_drift.sql`, `workers/agent-worker/src/council/leaning_drift.py`.

---

## C-10 — Deliberation pacing & job payload [Phase 25 plan 09]

| 层 | 契约 |
|----|------|
| **Env** | `VOTE_DEBATE_ROUNDS_MAX` 默认 **5**；`VOTE_INSTANT_DEBATE` 默认 **1**（单 worker job 跑 proposal+全部 debate+ballot）；`VOTE_DEBATE_ROUND_GAME_DAYS` 默认 **1**（paced 模式每轮间隔游戏日，1440 gameMinute） |
| **Trigger** | `evaluateVoteTrigger` / `forceEnqueueWorldVote` 对 `debateRoundsMax` 调用 `capDebateRoundsMax`；enqueue payload 含 `instant: boolean` |
| **Checkpoint** | `RoomVoteState.activeDeliberation` 存 paced 中间态（`jobId`, `proposalTitle`, `proposalBody`, `currentRound`, `transcript[]`, `nextRoundAtGameMinute`）；`POST .../world-vote/checkpoint` 写入并 **clear pending**；instant job 完成后 `activeDeliberation=null` |
| **Continuation** | `maybeEnqueueWorldVote` tick 内优先 `maybeEnqueueDeliberationContinuation`；jobId `${baseJobId}-r{N}`；payload `resumeJobId` + `instant:false` |
| **Worker** | `instant=true`：单 job 全流程；`instant=false`：slice 0 = proposal+round1 → checkpoint；slice N = round N+1 → checkpoint 或 final ballot+writeback |

**验证：** `pnpm --filter @aetherlife/game-server test -- world-vote-pacing world-vote-trigger` · `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_world_vote.py -q`

**锚点文件：** `world/world-vote-pacing.ts`, `world/world-vote-state.ts`, `world/world-vote-trigger.ts`, `queue/world-vote.ts`, `workers/agent-worker/src/graph/world_vote.py`.

---

## 变更检查清单（PR / Agent 自检）

- [ ] 本 PR 触及上表哪几条 C-xx？
- [ ] 相邻层文件是否同 PR 更新？
- [ ] INVARIANTS / ISSUE-LOG Guardrails 是否需要新条目？
- [ ] 是否增加或更新自动化/手动验证步骤？
