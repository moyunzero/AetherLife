import type * as Phaser from "phaser";
import { isBackgroundNpcId } from "@aetherlife/shared";
import type { EntitySprite } from "./roomSceneTypes.js";

type RectLike = { x: number; y: number; width: number; height: number };

function rectsOverlap(a: RectLike, b: RectLike): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function rectContains(r: RectLike, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
}

/** NPC ids whose sprite bounds overlap the camera worldView (excludes hidden + bg NPCs). */
export function tickViewportVisibleNpcIds(
  cam: Phaser.Cameras.Scene2D.Camera,
  npcSprites: Map<string, EntitySprite>,
): string[] {
  const view = cam.worldView;
  const ids: string[] = [];
  for (const [npcId, ent] of npcSprites) {
    if (!ent.npcId || ent.container.visible === false) continue;
    if (isBackgroundNpcId(npcId)) continue;
    const b = ent.container.getBounds();
    if (rectsOverlap(view, b)) {
      ids.push(npcId);
    }
  }
  return ids.sort();
}

const NPC_PICK_INSET_PX = 6;

/** Top-most interactable NPC on grid cell (fallback when sprite bounds miss). */
export function npcIdAtGridCell(
  gx: number,
  gy: number,
  npcSprites: Map<string, EntitySprite>,
): string | null {
  const hits: Array<{ id: string; depth: number }> = [];
  for (const [npcId, ent] of npcSprites) {
    if (!ent.npcId || ent.container.visible === false) continue;
    if (isBackgroundNpcId(npcId)) continue;
    if (ent.gridX !== gx || ent.gridY !== gy) continue;
    hits.push({ id: npcId, depth: ent.container.depth });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.depth - a.depth);
  return hits[0]!.id;
}

/** Top-most visible NPC under world coordinates (for pointer pick). */
export function hitNpcAtWorldPoint(
  worldX: number,
  worldY: number,
  npcSprites: Map<string, EntitySprite>,
): string | null {
  const hits: Array<{ id: string; depth: number }> = [];
  for (const [npcId, ent] of npcSprites) {
    if (!ent.npcId || ent.container.visible === false) continue;
    if (isBackgroundNpcId(npcId)) continue;
    const b = ent.container.getBounds();
    const pick: RectLike = {
      x: b.x + NPC_PICK_INSET_PX,
      y: b.y + NPC_PICK_INSET_PX,
      width: Math.max(0, b.width - NPC_PICK_INSET_PX * 2),
      height: Math.max(0, b.height - NPC_PICK_INSET_PX * 2),
    };
    if (!rectContains(pick, worldX, worldY)) continue;
    hits.push({ id: npcId, depth: ent.container.depth });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.depth - a.depth);
  return hits[0]!.id;
}

/** Sprite bounds first, then grid-cell fallback (ISSUE-039 / Phase 19 UAT). */
export function pickNpcAtWorldPoint(
  worldX: number,
  worldY: number,
  gx: number,
  gy: number,
  npcSprites: Map<string, EntitySprite>,
): string | null {
  return (
    hitNpcAtWorldPoint(worldX, worldY, npcSprites)
    ?? npcIdAtGridCell(gx, gy, npcSprites)
  );
}

export const VIEWPORT_NPC_TICK_MS = 100;
