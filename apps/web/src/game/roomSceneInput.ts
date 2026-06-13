import * as Phaser from "phaser";
import type { ChunkView, RoomState } from "@aetherlife/shared";
import { clientFindPath } from "../lib/chunkWalkability.js";
import { isGlobalFloorBlocked } from "./floorBlocked.js";
import { CELL_PX, gridToWorld, worldToGrid } from "./gridLayout.js";
import { attachGridMovementKeys, GRID_STEP_MS, type GridMovementKeyHandle } from "./gridMovement.js";
import type { MovementSyncController } from "./MovementSyncController.js";
import { hitNpcAtWorldPoint } from "./roomSceneViewport.js";
import type { EntitySprite, PlayerSnap } from "./roomSceneTypes.js";
import { theme } from "./theme.js";

export type RoomSceneInputCtx = {
  scene: Phaser.Scene;
  input: Phaser.Input.InputPlugin;
  cameras: Phaser.Cameras.Scene2D.CameraManager;
  tweens: Phaser.Tweens.TweenManager;
  registry: Phaser.Data.DataManager;
  flashGfx: Phaser.GameObjects.Graphics;
  pathGfx: Phaser.GameObjects.Graphics;
  playerSprites: Map<string, EntitySprite>;
  npcSprites: Map<string, EntitySprite>;
  onNpcSelected?: (npcId: string) => void;
  getMoveMap: () => RoomState;
  getLoadedChunks: () => ChunkView[];
  getMovementSync: () => MovementSyncController | undefined;
  movementDisabled: () => boolean;
  getPathTarget: () => { x: number; y: number } | null;
  setPathTarget: (target: { x: number; y: number } | null) => void;
  getZoomBounds: () => { min: number; max: number };
  getPinchState: () => { startDist: number; startZoom: number };
  setPinchState: (startDist: number, startZoom: number) => void;
  setKeyHandle: (handle: GridMovementKeyHandle | undefined) => void;
};

export function flashBlockedCell(ctx: RoomSceneInputCtx, x: number, y: number): Phaser.Tweens.Tween | null {
  ctx.flashGfx.clear();
  ctx.flashGfx.fillStyle(theme.destructive, 0.55);
  ctx.flashGfx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
  return ctx.tweens.add({
    targets: ctx.flashGfx,
    alpha: { from: 1, to: 0 },
    duration: 200,
    onComplete: () => {
      ctx.flashGfx.clear();
      ctx.flashGfx.setAlpha(1);
    },
  });
}

export function drawPathPreview(ctx: RoomSceneInputCtx, targetX: number, targetY: number): void {
  const reduced = ctx.registry.get("reducedMotion") as boolean;
  if (reduced) {
    ctx.pathGfx.clear();
    return;
  }

  const sessionId = ctx.registry.get("sessionId") as string | null;
  const players = (ctx.registry.get("players") as PlayerSnap[]) ?? [];
  const self = players.find((p) => p.sessionId === sessionId);
  if (!self) {
    ctx.pathGfx.clear();
    return;
  }

  const selfEnt = sessionId ? ctx.playerSprites.get(sessionId) : undefined;
  const originX = selfEnt?.gridX ?? self.x;
  const originY = selfEnt?.gridY ?? self.y;

  const map = ctx.getMoveMap();
  const others = players
    .filter((p) => p.sessionId !== sessionId)
    .map((p) => ({ x: p.x, y: p.y }));
  const path = clientFindPath(
    map,
    originX,
    originY,
    targetX,
    targetY,
    others,
    ctx.getLoadedChunks(),
  );
  ctx.pathGfx.clear();
  if (!path || path.length < 2) return;

  ctx.pathGfx.lineStyle(3, theme.accentDim, 0.4);
  const first = path[0]!;
  let prev = gridToWorld(first.x, first.y);
  for (let i = 1; i < path.length; i += 1) {
    const cell = path[i]!;
    const next = gridToWorld(cell.x, cell.y);
    ctx.pathGfx.beginPath();
    ctx.pathGfx.moveTo(prev.wx, prev.wy);
    ctx.pathGfx.lineTo(next.wx, next.wy);
    ctx.pathGfx.strokePath();
    prev = next;
  }
}

