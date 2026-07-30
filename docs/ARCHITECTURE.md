# AetherLife 架构设计

> 操作边界与命令：[AGENTS.md](../AGENTS.md) · 跨层契约：[CONTRACTS.md](./CONTRACTS.md) · 多人不变量：[INVARIANTS-MULTIPLAYER.md](./INVARIANTS-MULTIPLAYER.md)

---

## 1. 项目概述

AetherLife（以太人生）是一款 **AI 驱动的多人联机生活模拟 Web 游戏**。玩家在星露谷式 2D 世界中移动、探索，并用自然语言与拥有独立记忆、性格与集体态度的 NPC 互动。核心价值不是「对话树」，而是可验证的闭环：

**感知 → 记忆 → 反思 → 执行**

系统把 LLM 智能体接到权威多人游戏服：NPC 能理解自然语言、记住互动、改变后续行为；并在此之上支持异步 job 队列、程序化世界与议会世界观。

### 1.1 核心能力

| 能力 | 现状 |
|------|------|
| 智能 NPC 对话 | Colyseus `speak` → Redis job → LangGraph worker；流式/分阶段事件回客户端 |
| 记忆系统 | Postgres + pgvector；per-player 叙事记忆 + collective 态度分桶 |
| 关系 / 态度 | `npc_attitudes` + collective events（非单一「好感度标量 UI」） |
| 游戏化交互 | Phaser 4 网格移动、Tiled 家园图、程序化 chunk、12 席议会在场 |
| 多人 | Colyseus 权威房间（最多约 4 人）；空间指令相对**发起者**坐标 |
| Ambient 生命感 | 日程 / zone 漫游 + 异步 LLM intent（不阻塞 speak） |
| 可观测 | job 事件、phase timing、E2E Golden Flows（真实 LLM） |

---

## 2. 技术架构概览

系统按职责分为五层。

```
┌─────────────────────────────────────────────────────────────────┐
│ ① 客户端层  apps/web                                              │
│    React HUD · Phaser 4 场景 · Colyseus SDK · Speak / SSE UI      │
└────────────────────────────┬────────────────────────────────────┘
                             │ WS (Colyseus) · HTTP /api · /v1
┌────────────────────────────▼────────────────────────────────────┐
│ ② 权威实时层  apps/game-server                                    │
│    Colyseus GameRoom · RoomState / executor · 队列入队 · 记忆 API │
└───────────────┬─────────────────────────────┬───────────────────┘
                │ Redis jobs                  │ HTTP /v1（可选）
┌───────────────▼─────────────┐   ┌───────────▼───────────────────┐
│ ③ 异步智能体层               │   │ ④ AI Gateway 层                 │
│    workers/agent-worker      │   │    apps/ai-gateway (FastAPI)    │
│    LangGraph speak · ambient │   │    NL parse · ContentGuard     │
│    lore · world-vote …       │   │    chat 入队旁路               │
└───────────────┬─────────────┘   └────────────────────────────────┘
                │ Bearer /internal + DB
┌───────────────▼─────────────────────────────────────────────────┐
│ ⑤ 数据与外部服务层                                                │
│    Supabase Postgres + pgvector · Upstash Redis · LLM Providers │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 各层职责

| 层 | 路径 | 职责 |
|----|------|------|
| **客户端** | `apps/web` | 渲染与输入；客户端预测移动；发 `speak` / `move`；消费 schema 与 job 事件。`onStateChange` **仅**在 `useColyseusRoom` |
| **权威实时** | `apps/game-server` | 房间权威状态；移动裁决；speak 校验入队；`worker-state` / `apply-actions` / memory-context；ambient tick |
| **异步智能体** | `workers/agent-worker` | 消费 Redis job；LLM 回合与 tool；记忆 tail；背景 JSON job（ambient intent、lore、world-vote） |
| **AI Gateway** | `apps/ai-gateway` | 对外 NL / guard / 部分 chat 入口；**不**替代 Colyseus speak 主路径 |
| **共享契约** | `packages/shared` · `packages/game-actions` · `packages/npc-memory` | 消息常量、议会人设、动作 Zod schema、记忆迁移 |

端口（`pnpm dev:stack`）：web **5173** · game-server **2567** · ai-gateway **8000**。

详表见 [STACK-REFERENCE.md](./STACK-REFERENCE.md)；LLM 路由见 [LLM-ROUTING.md](./LLM-ROUTING.md)。

---

## 3. 数据流转

### 3.1 Speak 闭环（自然语言指挥 NPC）

Speak 走 **入队 + 异步 worker**，避免阻塞 Colyseus 房间。

```
玩家输入
   │
   ▼
Web  useNpcChat  →  room.send("speak", { text, npcId })
   │
   ▼
GameRoom.onMessage("speak")
   · 校验 npcId ∈ COUNCIL_NPC_IDS、内容 blocklist
   · startNpcChatTurn → Redis LPUSH aetherlife:npc-turn:jobs
   · 立即 speakAck / isThinking（不调 LLM）
   │
   ▼
