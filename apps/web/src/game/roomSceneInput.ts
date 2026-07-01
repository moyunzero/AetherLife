import * as Phaser from "phaser";
import type { ChunkView, RoomState } from "@aetherlife/shared";
import {
  getCouncilSpawnSlots,
  HOME_MAP_TILE_H,
  HOME_MAP_TILE_W,
} from "@aetherlife/shared";
import { clientFindPath } from "../lib/chunkWalkability.js";
import { isGlobalFloorBlocked } from "./floorBlocked.js";
import { CELL_PX, gridToWorld, worldToGrid } from "./gridLayout.js";
import { attachGridMovementKeys, GRID_STEP_MS, type GridMovementKeyHandle } from "./gridMovement.js";
import type { MovementSyncController } from "./MovementSyncController.js";
import { regionWalkabilityAt } from "./regionCollision.js";
import { YSORT_OVERHEAD_DEPTH } from "./entityLayout.js";
import { pickNpcAtWorldPoint } from "./roomSceneViewport.js";
import { refreshNpcChatBubbles } from "./entitySprites.js";
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

function isGridDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("gridDebug") === "1";
}

/** Above all Y-sorted map sprites + Tiled overhead (screen-fixed HUD). */
const GRID_DEBUG_HUD_DEPTH = YSORT_OVERHEAD_DEPTH + 2_000;

function gridDebugHudText(
  x: number,
  y: number,
  pickCount: number,
): string {
  const walk = regionWalkabilityAt(x, y);
  const walkLabel = walk === true ? "可走" : walk === false ? "阻挡" : "区外";
  return `gridDebug · 格 (${x}, ${y}) · ${walkLabel}\n已选 ${pickCount}/12 · Shift+点击记录出生点`;
}

