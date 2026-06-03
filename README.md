# AetherLife / 以太人生

AI 驱动的多人联机生活模拟 Web 游戏 — Phase 1 提供 monorepo、**Supabase + Upstash 云 dev 数据层**与 Core-4 action schema 基座。

## Prerequisites

- Node.js 20+
- pnpm 9+ (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- [Supabase](https://supabase.com) 免费档 dev project（Postgres）
- [Upstash](https://upstash.com) 免费档 Redis
- Python 3.12+ and [uv](https://docs.astral.sh/uv/)（可选，本地跑 ai-gateway）
- Docker（**可选**，仅容器化 ai-gateway 时用 `pnpm docker:ai`）

Supabase 免费档项目闲置可能暂停；存储与连接数有上限，solo dev 通常够用。

## Setup

1. Clone the repository
2. `pnpm install`
3. **Supabase:** 新建项目 → Database → 复制 **Session pooler** URI → SQL Editor 执行 `CREATE EXTENSION IF NOT EXISTS vector;`
4. **Upstash:** 新建 Redis → 复制 TLS `REDIS_URL`
5. `cp .env.example .env` 并填入上述两个 URL（勿提交 `.env`）
6. `pnpm verify:cloud` — 确认 Postgres `SELECT 1` 与 Redis `PING` 成功
7. `pnpm dev` — 启动 web + game-server（不依赖 Docker）

**ai-gateway（占位 FastAPI）：**

- 推荐：`pnpm dev:ai`（另开终端）
- 可选：`pnpm docker:ai`（需 Docker）

Phase 1 服务端仅通过 `DATABASE_URL` / `REDIS_URL` 连接云库；**不在浏览器使用 Supabase client**（Auth/RLS 留待后续 phase）。

## Verify

```bash
pnpm turbo test
pnpm turbo build
pnpm verify:cloud
pnpm verify          # build + test + verify:cloud

curl -sf http://127.0.0.1:2567/health
curl -sf http://127.0.0.1:8000/health   # after pnpm dev:ai
```

Action contract details: [packages/game-actions/README.md](packages/game-actions/README.md)

## Phase 1 scope

Foundation only — no NPC AI, Colyseus multiplayer, or 2.5D rendering yet.
