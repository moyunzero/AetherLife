# AetherLife / 以太人生

AI 驱动的多人联机生活模拟 Web 游戏 — Phase 1 提供 monorepo、Docker dev stack 与 Core-4 action schema 基座。

## Prerequisites

- Node.js 20+
- pnpm 9+ (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Docker Desktop (or Docker Engine + Compose v2)
- Python 3.12+ and [uv](https://docs.astral.sh/uv/) (optional, for local ai-gateway dev)

## Setup

1. Clone the repository
2. `pnpm install`
3. `cp .env.example .env`
4. Choose a stack:
   - **Fast TS dev:** `pnpm docker:up` then `pnpm dev` (Postgres + Redis + web + game-server)
   - **Full stack (INFR-01):** `pnpm docker:up:full` or `pnpm verify:stack` (adds ai-gateway container)
   - **Local ai-gateway:** `pnpm dev:ai` (Python/uv, not started by `pnpm dev`)

### Compose profiles

| Profile | Services |
|---------|----------|
| `infra` | Postgres + Redis (`pnpm docker:up`) |
| `full` | infra + ai-gateway (`pnpm docker:up:full`) |

ROADMAP wording `docker compose up` for the complete stack maps to `pnpm docker:up:full`.

## Verify

```bash
pnpm turbo test
pnpm turbo build
pnpm verify:stack   # full stack + health curls (requires Docker)
curl -sf http://127.0.0.1:2567/health
curl -sf http://127.0.0.1:8000/health
```

Action contract details: [packages/game-actions/README.md](packages/game-actions/README.md)

## Phase 1 scope

Foundation only — no NPC AI, Colyseus multiplayer, or 2.5D rendering yet.
