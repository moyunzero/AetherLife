<!-- GSD:project-start source:PROJECT.md -->

> **AI agents (all tools):** Read **[AGENTS.md](./AGENTS.md)** first — boundaries, commands, issue log, Colyseus guardrails, definition of done.  
> **Cursor:** [`.cursor/rules/Guidelines.mdc`](.cursor/rules/Guidelines.mdc) + [`.cursor/rules/phase-evolution.mdc`](.cursor/rules/phase-evolution.mdc) apply automatically.  
> **阶段演进：** [docs/PHASE-EVOLUTION.md](./docs/PHASE-EVOLUTION.md) · [docs/CONTRACTS.md](./docs/CONTRACTS.md) · skill [`.cursor/skills/phase-evolution/SKILL.md`](.cursor/skills/phase-evolution/SKILL.md)  
> **Humans:** [CONTRIBUTING.md](./CONTRIBUTING.md).

## Project

**AetherLife / 以太人生**

AetherLife 是一款 AI 驱动的多人联机生活模拟 Web 游戏。玩家与拥有独立记忆、反思与长期规划的 NPC 通过自然语言/语音互动，共同影响一个可程序化扩展、由 LLM 注入叙事灵魂的世界。目标用户是喜欢《模拟人生》《动物森友会》《我的世界》的玩家、AI 爱好者，以及偏社交与叙事驱动的玩家。

**Core Value:** 玩家可以用自然语言指挥 NPC 完成复杂任务，NPC 会记住互动并据此改变未来行为——这一「记忆→反思→执行」闭环必须在 MVP 中可验证、可感知。

### Constraints

- **Latency**: 位置同步 <200ms；AI 决策 1–3s 可接受，需「思考中」反馈
- **Cost**: 模型分层（日常开源推理 vs 关键交互 frontier 模型）+ 缓存
- **Safety**: Constitutional AI + 后验校验 + Guardrails
- **Timeline**: 约每 3–4 周一个可玩版本；Phase 0 目标 4–6 周
- **Platform**: Web 优先，跨 PC/移动浏览器
- **Consistency**: LangGraph Checkpoint + 规则引擎防幻觉/失控

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| **LangGraph** | 0.2.x / 1.x | NPC 状态机、反思、Checkpoint |
| **LangSmith** | latest | trace / eval |
| **FastAPI** | 0.115+ | AI gateway |
| **Colyseus** | @colyseus/sdk 0.17+ | 权威多人同步 |
| **PostgreSQL** + **pgvector** | 16+ / 0.7+ | 持久化 + 向量记忆 |
| **Redis** | 7+ | 缓存、BullMQ |
| **React** | 18.x–19.x | HUD shell |
| **Phaser** | 4.0+ | **当前 web 渲染**（`apps/web/src/game`） |
| **TypeScript** | 5.6+ | 全栈类型 |
| **Vite CSS** | — | HUD 样式（`apps/web/src/index.css`；无 Tailwind） |
| **Docker + Compose** | latest | 本地/CI |

详表（备选、禁选、模型分层、版本矩阵）：**[docs/STACK-REFERENCE.md](./docs/STACK-REFERENCE.md)**

### Development Tools

| Tool | Purpose |
|------|---------|
| pnpm + Turborepo | Monorepo |
| Vitest + Playwright | 单测（Vitest）；E2E/UAT 用 `scripts/.pw-deps` 的 Playwright（非根 `package.json`；`verify:phaseN` 须真实 LLM） |
| LangSmith | LLM trace / eval（无 OpenTelemetry 依赖） |

## Installation (Monorepo)

```bash
pnpm install
pnpm dev:stack   # web :5173, game-server :2567, ai-gateway :8000
```

Per-package: `pnpm --filter @aetherlife/web dev` · `pnpm --filter @aetherlife/game-server dev`

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Cross-tool rules (boundaries, commands, issue log, Colyseus, definition of done): **[AGENTS.md](./AGENTS.md)** — keep in sync when conventions change.

**Phase evolution:** [docs/PHASE-EVOLUTION.md](./docs/PHASE-EVOLUTION.md) — Evolution Audit template, CONTRACTS, GSD skill 映射；Agent 改跨层代码前必读。

GSD workflow (`/gsd-quick`, `/gsd-debug`, `/gsd-execute-phase`) applies to planned phase work; **Guidelines.mdc + phase-evolution.mdc + AGENTS.md** apply inside every workflow.

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:docs/ARCHITECTURE.md -->

## Architecture

**SSOT:** [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — layers, speak/move flows, monorepo layout.

Web client: React HUD + Phaser 4 (`apps/web/src/game`). Game-server authoritative state via Colyseus. AI: FastAPI gateway + LangGraph worker.

Operational rules (commands, boundaries, verify): **[AGENTS.md](./AGENTS.md)** · Web-specific: **[apps/web/AGENTS.md](./apps/web/AGENTS.md)** · Movement: [docs/MOVEMENT-ARCHITECTURE.md](./docs/MOVEMENT-ARCHITECTURE.md).
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

| Skill | Path | Use when |
|-------|------|----------|
| **phase-evolution** | [`.cursor/skills/phase-evolution/SKILL.md`](.cursor/skills/phase-evolution/SKILL.md) | 新 phase、多人/NL/跨层 bug、CONTRACTS/INVARIANTS 变更 |

### Phaser 4 skills（canvas / `apps/web/src/game`）

编辑 Phaser 代码前 **Read** `.cursor/skills/<name>/SKILL.md`。索引与路由：**[docs/PHASER-SKILLS.md](./docs/PHASER-SKILLS.md)** · Web 摘要：[apps/web/AGENTS.md](./apps/web/AGENTS.md). 引擎：**Phaser 4**（非 v3）。

Installed **GSD skills**（`~/.claude/skills/gsd-*`）与演进防债务的映射见 [docs/PHASE-EVOLUTION.md](./docs/PHASE-EVOLUTION.md) §3。

<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
