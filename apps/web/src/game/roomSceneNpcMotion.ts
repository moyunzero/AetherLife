import type Phaser from "phaser";
import type { GridCell, RoomState } from "@aetherlife/shared";
import { clientFindPath } from "../lib/chunkWalkability.js";
import { entityYSortDepth } from "./entityLayout.js";
import { gridToWorld } from "./gridLayout.js";
import { GRID_STEP_MS } from "./gridMovement.js";
import {
  applyStepAnimation,
  applyStepEndAnimation,
} from "./entitySprites.js";
import type { EntitySprite, PlayerSnap } from "./roomSceneTypes.js";

const STEP_MS = GRID_STEP_MS;

export type RoomSceneNpcMotionCtx = {
  registry: Phaser.Data.DataManager;
  tweens: Phaser.Tweens.TweenManager;
  getMoveMap: () => RoomState;
  getLoadedChunks: () => import("@aetherlife/shared").ChunkView[];
  stopEntityMotion: (ent: EntitySprite) => void;
  snapEntityToGrid: (ent: EntitySprite, gx: number, gy: number) => void;
  tweenEntityOneStep: (ent: EntitySprite, gx: number, gy: number, duration: number) => void;
};

export function pathForNpcMove(
  ctx: RoomSceneNpcMotionCtx,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  npcId: string,
): GridCell[] | null {
  const map = ctx.getMoveMap();
  const players = (ctx.registry.get("players") as PlayerSnap[]) ?? [];
  const others = players.map((p) => ({ x: p.x, y: p.y }));
  return clientFindPath(
    map,
    fromX,
    fromY,
    toX,
    toY,
    others,
    ctx.getLoadedChunks(),
    { excludeNpcId: npcId },
  );
}

/** Load / reset: snap NPC to persisted grid (Stardew-style, no walk-in on refresh). */
export function snapNpcTo(ctx: RoomSceneNpcMotionCtx, ent: EntitySprite, gx: number, gy: number): void {
  ent.targetGridX = gx;
  ent.targetGridY = gy;
  ctx.stopEntityMotion(ent);
  ctx.snapEntityToGrid(ent, gx, gy);
}

/** NPC moves step-by-step (~140ms/cell), matching player sendMoveTo animation. */
export function tweenNpcTo(
  ctx: RoomSceneNpcMotionCtx,
  ent: EntitySprite,
  gx: number,
  gy: number,
  npcId: string,
): void {
  if (ent.gridX === gx && ent.gridY === gy) {
    ent.targetGridX = gx;
    ent.targetGridY = gy;
    ctx.stopEntityMotion(ent);
    ctx.snapEntityToGrid(ent, gx, gy);
    return;
  }

  if (
    ent.targetGridX === gx &&
    ent.targetGridY === gy &&
    ent.moveTween?.isPlaying()
  ) {
    return;
  }

  const reduced = ctx.registry.get("reducedMotion") as boolean;
  const path = pathForNpcMove(ctx, ent.gridX, ent.gridY, gx, gy, npcId);

  ctx.stopEntityMotion(ent);
  ent.targetGridX = gx;
  ent.targetGridY = gy;
  ctx.snapEntityToGrid(ent, ent.gridX, ent.gridY);

  if (reduced) {
    ctx.snapEntityToGrid(ent, gx, gy);
    return;
  }

  if (!path || path.length <= 1) {
    const dist = Math.abs(ent.gridX - gx) + Math.abs(ent.gridY - gy);
    if (dist === 1) {
      ctx.tweenEntityOneStep(ent, gx, gy, STEP_MS);
    } else {
      ctx.snapEntityToGrid(ent, gx, gy);
    }
    return;
  }

  let stepIndex = 1;
  const walkNext = (): void => {
    if (stepIndex >= path.length) {
      ent.moveTween = undefined;
      return;
    }
    const cell = path[stepIndex]!;
    stepIndex += 1;
    const fromX = ent.gridX;
    const fromY = ent.gridY;
    const { wx, wy } = gridToWorld(cell.x, cell.y);
    ent.container.setDepth(entityYSortDepth(cell.x, cell.y, ent.depthLayer));
    applyStepAnimation(ent, fromX, fromY, cell.x, cell.y);
    ent.moveTween = ctx.tweens.add({
      targets: ent.container,
      x: wx,
      y: wy,
      duration: STEP_MS,
      ease: "Linear",
      onComplete: () => {
        ent.gridX = cell.x;
        ent.gridY = cell.y;
        const continuing = stepIndex < path.length;
        applyStepEndAnimation(ent, continuing);
        if (continuing) {
          walkNext();
        } else {
          ent.moveTween = undefined;
        }
      },
    });
  };
  walkNext();
}
