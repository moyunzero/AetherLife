# Optimization decisions (2026-06-24)

Roadmap analysis follow-up. Locked for v4 stabilization → v5 scoping.

## 1. Focus tier

**Decision:** **P0 (gameplay credibility) + P3 (surface cleanup)** this slice.

- P0: NPC name fix, onboarding, memory drawer entry
- P3: orphan UI removal, dead CSS, simplify unused component branches
- P2 (god-file splits, route tests): defer to v5 / dedicated refactor slice

> **Reverted 2026-06-24:** default interactables (door/pickup seeding + pickup rendering)
> were dropped at user request — out of scope for this slice. `createDefaultRoom().objects`
> stays `[]`; the pre-existing door subsystem (executor/bridge/schema, `verify:phase*`
> injection) is untouched.

## 2. Planning pillar

**Decision:** **Adjust positioning** — do not ship a frontier-LLM daily-plan graph in this slice.

| Shipped loop | Mechanism |
|--------------|-----------|
| Memory | pgvector + `persist_turn_memory` |
| Reflect | every N memories → `store_reflection` |
| Routine behavior | server schedule + ambient intent (rules + async LLM) |
| Execute | `tool_calls_to_actions` → apply-actions |

**Not in scope:** Smallville-style emergent multi-step plans stored per NPC. v5 candidate if Core Value messaging needs it.

Public copy: **记忆 → 反思 → 执行**; routine “planning” = schedule/ambient, not a separate plan store.

## 3. Multiplayer

**Decision:** **Freeze new investment** — solo-first ship gate (v4) remains authoritative.

- Maintain Colyseus sync + 4-player room for demos; no new MP-only features
- ISSUE-049 (shared reset) deferred until MP milestone
- SCALE-01 (8–16 players) = v5+

## Implemented in this slice

See git diff. Verification:

```bash
pnpm --filter @aetherlife/shared test
pnpm --filter @aetherlife/web test
pnpm --filter @aetherlife/game-server test
cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_ambient_intent.py -q
```
