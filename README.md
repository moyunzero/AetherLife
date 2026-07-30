# AetherLife

[![CI](https://github.com/moyunzero/AetherLife/actions/workflows/ci.yml/badge.svg)](https://github.com/moyunzero/AetherLife/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**English** | [简体中文](./README.zh-CN.md)

AI-driven multiplayer life-simulation web game: guide memory-bearing NPCs through natural language in a procedural pixel world. Colyseus handles authoritative sync; LangGraph workers run async NPC turns with persistent pgvector memory.

## Table of Contents

- [About](#about)
- [Project Status](#project-status)
- [Demo](#demo)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Map debugging](#map-debugging)
- [Architecture](#architecture)
- [Testing](#testing)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Asset Credits](#asset-credits)
- [License](#license)

## About

Players explore a Stardew-inspired 2D world, discover LLM-generated lore, and shape NPC collective attitudes through dialogue and actions. The core loop—**perceive → remember → reflect → act**—must be verifiable in every session. Since v4, quest-strip UI was removed in favor of ambient world echo.

**Target audience:** Life-sim fans (*The Sims*, *Animal Crossing*, *Minecraft*), AI enthusiasts, and narrative-driven multiplayer players.

## Project Status

| Milestone | Phases | Status | Shipped |
|-----------|--------|--------|---------|
| **v0** Phase 0 text loop | 01–05 | ✅ Shipped | 2026-06-04 |
| **v1** Graphics + multiplayer + world | 06–08, 10–12.1 (09 deferred) | ✅ Shipped | 2026-06-07 |
| **v2** Playable AI town | 12.2–15 | ✅ Shipped | 2026-06-09 |
| **v3** Intelligent ambient + Speak SLA | 16–17.1, 18 | ✅ Shipped | 2026-06-11 |
| **v4** Solo life loop | 19–22 | ✅ Shipped | 2026-06-22 |
| **v5** AI Society / Council Worldview | 23–27 | 🔨 In progress | 23–26 ✅ · **27 next** |
| **Deferred** Voice pipeline | 09 | ⏸ Deferred | — |

Phases 23–26 shipped (persona · chronicle · vote/debate · map + LPC). **Next:** Phase 27 Personal Life Timeline — see [`.planning/STATE.md`](./.planning/STATE.md).

→ **[Development History](./docs/DEVELOPMENT-HISTORY.md)** · [简体中文](./docs/DEVELOPMENT-HISTORY.zh-CN.md)

## Demo

| | |
|---|---|
| **Local** | [http://localhost:5173](http://localhost:5173) — run `pnpm dev:stack` |
| **Screenshots** | _Coming soon_ |
| **Public deploy** | _Not yet available_ |

## Features

- **Multiplayer** — Colyseus authoritative sync, up to 4 players per room
- **Natural language** — ai-gateway parses intent; worker runs async NPC turns
- **Persistent memory** — Postgres + pgvector; NPCs remember and adapt
- **Phaser 4 world** — Grid movement, procedural chunks, world lore
- **Intelligent ambient NPCs (v3)** — Schedule/zone wander, async LLM intent, Tiled collision
- **Speak SLA (v3)** — worker-state cache, stale fallback, multi-tab speak
- **Collective attitude** — NPC group attitude evolves with player behavior
- **Council (v5)** — 12-NPC personas, world chronicle, vote/debate, map presence (Phases 23–26); personal timeline next (27)

## Tech Stack

| Layer | Technology |
|-------|------------|
| Client | React 19 · Vite · Phaser 4 |
| Realtime | Colyseus · SSE |
| AI | LangGraph worker · FastAPI gateway |
| Data | Supabase Postgres · Upstash Redis |

Monorepo: `apps/web` · `apps/game-server` · `apps/ai-gateway` · `workers/agent-worker` · `packages/*`

## Quick Start

### Prerequisites

- Node.js 20+, pnpm 9+ (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- [Supabase](https://supabase.com) project (Postgres + `CREATE EXTENSION vector`)
- [Upstash](https://upstash.com) Redis
- Python 3.12+, [uv](https://docs.astral.sh/uv/) (ai-gateway / worker)
- LLM API keys (see `.env.example`; production defaults: **NVIDIA NIM** NPC primary, **Groq** social JSON, OpenRouter embed)

### Install & run

```bash
git clone https://github.com/moyunzero/AetherLife.git
cd AetherLife
pnpm install
cp .env.example .env   # fill DATABASE_URL, REDIS_URL, LLM keys
pnpm verify:cloud
pnpm --filter @aetherlife/npc-memory db:migrate
cd apps/ai-gateway && uv sync --extra dev && cd ../..
pnpm dev:stack
```

Open **http://localhost:5173** in your browser. Press `Ctrl+C` to stop all local processes.

> No local Postgres/Redis required — dev uses Supabase + Upstash cloud.  
> UI smoke: `pnpm dev:stack:mock`. Phase verification scripts require **real LLM** (`pnpm dev:stack`, never `LLM_MOCK=1`).

### Health checks

```bash
curl -sf http://127.0.0.1:5173/
curl -sf http://127.0.0.1:2567/health
curl -sf http://127.0.0.1:8000/health
```

## Map debugging

When tuning maps, spawn points, or collision, you need **grid coordinates `(gx, gy)` for each cell**. Convention: **1 Tiled tile = 1 game cell** (32px/cell); the Beginning Fields home region is **40×40** cells. See [docs/BEGINNING-FIELDS.md](./docs/BEGINNING-FIELDS.md).

### In-game: current cell

After `pnpm dev:stack` and joining a room, the strip above the canvas updates as you move:

- **Cell `(gx, gy)`** — global grid coords (matches Tiled, `spawns.json`, server walkability)
- **Chunk `(cx, cy)`** — procedural chunk index
- **Biome / region** — terrain and WorldRegion label for that cell

### Grid overlay: `?gridDebug=1` (recommended)

Add the query param to the URL, e.g.:

```text
http://localhost:5173/?gridDebug=1
```

In-room you get:

| Feature | Description |
|---------|-------------|
| **Grid lines** | Full 40×40 overlay on Beginning Fields |
| **Hover** | Top HUD shows `格 (x, y)` plus **walkable / blocked / out of region**; cell tint (green / red / yellow) |
| **Council spawns** | Green boxes for the 12 `councilSpawns` anchors |
| **Shift + click** | Record spawn candidates (up to 12); full list logged to the console |

Browser console helpers:

```js
window.__aetherlife_gridPicks          // picked coords
window.__aetherlife_clearGridPicks()  // clear picks
window.__aetherlife_spawnCellInfo(9, 21)  // walkability at a cell
```

Use this after editing `apps/game-server/data/world/beginning-fields@v1/spawns.json` or Tiled collision, then rebake with `node scripts/bake-beginning-fields.mjs`.

### Chunk bounds: `?terrainDebug=1`

For procedural terrain outside the home Tiled map:

```text
http://localhost:5173/?terrainDebug=1
```

Draws borders around loaded chunks. Combine with grid debug: `?gridDebug=1&terrainDebug=1`.

### Reference coordinates

| Use | `(gx, gy)` |
|-----|------------|
| Default player spawn | `(34, 13)` |
| Home map bounds | `x, y ∈ [0, 39]` |
| Council 12 spawn anchors | [BEGINNING-FIELDS.md § Council spawns](./docs/BEGINNING-FIELDS.md#议会-12-席出生点phase-26--村内多点分散) |

## Architecture

Full design (layers, speak/move data flows, monorepo layout): **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

```mermaid
flowchart LR
  Browser["Browser :5173"] --> Web["Vite web"]
  Web -->|"/api"| GS["game-server :2567"]
  Web -->|"/v1"| GW["ai-gateway :8000"]
  GW --> GS
  GS --> Redis["Upstash Redis"]
  Worker["agent-worker"] --> Redis
  Worker --> GS
  GS --> PG["Supabase Postgres"]
  Worker --> PG
```

| Service | Port | Role |
|---------|------|------|
| web | 5173 | UI; proxies `/v1` → gateway, `/api` → game-server |
| game-server | 2567 | Colyseus rooms, SSE, memory API |
| ai-gateway | 8000 | NL parse, input guard, chat ingress |
| agent-worker | — | Redis queue consumer, LangGraph NPC turns |

Per-terminal debug: `pnpm dev` · `pnpm dev:ai` · `pnpm dev:worker` (equivalent to `pnpm dev:stack`).

## Testing

```bash
pnpm turbo test
pnpm turbo build
pnpm verify          # build + test + verify:cloud
pnpm agent:verify    # diff → mapped unit tests (mock LLM OK)

# Cross-layer unit tests (mock LLM OK)
pnpm --filter @aetherlife/game-server test
cd workers/agent-worker && LLM_MOCK=1 uv run pytest -q
cd apps/ai-gateway && uv run pytest tests -q
```

Phase integration gates require `pnpm dev:stack` + real API keys — see [CONTRIBUTING.md](./CONTRIBUTING.md#集成验收). Golden flows: `pnpm agent:verify --e2e --base` ([E2E-POLICY.md](./docs/E2E-POLICY.md)).

Action schema: [packages/game-actions/README.md](./packages/game-actions/README.md)

## Documentation

| Document | Description |
|----------|-------------|
| **[docs/README.md](./docs/README.md)** | Docs index (SSOT vs topic vs E2E layers) |
| **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** | System layers, data flows, monorepo map |
| **[Development History](./docs/DEVELOPMENT-HISTORY.md)** | Phase synthesis (shipping status → STATE.md) |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Workflow, constraints, acceptance commands |
| [docs/CONTRACTS.md](./docs/CONTRACTS.md) | game-server ↔ worker API contracts |
| [docs/INVARIANTS-MULTIPLAYER.md](./docs/INVARIANTS-MULTIPLAYER.md) | Multiplayer spatial + NL invariants |
| [docs/MOVEMENT-ARCHITECTURE.md](./docs/MOVEMENT-ARCHITECTURE.md) | Phaser movement + Colyseus sync |
| [docs/E2E-POLICY.md](./docs/E2E-POLICY.md) | E2E / UAT policy + Golden Flows |
| [docs/PHASE-EVOLUTION.md](./docs/PHASE-EVOLUTION.md) | Phase evolution + cross-layer guardrails |
| [docs/COUNCIL-PERSONAS.md](./docs/COUNCIL-PERSONAS.md) | 12-seat council persona SSOT + export/audit |

## Contributing

Issues and PRs welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) first. Never commit `.env` or API keys.

## Asset Credits

| Asset | Author | Use |
|-------|--------|-----|
| [The Fantasy Tileset](https://ventilatore.itch.io/the-fantasy-tileset) | [Ventilatore](https://ventilatore.itch.io) | Beginning Fields home map (16×16 tiles, Tiled) |

## License

[MIT](./LICENSE)
