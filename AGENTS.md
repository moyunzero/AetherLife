# AGENTS.md — AetherLife / 以太人生

Cross-tool instructions for AI coding agents (Cursor, Copilot, Codex, Claude Code, etc.).  
**Read this file before substantive edits.** Project context and GSD stack detail: [CLAUDE.md](./CLAUDE.md).

---

## Agent role

You are a senior engineer on a **pnpm monorepo** life-sim game: Node game-server (Colyseus), Python ai-gateway + worker, React web client. Priorities:

1. **Evidence before code** — reproduce, read callers, verify SDK/API semantics.
2. **Surgical diffs** — only what the task requires; match existing style.
3. **Verifiable completion** — run the narrowest check that proves the fix (script, test, or UAT step).
4. **Record learnings** — non-trivial bugs go in [docs/ISSUE-LOG.md](./docs/ISSUE-LOG.md).

Behavioral baseline (Cursor): [`.cursor/rules/Guidelines.mdc`](.cursor/rules/Guidelines.mdc) — think first, simplicity, no drive-by refactors, explicit success criteria.

**Phase evolution (always):** [`.cursor/rules/phase-evolution.mdc`](.cursor/rules/phase-evolution.mdc) — cross-layer + INVARIANTS + CONTRACTS before Write. Skill: [`.cursor/skills/phase-evolution/SKILL.md`](.cursor/skills/phase-evolution/SKILL.md).

**E2E / UAT (always):** [`.cursor/rules/e2e-policy.mdc`](.cursor/rules/e2e-policy.mdc) + [docs/E2E-POLICY.md](./docs/E2E-POLICY.md) — `verify:phase*` / `uat:phase*` **禁止** `LLM_MOCK=1`；须 `pnpm dev:stack` + 真实 API Key；从游戏体验矩阵选/扩展用例。

**Agent iteration (always):** [`.cursor/rules/agent-iteration.mdc`](.cursor/rules/agent-iteration.mdc) — Plan → scope → slice → `pnpm agent:verify` → `--e2e` golden flows → revert 不救场。

Planned phase work: GSD commands in [CLAUDE.md](./CLAUDE.md) (`/gsd-quick`, `/gsd-debug`, `/gsd-execute-phase`). Do not bypass GSD unless the user explicitly asks.

**Phase 9 语音暂缓：** 勿实现 STT/TTS；恢复前读 [.planning/phases/09-voice-pipeline/09-STATUS.md](./.planning/phases/09-voice-pipeline/09-STATUS.md)，下一活跃阶段为 Phase 10。

---

## Tech stack (short)

| Area | Stack |
|------|--------|
| Monorepo | pnpm 9, Turbo, Node 20+ |
| Web | React 18+, Vite, TypeScript, **Phaser 4** — `apps/web` |
| Game server | Express + Colyseus `@colyseus/sdk` 0.17 — `apps/game-server` |
| AI | FastAPI `apps/ai-gateway`, LangGraph worker `workers/agent-worker` |
| Data | Supabase Postgres (`DATABASE_URL`), Upstash Redis (`REDIS_URL`) |
| Shared types | `packages/shared`, actions `packages/game-actions` |

Do **not** block Colyseus `onMessage("speak")` on LLM; async worker + job queue only.

### LLM（P0）

智谱 **glm-4.7-flash** 账户并发 **= 1**（第二条 chat 即 429）。路由与 fallback：[docs/LLM-ROUTING.md](./docs/LLM-ROUTING.md) · 探测：`pnpm verify:llm-models`。

**Speak 记忆（ISSUE-022）：** 禁止在 `onMessage("speak")` / `startNpcChatTurn` 内打 importance LLM 或 `appendPlayerMemory`；记忆由 worker **`run_npc_memory_tail` → `persist_turn_memory`** 串行写入。

### Multiplayer (Phase 08+)

见 [docs/INVARIANTS-MULTIPLAYER.md](./docs/INVARIANTS-MULTIPLAYER.md)：`players` 非 lone `player`；worker-state / apply-actions 带 **`X-Player-Id` / `initiatorPlayerId`**；`tool_calls_to_actions` 后再 apply-actions。Server/worker：[apps/game-server/AGENTS.md](./apps/game-server/AGENTS.md).

---

## Key commands

Run from **repository root** unless noted.

| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Full dev stack | `pnpm dev:stack` → http://localhost:5173 |
| Mock LLM stack (非 E2E) | `pnpm dev:stack:mock` — 仅本地 UI 冒烟，**禁止**用于 `verify:phase*` / `uat:phase*` |
| Build | `pnpm turbo build` |
| Test | `pnpm turbo test` |
| Cloud connectivity | `pnpm verify:cloud` |
| LLM model probes | `pnpm verify:llm-models` — [LLM-MODEL-VERIFY.md](./docs/LLM-MODEL-VERIFY.md) · 路由/配额 [LLM-ROUTING.md](./docs/LLM-ROUTING.md) |
| E2E / phase verify | [docs/E2E-POLICY.md](./docs/E2E-POLICY.md) — `dev:stack` + 真实 LLM；例：`verify:phase6` · `verify:phase6:move-only` |
| Movement | [docs/MOVEMENT-ARCHITECTURE.md](./docs/MOVEMENT-ARCHITECTURE.md) |
| Game-server tests | `pnpm turbo test --filter=@aetherlife/game-server` |
| Worker tests | `cd workers/agent-worker && LLM_MOCK=1 uv run pytest -q` |
| Gateway tests | `cd apps/ai-gateway && uv run pytest tests -q` |
| DB migrate | `pnpm --filter @aetherlife/npc-memory db:migrate` |
| Health | `curl -sf http://127.0.0.1:2567/health` and `:8000/health` |
| **Agent verify (diff → tests)** | `pnpm agent:verify` — fast L2; `pnpm agent:verify --e2e` — golden flows (needs `dev:stack`) |
| **Scope audit** | `AGENT_SCOPE="path/*" pnpm agent:verify:scope` |
| **Git pre-push hook** | `pnpm hooks:install` once → runs `agent:verify --base` on push |
| **Council persona export** | `pnpm council:export-personas` — dossiers → compact + speak JSON |
| **Council persona audit** | `pnpm council:audit-personas` — 0 issues before merge（见 [COUNCIL-PERSONAS.md](./docs/COUNCIL-PERSONAS.md)） |

Secrets: root `.env` from `.env.example` — **never commit** `.env` or API keys.

---

## Agent iteration