export function clearPathPreview(ctx: RoomSceneInputCtx): void {
  ctx.pathGfx.clear();
  ctx.setPathTarget(null);
}

export function setupRoomSceneInput(ctx: RoomSceneInputCtx): void {
  let pendingTap: { x: number; y: number; worldX: number; worldY: number } | null = null;

  const activePointerCount = (): number =>
    [ctx.input.pointer1, ctx.input.pointer2].filter((p) => p.isDown).length;

  ctx.input.on("pointerdown", () => {
    if (ctx.movementDisabled()) return;
    if (activePointerCount() > 1) {
      pendingTap = null;
      return;
    }
    const world = ctx.cameras.main.getWorldPoint(ctx.input.pointer1.x, ctx.input.pointer1.y);
    const { x, y } = worldToGrid(world.x, world.y);
    pendingTap = { x, y, worldX: world.x, worldY: world.y };
  });

  ctx.input.on(
    "wheel",
    (
      _pointer: Phaser.Input.Pointer,
      _gameObjects: unknown,
      _deltaX: number,
      deltaY: number,
    ) => {
      const cam = ctx.cameras.main;
      const { min, max } = ctx.getZoomBounds();
      const next = Phaser.Math.Clamp(cam.zoom - deltaY * 0.001, min, max);
      cam.setZoom(next);
    },
  );

  ctx.input.on("pointerdown", () => {
    if (ctx.input.pointer1.isDown && ctx.input.pointer2.isDown) {
      pendingTap = null;
      const dist = Phaser.Math.Distance.Between(
        ctx.input.pointer1.x,
        ctx.input.pointer1.y,
        ctx.input.pointer2.x,
        ctx.input.pointer2.y,
      );
      ctx.setPinchState(dist, ctx.cameras.main.zoom);
    }
  });

  ctx.input.on("pointermove", () => {
    if (!ctx.input.pointer1.isDown || !ctx.input.pointer2.isDown) return;
    const pinch = ctx.getPinchState();
    if (pinch.startDist <= 0) return;
    const dist = Phaser.Math.Distance.Between(
      ctx.input.pointer1.x,
      ctx.input.pointer1.y,
      ctx.input.pointer2.x,
      ctx.input.pointer2.y,
    );
    const ratio = dist / pinch.startDist;
    const { min, max } = ctx.getZoomBounds();
    const next = Phaser.Math.Clamp(pinch.startZoom * ratio, min, max);
    ctx.cameras.main.setZoom(next);
  });

  ctx.input.on("pointerup", () => {
    ctx.setPinchState(0, ctx.cameras.main.zoom);

    if (activePointerCount() > 0) {
      pendingTap = null;
      return;
    }

    if (!pendingTap || ctx.movementDisabled()) {
      pendingTap = null;
      return;
    }

    const { x, y, worldX, worldY } = pendingTap;
    pendingTap = null;

    const hitNpcId = hitNpcAtWorldPoint(worldX, worldY, ctx.npcSprites);
    if (hitNpcId) {
      ctx.onNpcSelected?.(hitNpcId);
      return;
    }

    const map = ctx.getMoveMap();
    const chunks = ctx.getLoadedChunks();
    if (isGlobalFloorBlocked(map, chunks, x, y)) {
      flashBlockedCell(ctx, x, y);
      return;
    }

    const sync = ctx.getMovementSync();
    void sync?.sendMoveTo(x, y);
    ctx.setPathTarget({ x, y });
    drawPathPreview(ctx, x, y);
  });

  const handle = attachGridMovementKeys({
    enabled: true,
    stepMs: GRID_STEP_MS,
    onMove: (dx, dy) => {
      if (ctx.movementDisabled()) return;
      ctx.getMovementSync()?.sendWasd(dx, dy);
    },
  });
  ctx.setKeyHandle(handle);
}