agent-worker  BRPOP
   · fetch_state（worker-state + X-Player-Id）
   · load_memory_context / 关系与 dual-RAG（按 intent）
   · LangGraph llm_turn（主对话 + tool_calls）
   · tool_calls_to_actions → POST /internal/.../apply-actions
   · emit done / speakPartial …
   · 异步 run_npc_memory_tail → persist_turn_memory（禁止在 Room handler 写记忆）
   │
   ▼
Web  更新对话 UI · Phaser 铭牌 thinking/speaking · 地图若有 move/interact
```

硬约束（摘要）：

- Room handler **禁止**同步 LLM（C-02）。
- 相对位移「到我下方」必须相对**发起者**格：`X-Player-Id` + `roomStateForInitiator` + `moveAnchorCell`（C-01 / MP-04…08）。
- LLM 出口必须经 `tool_calls_to_actions`，禁止原样 POST（C-03 / MP-10）。

序列与延迟细节：[LLM-E2E-FLOW-AND-LATENCY.md](./LLM-E2E-FLOW-AND-LATENCY.md)。

**Dialogue continuity（Phase 29 / D-SESS）：** 当前对话轮次缓存在进程内 `Map`（`aetherlife:dialogue:v1:{room}:{npc}:{player}`），并异步写入 Redis List。进程重启或 Map miss 后，`getRecentTurnsAsync` 从 Redis 回填 Map。D-SESS UAT 用 Map-evict（`POST .../dialogue-map-evict`）模拟 miss，无需杀进程 — `pnpm uat:phase29:dialogue-restart`。

### 3.2 移动同步闭环

```
WASD / 点击寻路（Phaser）
   → MovementSyncController 客户端预测
   → Colyseus move 包
   → game-server move-handler 裁决
   → moveAck / schema players[]
   → 本地 tween 对账 · 远端插值
```

权威：人类坐标在 `GameRoomState.players[]`；`RoomState.player` / `map.player` **不得**单独作多人空间推理。详见 [MOVEMENT-ARCHITECTURE.md](./MOVEMENT-ARCHITECTURE.md)。

### 3.3 Ambient / 背景智能

```
GameRoom ambient tick（游戏分钟推进）
   → 入队 npc-ambient-intent（及 lore / world-vote 等）
   → worker JSON-only job（不走 apply-actions tool 路径）
   → POST /internal/... 写回 intent / lore / history
   → Colyseus 广播或 HTTP 初载 + onMessage 合并
