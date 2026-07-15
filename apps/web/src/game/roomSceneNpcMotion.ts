import type Phaser from "phaser";
import type { GridCell, RoomState } from "@aetherlife/shared";
import { clientFindPath } from "../lib/chunkWalkability.js";
import { entityYSortDepth } from "./entityLayout.js";
import { gridToWorld } from "./gridLayout.js";
import {
  NPC_ANIMATE_CATCHUP_MAX_CELLS,
  NPC_GRID_STEP_MS,
  shouldSnapNpcCatchup,
} from "./gridMovement.js";
import {
  applyStepAnimation,
  applyStepEndAnimation,
} from "./entitySprites.js";
import { isLpcProfile, lpcNpc1WalkCycleMs } from "./lpcNpc1Sheet.js";
import type { EntitySprite, PlayerSnap } from "./roomSceneTypes.js";

const STEP_MS = NPC_GRID_STEP_MS;
/** Match remote peers — Linear + frozen stand reads as 漂移. */
const NPC_STEP_EASE = "Cubic.easeInOut";

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
  ent.pendingGridX = undefined;
  ent.pendingGridY = undefined;
  ctx.stopEntityMotion(ent);
  ctx.snapEntityToGrid(ent, gx, gy);
}

function beginNpcStepTween(
  ctx: RoomSceneNpcMotionCtx,
  ent: EntitySprite,
  gx: number,
  gy: number,
  onArrived: () => void,
): void {
  const fromX = ent.gridX;
  const fromY = ent.gridY;
  const { wx, wy } = gridToWorld(gx, gy);
  ent.container.setDepth(entityYSortDepth(gx, gy, ent.depthLayer));
  applyStepAnimation(ent, fromX, fromY, gx, gy);
  // Pace LPC gait to one cycle per cell (Phaser AnimationState.timeScale).
  if (ent.avatar?.anims) {
    const profile = ent.spriteProfile;
    const cycleMs =
      profile && isLpcProfile(profile) ? lpcNpc1WalkCycleMs(profile) : STEP_MS;
    ent.avatar.anims.timeScale = cycleMs / STEP_MS;
  }
  ent.moveTween = ctx.tweens.add({
    targets: ent.container,
    x: wx,
    y: wy,
    duration: STEP_MS,
    ease: NPC_STEP_EASE,
    onComplete: () => {
      ent.gridX = gx;
      ent.gridY = gy;
      ent.moveTween = undefined;
      if (ent.avatar?.anims) ent.avatar.anims.timeScale = 1;
      onArrived();
    },
  });
}

/**
 * NPC moves step-by-step (~NPC_GRID_STEP_MS/cell = one LPC gait).
 * Must not kill an in-flight step when a stale schema still reports the start cell
 * (ISSUE-004-style interrupt) — that causes idle-pose Linear “漂移”.
 */
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
    ent.pendingGridX = undefined;
    ent.pendingGridY = undefined;
    // Stale schema at start cell while still tweening toward dest — keep going.
    if (ent.moveTween?.isPlaying()) return;
    return;
  }

  if (
    ent.targetGridX === gx &&
    ent.targetGridY === gy &&
    ent.moveTween?.isPlaying()
  ) {
    return;
  }

  if (ent.moveTween?.isPlaying()) {
    // Queue at most one follow-up cell; finish current step first.
    ent.pendingGridX = gx;
    ent.pendingGridY = gy;
    ent.targetGridX = gx;
    ent.targetGridY = gy;
    return;
  }

  const reduced = ctx.registry.get("reducedMotion") as boolean;
  ent.targetGridX = gx;
  ent.targetGridY = gy;
  ent.pendingGridX = undefined;
  ent.pendingGridY = undefined;

  if (reduced || shouldSnapNpcCatchup(ent.gridX, ent.gridY, gx, gy)) {
    ctx.stopEntityMotion(ent);
    ctx.snapEntityToGrid(ent, gx, gy);
    applyStepEndAnimation(ent, false);
    return;
  }

  const path = pathForNpcMove(ctx, ent.gridX, ent.gridY, gx, gy, npcId);
  const resumeFromPendingOrIdle = (): void => {
    const px = ent.pendingGridX;
    const py = ent.pendingGridY;
    if (px != null && py != null && (px !== ent.gridX || py !== ent.gridY)) {
      ent.pendingGridX = undefined;
      ent.pendingGridY = undefined;
      tweenNpcTo(ctx, ent, px, py, npcId);
      return;
    }
    applyStepEndAnimation(ent, false);
  };

  if (!path || path.length <= 1) {
    const dist = Math.abs(ent.gridX - gx) + Math.abs(ent.gridY - gy);
    if (dist === 1) {
      beginNpcStepTween(ctx, ent, gx, gy, resumeFromPendingOrIdle);
    } else {
      ctx.snapEntityToGrid(ent, gx, gy);
      applyStepEndAnimation(ent, false);
    }
    return;
  }

  if (path.length - 1 > NPC_ANIMATE_CATCHUP_MAX_CELLS) {
    ctx.snapEntityToGrid(ent, gx, gy);
    applyStepEndAnimation(ent, false);
    return;
  }

  let stepIndex = 1;
  const walkNext = (): void => {
    if (stepIndex >= path.length) {
      resumeFromPendingOrIdle();
      return;
    }
    const cell = path[stepIndex]!;
    stepIndex += 1;
    beginNpcStepTween(ctx, ent, cell.x, cell.y, () => {
      const continuing = stepIndex < path.length;
      if (continuing) {
        walkNext();
      } else {
        resumeFromPendingOrIdle();
      }
    });
  };
  walkNext();
}
