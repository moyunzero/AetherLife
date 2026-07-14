# Game assets — credits & licenses

Phase 13.2 farm art (default production). Regenerate atlases: `pnpm art:import` or `pnpm art:import:farm`.

**Pastoral color:** runtime Phaser tint in `apps/web/src/game/pastoralTint.ts` — import scripts do not bake color grading.

**Dev-only rollback:** `pnpm art:import:roguelike` (Kenney Roguelike dungeon tiles — not AE-08 path). LPC sprites: `pnpm art:import:lpc`.

## Tiles & decor (Kenney Tiny Town — Phase 13.2)

| Field | Value |
|-------|--------|
| **Asset** | Tiny Town (16×16 tiles, 1px spacing) |
| **Author** | Kenney (www.kenney.nl) |
| **Source** | [OpenGameArt — Tiny Town](https://opengameart.org/content/tiny-town) · [Kenney asset page](https://kenney.nl/assets/tiny-town) |
| **License** | **CC0 1.0** (public domain) — attribution appreciated, not required |
| **Imported** | 2026-06-08 |
| **Vendor copy** | `scripts/vendor/phase13.2/tiny-town/` |
| **Import script** | `scripts/import-phase13.2-farm-art.mjs` |

### Biome tile mapping (Tiny Town sheet index, 12 cols × 11 rows)

| Biome | Walk variants | Blocked | Shore |
|-------|---------------|---------|-------|
| home | plowed dirt 72, 73 | stone 88 | dirt 72 |
| meadow | grass + flowers 13, 14, 36, 37 | dirt mound 52 | grass 13 |
| scrub | grass 13, 14, 36, 37 | dirt mound 52 | grass edge 24 |
| wetland | water 43, shore mud 44 | water 43 | mud 44 |
| highland | cobble 88–91 | stone wall 92 | cobble 89 |

### Decor frames (decor.png)

| Frame | Tiny Town index | Use |
|-------|-----------------|-----|
| 0–1 | 85, 86 | door closed / open (building wall) |
| 2 | 28 | bush |
| 3–6 | 60, 61, 48, 49 | 2×2 tree SW/SE/NW/NE |
| 7 | 121 | fence |
| 8 | 104 | well (homestead landmark) |
| 9 | 44 | wetland shore |

## Tiles & decor (Kenney Roguelike — Phase 13.1 **dev-only rollback**)

| Field | Value |
|-------|--------|
| **Import script** | `scripts/import-phase13-art.mjs` (`pnpm art:import:roguelike`) — **not production default** |
| **Vendor copy** | `scripts/vendor/phase13/kenney/` |

## Characters & NPCs — **全员 LPC（产品决策 · 2026-07）**

| Field | Value |
|-------|--------|
| **决策** | **所有玩家**（本地 + 远端）与 **`npc-1`…`npc-12`** 统一使用 LPC 烘焙皮；**不再**用 `sprites/characters.png` 四色 palette 区分玩家 |
| **源图** | `npc-asset/player-1.png` + `npc-asset/npc-{1…12}.png`（Universal LPC Spritesheet Character Generator） |
| **烘焙** | `pnpm assets:sync:lpc-npcs`（别名 `assets:sync:lpc-npc1`）→ `scripts/sync-npc-lpc-assets.mjs` |
| **输出** | `sprites/lpc-player-1.png` + `sprites/lpc-npc-{1…12}.png` — 各 64×64 帧，walk（row 8–11）+ idle（row 22–25），方向 up/left/down/right |
| **运行时** | `lpcNpc1Sheet.ts` · `entitySprites.registerLpcNpcAnims` · `useSpriteEntities()` 须 `spritesLpcNpc1` + `spritesNpcs` |
| **显示** | `CELL_PX=32`；角色高 `CHAR_DISPLAY_PX=64`（2 格）；`LPC_NPC1_SCALE=1.0` |

文档：[BEGINNING-FIELDS.md](../../docs/BEGINNING-FIELDS.md) §角色视觉 · Guardrails #106–#107 in [ISSUE-LOG.md](../../docs/ISSUE-LOG.md)。

## Characters & NPCs (Stardew-style @character — **legacy player skin**)

| Field | Value |
|-------|--------|
| **Asset** | `assets/character/Walk.png` + `Idle.png` (32×32 cells → crop → **16×32** @ 3× scale) |
| **Import** | `pnpm art:import:character` → `scripts/import-character-art.mjs` |
| **Output** | `sprites/characters.png` (4 palette rows) — **dev/rollback only**；生产玩家皮已切 LPC |
| **Facing** | Sheet rows: down / up / right; **left** = horizontal flip in `entitySprites.applyFacingFlip` |
| **Walk / idle** | 4 walk + 2 idle frames per facing (from 6 walk / 4 idle source columns) |

Council NPCs（`npc-1`…`npc-12`）生产路径为 LPC 烘焙皮；`sprites/npcs.png` 仅作 legacy / Stardew fallback。

Legacy LPC vendor pass: `pnpm art:import:lpc` (`scripts/vendor/phase13/lpc/`).

## Characters & NPCs (Universal LPC — legacy vendor)

## Dev-only placeholders

`pnpm art:placeholder` runs `scripts/generate-phase13-atlases.mjs` — **flat color blocks for local dev only**, not Tier B ship art.

## UI chrome (Phase 13 — viewport / composer)

| Field | Value |
|-------|--------|
| **Files** | `apps/web/public/assets/ui/game-viewport-frame-top.png`, `game-viewport-frame-tile.png` |
| **Source** | AI-generated wood texture, cropped + compressed via `node scripts/optimize-phase13-ui-frame.mjs` |
| **License** | Project-owned generated asset (not third-party art) |
| **Use** | Room panel header overlay + composer parchment tile |
