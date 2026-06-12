# AGENTS.md — game-server + worker 边界

根规则：[../../AGENTS.md](../../AGENTS.md)。多人不变量：[../../docs/INVARIANTS-MULTIPLAYER.md](../../docs/INVARIANTS-MULTIPLAYER.md)。跨层契约：[../../docs/CONTRACTS.md](../../docs/CONTRACTS.md)（C-01、C-03）。

## 权威状态

- **地图 / NPC / 物体**：`room/store` 中的 `RoomState`（executor 变更唯一入口）。
- **人类玩家位置**：Colyseus `GameRoomState.players` 为准；`RoomState.player` 仅遗留/回退。
- **同步方向**：executor 变更 → `refreshFromMap` → Colyseus NPC 字段；玩家移动 → Colyseus → 可选 `syncMapPlayerPosition`（勿用于 worker 空间推理）。

## Worker 契约

| 步骤 | 要求 |
|------|------|
| `fetch_state` | `GET /internal/rooms/:id/worker-state` + `X-Player-Id`（非 `__legacy__`） |
| LLM prompt | `state.player` = 发起者格（服务端 `roomStateForInitiator`） |
| `apply-actions` | JSON 含 `initiatorPlayerId`；服务端设 `moveAnchorCell` |
| `apply-actions` 入参 | Worker 经 `tool_calls_to_actions` 清洗后再 POST（C-03 / MP-10） |
| Memory tail | `persist_turn_memory` 写 player + npc；importance 走 `LLM_PROVIDER_IMPORTANCE`（默认 **NVIDIA nano**），**勿**与主路径智谱并行 |

**智谱 GLM-4.7-Flash 账户并发=1** — 详见根 [AGENTS.md](../../AGENTS.md)「LLM — 智谱 GLM-4.7-Flash」。`npc-chat.ts` 不得 `appendPlayerMemory`。

## 参数与日程

- **运行时 tunables：** [`apps/game-server/src/ambient/README.md`](../../apps/game-server/src/ambient/README.md)（`AMBIENT_MS`、`LINGER_*`、社交 bias）
- **日程 JSON 字段：** [`apps/game-server/data/schedules/README.md`](../../apps/game-server/data/schedules/README.md) + [`schema.json`](../../apps/game-server/data/schedules/schema.json)

## 文件锚点

- `colyseus/bridge.ts` — `findPlayerCellByPlayerId`, `roomStateForInitiator`, `collectPlayerCells`
- `routes/rooms.ts` — state 视图、apply-actions
- `room/executor.ts` — `snapNpcMoveDest`, 碰撞与吸附
- `workers/.../npc_loop.py` — `fetch_state` / `apply_tools` header 与 body
- `workers/.../action_sanitize.py` — `tool_calls_to_actions`

## 测试

```bash
pnpm --filter @aetherlife/game-server test
```
