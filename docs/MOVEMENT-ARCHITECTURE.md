# Movement & Sync Architecture (Phaser-first)

**Status:** Active — migrated in Phase 10.5 (pre–Phase 11)  
**Audience:** Agents + humans shipping Steam / desktop builds  
**Related:** [Colyseus Client Predicted Input](https://docs.colyseus.io/learn/tutorial/phaser/client-predicted-input), [ISSUE-LOG.md](./ISSUE-LOG.md) Guardrails #36–#42

---

## Goal

Life-sim multiplayer movement follows **authoritative server + client prediction** (same pattern as Stardew/Animal Crossing grid walk, Habbo click-to-path, Colyseus official Phaser tutorial):

1. **Server** validates moves (`moveAck`, `serverTo` chain).
2. **Client** predicts immediately (WASD step / click path tween).
3. **Local player sprite** is **not** driven by raw Colyseus schema while `pending > 0` or locomotion is active.
4. **Remote players** use buffered step interpolation (`RemotePlayerInterpolator`).

Phaser owns **input → predict → tween → ack** on the main path. React owns **room lifecycle**, **HUD** (hints, sync debug), and **MovementPanel fallback** (no WebGL).

---

## Layer diagram

```
┌─────────────────────────────────────────────────────────────┐
│ React — useColyseusRoom                                      │
│  • Colyseus join / leave / onStateChange (ONLY place)        │
│  • chunksSync, player snapshots → registry                   │
│  • MovementSyncController instance + HUD callbacks           │
│  • MovementPanel fallback: sendMove / sendMoveTo delegates   │
└──────────────────────────┬──────────────────────────────────┘
                           │ registry: movementSync, colyseusRoom, joinGeneration
┌──────────────────────────▼──────────────────────────────────┐
│ Phaser — RoomScene                                           │
│  • WASD + click input                                        │
│  • movementSync.sendWasd / sendMoveTo                        │
│  • moveAck via controller.attachRoom (hook on join)          │
│  • LocalPlayerMovementController (tweens)                    │
│  • RemotePlayerInterpolator                                  │
│  • syncEntities: `shouldSuppressLocalSchemaSnap` (MP-MOV-02) │
│  • update: `tickExploreGrid` → registry `exploreGrid`        │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ Pure TS — packages/shared + apps/web/src/lib                   │
│  • ClientMovementPredictor, reconcileMoveAck, pathfind         │
│  • MovementSyncController orchestrates predictor + path      │
└─────────────────────────────────────────────────────────────┘
```

---

## Module responsibilities

| Module | Location | Owns |
|--------|----------|------|
| `MovementSyncController` | `apps/web/src/game/MovementSyncController.ts` | pending drain, click pathfind, `pushTargetMove`, ack apply, animating flag |
| `ClientMovementPredictor` | `apps/web/src/lib/clientMovementPredictor.ts` | pending queue, serverTo, visualPos, enqueueStep |
| `LocalPlayerMovementController` | `apps/web/src/game/LocalPlayerMovementController.ts` | Phaser tweens, `getLogicGrid()` |
| `RemotePlayerInterpolator` | `apps/web/src/game/RemotePlayerInterpolator.ts` | remote step playback |
| `useColyseusRoom` | `apps/web/src/hooks/useColyseusRoom.ts` | Room singleton, schema snapshots, sync controller ref |
| `RoomScene` | `apps/web/src/game/RoomScene.ts` | Input, moveAck listener, locomotion bridge |

---

## Invariants (do not break)

| ID | Rule |
|----|------|
| MP-UI-01 | `onStateChange` registered **only** in `useColyseusRoom` |
| MP-UI-02 | `room.onMessage` cleanup via returned `off()` — never `removeAllListeners` |
| MP-MOV-01 | Click: drain pending → **then** `cancelLocomotion` → pathfind → single `{targetX,targetY}` packet |
| MP-MOV-02 | Local player: no schema snap when `pending > 0` or `isLocalLocomoting()` — `shouldSuppressLocalSchemaSnap` in `@aetherlife/shared` |
| MP-MOV-03 | Click path origin = `motionBridge.getLogicGrid()` when available |
| MP-MOV-04 | `ClientMovementPredictor` stays framework-agnostic (vitest-friendly) |
| MP-MOV-05 | Blocked WASD: local `onBlockedFace` + `{ dx, dy }` move (no `clientSeq`/pending); server updates `player.facing` + `bumpStateVersion` when facing changes |

---

## Steam / desktop readiness

- **Game loop in Phaser** — movement tied to scene `update`, not React render cadence.
- **Thin React shell** — chat, NPC tabs, memory panels remain DOM; swappable for Electron/Tauri wrapper later.
- **Shared prediction lib** — same `moveAck` / pathfind code as game-server contracts (`packages/shared`).

---

## Verification

```bash
pnpm dev:stack
# http://localhost:5173 — WASD, click path, 2 tabs peer sync

pnpm --filter @aetherlife/shared test
pnpm verify:phase6:move-only   # dual-client move + MP-MOV-02 unit gate
```

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-05 | Phase 10.5: `MovementSyncController`; RoomScene owns input + moveAck; docs created |
| 2026-06-05 | Wave 2: `tickExploreGrid` in `RoomScene.update`; `shouldSuppressLocalSchemaSnap`; verify:phase6:move-only gate |
| 2026-06-05 | Fix schema lag snap: local≠schema suppress + no authoritative rewind; `uat-phase6-move-flash.mjs` in move-only verify |