/** Dev: ?gridDebug=1 — grid overlay, hover cell, Shift+click records spawn candidates. */
function setupGridDebugPicker(ctx: RoomSceneInputCtx): void {
  if (!isGridDebugEnabled()) return;

  const w = window as Window & {
    __aetherlife_gridPicks?: Array<{ x: number; y: number }>;
    __aetherlife_clearGridPicks?: () => void;
    __aetherlife_spawnCellInfo?: (x: number, y: number) => {
      x: number;
      y: number;
      walkable: boolean | undefined;
    };
  };
  w.__aetherlife_gridPicks = w.__aetherlife_gridPicks ?? [];

  const overlayGfx = ctx.scene.add.graphics().setDepth(YSORT_OVERHEAD_DEPTH - 200);
  const hoverGfx = ctx.scene.add.graphics().setDepth(YSORT_OVERHEAD_DEPTH - 150);
  const markerGfx = ctx.scene.add.graphics().setDepth(YSORT_OVERHEAD_DEPTH - 100);

  const drawGridOverlay = () => {
    overlayGfx.clear();
    overlayGfx.lineStyle(1, 0xffffff, 0.18);
    for (let x = 0; x <= HOME_MAP_TILE_W; x += 1) {
      const px = x * CELL_PX;
      overlayGfx.lineBetween(px, 0, px, HOME_MAP_TILE_H * CELL_PX);
    }
    for (let y = 0; y <= HOME_MAP_TILE_H; y += 1) {
      const py = y * CELL_PX;
      overlayGfx.lineBetween(0, py, HOME_MAP_TILE_W * CELL_PX, py);
    }
    overlayGfx.lineStyle(2, 0x66ff88, 0.75);
    try {
      for (const slot of getCouncilSpawnSlots()) {
        overlayGfx.strokeRect(
          slot.x * CELL_PX + 2,
          slot.y * CELL_PX + 2,
          CELL_PX - 4,
          CELL_PX - 4,
        );
      }
    } catch {
      // registry not ready — grid lines still useful
    }
  };

  const drawHoverCell = (x: number, y: number) => {
    hoverGfx.clear();
    const walk = regionWalkabilityAt(x, y);
    const color = walk === true ? 0x66ff88 : walk === false ? 0xff6666 : 0xffe566;
    hoverGfx.fillStyle(color, 0.32);
    hoverGfx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
    hoverGfx.lineStyle(2, color, 0.95);
    hoverGfx.strokeRect(x * CELL_PX + 1, y * CELL_PX + 1, CELL_PX - 2, CELL_PX - 2);
  };

  const drawPickMarkers = () => {
    markerGfx.clear();
    markerGfx.lineStyle(3, 0xffe566, 0.95);
    for (const p of w.__aetherlife_gridPicks ?? []) {
      markerGfx.strokeRect(p.x * CELL_PX + 2, p.y * CELL_PX + 2, CELL_PX - 4, CELL_PX - 4);
    }
  };

  w.__aetherlife_clearGridPicks = () => {
    w.__aetherlife_gridPicks = [];
    drawPickMarkers();
  };
  w.__aetherlife_spawnCellInfo = (x, y) => ({
    x,
    y,
    walkable: regionWalkabilityAt(x, y),
  });

  const hud = ctx.scene.add
    .text(0, 0, "", {
      fontSize: "20px",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      color: "#ffe566",
      backgroundColor: "#000000e6",
      padding: { x: 14, y: 10 },
      stroke: "#000000",
      strokeThickness: 4,
    })
    .setDepth(GRID_DEBUG_HUD_DEPTH)
    .setScrollFactor(0)
    .setOrigin(0.5, 0);

  const layoutHud = () => {
    const cam = ctx.cameras.main;
    hud.setPosition(cam.width / 2, 52);
  };
  layoutHud();
  ctx.scene.scale.on("resize", layoutHud);

  const worldFromPointer = (pointer: Phaser.Input.Pointer) =>
    pointer.positionToCamera(ctx.cameras.main) as Phaser.Math.Vector2;

  const updateHover = (pointer: Phaser.Input.Pointer) => {
    const world = worldFromPointer(pointer);
    const { x, y } = worldToGrid(world.x, world.y);
    hud.setText(gridDebugHudText(x, y, w.__aetherlife_gridPicks?.length ?? 0));
    drawHoverCell(x, y);
  };

  ctx.input.on("pointermove", updateHover);

  ctx.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
    if (!pointer.event.shiftKey) return;
    const world = worldFromPointer(pointer);
    const { x, y } = worldToGrid(world.x, world.y);
    const picks = w.__aetherlife_gridPicks!;
    picks.push({ x, y });
    drawPickMarkers();
    const info = w.__aetherlife_spawnCellInfo!(x, y);
    console.log(`[gridDebug] pick #${picks.length}: (${x}, ${y})`, info, picks);
    hud.setText(gridDebugHudText(x, y, picks.length));
  });

  drawGridOverlay();
  drawPickMarkers();
  updateHover(ctx.input.activePointer);
}

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

  if (!ctx.input.pointer2) {
    ctx.input.addPointer(1);
  }

  const worldFromPointer = (pointer: Phaser.Input.Pointer) =>
    pointer.positionToCamera(ctx.cameras.main) as Phaser.Math.Vector2;

  const activePointerCount = (): number => {
    let count = 0;
    if (ctx.input.mousePointer?.isDown) count += 1;
    if (ctx.input.pointer1?.isDown) count += 1;
    if (ctx.input.pointer2?.isDown) count += 1;
    return count;
  };

  const updateNpcHover = (worldX: number, worldY: number) => {
    const { x, y } = worldToGrid(worldX, worldY);
    const hitNpcId = pickNpcAtWorldPoint(worldX, worldY, x, y, ctx.npcSprites);
    const nextId = hitNpcId ?? null;
    const prevId = ctx.registry.get("hoveredNpcId") as string | null | undefined;
    if (nextId === prevId) return;
    ctx.registry.set("hoveredNpcId", nextId);
    refreshNpcChatBubbles(ctx.npcSprites, ctx.registry);
  };

  const clearNpcHover = () => {
    if (ctx.registry.get("hoveredNpcId") == null) return;
    ctx.registry.set("hoveredNpcId", null);
    refreshNpcChatBubbles(ctx.npcSprites, ctx.registry);
  };

  ctx.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
    if (activePointerCount() > 1) {
      pendingTap = null;
      return;
    }
    const world = worldFromPointer(pointer);
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
    const p1 = ctx.input.pointer1;
    const p2 = ctx.input.pointer2;
    if (p1?.isDown && p2?.isDown) {
      pendingTap = null;
      const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
      ctx.setPinchState(dist, ctx.cameras.main.zoom);
    }
  });

  ctx.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
    const p1 = ctx.input.pointer1;
    const p2 = ctx.input.pointer2;
    if (p1?.isDown && p2?.isDown) {
      const pinch = ctx.getPinchState();
      if (pinch.startDist <= 0) return;
      const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
      const ratio = dist / pinch.startDist;
      const { min, max } = ctx.getZoomBounds();
      const next = Phaser.Math.Clamp(pinch.startZoom * ratio, min, max);
      ctx.cameras.main.setZoom(next);
      return;
    }
    if (activePointerCount() > 0) return;
    const world = pointer.positionToCamera(ctx.cameras.main) as Phaser.Math.Vector2;
    updateNpcHover(world.x, world.y);
  });

  ctx.input.on("pointerout", () => {
    clearNpcHover();
  });

  ctx.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
    ctx.setPinchState(0, ctx.cameras.main.zoom);

    if (activePointerCount() > 0) {
      pendingTap = null;
      return;
    }

    if (!pendingTap) {
      return;
    }

    const { x, y, worldX, worldY } = pendingTap;
    pendingTap = null;

    const releaseWorld = worldFromPointer(pointer);
    const releaseGrid = worldToGrid(releaseWorld.x, releaseWorld.y);

    if (isGridDebugEnabled() && pointer.event.shiftKey) {
      return;
    }

    const hitNpcId =
      pickNpcAtWorldPoint(
        releaseWorld.x,
        releaseWorld.y,
        releaseGrid.x,
        releaseGrid.y,
        ctx.npcSprites,
      )
      ?? pickNpcAtWorldPoint(worldX, worldY, x, y, ctx.npcSprites);
    if (hitNpcId) {
      ctx.onNpcSelected?.(hitNpcId);
      return;
    }

    if (ctx.movementDisabled()) {
      return;
    }

    const moveGx = releaseGrid.x;
    const moveGy = releaseGrid.y;
    const map = ctx.getMoveMap();
    const chunks = ctx.getLoadedChunks();
    if (isGlobalFloorBlocked(map, chunks, moveGx, moveGy)) {
      flashBlockedCell(ctx, moveGx, moveGy);
      return;
    }

    const sync = ctx.getMovementSync();
    void sync?.sendMoveTo(moveGx, moveGy);
    ctx.setPathTarget({ x: moveGx, y: moveGy });
    drawPathPreview(ctx, moveGx, moveGy);
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

  setupGridDebugPicker(ctx);
}
