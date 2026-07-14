# 开发历程

[English](./DEVELOPMENT-HISTORY.md) | **简体中文**

**以太人生 / AetherLife** — 从 v0（文本闭环）到 v5（AI 议会）的分阶段交付记录。

本文档合成 **37 个开发 Phase**（含子阶段）的完整记录。每条含目标、思路、交付、验收、技术决策、已知债务与关联 ISSUE。

**最后更新：** 2026-06-25

---

## 目录

- [时间线总览](#时间线总览)
- [里程碑 v0 — 文本闭环](#里程碑-v0--文本闭环)
- [里程碑 v1 — 图形 + 多人 + 世界](#里程碑-v1--图形--多人--世界)
- [里程碑 v2 — 可玩的 AI 小镇](#里程碑-v2--可玩的-ai-小镇)
- [里程碑 v3 — 智能 Ambient 与 Speak SLA](#里程碑-v3--智能-ambient-与-speak-sla)
- [里程碑 v4 — 自主人生闭环](#里程碑-v4--自主人生闭环)
- [里程碑 v5 — AI 议会（进行中）](#里程碑-v5--ai-议会进行中)
- [全局暂缓项](#全局暂缓项)
- [如何验收](#如何验收)

---

## 时间线总览

| 里程碑 | 阶段 | 状态 | 交付日期 |
|-----------|--------|--------|---------|
| **v0** 文本闭环 | 01–05 | ✅ 已交付 | 2026-06-04 |
| **v1** 图形 + 多人 + 世界 | 06–08, 10–12.1 | ✅ 已交付 | 2026-06-07 |
| **v2** 可玩的 AI 小镇 | 12.2–15 | ✅ 已交付 | 2026-06-09 |
| **v3** 智能 Ambient 与 Speak SLA | 16–17.1 | ✅ 已交付 | 2026-06-11 |
| **v3.1** 代码健康重构 | 18 | ✅ 已交付 | 2026-06-12 |
| **v4** 自主人生闭环 | 19–22 | ✅ 已交付 | 2026-06-22 |
| **v5** AI 议会 / 世界观 | 23–27 | 🔨 进行中 | Phase 23 ✅（2026-06-25） |

**v0→v4 脉络：** 纯文本 Generative Agent 闭环 → Colyseus 多人 + Phaser 世界 → 视觉打磨 + 小镇玩法 loop → 智能 ambient + speak 稳定 → 沉浸单人人生（记忆信任 + 世界回响）。

**v5 方向：** 从 3 个可对话 NPC 扩展为 12 人 AI 议会：世界编年史、多轮辩论表决、全员上地图、个人人生时间线。

---

## 里程碑 v0 — 文本闭环

**交付：** 2026-06-04 · **阶段：** 01–05 · **核心价值验证：** 感知 → 记忆 → 执行（文本 UI）

---

### Phase 01 — 基础与 Action Schema

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-03 |

**目标**

- 建立 monorepo、云 dev stack（Supabase + Upstash）、共享 Zod action schema 作为所有 LLM mutation 的唯一契约。

**思路**

- 云 Postgres/Redis 降低上手成本；game-server 与 worker 共享 Zod schema 防止契约漂移。

**关键交付**

- pnpm + Turborepo monorepo
- `packages/game-actions` Zod + OpenAI tools
- `scripts/verify-cloud.mjs`
- ai-gateway FastAPI `/health`
- `.env.example` Supabase/Upstash template

**验收:** `pnpm verify:cloud` · `pnpm turbo test`

**技术决策:** INFR-01 cloud dev stack; INFR-02 game-actions as sole mutation schema

---

### Phase 02 — 单 NPC 文本闭环

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-04 |

**目标**

- 单 NPC 在纯文本 UI 完成 Generative Agent 闭环，验证核心价值。

**思路**

- LangGraph + BullMQ 异步 worker；禁止 Colyseus 阻塞 LLM；SSE 驱动「思考中」反馈。

**关键交付**

- game-server room routes + SSE
- `workers/agent-worker` LangGraph `npc_loop.py`
- apps/web chat UI
- `scripts/verify-phase2.mjs`

**验收:** `pnpm verify:phase2` · `cd workers/agent-worker && LLM_MOCK=1 uv run pytest -q`

**技术决策:** AGNT-01/03; INFR-03 LangSmith trace

---

### Phase 03 — 持久记忆

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-03 |

**目标**

- NPC 记忆跨 restart/session 保留；向量检索注入对话；摘要防膨胀。

**思路**

- pgvector + `@aetherlife/npc-memory`；top-k embedding 检索；≥100 条 bulk 摘要。

**关键交付**

- `packages/npc-memory` schema + migrations
- game-server MemoryService + internal API
- worker reflect/bulk summarize
- `scripts/verify-phase3.mjs`

**验收:** `pnpm verify:phase3` · `pnpm verify:phase3 -- --seed-bulk=100`

**技术决策:** D-07 reset clears memory, keeps checkpoint; HNSW dropped for 2048-dim embed

**已知债务:** Dev embed latency p95 ~2–4s (production target <500ms not met at v0 close)

---

### Phase 04 — 多 NPC 文本房间

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-04 |

**目标**

- 1–3 NPC 同 room 独立 thread，玩家可切换对话对象。

**思路**

- 每 NPC 独立 LangGraph thread；NpcTabBar + 记忆面板可观测；`transfer` action 支持 NPC 间转移。

**关键交付**

- Multi-NPC room state
- `transfer` action + executor
- NpcMemoryPanel
- `scripts/verify-phase4.mjs`

**验收:** `pnpm verify:phase4`

**技术决策:** AGNT-02/04

---

### Phase 05 — NL 网关与安全

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-04 |

**目标**

- FastAPI 统一 NL 入口，Guardrails + thinking UX。

**思路**

- ai-gateway `/chat` + `/nl/parse` + ContentGuard；early thinking SSE；reply audit。

**关键交付**

- apps/ai-gateway chat/parse/guard
- game-server thinking hooks
- web `/v1` proxy
- `scripts/verify-phase5.mjs`

**验收:** `pnpm verify:phase5` · `cd apps/ai-gateway && uv run pytest tests -q`

**技术决策:** SAFE-01…03

**已知债务:** Direct gs `/chat` bypass, public audit-log, no rate limit — documented accepted risks in 05-SECURITY.md

---

## 里程碑 v1 — 图形 + 多人 + 世界

**交付：** 2026-06-07 · **阶段：** 06–08, 10, 10.5, 11, 11.6, 11.7, 12, 12.1（Phase 09 暂缓）

**里程碑思路：** 将 v0 文本闭环扩展为图形多人：Colyseus 同步、Phaser 渲染、程序化 chunk、LLM lore、集体记忆 + worker 社交感知。

---

### Phase 06 — Colyseus 与移动

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-03 |
| **里程碑** | v1 |

**目标:** Authoritative game-server; player movement sync; foundation for graphics/multiplayer.

**思路:** Colyseus GameRoom server-authoritative move; 20Hz tick; speak → BullMQ async, never block room.

**Key deliverables:** GameRoom.ts + schema.ts + move-handler.ts; useColyseusRoom + MovementPanel; useNpcChat speak/broadcast

**验收:** `pnpm verify:phase6` · `pnpm uat:phase6:playwright`

**技术决策:** D-01 same port HTTP+WS; D-04 broadcast not SSE on web; D-20 WASD + click grid

---

### Phase 07 — 2.5D 渲染器

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-04 |

**目标:** Phaser 4 top-down 8×8 room; player + NPC sprites bound to Colyseus/REST; MovementPanel fallback.

**思路:** Phaser 4 RoomScene + React PhaserGame; probePhaserBoot + fallback path on WebGL failure.

**Key deliverables:** RoomScene.ts + PhaserGame.tsx; gridLayout.ts + theme.ts; npcReply sanitize

**验收:** `pnpm verify:phase7` · `pnpm uat:phase7:reset-snap`

**关联 ISSUE:** [ISSUE-002](../docs/ISSUE-LOG.md) (reset flushSync order)

---

### Phase 08 — 多人房间

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-05 |

**目标:** 4 players per room + async NPC AI patch without race conditions.

**思路:** maxClients=4 + clientSeq/moveAck prediction; speak queue + speakBusy per NPC; stateVersion monotonic AI patch.

**Key deliverables:** GameRoom speak queue + moveAck; applyStatePatch.ts; contentGuard speak blocklist

**验收:** `pnpm verify:phase8` · `pnpm uat:phase8:playwright` · `pnpm verify:phase8:soak`

**技术决策:** SYNC-02…04; X-Player-Id / initiatorPlayerId foundation

**已知债务:** E2E flaky under 智谱 concurrency=1 → fixed in Phase 12.2 ([ISSUE-032](../docs/ISSUE-LOG.md))

---

### Phase 09 — 语音管线

| | |
|---|---|
| **状态** | ⏸ 暂缓 |
| **Decision date** | 2026-06-05 |

**目标:** STT/TTS immersive voice (PTT → speak path → TTS for initiator only).

**思路:** Planning complete (CONTEXT/UI-SPEC/4-wave PLAN) but not executed; prioritized world/multiplayer slices; voice needs GPU hosting or paid API cost.

**Key deliverables (planned only):** 09-CONTEXT.md + 09-UI-SPEC.md; 09-01…04-PLAN.md — **no apps/ voice code**

**验收:** — (not implemented)

**技术决策:** D-02 PTT + Colyseus speak primary path; self-hosted Speaches/Kokoro preferred architecture

**已知债务:** VOICE-01/02 fully deferred; resume conditions documented in phase 09 status

---

### Phase 10 — Chunk 地形

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-05 |

**目标:** Seed-driven chunk load/unload + DB delta persistence.

**思路:** ChunkLoader 3×3 window + LRU; door delta persist on re-enter; Colyseus global coords + chunksSync.

**Key deliverables:** chunk-loader.ts; world_chunk_deltas migration; `scripts/verify-phase10.mjs`

**验收:** `pnpm verify:phase10` · `pnpm uat:phase10:playwright`

**技术决策:** WORLD-01; WORLD-03

**已知债务:** LLM lore → Phase 11; tile sprite atlas → art pass (Phase 13)

---

### Phase 10.5 — Phaser 移动同步

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-05 |

**目标:** Phaser-first movement orchestration; RoomScene owns input→sync; eliminate React onMove vs explore tick races.

**思路:** RoomScene.setupInput → movementSync; remove useColyseusRoom setInterval explore tick; MP-MOV-02 shouldSuppressLocalSchemaSnap gate.

**Key deliverables:** docs/MOVEMENT-ARCHITECTURE.md; localPlayerSchemaSnap.ts; verify-phase6 move-only gate

**验收:** `pnpm verify:phase6:move-only` · `pnpm --filter @aetherlife/shared test`

**技术决策:** Phaser-first movement; registry changedata explore coords

---

### Phase 11 — LLM 世界 Lore

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-06 |

**目标:** Async LLM metadata on first chunk enter; persisted cache.

**思路:** lore-orchestrator + lore_loop.py async job; Postgres chunk_lore cache hit skips repeat LLM; ExploreStrip + lore toast.

**Key deliverables:** lore-orchestrator.ts; lore_loop.py; ExploreStrip + toast

**验收:** `pnpm verify:phase11` · `pnpm uat:phase11:playwright`

**技术决策:** WORLD-02; dedup poll in verify script

---

### Phase 11.6 — 智谱主路径

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-07 |

**目标:** 智谱 glm-4.7-flash as NPC primary path + lore text fallback; factory zhipu provider.

**思路:** factory provider=zhipu + thinking disabled; NPC failure fallback OpenRouter; verify:llm-models probes zhipu.

**Key deliverables:** workers/agent-worker llm/factory.py; npc_loop zhipu default; scripts/verify-llm-models.mjs

**验收:** `pnpm verify:llm-models` · worker pytest

**技术决策:** 智谱 account concurrency = 1 constraint

**关联 ISSUE:** [ISSUE-032](../docs/ISSUE-LOG.md) root cause (zhipu concurrency)

---

### Phase 11.7 — LLM 角色路由

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-07 |

**目标:** Six-platform role-based LLM routing; 智谱 slot reserved for NPC tool-calling only.

**思路:** Social/Summarize/Collective → SiliconFlow Qwen3.5-4B; Importance → NVIDIA nano; Lore fallback → NVIDIA; NPC fallback → OpenRouter.

**Key deliverables:** docs/LLM-ROUTING.md; config.py role routing; .env.example six-platform blocks

**验收:** `pnpm verify:llm-models` · `pnpm agent:verify` · worker pytest

**关联 ISSUE:** [ISSUE-031](../docs/ISSUE-LOG.md), [ISSUE-032](../docs/ISSUE-LOG.md), [ISSUE-033](../docs/ISSUE-LOG.md)

---

### Phase 12 — 集体记忆

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-07 |

**目标:** Multi-player behavior toward NPCs writes shared collective memory; attitude observable.

**思路:** collective tables + dual speak events; AttitudeBandChip + hostile gate 403; worker tool_gate + memory tail.

**Key deliverables:** packages/npc-memory collective tables; apps/game-server/src/collective/*; AttitudeBandChip

**验收:** `VERIFY_PHASE12_FAST=1 pnpm verify:phase12`

**技术决策:** SOCL-01/02

---

### Phase 12.1 — LLM 社交感知

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-07 |

**目标:** Worker structured social perception + reply; server no longer dual-writes speak wordlists.

**思路:** SocialTurnOut → apply event → refresh band; score_social_perception structured turn; server action rules only for collective writes.

**Key deliverables:** worker social perception graph; uat-phase12.1-playwright.mjs; ISSUE-LOG Guardrails 59–60

**验收:** `pnpm uat:phase12.1:playwright` · `VERIFY_PHASE12_FAST=1 pnpm verify:phase12`

**技术决策:** Option B — worker-only social LLM

---

## 里程碑 v2 — 可玩的 AI 小镇

**交付：** 2026-06-09 · **阶段：** 12.2, 13, 13.1, 13.2, 13.3, 14, 14.1, 15

**里程碑思路：** 路径 1 核心 loop：探索 chunk → lore → NL → 集体态度 → 跨 session 记忆；Phaser 视觉可传播；speak 稳定可日常玩。

---

### Phase 12.2 — Speak 可靠性

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-07 |

**目标:** Eliminate 智谱 single-slot speak/E2E flakiness; multiplayer NL playable daily.

**思路:** NPC main dialogue → SiliconFlow Qwen3.5-4B; per-NPC serial + cross-NPC parallel; worker BRPOP FIFO + speakBusy no silent drop.

**Key deliverables:** llm_social_turn.py social degrade; main.py BRPOP + async memory tail; structured LLM call log

**验收:** `pnpm agent:verify --e2e` · `pnpm verify:phase8` · `pnpm verify:llm-models`

**技术决策:** STAB-02 — three consecutive E2E passes as sole ship gate

**关联 ISSUE:** [ISSUE-032](../docs/ISSUE-LOG.md) fixed; [ISSUE-022](../docs/ISSUE-LOG.md) guardrail (memory in worker tail only)

---

### Phase 13 — Phaser 世界视觉

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-08 |

**目标:** First screen upgrade from prototype discs to shareable Stardew-style tile + sprite + decor world.

**思路:** Tilemap replaces drawFloor; 4-dir walk/idle anim; Y-sort + proximity nameplate (VIS-04); area lazy preload + visualFallback.

**Key deliverables:** FloorRenderer + DecorRenderer; entitySprites + animations; ProximityNameplate

**验收:** `pnpm verify:phase13` · `pnpm uat:phase13:playwright` · `pnpm verify:phase6:move-only`

**技术决策:** 16×16 pixel tile pastoral; D-22 boot >5s warn / >8s fail

**关联 ISSUE:** [ISSUE-035](../docs/ISSUE-LOG.md), [ISSUE-036](../docs/ISSUE-LOG.md), [ISSUE-038](../docs/ISSUE-LOG.md)

---

### Phase 13.1 — 美术资源替换

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-08 |

**目标:** Replace placeholder art with CC0/LPC real pixel assets; aesthetic rubric AE-01…08.

**Key deliverables:** Kenney Tiny Town + Universal LPC import; pnpm art:import; CREDITS.md

**验收:** `pnpm verify:phase13` · `pnpm uat:phase13:playwright`

**技术决策:** TILE_PX=16, FRAMES_PER_FACING=6 contract

---

### Phase 13.2 — 农场美术

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-08 |

**目标:** Tiny Town 地球Online-style tiles replace Roguelike; life-sim aesthetic AE-08.

**Key deliverables:** pastoralTint.ts; pnpm art:import:farm; home-farm.png canonical screenshot

**验收:** `pnpm verify:phase13` · `pnpm uat:phase13:playwright`

**关联 ISSUE:** [ISSUE-039](../docs/ISSUE-LOG.md) (decor Y-sort)

---

### Phase 13.3 — 星露谷比例校准

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-08 |

**目标:** CELL_PX=48 integer scale + 16×32 character frames + Asset Bible.

**思路:** 16px source × 3 = 48px on-screen cell; LPC bbox crop bottom-align; logical 8×8 chunk map unchanged.

**验收:** `pnpm verify:phase13` · `pnpm uat:phase13:playwright` · `pnpm agent:verify`

**技术决策:** Colyseus coords remain integer grid cells; viewport 576×576

---

### Phase 14 — 有生命的 NPC

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-08 |

**目标:** Observable NPC life when player is not speaking — schedule + activity sync.

**思路:** game-server 6s ambient tick (no LLM in tick); accelerated game-day clock + ExploreCoordsStrip HUD; proximity activity sub-labels.

**Key deliverables:** ambient engine + schedule JSON; Colyseus activity + gameTime schema; Phaser activity labels

**验收:** `pnpm verify:phase14` · `pnpm --filter @aetherlife/game-server test`

**技术决策:** 1 real minute = 10 game minutes; speak/thinking pauses single NPC ambient

**已知债务:** Low-frequency lore/reflect enrichment → Phase 16

---

### Phase 14.1 — 被挡朝向

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-08 |

**目标:** WASD blocked still updates local idle facing; optional multiplayer facing sync.

**Key deliverables:** clientMovementPredictor onBlockedFace; move-handler facing-on-block; MP-MOV-05 in MOVEMENT-ARCHITECTURE.md

**验收:** `pnpm agent:verify` · `pnpm --filter @aetherlife/web test` · `pnpm verify:phase6:move-only`

**技术决策:** C-04 blocked-facing CONTRACTS row

**关联 ISSUE:** [ISSUE-040](../docs/ISSUE-LOG.md)

---

### Phase 15 — 小镇玩法 Loop

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-09 |

**目标:** Path 1 UAT-ready loop: explore → lore → NL → collective attitude → cross-session memory.

**Key deliverables:** JournalQuestStrip; CollectiveBrowsePanel + resolveCollectiveInitiatorPlayerId; ColyseusNpcJobDonePayload.memoryQuote

**验收:** `pnpm verify:phase15` · `pnpm uat:phase15:playwright` · `pnpm verify:phase13`

**技术决策:** initiator from playerIds, never text inference; memory write in worker tail only

**关联 ISSUE:** [ISSUE-022](../docs/ISSUE-LOG.md)

---

## 里程碑 v3 — 智能 Ambient 与 Speak SLA

**交付：** 2026-06-11 · **阶段：** 16, 17, 17.1（含 Phase 18 代码健康重构，2026-06-12）

**里程碑思路：** Tiled 可行走世界上的 zone/意图驱动漫游；异步 LLM intent；speak 热路径缓存加固 + 真实 LLM golden E2E。

---

### Phase 16 — 智能 Ambient NPC

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-11 |

**目标:** Scalable Tiled world with zone/intent-driven NPC wander; async LLM intent planner.

**思路:** WorldRegion registry + zone wander replaces waypoint ring; async intent job (schedule segment change + speak_end trigger); village-plaza@v1 cross-region + background NPC tier.

**Key deliverables:** WorldRegion + zones/pois/spawns; npc-ambient-intent BullMQ job; Tiled collision walkability

**验收:** `pnpm verify:phase16` · `pnpm agent:verify` · game-server test

**技术决策:** 6s tick ≤1 cell; no blocking LLM in tick; intent third-line UI abolished

**已知债务:** COZY-01 Metlivi economy deferred

**关联 ISSUE:** [ISSUE-043](../docs/ISSUE-LOG.md)

---

### Phase 17 — Speak 热路径 SLA

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-11 |

**目标:** worker-state / memory-context cache + internal latency observability; shorten speak hot path.

**思路:** skipNearbyLore default on speak hot path; memoryContextCache bounded TTL; stale snapshot fallback, no hard-fail.

**Key deliverables:** memoryContextCache.ts; skipNearbyLore default; internal-latency logs

**验收:** `pnpm agent:verify` · `pnpm agent:verify --e2e --base` · game-server test

**技术决策:** Infra SLA here; user-perceived SLA defined in v4 Phase 20

---

### Phase 17.1 — Speak 缓存加固

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-11 |

**目标:** Post-Phase-17 cache identity, invalidation, bounds, lore stampede hardening.

**Key deliverables:** internal-memories identity fix; memoryContextCache bounds; bridge.test.ts reset snap

**验收:** `pnpm agent:verify --e2e --base`

**技术决策:** Align C-01 internal player id

---

### Phase 18 — 代码健康重构

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-12 |
| **里程碑** | v3.1 |

**目标:** Reduce maintenance cost without behavior change — verify DRY + RoomScene/useNpcChat split.

**思路:** All verify-phase*.mjs → scripts/lib/env.mjs; useNpcChat pure functions → hooks/npcChat/; RoomScene split by camera/floor/input/sync/motion.

**Key deliverables:** scripts/lib/env.mjs; roomSceneSync.ts + submodules; hooks/npcChat/*

**验收:** `pnpm agent:verify` · `pnpm agent:verify --e2e --base` · `pnpm verify:phase13` · `pnpm verify:phase8`

**技术决策:** Frozen UX files untouched (ISSUE-037/038); RoomScene.ts ~1086 LOC post-split

**已知债务:** ISSUE-049 multiplayer reset; worker npc_loop.py split deferred

**关联 ISSUE:** [ISSUE-037](../docs/ISSUE-LOG.md), [ISSUE-038](../docs/ISSUE-LOG.md), [ISSUE-049](../docs/ISSUE-LOG.md)

---

## 里程碑 v4 — 自主人生闭环

**交付：** 2026-06-22 · **阶段：** 19–22 · **标签：** v4

**里程碑思路：** 全屏沉浸壳；跨 session 记忆口播；无任务条的世界回响；单人真实 LLM C1–C5 rubric ship gate。

---

### Phase 19 — 沉浸 UI 壳

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-13 |

**目标:** Full-screen immersive UI — Phaser fill + DialogueBar + ShellDrawer; remove NpcTabBar.

**思路:** 100dvh shell + Stardew wood-frame HUD; map click + NpcAvatarStrip replaces TabBar; drawer for history/collective.

**Key deliverables:** ImmersiveShell + DialogueBar + ShellDrawer; CornerMenu + NpcAvatarStrip; Phaser NPC hit-test

**验收:** `pnpm verify:phase19` · `pnpm verify:phase13` · `pnpm uat:phase8`

**技术决策:** useNpcChat speakBusy unchanged (Frozen ISSUE-037); JournalQuestStrip retained until Phase 21

**关联 ISSUE:** [ISSUE-037](../docs/ISSUE-LOG.md), [ISSUE-038](../docs/ISSUE-LOG.md), [ISSUE-041](../docs/ISSUE-LOG.md), [ISSUE-011](../docs/ISSUE-LOG.md)

---

### Phase 20 — 记忆与 Speak 信任

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-16 |

**目标:** Solo trust floor — cross-session memory in speech + user-perceived Speak SLA Tier-1 (not Phase 17 ms tables).

**思路:** recall_merge cross-session password/nickname; engageDialogue overlay-first measures T_think/T_first; SOLO-05 Tier-1 ship gates separate from Tier-2 audit.

**Key deliverables:** recall_merge.py + memory_quote; benchmark-speak-browser.mjs; SPEAK-SLA scorecard

**验收:** `pnpm verify:phase20` · `pnpm agent:verify`

**技术决策:** D-12 charter — Tier-1 verify+UAT ships; Tier-2 p95 audit only; assert-refusal-markers-parity JS↔Python

**关联 ISSUE:** [ISSUE-041](../docs/ISSUE-LOG.md), [ISSUE-050](../docs/ISSUE-LOG.md)

---

### Phase 21 — 世界回响

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-21 |

**目标:** Life-sim feel without quests — NL world traces; remove JournalQuestStrip; lore toast +「已发现」drawer.

**Key deliverables:** Remove JournalQuestStrip; LoreDiscoverToast; DiscoveredLorePanel drawer tab; 21-QUEST-LANGUAGE-AUDIT.md

**验收:** `pnpm verify:phase21` · `pnpm uat:phase21:playwright` · `pnpm verify:phase13`

**技术决策:** Non-quest copy gate; ISSUE-013 pending→ready toast split

**关联 ISSUE:** [ISSUE-013](../docs/ISSUE-LOG.md)

---

### Phase 22 — 单人人生门禁

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-22 |

**目标:** v4 ship gate — solo real-LLM C1–C5 rubric + SOLO-04/06 aggregate verification.

**思路:** pnpm verify:phase22 aggregates phase20+21+inline+golden; Collective rude auto-opens drawer + help no double-open (SOLO-04); Human UAT 10/10.

**Key deliverables:** scripts/verify-phase22.mjs aggregator; 22-UAT-MATRIX.md; v4 milestone closure

**验收:** `pnpm verify:phase22` · `pnpm agent:verify` · `pnpm agent:verify --e2e`

**技术决策:** WORLD_SEED=42 golden spawns; 5-step aggregator ~22min real LLM

---

## 里程碑 v5 — AI 议会（进行中）

**启动：** 2026-06-25（Phase 23）· **阶段：** 23–27 · **状态：** Phase 23 ✅；24–27 📋 规划中

**里程碑思路：** 将 NPC 从 3 个可对话角色升级为 12 人 AI 议会：世界编年史、多轮辩论表决、全员上地图、与世界历史双轨的个人主观传记时间线。

---

### Phase 23 — 议会人格基础

| | |
|---|---|
| **状态** | ✅ 已交付 |
| **完成** | 2026-06-25 |

**目标:** 12 council NPCs single source of truth registry + `__council__` memory scope; persona data layer for vote/map expansion.

**思路:** COUNCIL_PERSONAS SSOT + 12 dossiers；worker speak/vote 镜像经 `council-personas-speak.json` + `council-personas-compact.json`（`pnpm council:export-personas`）；pgvector `__council__` 与玩家 speak 记忆隔离。

**Key deliverables:** packages/shared/src/council/* + npcPersonas.ts; councilSeed.ts + C-07 CONTRACTS; CouncilRosterPanel drawer tab「星际议会」; 12 schedule JSON + personality seeds

**验收:** `pnpm agent:verify` · game-server test · worker pytest

**技术决策:** SPEAKABLE_NPC_IDS = npc-1..3 only; voting 4/3/5 against/for/swing split

**已知债务:** PERSONA-04 vote-time LTM E2E → Phase 25; PERSONA-02 live speak voice differentiation → human UAT

**关联 ISSUE:** [ISSUE-001](../docs/ISSUE-LOG.md), [ISSUE-022](../docs/ISSUE-LOG.md)

---

### Phase 24 — 世界历史编年史

| | |
|---|---|
| **状态** | 📋 规划中 |

**目标:** World history chronicle persistence + player-readable drawer panel; vote provenance and rejected-proposal history.

**思路:** world_history append-only migration; GET /rooms/:id/world-history + worker writeback; Colyseus worldHistorySync + WorldHistoryPanel.

**Key deliverables (planned):** world_history table + Drizzle schema; WorldHistoryPanel + useWorldHistory; minutes expand (full proposal + 12 votes); accepted/rejected toggle

**验收（规划）:** `pnpm agent:verify` · game-server test · web test

**技术决策:** CONTRACTS C-07 world-history API; proposer/voter display names from Phase 23 registry

---

### Phase 25 — 议会投票与辩论

| | |
|---|---|
| **状态** | 📋 规划中 |

**目标:** Background council loop — proposal → multi-round debate → vote → chronicle + memory writeback; relationship evolution foundation.

**思路:** world-vote BullMQ + Redis bridge; tick LPUSH only; worker world_vote.py ≤3 debate rounds + 11 votes; npc_relationships + applyRelationshipDeltas.

**Key deliverables (planned):** world_vote.py graph; npc_relationships migration;「议会审议中」UI + result toast; canon RAG back into speak

**验收（规划）:** `pnpm verify:phase25` · game-server test · worker pytest -k world_vote · `pnpm agent:verify --e2e`

**技术决策:** nvidia/agnes only; no 智谱 slot; CONTRACTS C-07 final + C-09 npc_relationships; REL-01…05

---

### Phase 26 — 议会地图存在

| | |
|---|---|
| **状态** | ✅ 已完成（2026-06-30） |

**目标:** All 12 council NPCs on map — Colyseus sync, Phaser render, all speakable + ambient.

**思路:** Schema supports 12 main NPCs (escape npc1/2/3 three-slot hardcode); 12 proximity speak + ambient schedule; speak persona injection with runtime relationships (REL-06).

**Key deliverables (planned):** Colyseus schema 12-NPC; RoomScene 12 entities + nameplates; DialogueBar accepts council registry id; v5 ship gate verify:phase26

**验收（规划）:** `pnpm verify:phase26` · `pnpm verify:phase13` · `pnpm agent:verify --e2e` · `pnpm uat:phase8`

**技术决策:** Largest schema change — INVARIANTS audit mandatory; VIS-04 frozen contract

**关联 ISSUE:** [ISSUE-037](../docs/ISSUE-LOG.md) (if useNpcChat touched)

---

### Phase 26.1 — LPC 角色视觉刷新（全员 LPC）

| | |
|---|---|
| **状态** | ✅ 已交付 (2026-07-01) |

**目标:** **所有玩家** + **`npc-1`…`npc-12`** 统一 LPC walk/idle；显示格 **CELL_PX=32**，角色高 **64px**（2 格）。

**产品决策:** **全员 LPC** — 玩家不再用 Stardew `characters.png` 四色 palette；议会 **`npc-1`…`npc-12`** 均用烘焙 `lpc-npc-*.png`（`npcs.png` 仅 legacy fallback）。

**交付物:** `scripts/sync-npc-lpc-assets.mjs` · `lpc-player-1.png` + `lpc-npc-{1…12}.png` · `lpcNpc1Sheet.ts` · 铭牌刷新（`sceneLabelLayout.ts`、宋体、无描边/底条）。

**2026-07-14 扩展:** 12 席议会 LPC 全量烘焙并接入运行时；`pnpm assets:sync:lpc-npcs`；`HomeMapBackground` Object Shadows depth 带 + `MAP_TILE_DEPTH_*`。

**验收:** `pnpm --filter @aetherlife/web test` · `pnpm verify:phase6:move-only` · `pnpm verify:phase13`

**技术决策:** `GRID_STEP_MS=200` · `useSpriteEntities()` 须 `spritesLpcNpc1` + `spritesNpcs`；Phase 13.3 的 48px 为历史记录，**运行时以 32px 为准** — Guardrails #106–#107 · [BEGINNING-FIELDS.md](../docs/BEGINNING-FIELDS.md) §角色视觉

---

### Phase 27 — 个人人生时间线

| | |
|---|---|
| **状态** | 📋 规划中 |

**目标:** Per-NPC subjective life timeline parallel to objective world history; LLM dynamic growth + cross-NPC multi-perspective.

**思路:** npc_personal_timeline append-only; 太乙 calendar + registry lifeNodes seeds; worker personal_timeline.py scheduled/event-driven generation.

**Key deliverables (planned):** packages/shared/src/personalTimeline.ts; npc_personal_timeline migration; biography drawer sub-tab; relationship delta → personal timeline entries (REL-07)

**验收（规划）:** `pnpm verify:phase27` · `pnpm agent:verify` · game-server test · worker pytest

**技术决策:** CONTRACTS C-08 draft personal-timeline API; reflect/lore routing; no 智谱 speak slot; eventAnchorId cross-NPC fact anchor

**已知债务:** Phase 28 REL advanced (decay/NPC-to-NPC chat/relationship graph) post-v5

---

## 全局暂缓项

| 项 | Phase | 原因 |
|-----------|-------|---------------|
| **Voice STT/TTS** | 09 | Cost + priority; planning complete, code not started |
| **SCALE-01** (8–16 players/room) | future | Post-v5 |
| **COZY / ECON** economy chain | future | Metlivi economy deferred from Phase 16 |
| **ISSUE-049** multiplayer shared reset | cross-cutting | POST /reset still resets shared RoomState |
| **Phase 28** advanced relationships | post-v5 | Decay, NPC-to-NPC chat, relationship graph |

---

## 如何验收

在仓库根目录运行。Phase 脚本需 `pnpm dev:stack` + 真实 LLM Key（verify:phase* 禁止 `LLM_MOCK=1`）。单测可用 mock LLM。

| 门禁 | Command |
|-------------|---------|
| Cloud connectivity | `pnpm verify:cloud` |
| Current v4 solo life | `pnpm verify:phase22` |
| Current v5 council (Phase 23) | `pnpm agent:verify` + game-server test + worker pytest |
| Golden flows (regression) | `pnpm agent:verify --e2e --base` |
| Full test suite | `pnpm turbo test` |

---

## Phase 索引（37 个）

| # | 名称 | 里程碑 | 状态 |
|---|------|-----------|--------|
| 01 | Foundation & Action Schema | v0 | ✅ |
| 02 | Single NPC Text Loop | v0 | ✅ |
| 03 | Persistent Memory | v0 | ✅ |
| 04 | Multi-NPC Text Room | v0 | ✅ |
| 05 | NL Gateway & Safety | v0 | ✅ |
| 06 | Colyseus & Movement | v1 | ✅ |
| 07 | 2.5D Renderer | v1 | ✅ |
| 08 | Multiplayer Room | v1 | ✅ |
| 09 | Voice Pipeline | v1 | ⏸ |
| 10 | Chunk Terrain | v1 | ✅ |
| 10.5 | Phaser Movement Sync | v1 | ✅ |
| 11 | LLM World Lore | v1 | ✅ |
| 11.6 | Zhipu GLM-4.7-Flash | v1 | ✅ |
| 11.7 | LLM Role Routing | v1 | ✅ |
| 12 | Collective Memory | v1 | ✅ |
| 12.1 | LLM Social Perception | v1 | ✅ |
| 12.2 | Speak Reliability | v2 | ✅ |
| 13 | Phaser World Visuals | v2 | ✅ |
| 13.1 | Phaser World Art Pass | v2 | ✅ |
| 13.2 | Farm Art Pass | v2 | ✅ |
| 13.3 | Stardew Scale Calibration | v2 | ✅ |
| 14 | Living NPCs | v2 | ✅ |
| 14.1 | Blocked Move Facing | v2 | ✅ |
| 15 | Town Play Loop | v2 | ✅ |
| 16 | Intelligent Ambient NPCs | v3 | ✅ |
| 17 | Speak Pre-LLM SLA | v3 | ✅ |
| 17.1 | Speak Cache Hardening | v3 | ✅ |
| 18 | Code Health Refactor | v3.1 | ✅ |
| 19 | Immersive UI Shell | v4 | ✅ |
| 20 | Memory & Speak Trust | v4 | ✅ |
| 21 | World Echo | v4 | ✅ |
| 22 | Solo Life Gate | v4 | ✅ |
| 23 | Council Persona Foundation | v5 | ✅ |
| 24 | World History Chronicle | v5 | 📋 |
| 25 | Council Vote & Debate | v5 | 📋 |
| 26 | Council Map Presence | v5 | 📋 |
| 27 | Personal Life Timeline | v5 | 📋 |

---

*维护者：Phase ship 或状态变更时更新本文档，并同步 README 项目状态表。*