Plan → scope → `pnpm agent:verify` → `pnpm agent:verify --e2e`（golden flows）。完整五道门：[agent-iteration.mdc](.cursor/rules/agent-iteration.mdc) · [E2E-POLICY §8](./docs/E2E-POLICY.md#8-golden-flowsagent-迭代回归预言机).

---

## Boundaries

### Always

- Follow [Guidelines.mdc](.cursor/rules/Guidelines.mdc), [phase-evolution.mdc](.cursor/rules/phase-evolution.mdc), and [agent-iteration.mdc](.cursor/rules/agent-iteration.mdc): Plan → scope → `pnpm agent:verify` before claiming done.
- Match patterns in the nearest code (read before writing).
- Unsubscribe Colyseus listeners via `room.onMessage(...)` return value — see **Colyseus** below.
- After fixing a non-trivial bug: update [docs/ISSUE-LOG.md](./docs/ISSUE-LOG.md) (status, root cause, verification, Guardrails).
- Prefer `pnpm` over npm/yarn.

### Ask first

- New dependencies, schema/migration changes, env var renames.
- Deleting or renaming public APIs, SSE/Colyseus message types.
- Force push, amending pushed commits, skipping git hooks.
- Large refactors not requested by the user.

### Never

- Call `room.removeAllListeners("messageType")` on a shared Colyseus `Room` — SDK ignores the argument and clears **all** handlers including `onStateChange` (movement UI freezes). See ISSUE-001 in issue log.
- Put UI-only state (`activeNpcId`, tab index, etc.) in `useEffect` deps that register room listeners unless you intentionally re-bind everything.
- Commit `.env`, credentials, or `INTERNAL_WORKER_TOKEN` values.
- Run LLM inference inside Colyseus `onMessage` handlers (blocks room).
- Run `pnpm verify:phase*` or `pnpm uat:phase*:playwright` with `LLM_MOCK=1` or against `dev:stack:mock`.
- Client-authoritative player position without server validation.
- “Improve” unrelated files, format drive-by, or remove pre-existing dead code unless asked.
- Claim “fixed” without running a verification step you can cite.
- **Weaken UAT-verified UX without regression gates** — see **Frozen UX contracts** below.

### Frozen UX contracts（已验收 — 禁止 drive-by 改动）

以下路径在 Phase UAT/verify **已通过**；仅在做同 slice 修复且跑过对应 gate 时允许改：

| 路径 | 契约 | 回归 gate |
|------|------|-----------|
| `apps/web/src/game/entityLabels.ts` | Proximity 铭牌 12px + stroke 4px + shadow（ISSUE-038） | `pnpm verify:phase13` + UAT #6/#7 |
| `apps/web/src/game/entitySprites.ts` | `SPRITE_NAMEPLATE_Y` 在 sprite 头顶上方 | 同上 |
| `apps/web/src/game/ProximityNameplate.ts` | ≤2 格 fade；speak/thinking 强制显示 | 同上 |
| `apps/web/src/hooks/useNpcChat.ts` | 方案 A composer busy；`onSpeakBusy` 清 `sendingNpcId`（ISSUE-037） | `uat:phase8` Test 4 + web test |

详见 [docs/ISSUE-LOG.md](./docs/ISSUE-LOG.md) Guardrails #57–#59。

---

## Colyseus client (critical)

```ts
// WRONG — wipes onStateChange + all onMessage + schema callbacks
room.removeAllListeners("speakAck");

// RIGHT
const off = room.onMessage("speakAck", handler);
// cleanup: off();
```

- Register `onStateChange` in **one** place (`useColyseusRoom`). Other hooks only use `onMessage` with per-handler unsubscribe.
- “Cannot move” reports: check whether `move` is sent vs UI not updating (`onStateChange` missing).

Details: [docs/ISSUE-LOG.md](./docs/ISSUE-LOG.md) Guardrails + ISSUE-001. Web-only notes: [apps/web/AGENTS.md](./apps/web/AGENTS.md).

---

## Issue log & definition of done

Ledger: [docs/ISSUE-LOG.md](./docs/ISSUE-LOG.md) — open → fixed + verification command + Guardrails（非琐碎 bug）。Skip typos.

### Before saying complete

- [ ] Change matches user scope only (Guidelines surgical rule).
- [ ] Relevant test, `pnpm turbo test --filter=…`, or phase verify script passes (or user waived).
- [ ] For bugs: issue log entry updated + Guardrails if applicable.
- [ ] Cross-layer edits: CONTRACTS row + both test suites (see phase-evolution.mdc).
- [ ] No secrets in diff; no accidental `removeAllListeners` on Colyseus room.
- [ ] If UI/network: stated how to manually verify (URL + steps).

---

## Documentation map (progressive disclosure)

| Doc | Purpose |
|-----|---------|
| [README.md](./README.md) | Human setup, dev stack, verify |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Humans + agents: PR/issue workflow |
| [CLAUDE.md](./CLAUDE.md) | GSD project brief, stack versions, workflow |
| [docs/ISSUE-LOG.md](./docs/ISSUE-LOG.md) | Bug ledger + guardrails |
| [docs/PHASE-EVOLUTION.md](./docs/PHASE-EVOLUTION.md) | 阶段演进防债务 + GSD skill 映射 |
| [docs/COUNCIL-PERSONAS.md](./docs/COUNCIL-PERSONAS.md) | 12 席议会人设 SSOT + export/audit |
| [docs/CONTRACTS.md](./docs/CONTRACTS.md) | 跨层契约 C-01…05 |
| [docs/INVARIANTS-MULTIPLAYER.md](./docs/INVARIANTS-MULTIPLAYER.md) | MP-01…10 多人空间/NL 硬约束 |
| [docs/MOVEMENT-ARCHITECTURE.md](./docs/MOVEMENT-ARCHITECTURE.md) | Phaser-first 移动/同步（Phase 10.5，Steam 向） |
| [docs/BEGINNING-FIELDS.md](./docs/BEGINNING-FIELDS.md) | Home Tiled 地图烘焙、碰撞、Y-sort（web + game-server） |
| [docs/LLM-ROUTING.md](./docs/LLM-ROUTING.md) | LLM 平台、模型角色、限速、并发、fallback |
| [docs/LLM-MODEL-VERIFY.md](./docs/LLM-MODEL-VERIFY.md) | LLM/embed 连通性探测 Run history |
| [docs/PHASER-SKILLS.md](./docs/PHASER-SKILLS.md) | Phaser 4 skills 索引与任务路由 |
| [docs/STACK-REFERENCE.md](./docs/STACK-REFERENCE.md) | 栈详表（备选、禁选、模型分层） |
| [.planning/EVOLUTION-AUDIT-TEMPLATE.md](./.planning/EVOLUTION-AUDIT-TEMPLATE.md) | 新 phase 审计模板 |
| [apps/game-server/AGENTS.md](./apps/game-server/AGENTS.md) | game-server + worker 状态边界 |
| [.planning/](./.planning/) | Phases, UAT, PATTERNS, RESEARCH |
| [packages/game-actions/README.md](./packages/game-actions/README.md) | Action schema |

---

## Monorepo layout

```
apps/web/           — Vite React UI, Colyseus hooks
apps/game-server/   — HTTP + Colyseus GameRoom
apps/ai-gateway/    — FastAPI NL + guard
workers/agent-worker/
packages/shared/    — Colyseus message constants
packages/game-actions/
```

When editing under `apps/web/`, also read [apps/web/AGENTS.md](./apps/web/AGENTS.md).

---

## Phaser 4 skills

**Write/Edit** `apps/web/src/game/**` 或 `PhaserGame.tsx` 前：**Read** `.cursor/skills/<name>/SKILL.md`（Phaser **4**，非 v3）。

完整 28-skill 索引与任务路由 → **[docs/PHASER-SKILLS.md](./docs/PHASER-SKILLS.md)** · Web 边界 → [apps/web/AGENTS.md](./apps/web/AGENTS.md) · 移动同步 → [MOVEMENT-ARCHITECTURE.md](./docs/MOVEMENT-ARCHITECTURE.md).
