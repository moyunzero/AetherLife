# Stack reference（详细选型）

Agent 操作规则见 [AGENTS.md](../AGENTS.md)。本文档为 CLAUDE.md / GSD 栈详表，按需查阅。

---

## Supporting libraries

| Library | Version | Purpose |
|---------|---------|---------|
| @langchain/core + providers | latest | LangGraph 内多模型切换 |
| BullMQ | 5.x | NPC 反思/规划队列 |
| ioredis | 5.x | Redis 客户端 |
| Drizzle ORM | 0.38+ | Postgres 访问 |
| Zod | 3.x | LLM → 游戏 API schema gate |
| @colyseus/schema | 3.x | Room state 同步 |
| howler.js | 2.x | 浏览器音频（Phase 9 语音暂缓） |

---

## Alternatives considered

| Recommended | Alternative | Notes |
|-------------|-------------|-------|
| LangGraph | CrewAI | 仅 Phase 0 spike |
| LangGraph | OpenAI Agents SDK | GPT-only 且无 graph 经验时 |
| Colyseus | Nakama / Socket.io | life sim 需 authoritative |
| Phaser 4 | Three.js R3F | 历史 PRD；`apps/web` 已用 Phaser |
| pgvector | Pinecone/Qdrant | >10M memories 时 |
| FastAPI | Node-only AI | Python LLM 生态更成熟 |

---

## What NOT to use

| Avoid | Use instead |
|-------|-------------|
| 纯 AutoGen 核心编排 | LangGraph |
| 客户端权威同步 | Colyseus server |
| 每 NPC 每 tick frontier LLM | 分层模型 + 事件驱动反思 |
| InMemorySaver 生产 | AsyncPostgresSaver |
| Phase 0 WebGPU 必选 | WebGL2 默认 |
| MongoDB 主库 | Postgres + pgvector |
| Room.onMessage 内阻塞 LLM | BullMQ 异步 |

---

## Model tiering

| Tier | Models | Use |
|------|--------|-----|
| T0 | Qwen3、DeepSeek-R1 distill | 内心独白、批量反思 |
| T1 | GPT-4.1-mini、Claude Sonnet | 玩家对话、中等规划 |
| T2 | GPT-5、Claude Opus、Grok | 剧情转折、安全敏感 |
| 缓存 | embedding 相似 query | 重复意图 |

---

## Version compatibility

| A | B | Notes |
|---|---|-------|
| LangGraph 1.x | langchain-core 0.3+ | 锁定 minor |
| @colyseus/sdk 0.17 | @colyseus/schema 3.x | 同 major |
| Phaser 4 | React 18+ | 见 apps/web/AGENTS.md |
| pgvector 0.7 | Postgres 16 | `CREATE EXTENSION vector` |
