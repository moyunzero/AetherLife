# 多人房间不变量（Multiplayer Invariants）

本文件定义 **Phase 08+** 多人 Colyseus 与 NL 指令链路的硬约束。违反任一条即视为架构缺陷，修 bug 时先对照此处再改代码。

跨层契约表：[CONTRACTS.md](./CONTRACTS.md)。

参考实践（外部）：

- [agents.md](https://agents.md) — 代理可读的项目约束（配置即代码）
- [OpenAI agents.md 仓库](https://github.com/agentsmd/agents.md) — 根目录 + 子目录分层 `AGENTS.md`
- 权威服务端：Colyseus / Nakama 模式 — **客户端预测、服务端裁决**；房间状态以服务端为准

---

## 1. 身份与坐标

| ID | 不变量 |
|----|--------|
| MP-01 | **每名人类玩家** 在 Colyseus `GameRoomState.players` 中有独立 `(x,y)` 与 `playerId`。 |
| MP-02 | `RoomState.player` 是 **遗留单人字段**，仅作默认/回退；**不得**作为多人空间推理的唯一依据。 |
| MP-03 | `syncMapPlayerPosition` 写入的 `map.player` = **最后移动者**，不表示「当前说话的玩家」。 |
| MP-04 | Worker speak 热路径 `GET /internal/rooms/:id/worker-state`（legacy `GET /rooms/:id/state` 仍可用）必须在带 `X-Player-Id` 时，将 `state.player` **覆盖为** 该玩家在 Colyseus 中的实时格（见 `roomStateForInitiator`）。 |
| MP-05 | `playerId` 除记忆分桶外，必须参与 **空间上下文**（state 视图 + `apply-actions` 的 `initiatorPlayerId`）。 |

## 2. NL 指令与执行

| ID | 不变量 |
|----|--------|
| MP-06 | Prompt 中「我 / 下方 / 旁边」仅相对 **本次发起指令的玩家**（`state.player` 在 worker 视图中已绑定）。 |
| MP-07 | `apply-actions` 的碰撞格必须包含 **所有** Colyseus 在线玩家（`collectPlayerCells`），不能只读 `map.player`。 |
| MP-08 | NPC `move` 目标被占时：先尝试 **发起者四邻** 可走格（`moveAnchorCell`），再 BFS 吸附；避免落到无关远处格。 |
| MP-09 | Speak 队列按 **npcId** 互斥，不按房间互斥；不同 NPC 可并行。 |
| MP-10 | Worker 在 `POST apply-actions` 前必须用 `action_sanitize` 剥离 LLM 多余字段；`interact.objectId` 须存在于当前 `room.objects`，否则跳过该条而非整批 400。 |

## 3. Council map presence（Phase 26）

| ID | 不变量 |
|----|--------|
| MP-11 | **同房所有客户端** 经 Colyseus 见 **相同 12 议会 NPC** 的权威 `(x,y)` 与 `isThinking`/`isSpeaking`；web 仅通过 `useColyseusRoom` 派生 `roomNpcs[]`，禁止直读 MapSchema。 |
| MP-12 | **禁止**恢复 flat `npc1*`/`bgNpc*` 三槽或 bg-villager 模型；`schemaVersion=2` + `MapSchema<NpcEntityState>` 为唯一 SSOT（见 C-08）。 |

## 4. 禁止事项

- 禁止在 worker `fetch_state` 时不传 `X-Player-Id`（非 `__legacy__` 时）。
- 禁止在 `apply-actions` 中忽略 `initiatorPlayerId` 做相对移动吸附。
- 禁止假设 `room_snapshot.player` 与 UI 上「你」的 Colyseus 坐标永远一致（多人时必然不一致）。
- 禁止将 LLM `tool_calls.args` 原样 POST 到 `apply-actions`（`game-actions` Zod `.strict()` 会 400）。
- 禁止在 web/Phaser 直读 Colyseus `state.npcs` Map — 须消费 `useColyseusRoom` 派生的 `roomNpcs[]`（C-08 / MP-11）。
- 禁止恢复 `npc1X`/`bgNpc1X` 扁平槽或仅 3 主 NPC + 4 bg-villager 房间模型（MP-12）。

## 5. 验证清单

单元测试可用 `LLM_MOCK=1`；**phase 验收（`pnpm verify:phase*`）必须真实 LLM**，禁止 `LLM_MOCK=1` 或 `dev:stack:mock`。

```bash
pnpm --filter @aetherlife/shared build
pnpm --filter @aetherlife/game-server test
cd workers/agent-worker && LLM_MOCK=1 uv run pytest -q

pnpm dev:stack
pnpm verify:phase8   # 含双人「移动到我的下方」+ X-Player-Id 四邻断言
pnpm verify:phase26  # 12 NPC 地图 + 3 speak + 议会闭环（真实 LLM，禁止 LLM_MOCK）
```

## 6. 为何会反复出问题（根因模式）

| 模式 | 说明 | 本项目实例 |
|------|------|------------|
| **单人模型残留** | Phase 2–4 按单人设计的数据字段未在 Phase 8 升级 | `RoomState.player` |
| **身份双轨** | `playerId` 只接记忆、不接空间 | 阿斯托利亚相对「错误的玩家」移动 |
| **最后写入胜出** | 全局字段被最后移动者覆盖 | `syncMapPlayerPosition` |
| **跨层契约断裂** | TS 服务端、Python worker、Prompt 三处语义不一致 | 未传 header / initiator |
| **吸附无锚点** | 碰撞修复只做全局 BFS，丢失「相对发起者」语义 | 阿斯托利亚被吸到莫玄虚正下方 |

新增多人功能前：先问「发起者是谁？他的格坐标从哪读？写回会不会影响他人？」
