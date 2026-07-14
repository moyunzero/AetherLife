# AGENTS.md — apps/web

Parent: [../../AGENTS.md](../../AGENTS.md). Read parent first.

## Agent role

Frontend engineer on `@aetherlife/web`: React HUD + **Phaser 4** canvas + Colyseus client. Priorities: listener hygiene, Phaser-first movement, run verify gates before claiming done.

## Scope

| Layer | Stack |
|-------|-------|
| UI | React 18, Vite 6, TypeScript |
| Canvas | Phaser 4.0 (`src/game/**`, `components/PhaserGame.tsx`) |
| Realtime | `@colyseus/sdk` 0.17 — `useColyseusRoom`, `useNpcChat` |
| Movement | [MOVEMENT-ARCHITECTURE.md](../../docs/MOVEMENT-ARCHITECTURE.md) |

## Key commands

From repo root unless noted.

| Task | Command |
|------|---------|
| Full dev stack | `pnpm dev:stack` → http://localhost:5173 |
| Web unit tests | `pnpm --filter @aetherlife/web test` |
| Shared types | `pnpm --filter @aetherlife/shared test` |
| Move-only gate | `pnpm verify:phase6:move-only` |
| Nameplate / proximity | `pnpm verify:phase13` |

## File-scoped commands

Replace `PATH` with a file under `apps/web/`.

| Task | Command |
|------|---------|
| Single test | `pnpm --filter @aetherlife/web exec vitest run PATH` |
| Hook example | `pnpm --filter @aetherlife/web exec vitest run src/hooks/useNpcChat.test.ts` |
| Game example | `pnpm --filter @aetherlife/web exec vitest run src/game/entityLabels.test.ts` |
| Production build | `pnpm --filter @aetherlife/web build` |

## Critical files

| Path | Role |
|------|------|
| `hooks/useColyseusRoom.ts` | Sole `onStateChange`; join / move API |
| `hooks/useNpcChat.ts` | Speak + SSE; composer busy (ISSUE-037) |
| `components/PhaserGame.tsx` | Phaser boot; React ↔ registry bridge |
| `game/RoomScene.ts` | Scene lifecycle; delegates to `roomScene*.ts` |
| `game/MovementSyncController.ts` | Move ack → Phaser sync |
| `components/MovementPanel.tsx` | WebGL-off fallback movement |

## Phaser skills

Before **Write/Edit** on `src/game/**` or `PhaserGame.tsx` (or React bridges that drive the canvas), **must**:

1. **Read** the matching Phaser skill — index & routing: **[docs/PHASER-SKILLS.md](../../docs/PHASER-SKILLS.md)** (Phaser **4**, not v3).
2. **Check latest official Phaser docs** via **context7** (or phaser.io docs) for the APIs you touch — skills encode project conventions; they do **not** replace upstream docs.

Does **not** replace Colyseus sync ([MOVEMENT-ARCHITECTURE.md](../../docs/MOVEMENT-ARCHITECTURE.md)). Parent: [root AGENTS.md — Phaser 4 skills](../../AGENTS.md).

## Boundaries

### Always

- One Colyseus `Room`: `onStateChange` only in `hooks/useColyseusRoom.ts`.
- `useNpcChat` (and any hook): cleanup with `off()` from `room.onMessage`; never `removeAllListeners`.
- **Phaser edits:** Read matching skill ([PHASER-SKILLS.md](../../docs/PHASER-SKILLS.md)) + verify **Phaser 4** APIs against latest official docs (context7) before Write.
- **Phaser path:** WASD + click → `RoomScene` → `MovementSyncController` (`registry` key `movementSync`); no `onMove` / `onMoveTo` on `PhaserGame`.
- **Fallback:** `MovementPanel` uses `sendMove` / `sendMoveTo` from `useColyseusRoom`.
- `MovementPanel`: do **not** disable movement when `status === "thinking"`; only disable composer.

### Ask first

- Frozen UX paths in root [AGENTS.md — Frozen UX contracts](../../AGENTS.md): `entityLabels.ts`, `entitySprites.ts`, `ProximityNameplate.ts`, `useNpcChat.ts` — run the listed verify gate in the same PR.
- `oneCityTilesetManifest.ts` or `public/assets/one-city/**` — regenerate via bake script; do not hand-edit generated manifest.
- New npm dependencies; changes to `vite.config.ts` or Phaser `GameConfig`.
- Beginning Fields / Tiled map edits — read [docs/BEGINNING-FIELDS.md](../../docs/BEGINNING-FIELDS.md) first.

### Never

- `useEffect(..., [activeNpcId])` that registers Colyseus listeners — use `activeNpcIdRef` for reply attribution.
- Assume `removeAllListeners("type")` is selective — it clears **all** handlers ([ISSUE-001](../../docs/ISSUE-LOG.md)).
- Reintroduce React-per-step movement callbacks on the Phaser canvas path.
- `createFromObjects` for Beginning Fields collection tiles (see BEGINNING-FIELDS).

## Beginning Fields

Home Tiled map (40×40 @ 16px → **32px/grid** in-game). Full bake / collision / Y-sort workflow: **[docs/BEGINNING-FIELDS.md](../../docs/BEGINNING-FIELDS.md)**.

- After map change: `node scripts/bake-beginning-fields.mjs`
- Regression: home Campfire 2×2 + animation (ISSUE-042)

## Character visuals（全员 LPC · 2026-07）

**产品决策：** 所有玩家 + `npc-1`…`npc-12` → LPC `sprites/lpc-player-1.png` + `sprites/lpc-npc-{1…12}.png`。

| Task | Command / path |
|------|----------------|
| 烘焙 LPC 皮 | `pnpm assets:sync:lpc-npcs`（别名 `assets:sync:lpc-npc1`；源 `npc-asset/player-1.png` + `npc-asset/npc-{1…12}.png`） |
| 常量 | `gridLayout.CELL_PX=32` · `entityLayout.CHAR_DISPLAY_PX=64` |
| 运行时 | `lpcNpc1Sheet.ts` · `entitySprites.ts`（`registerLpcNpcAnims`）· `sceneLabelLayout.ts` |
| 文档 | [BEGINNING-FIELDS.md](../../docs/BEGINNING-FIELDS.md) §角色视觉 |
| 回归 | `pnpm verify:phase6:move-only` + `pnpm verify:phase13` |

Guardrails #106–#107 · Frozen UX 见根 [AGENTS.md](../../AGENTS.md)。

## Verify locally

```bash
pnpm dev:stack
# http://localhost:5173 — WASD, click path, speak, 2-tab peer sync
pnpm --filter @aetherlife/web test
pnpm verify:phase6:move-only
```