```

Speak 进行中，worker 优先 drain `npc-turn`，背景 job 让路。契约见 CONTRACTS C-06 / C-07。

---

## 4. Monorepo 目录结构

```
AI-web/
├── apps/
│   ├── web/                      # 客户端：React + Phaser 4
│   │   ├── src/
│   │   │   ├── game/             # RoomScene、移动、铭牌、精灵
│   │   │   ├── hooks/            # useColyseusRoom、useNpcChat
│   │   │   ├── components/       # HUD / Drawer / Dialogue
│   │   │   └── lib/              # 预测器等纯 TS
│   │   └── public/assets/        # 地图、LPC 精灵、tileset
│   ├── game-server/              # 权威服：Express + Colyseus
│   │   ├── src/
│   │   │   ├── colyseus/         # GameRoom、schema、bridge、npc-chat
│   │   │   ├── room/             # store、executor（世界变更唯一写路径）
│   │   │   ├── queue/            # npc-turn、ambient、lore、world-vote…
│   │   │   ├── ambient/          # tick、intent cache
│   │   │   ├── world/            # lore / history 仓储与广播
│   │   │   ├── memory/           # 记忆与 embed 相关
│   │   │   └── routes/           # 公开 + /internal/*
│   │   └── data/                 # schedules、beginning-fields 烘焙产物
│   └── ai-gateway/               # FastAPI：NL、guard、旁路 chat
│
├── workers/
│   └── agent-worker/             # 单进程 BRPOP 循环 + LangGraph
│       └── src/
│           ├── main.py           # 队列优先级与 speak-in-progress 守卫
│           ├── graph/            # npc_loop、ambient_intent、lore、world_vote…
│           ├── llm/              # 多 provider 路由
│           └── memory/           # persist / reflect 辅助
│
├── packages/
│   ├── shared/                   # 消息常量、议会人设、房间类型
│   ├── game-actions/             # GameAction Zod strict schema
│   └── npc-memory/               # SQL migrations（pgvector 等）
│
├── docs/                         # 契约、不变量、E2E、本架构文档
├── npc-asset/                    # 角色源素材（烘焙进 web public）
└── scripts/                      # bake、verify、council export…
```

包级边界补充：

- Web：[apps/web/AGENTS.md](../apps/web/AGENTS.md)
- Game-server / worker：[apps/game-server/AGENTS.md](../apps/game-server/AGENTS.md)

---

## 5. 权威状态与写路径（设计原则）

| 状态种类 | 权威位置 | 谁可以写 |
|----------|----------|----------|
| 人类玩家 `(x,y)` | Colyseus `players[]` | `move-handler`（客户端仅预测） |
| NPC / 物体 / 地图逻辑 | `room/store` 的 `RoomState` | **仅** `executor` / `apply-actions` |
| Speak 进行中 UI 标志 | Colyseus `NpcEntityState` | `setNpcSpeakPhase` 等 |
| 叙事记忆 | `npc_memories`（room+npc+player） | worker memory tail / internal memories |
| 集体态度 | `collective_events` + `npc_attitudes` | worker 社交结构化写回；规则类可由 server |
| Ambient intent | 内存 cache + schema 字段 | internal `npc-intent` |

**Phase 29 记忆检索补充：**

- 遗忘曲线加权检索（`packages/npc-memory` SSOT）；ANN = halfvec overfetch → 曲线重排。
- 短期对话：进程内 Map + Redis List；miss 后 `getRecentTurnsAsync` 回填（§3.1 D-SESS）。
- Semantic（mood/beliefs）仅 LLM / 内部可见；公开 API strip（C-05）。
- PROP 2-hop 好感传播常量锁定；不进 ChatState 级联。

**单一变异入口：** 世界动作经 `POST /internal/rooms/:id/apply-actions`（Bearer `INTERNAL_WORKER_TOKEN`）。公开 mutation 路由已移除（C-03）。

---

## 6. 快速对照：本地跑通

环境与密钥见根目录 `.env.example`。完整步骤见 [README.md](../README.md)；此处只给架构视角的最小路径：

```bash
pnpm install
cp .env.example .env          # DATABASE_URL、REDIS_URL、LLM keys
pnpm verify:cloud
pnpm --filter @aetherlife/npc-memory db:migrate
pnpm dev:stack                # :5173 / :2567 / :8000 + worker
```

健康检查：

```bash
curl -sf http://127.0.0.1:5173/
curl -sf http://127.0.0.1:2567/health
curl -sf http://127.0.0.1:8000/health
```

验证分层：

| 层级 | 命令 |
|------|------|
| 单测（可 mock LLM） | `pnpm agent:verify`；`pnpm --filter @aetherlife/game-server test`；`cd workers/agent-worker && LLM_MOCK=1 uv run pytest -q` |
| E2E / phase（**禁止** mock） | `pnpm dev:stack` + `pnpm verify:phaseN`（如 `verify:phase8`、`verify:phase26`） / `pnpm agent:verify --e2e` — 见 [E2E-POLICY.md](./E2E-POLICY.md) |

---

## 7. 相关文档地图

| 文档 | 读什么时候 |
|------|------------|
| [CONTRACTS.md](./CONTRACTS.md) | 改 game-server ↔ worker ↔ prompt 任一边界 |
| [INVARIANTS-MULTIPLAYER.md](./INVARIANTS-MULTIPLAYER.md) | 多人空间、相对移动、12 NPC 在场 |
| [MOVEMENT-ARCHITECTURE.md](./MOVEMENT-ARCHITECTURE.md) | Phaser 预测、moveAck、远端插值 |
| [LLM-E2E-FLOW-AND-LATENCY.md](./LLM-E2E-FLOW-AND-LATENCY.md) | Speak 全链路与延迟 |
| [LLM-ROUTING.md](./LLM-ROUTING.md) | Provider / 并发 / fallback |
| [COUNCIL-PERSONAS.md](./COUNCIL-PERSONAS.md) | 12 席人设 SSOT |
| [BEGINNING-FIELDS.md](./BEGINNING-FIELDS.md) | 家园 Tiled、碰撞、出生点 |
| [PHASE-EVOLUTION.md](./PHASE-EVOLUTION.md) | 阶段演进与防债务 |
| [.planning/research/ARCHITECTURE.md](../.planning/research/ARCHITECTURE.md) | **v5 议会 / world-vote 集成研究**（规划向，非运行时 SSOT） |

---

## 8. 演进原则（架构债务预防）

1. **先契约后代码**：跨层改动同一 PR 更新 CONTRACTS 相邻行，并跑两侧测试。
2. **身份贯穿空间**：`playerId` 不只服务记忆，必须进入 worker-state 与 `apply-actions`。
3. **异步优先**：任何 LLM 不得进 Colyseus `onMessage` 同步路径。
4. **背景 job 让路 speak**：worker 队列优先级与 speak-in-progress 守卫保持不变。
5. **冻结 UX 不 drive-by**：铭牌 / speak busy 等见 AGENTS.md Frozen UX；改则跑对应 verify gate。

---

*本文档描述当前主线架构（含 Phase 26 十二席地图在场）。里程碑时间线见 [DEVELOPMENT-HISTORY.zh-CN.md](./DEVELOPMENT-HISTORY.zh-CN.md)。*
