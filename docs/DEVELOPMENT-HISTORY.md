# Development History

**English** | [简体中文](./DEVELOPMENT-HISTORY.zh-CN.md)

**AetherLife** — phased delivery record from v0 (text loop) through v5 (AI Society).

This document synthesizes all **37 development phases** (including sub-phases). Each entry covers goal, rationale, deliverables, verification, tech decisions, known debt, and related issues.

**Last updated:** 2026-06-25

---

## Table of Contents

- [Timeline Overview](#timeline-overview)
- [Milestone v0 — Phase 0 Text Loop](#milestone-v0--phase-0-text-loop)
- [Milestone v1 — Graphics + Multiplayer + World](#milestone-v1--graphics--multiplayer--world)
- [Milestone v2 — Playable AI Town](#milestone-v2--playable-ai-town)
- [Milestone v3 — Intelligent Ambient + Speak SLA](#milestone-v3--intelligent-ambient--speak-sla)
- [Milestone v4 — Solo Life Loop](#milestone-v4--solo-life-loop)
- [Milestone v5 — AI Society (In Progress)](#milestone-v5--ai-society-in-progress)
- [Global Deferred Items](#global-deferred-items)
- [How to Verify](#how-to-verify)

---

## Timeline Overview

| Milestone | Phases | Status | Shipped |
|-----------|--------|--------|---------|
| **v0** Phase 0 text loop | 01–05 | ✅ Shipped | 2026-06-04 |
| **v1** Graphics + multiplayer + world | 06–08, 10–12.1 | ✅ Shipped | 2026-06-07 |
| **v2** Playable AI town | 12.2–15 | ✅ Shipped | 2026-06-09 |
| **v3** Intelligent ambient + Speak SLA | 16–17.1 | ✅ Shipped | 2026-06-11 |
| **v3.1** Code health | 18 | ✅ Shipped | 2026-06-12 |
| **v4** Solo life loop | 19–22 | ✅ Shipped | 2026-06-22 |
| **v5** AI Society / Council Worldview | 23–27 | 🔨 In progress | Phase 23 ✅ 2026-06-25 |

**v0→v4 arc:** Text-only Generative Agent loop → Colyseus multiplayer + Phaser world → visual polish + town play loop → ambient intelligence + speak reliability → immersive solo life with memory trust and world echo.

**v5 direction:** Expand from 3 speakable NPCs to a 12-member AI council with world chronicle, multi-round debate/vote, full map presence, and per-NPC personal life timelines.

---

## Milestone v0 — Phase 0 Text Loop

**Shipped:** 2026-06-04 · **Phases:** 01–05 · **Core value proven:** perceive → remember → act in text UI

---

### Phase 01 — Foundation & Action Schema

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-03 |

**Goal**

- Establish monorepo, cloud dev stack (Supabase + Upstash), and shared Zod action schema as the single contract for all LLM mutations.

**Rationale**

- Cloud Postgres/Redis lowers onboarding vs local Docker; Zod schema shared by game-server and worker prevents drift.

**Key deliverables**

- pnpm + Turborepo monorepo
- `packages/game-actions` Zod + OpenAI tools
- `scripts/verify-cloud.mjs`
- ai-gateway FastAPI `/health`
- `.env.example` Supabase/Upstash template

**Verification:** `pnpm verify:cloud` · `pnpm turbo test`

**Tech decisions:** INFR-01 cloud dev stack; INFR-02 game-actions as sole mutation schema

---

### Phase 02 — Single NPC Text Loop

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-04 |

**Goal**

- One NPC completes the Generative Agent loop in pure text UI — validates core product value.

**Rationale**

- LangGraph + BullMQ async worker; never block Colyseus on LLM; SSE drives thinking UX.

**Key deliverables**

- game-server room routes + SSE
- `workers/agent-worker` LangGraph `npc_loop.py`
- apps/web chat UI
- `scripts/verify-phase2.mjs`

**Verification:** `pnpm verify:phase2` · `cd workers/agent-worker && LLM_MOCK=1 uv run pytest -q`

**Tech decisions:** AGNT-01/03; INFR-03 LangSmith trace

---

### Phase 03 — Persistent Memory

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-03 |

**Goal**

- NPC memory survives restart/session; vector retrieval injects context; summarization prevents bloat.

**Rationale**

- pgvector + `@aetherlife/npc-memory`; top-k embedding retrieval; bulk summarize at ≥100 rows.

**Key deliverables**

- `packages/npc-memory` schema + migrations
- game-server MemoryService + internal API
- worker reflect/bulk summarize
- `scripts/verify-phase3.mjs`

**Verification:** `pnpm verify:phase3` · `pnpm verify:phase3 -- --seed-bulk=100`

**Tech decisions:** D-07 reset clears memory, keeps checkpoint; HNSW dropped for 2048-dim embed

**Known debt:** Dev embed latency p95 ~2–4s (production target <500ms not met at v0 close)

---

### Phase 04 — Multi-NPC Text Room

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-04 |

**Goal**

- 1–3 NPCs in one room with independent threads; player switches dialogue target.

**Rationale**

- Per-NPC LangGraph `thread_id`; NpcTabBar + memory panel for observability; `transfer` action between NPCs.

**Key deliverables**

- Multi-NPC room state
- `transfer` action + executor
- NpcMemoryPanel
- `scripts/verify-phase4.mjs`

**Verification:** `pnpm verify:phase4`

**Tech decisions:** AGNT-02/04

---

### Phase 05 — NL Gateway & Safety

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-04 |

**Goal**

- FastAPI unified NL ingress with Guardrails and thinking UX.

**Rationale**

- ai-gateway `/chat` + `/nl/parse` + ContentGuard; early thinking SSE; reply audit log.

**Key deliverables**

- apps/ai-gateway chat/parse/guard
- game-server thinking hooks
- web `/v1` proxy
- `scripts/verify-phase5.mjs`

**Verification:** `pnpm verify:phase5` · `cd apps/ai-gateway && uv run pytest tests -q`

**Tech decisions:** SAFE-01…03

**Known debt:** Direct gs `/chat` bypass, public audit-log, no rate limit — documented accepted risks in 05-SECURITY.md

---

## Milestone v1 — Graphics + Multiplayer + World

**Shipped:** 2026-06-07 · **Phases:** 06–08, 10, 10.5, 11, 11.6, 11.7, 12, 12.1 (Phase 09 deferred)

**milestone rationale:** Extend v0 text loop into graphical multiplayer: Colyseus sync, Phaser renderer, procedural chunks, LLM lore, collective memory + worker social perception.

---

### Phase 06 — Colyseus & Movement

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-03 |
| **Milestone** | v1 |

**Goal:** Authoritative game-server; player movement sync; foundation for graphics/multiplayer.

**Rationale:** Colyseus GameRoom server-authoritative move; 20Hz tick; speak → BullMQ async, never block room.

**Key deliverables:** GameRoom.ts + schema.ts + move-handler.ts; useColyseusRoom + MovementPanel; useNpcChat speak/broadcast

**Verification:** `pnpm verify:phase6` · `pnpm uat:phase6:playwright`

**Tech decisions:** D-01 same port HTTP+WS; D-04 broadcast not SSE on web; D-20 WASD + click grid

---

### Phase 07 — 2.5D Renderer

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-04 |

**Goal:** Phaser 4 top-down 8×8 room; player + NPC sprites bound to Colyseus/REST; MovementPanel fallback.

**Rationale:** Phaser 4 RoomScene + React PhaserGame; probePhaserBoot + fallback path on WebGL failure.

**Key deliverables:** RoomScene.ts + PhaserGame.tsx; gridLayout.ts + theme.ts; npcReply sanitize

**Verification:** `pnpm verify:phase7` · `pnpm uat:phase7:reset-snap`

**Related issues:** [ISSUE-002](../docs/ISSUE-LOG.md) (reset flushSync order)

---

### Phase 08 — Multiplayer Room

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-05 |

**Goal:** 4 players per room + async NPC AI patch without race conditions.

**Rationale:** maxClients=4 + clientSeq/moveAck prediction; speak queue + speakBusy per NPC; stateVersion monotonic AI patch.

**Key deliverables:** GameRoom speak queue + moveAck; applyStatePatch.ts; contentGuard speak blocklist

**Verification:** `pnpm verify:phase8` · `pnpm uat:phase8:playwright` · `pnpm verify:phase8:soak`

**Tech decisions:** SYNC-02…04; X-Player-Id / initiatorPlayerId foundation

**Known debt:** E2E flaky under 智谱 concurrency=1 → fixed in Phase 12.2 ([ISSUE-032](../docs/ISSUE-LOG.md))

---

### Phase 09 — Voice Pipeline

| | |
|---|---|
| **Status** | ⏸ Deferred |
| **Decision date** | 2026-06-05 |

**Goal:** STT/TTS immersive voice (PTT → speak path → TTS for initiator only).

**Rationale:** Planning complete (CONTEXT/UI-SPEC/4-wave PLAN) but not executed; prioritized world/multiplayer slices; voice needs GPU hosting or paid API cost.

**Key deliverables (planned only):** 09-CONTEXT.md + 09-UI-SPEC.md; 09-01…04-PLAN.md — **no apps/ voice code**

**Verification:** — (not implemented)

**Tech decisions:** D-02 PTT + Colyseus speak primary path; self-hosted Speaches/Kokoro preferred architecture

**Known debt:** VOICE-01/02 fully deferred; resume conditions documented in phase 09 status

---

### Phase 10 — Chunk Terrain

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-05 |

**Goal:** Seed-driven chunk load/unload + DB delta persistence.

**Rationale:** ChunkLoader 3×3 window + LRU; door delta persist on re-enter; Colyseus global coords + chunksSync.

**Key deliverables:** chunk-loader.ts; world_chunk_deltas migration; `scripts/verify-phase10.mjs`

**Verification:** `pnpm verify:phase10` · `pnpm uat:phase10:playwright`

**Tech decisions:** WORLD-01; WORLD-03

**Known debt:** LLM lore → Phase 11; tile sprite atlas → art pass (Phase 13)

---

### Phase 10.5 — Phaser Movement Sync

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-05 |

**Goal:** Phaser-first movement orchestration; RoomScene owns input→sync; eliminate React onMove vs explore tick races.

**Rationale:** RoomScene.setupInput → movementSync; remove useColyseusRoom setInterval explore tick; MP-MOV-02 shouldSuppressLocalSchemaSnap gate.

**Key deliverables:** docs/MOVEMENT-ARCHITECTURE.md; localPlayerSchemaSnap.ts; verify-phase6 move-only gate

**Verification:** `pnpm verify:phase6:move-only` · `pnpm --filter @aetherlife/shared test`

**Tech decisions:** Phaser-first movement; registry changedata explore coords

---

### Phase 11 — LLM World Lore

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-06 |

**Goal:** Async LLM metadata on first chunk enter; persisted cache.

**Rationale:** lore-orchestrator + lore_loop.py async job; Postgres chunk_lore cache hit skips repeat LLM; ExploreStrip + lore toast.

**Key deliverables:** lore-orchestrator.ts; lore_loop.py; ExploreStrip + toast

**Verification:** `pnpm verify:phase11` · `pnpm uat:phase11:playwright`

**Tech decisions:** WORLD-02; dedup poll in verify script

---

### Phase 11.6 — Zhipu GLM-4.7-Flash

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-07 |

**Goal:** 智谱 glm-4.7-flash as NPC primary path + lore text fallback; factory zhipu provider.

**Rationale:** factory provider=zhipu + thinking disabled; NPC failure fallback OpenRouter; verify:llm-models probes zhipu.

**Key deliverables:** workers/agent-worker llm/factory.py; npc_loop zhipu default; scripts/verify-llm-models.mjs

**Verification:** `pnpm verify:llm-models` · worker pytest

**Tech decisions:** 智谱 account concurrency = 1 constraint

**Related issues:** [ISSUE-032](../docs/ISSUE-LOG.md) root cause (zhipu concurrency)

---

### Phase 11.7 — LLM Role Routing

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-07 |

**Goal:** Six-platform role-based LLM routing; 智谱 slot reserved for NPC tool-calling only.

**Rationale:** Social/Summarize/Collective → SiliconFlow Qwen3.5-4B; Importance → NVIDIA nano; Lore fallback → NVIDIA; NPC fallback → OpenRouter.

**Key deliverables:** docs/LLM-ROUTING.md; config.py role routing; .env.example six-platform blocks

**Verification:** `pnpm verify:llm-models` · `pnpm agent:verify` · worker pytest

**Related issues:** [ISSUE-031](../docs/ISSUE-LOG.md), [ISSUE-032](../docs/ISSUE-LOG.md), [ISSUE-033](../docs/ISSUE-LOG.md)

---

### Phase 12 — Collective Memory

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-07 |

**Goal:** Multi-player behavior toward NPCs writes shared collective memory; attitude observable.

**Rationale:** collective tables + dual speak events; AttitudeBandChip + hostile gate 403; worker tool_gate + memory tail.

**Key deliverables:** packages/npc-memory collective tables; apps/game-server/src/collective/*; AttitudeBandChip

**Verification:** `VERIFY_PHASE12_FAST=1 pnpm verify:phase12`

**Tech decisions:** SOCL-01/02

---

### Phase 12.1 — LLM Social Perception

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-07 |

**Goal:** Worker structured social perception + reply; server no longer dual-writes speak wordlists.

**Rationale:** SocialTurnOut → apply event → refresh band; score_social_perception structured turn; server action rules only for collective writes.

**Key deliverables:** worker social perception graph; uat-phase12.1-playwright.mjs; ISSUE-LOG Guardrails 59–60

**Verification:** `pnpm uat:phase12.1:playwright` · `VERIFY_PHASE12_FAST=1 pnpm verify:phase12`

**Tech decisions:** Option B — worker-only social LLM

---

## Milestone v2 — Playable AI Town

**Shipped:** 2026-06-09 · **Phases:** 12.2, 13, 13.1, 13.2, 13.3, 14, 14.1, 15

**milestone rationale:** Path 1 core loop — explore chunk → lore → NL → collective → cross-session memory; Phaser visuals shareable; speak reliability for daily play.

---

### Phase 12.2 — Speak Reliability

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-07 |

**Goal:** Eliminate 智谱 single-slot speak/E2E flakiness; multiplayer NL playable daily.

**Rationale:** NPC main dialogue → SiliconFlow Qwen3.5-4B; per-NPC serial + cross-NPC parallel; worker BRPOP FIFO + speakBusy no silent drop.

**Key deliverables:** llm_social_turn.py social degrade; main.py BRPOP + async memory tail; structured LLM call log

**Verification:** `pnpm agent:verify --e2e` · `pnpm verify:phase8` · `pnpm verify:llm-models`

**Tech decisions:** STAB-02 — three consecutive E2E passes as sole ship gate

**Related issues:** [ISSUE-032](../docs/ISSUE-LOG.md) fixed; [ISSUE-022](../docs/ISSUE-LOG.md) guardrail (memory in worker tail only)

---

### Phase 13 — Phaser World Visuals

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-08 |

**Goal:** First screen upgrade from prototype discs to shareable Stardew-style tile + sprite + decor world.

**Rationale:** Tilemap replaces drawFloor; 4-dir walk/idle anim; Y-sort + proximity nameplate (VIS-04); area lazy preload + visualFallback.

**Key deliverables:** FloorRenderer + DecorRenderer; entitySprites + animations; ProximityNameplate

**Verification:** `pnpm verify:phase13` · `pnpm uat:phase13:playwright` · `pnpm verify:phase6:move-only`

**Tech decisions:** 16×16 pixel tile pastoral; D-22 boot >5s warn / >8s fail

**Related issues:** [ISSUE-035](../docs/ISSUE-LOG.md), [ISSUE-036](../docs/ISSUE-LOG.md), [ISSUE-038](../docs/ISSUE-LOG.md)

---

### Phase 13.1 — Phaser World Art Pass

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-08 |

**Goal:** Replace placeholder art with CC0/LPC real pixel assets; aesthetic rubric AE-01…08.

**Key deliverables:** Kenney Tiny Town + Universal LPC import; pnpm art:import; CREDITS.md

**Verification:** `pnpm verify:phase13` · `pnpm uat:phase13:playwright`

**Tech decisions:** TILE_PX=16, FRAMES_PER_FACING=6 contract

---

### Phase 13.2 — Farm Art Pass

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-08 |

**Goal:** Tiny Town 地球Online-style tiles replace Roguelike; life-sim aesthetic AE-08.

**Key deliverables:** pastoralTint.ts; pnpm art:import:farm; home-farm.png canonical screenshot

**Verification:** `pnpm verify:phase13` · `pnpm uat:phase13:playwright`

**Related issues:** [ISSUE-039](../docs/ISSUE-LOG.md) (decor Y-sort)

---

### Phase 13.3 — Stardew Scale Calibration

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-08 |

**Goal:** CELL_PX=48 integer scale + 16×32 character frames + Asset Bible.

**Rationale:** 16px source × 3 = 48px on-screen cell; LPC bbox crop bottom-align; logical 8×8 chunk map unchanged.

**Verification:** `pnpm verify:phase13` · `pnpm uat:phase13:playwright` · `pnpm agent:verify`

**Tech decisions:** Colyseus coords remain integer grid cells; viewport 576×576

---

### Phase 14 — Living NPCs

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-08 |

**Goal:** Observable NPC life when player is not speaking — schedule + activity sync.

**Rationale:** game-server 6s ambient tick (no LLM in tick); accelerated game-day clock + ExploreCoordsStrip HUD; proximity activity sub-labels.

**Key deliverables:** ambient engine + schedule JSON; Colyseus activity + gameTime schema; Phaser activity labels

**Verification:** `pnpm verify:phase14` · `pnpm --filter @aetherlife/game-server test`

**Tech decisions:** 1 real minute = 10 game minutes; speak/thinking pauses single NPC ambient

**Known debt:** Low-frequency lore/reflect enrichment → Phase 16

---

### Phase 14.1 — Blocked Move Facing

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-08 |

**Goal:** WASD blocked still updates local idle facing; optional multiplayer facing sync.

**Key deliverables:** clientMovementPredictor onBlockedFace; move-handler facing-on-block; MP-MOV-05 in MOVEMENT-ARCHITECTURE.md

**Verification:** `pnpm agent:verify` · `pnpm --filter @aetherlife/web test` · `pnpm verify:phase6:move-only`

**Tech decisions:** C-04 blocked-facing CONTRACTS row

**Related issues:** [ISSUE-040](../docs/ISSUE-LOG.md)

---

### Phase 15 — Town Play Loop

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-09 |

**Goal:** Path 1 UAT-ready loop: explore → lore → NL → collective attitude → cross-session memory.

**Key deliverables:** JournalQuestStrip; CollectiveBrowsePanel + resolveCollectiveInitiatorPlayerId; ColyseusNpcJobDonePayload.memoryQuote

**Verification:** `pnpm verify:phase15` · `pnpm uat:phase15:playwright` · `pnpm verify:phase13`

**Tech decisions:** initiator from playerIds, never text inference; memory write in worker tail only

**Related issues:** [ISSUE-022](../docs/ISSUE-LOG.md)

---

## Milestone v3 — Intelligent Ambient + Speak SLA

**Shipped:** 2026-06-11 · **Phases:** 16, 17, 17.1 (+ Phase 18 v3.1 maintenance 2026-06-12)

**milestone rationale:** Zone/intent-driven NPC wander on Tiled walkability; async LLM intent planner; speak pre-LLM cache hardening with real-LLM golden E2E.

---

### Phase 16 — Intelligent Ambient NPCs

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-11 |

**Goal:** Scalable Tiled world with zone/intent-driven NPC wander; async LLM intent planner.

**Rationale:** WorldRegion registry + zone wander replaces waypoint ring; async intent job (schedule segment change + speak_end trigger); village-plaza@v1 cross-region + background NPC tier.

**Key deliverables:** WorldRegion + zones/pois/spawns; npc-ambient-intent BullMQ job; Tiled collision walkability

**Verification:** `pnpm verify:phase16` · `pnpm agent:verify` · game-server test

**Tech decisions:** 6s tick ≤1 cell; no blocking LLM in tick; intent third-line UI abolished

**Known debt:** COZY-01 Metlivi economy deferred

**Related issues:** [ISSUE-043](../docs/ISSUE-LOG.md)

---

### Phase 17 — Speak Pre-LLM SLA

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-11 |

**Goal:** worker-state / memory-context cache + internal latency observability; shorten speak hot path.

**Rationale:** skipNearbyLore default on speak hot path; memoryContextCache bounded TTL; stale snapshot fallback, no hard-fail.

**Key deliverables:** memoryContextCache.ts; skipNearbyLore default; internal-latency logs

**Verification:** `pnpm agent:verify` · `pnpm agent:verify --e2e --base` · game-server test

**Tech decisions:** Infra SLA here; user-perceived SLA defined in v4 Phase 20

---

### Phase 17.1 — Speak Cache Hardening

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-11 |

**Goal:** Post-Phase-17 cache identity, invalidation, bounds, lore stampede hardening.

**Key deliverables:** internal-memories identity fix; memoryContextCache bounds; bridge.test.ts reset snap

**Verification:** `pnpm agent:verify --e2e --base`

**Tech decisions:** Align C-01 internal player id

---

### Phase 18 — Code Health Refactor

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-12 |
| **Milestone** | v3.1 |

**Goal:** Reduce maintenance cost without behavior change — verify DRY + RoomScene/useNpcChat split.

**Rationale:** All verify-phase*.mjs → scripts/lib/env.mjs; useNpcChat pure functions → hooks/npcChat/; RoomScene split by camera/floor/input/sync/motion.

**Key deliverables:** scripts/lib/env.mjs; roomSceneSync.ts + submodules; hooks/npcChat/*

**Verification:** `pnpm agent:verify` · `pnpm agent:verify --e2e --base` · `pnpm verify:phase13` · `pnpm verify:phase8`

**Tech decisions:** Frozen UX files untouched (ISSUE-037/038); RoomScene.ts ~1086 LOC post-split

**Known debt:** ISSUE-049 multiplayer reset; worker npc_loop.py split deferred

**Related issues:** [ISSUE-037](../docs/ISSUE-LOG.md), [ISSUE-038](../docs/ISSUE-LOG.md), [ISSUE-049](../docs/ISSUE-LOG.md)

---

## Milestone v4 — Solo Life Loop

**Shipped:** 2026-06-22 · **Phases:** 19–22 · **Tag:** v4

**milestone rationale:** Full-viewport immersive shell; cross-session memory recall in speech; world echo without quest strip; solo life ship gate with real-LLM C1–C5 rubric.

---

### Phase 19 — Immersive UI Shell

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-13 |

**Goal:** Full-screen immersive UI — Phaser fill + DialogueBar + ShellDrawer; remove NpcTabBar.

**Rationale:** 100dvh shell + Stardew wood-frame HUD; map click + NpcAvatarStrip replaces TabBar; drawer for history/collective.

**Key deliverables:** ImmersiveShell + DialogueBar + ShellDrawer; CornerMenu + NpcAvatarStrip; Phaser NPC hit-test

**Verification:** `pnpm verify:phase19` · `pnpm verify:phase13` · `pnpm uat:phase8`

**Tech decisions:** useNpcChat speakBusy unchanged (Frozen ISSUE-037); JournalQuestStrip retained until Phase 21

**Related issues:** [ISSUE-037](../docs/ISSUE-LOG.md), [ISSUE-038](../docs/ISSUE-LOG.md), [ISSUE-041](../docs/ISSUE-LOG.md), [ISSUE-011](../docs/ISSUE-LOG.md)

---

### Phase 20 — Memory & Speak Trust

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-16 |

**Goal:** Solo trust floor — cross-session memory in speech + user-perceived Speak SLA Tier-1 (not Phase 17 ms tables).

**Rationale:** recall_merge cross-session password/nickname; engageDialogue overlay-first measures T_think/T_first; SOLO-05 Tier-1 ship gates separate from Tier-2 audit.

**Key deliverables:** recall_merge.py + memory_quote; benchmark-speak-browser.mjs; SPEAK-SLA scorecard

**Verification:** `pnpm verify:phase20` · `pnpm agent:verify`

**Tech decisions:** D-12 charter — Tier-1 verify+UAT ships; Tier-2 p95 audit only; assert-refusal-markers-parity JS↔Python

**Related issues:** [ISSUE-041](../docs/ISSUE-LOG.md), [ISSUE-050](../docs/ISSUE-LOG.md)

---

### Phase 21 — World Echo

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-21 |

**Goal:** Life-sim feel without quests — NL world traces; remove JournalQuestStrip; lore toast +「已发现」drawer.

**Key deliverables:** Remove JournalQuestStrip; LoreDiscoverToast; DiscoveredLorePanel drawer tab; 21-QUEST-LANGUAGE-AUDIT.md

**Verification:** `pnpm verify:phase21` · `pnpm uat:phase21:playwright` · `pnpm verify:phase13`

**Tech decisions:** Non-quest copy gate; ISSUE-013 pending→ready toast split

**Related issues:** [ISSUE-013](../docs/ISSUE-LOG.md)

---

### Phase 22 — Solo Life Gate

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-22 |

**Goal:** v4 ship gate — solo real-LLM C1–C5 rubric + SOLO-04/06 aggregate verification.

**Rationale:** pnpm verify:phase22 aggregates phase20+21+inline+golden; Collective rude auto-opens drawer + help no double-open (SOLO-04); Human UAT 10/10.

**Key deliverables:** scripts/verify-phase22.mjs aggregator; 22-UAT-MATRIX.md; v4 milestone closure

**Verification:** `pnpm verify:phase22` · `pnpm agent:verify` · `pnpm agent:verify --e2e`

**Tech decisions:** WORLD_SEED=42 golden spawns; 5-step aggregator ~22min real LLM

---

## Milestone v5 — AI Society (In Progress)

**Started:** 2026-06-25 (Phase 23) · **Phases:** 23–27 · **Status:** Phase 23 ✅; 24–27 📋 Planned

**milestone rationale:** Upgrade NPCs from 3 speakable characters to a 12-member AI council with world chronicle, multi-round debate/vote, full map presence, and per-NPC subjective life timelines parallel to objective world history.

---

### Phase 23 — Council Persona Foundation

| | |
|---|---|
| **Status** | ✅ Shipped |
| **Completed** | 2026-06-25 |

**Goal:** 12 council NPCs single source of truth registry + `__council__` memory scope; persona data layer for vote/map expansion.

**Rationale:** COUNCIL_PERSONAS SSOT + 12 dossiers; worker speak/vote mirrors via `council-personas-speak.json` + `council-personas-compact.json` (`pnpm council:export-personas`); pgvector `__council__` isolated from player speak memory.

**Key deliverables:** packages/shared/src/council/* + npcPersonas.ts; councilSeed.ts + C-07 CONTRACTS; CouncilRosterPanel drawer tab「星际议会」; 12 schedule JSON + personality seeds

**Verification:** `pnpm agent:verify` · game-server test · worker pytest

**Tech decisions:** SPEAKABLE_NPC_IDS = npc-1..3 only; voting 4/3/5 against/for/swing split

**Known debt:** PERSONA-04 vote-time LTM E2E → Phase 25; PERSONA-02 live speak voice differentiation → human UAT

**Related issues:** [ISSUE-001](../docs/ISSUE-LOG.md), [ISSUE-022](../docs/ISSUE-LOG.md)

---

### Phase 24 — World History Chronicle

| | |
|---|---|
| **Status** | 📋 Planned |

**Goal:** World history chronicle persistence + player-readable drawer panel; vote provenance and rejected-proposal history.

**Rationale:** world_history append-only migration; GET /rooms/:id/world-history + worker writeback; Colyseus worldHistorySync + WorldHistoryPanel.

**Key deliverables (planned):** world_history table + Drizzle schema; WorldHistoryPanel + useWorldHistory; minutes expand (full proposal + 12 votes); accepted/rejected toggle

**Verification (planned):** `pnpm agent:verify` · game-server test · web test

**Tech decisions:** CONTRACTS C-07 world-history API; proposer/voter display names from Phase 23 registry

---

### Phase 25 — Council Vote & Debate

| | |
|---|---|
| **Status** | 📋 Planned |

**Goal:** Background council loop — proposal → multi-round debate → vote → chronicle + memory writeback; relationship evolution foundation.

**Rationale:** world-vote BullMQ + Redis bridge; tick LPUSH only; worker world_vote.py ≤3 debate rounds + 11 votes; npc_relationships + applyRelationshipDeltas.

**Key deliverables (planned):** world_vote.py graph; npc_relationships migration;「议会审议中」UI + result toast; canon RAG back into speak

**Verification (planned):** `pnpm verify:phase25` · game-server test · worker pytest -k world_vote · `pnpm agent:verify --e2e`

**Tech decisions:** nvidia/agnes only; no 智谱 slot; CONTRACTS C-07 final + C-09 npc_relationships; REL-01…05

---

### Phase 26 — Council Map Presence

| | |
|---|---|
| **Status** | ✅ Complete (2026-06-30) |

**Goal:** All 12 council NPCs on map — Colyseus sync, Phaser render, all speakable + ambient.

**Rationale:** Schema supports 12 main NPCs (escape npc1/2/3 three-slot hardcode); 12 proximity speak + ambient schedule; speak persona injection with runtime relationships (REL-06).

**Key deliverables (planned):** Colyseus schema 12-NPC; RoomScene 12 entities + nameplates; DialogueBar accepts council registry id; v5 ship gate verify:phase26

**Verification (planned):** `pnpm verify:phase26` · `pnpm verify:phase13` · `pnpm agent:verify --e2e` · `pnpm uat:phase8`

**Tech decisions:** Largest schema change — INVARIANTS audit mandatory; VIS-04 frozen contract

**Related issues:** [ISSUE-037](../docs/ISSUE-LOG.md) (if useNpcChat touched)

---

### Phase 26.1 — LPC Character Visual Refresh（全员 LPC）

| | |
|---|---|
| **Status** | ✅ Shipped (2026-07-01) |

**Goal:** Unify **all players** + **npc-1** on LPC walk/idle sprite; rescale grid to **CELL_PX=32** with **64px** character height (2 cells).

**Product decision:** **全员 LPC** — no Stardew `characters.png` palette rows for players; council NPCs `npc-2`…`npc-12` remain on `npcs.png`.

**Key deliverables:** `scripts/sync-npc-lpc-assets.mjs` · `lpc-npc-1.png` · `lpcNpc1Sheet.ts` · `entitySprites` LPC path · nameplate refresh (`sceneLabelLayout.ts`, Songti, no stroke/backdrop).

**Verification:** `pnpm --filter @aetherlife/web test` · `pnpm verify:phase6:move-only` · `pnpm verify:phase13`

**Tech decisions:** `GRID_STEP_MS=200` · `useSpriteEntities()` requires `spritesLpcNpc1` + `spritesNpcs`; Phase 13.3 48px record superseded at runtime — see Guardrails #106–#107 · [BEGINNING-FIELDS.md](../docs/BEGINNING-FIELDS.md) §角色视觉

---

### Phase 27 — Personal Life Timeline

| | |
|---|---|
| **Status** | 📋 Planned |

**Goal:** Per-NPC subjective life timeline parallel to objective world history; LLM dynamic growth + cross-NPC multi-perspective.

**Rationale:** npc_personal_timeline append-only; 太乙 calendar + registry lifeNodes seeds; worker personal_timeline.py scheduled/event-driven generation.

**Key deliverables (planned):** packages/shared/src/personalTimeline.ts; npc_personal_timeline migration; biography drawer sub-tab; relationship delta → personal timeline entries (REL-07)

**Verification (planned):** `pnpm verify:phase27` · `pnpm agent:verify` · game-server test · worker pytest

**Tech decisions:** CONTRACTS C-08 draft personal-timeline API; reflect/lore routing; no 智谱 speak slot; eventAnchorId cross-NPC fact anchor

**Known debt:** Phase 28 REL advanced (decay/NPC-to-NPC chat/relationship graph) post-v5

---

## Global Deferred Items

| Item | Phase | Reason |
|-----------|-------|---------------|
| **Voice STT/TTS** | 09 | Cost + priority; planning complete, code not started |
| **SCALE-01** (8–16 players/room) | future | Post-v5 |
| **COZY / ECON** economy chain | future | Metlivi economy deferred from Phase 16 |
| **ISSUE-049** multiplayer shared reset | cross-cutting | POST /reset still resets shared RoomState |
| **Phase 28** advanced relationships | post-v5 | Decay, NPC-to-NPC chat, relationship graph |

---

## How to Verify

Run from repo root. Phase scripts require `pnpm dev:stack` + real LLM keys (never `LLM_MOCK=1` for verify:phase*). Unit tests may use mock LLM.

| Gate | Command |
|-------------|---------|
| Cloud connectivity | `pnpm verify:cloud` |
| Current v4 solo life | `pnpm verify:phase22` |
| Current v5 council (Phase 23) | `pnpm agent:verify` + game-server test + worker pytest |
| Golden flows (regression) | `pnpm agent:verify --e2e --base` |
| Full test suite | `pnpm turbo test` |

When v5 ships Phase 25/26, add `pnpm verify:phase25` and `pnpm verify:phase26` to this table.

v5 ship 后 Phase 25/26 须在本表加入 `pnpm verify:phase25` 与 `pnpm verify:phase26`。

---

## Phase Index

| # | Name | Milestone | Status |
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

*Maintainers: update this document when a phase ships or status changes. Sync README Project Status table accordingly.*


*Maintainers: update when a phase ships. Sync README Project Status accordingly.*
