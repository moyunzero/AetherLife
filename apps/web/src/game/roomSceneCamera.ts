import type Phaser from "phaser";
import { HOME_MAP_TILE_W } from "@aetherlife/shared";
import { CAMERA_LERP } from "./gridMovement.js";
import { CELL_PX, gridToWorld } from "./gridLayout.js";
import type { EntitySprite, PlayerSnap } from "./roomSceneTypes.js";
import type { HomeMapBackground } from "./HomeMapBackground.js";

export type CameraLerpState = {
  x: number | null;
  y: number | null;
};

export type RoomSceneCameraCtx = {
  scene: Phaser.Scene;
  registry: Phaser.Data.DataManager;
  cameras: Phaser.Cameras.Scene2D.CameraManager;
  playerSprites: Map<string, EntitySprite>;
  npcSprites: Map<string, EntitySprite>;
  homeMapBackground: HomeMapBackground;
  getSessionId: () => string | null;
  getViewportW: () => number;
  getViewportH: () => number;
  getLoadedChunks: () => import("@aetherlife/shared").ChunkView[];
  getZoomState: () => { base: number; min: number; max: number };
  setZoomState: (base: number, min: number, max: number) => void;
  getCameraLerp: () => CameraLerpState;
  setCameraLerp: (x: number | null, y: number | null) => void;
};

/** Phaser cam.pan() returns Camera, not Tween — stop via panEffect.reset(). */
export function resetCameraPan(cam: Phaser.Cameras.Scene2D.Camera): void {
  cam.panEffect.reset();
}

export function tickCameraFollow(ctx: RoomSceneCameraCtx, delta: number): void {
  if (ctx.registry.get("uatHomesteadFrame") === true) return;

  const sessionId = ctx.getSessionId();
  if (!sessionId) return;

  const selfEnt = ctx.playerSprites.get(sessionId);
  const cam = ctx.cameras.main;
  const reduced = ctx.registry.get("reducedMotion") as boolean;
  const lerp = ctx.getCameraLerp();

  let targetX: number;
  let targetY: number;

  if (selfEnt) {
    targetX = selfEnt.container.x;
    targetY = selfEnt.container.y;
  } else {
    const players = (ctx.registry.get("players") as PlayerSnap[]) ?? [];
    const self = players.find((p) => p.sessionId === sessionId);
    if (!self) return;
    const w = gridToWorld(self.x, self.y);
    targetX = w.wx;
    targetY = w.wy;
  }

  if (reduced) {
    resetCameraPan(cam);
    cam.centerOn(targetX, targetY);
    ctx.setCameraLerp(targetX, targetY);
    return;
  }

  if (lerp.x == null || lerp.y == null) {
    resetCameraPan(cam);
    cam.centerOn(targetX, targetY);
    ctx.setCameraLerp(targetX, targetY);
    return;
  }

  const dt = Math.min(delta, 50);
  const t = 1 - (1 - CAMERA_LERP) ** (dt / 16.67);
  const nextX = lerp.x + (targetX - lerp.x) * t;
  const nextY = lerp.y + (targetY - lerp.y) * t;
  resetCameraPan(cam);
  cam.centerOn(nextX, nextY);
  ctx.setCameraLerp(nextX, nextY);
}

export function fitCameraToViewport(ctx: RoomSceneCameraCtx): void {
  const w = ctx.getViewportW();
  const h = ctx.getViewportH();
  const cam = ctx.cameras.main;
  const zx = cam.width / w;
  const zy = cam.height / h;
  const z = Math.min(zx, zy);
  ctx.setZoomState(z, z * 0.55, z * 1.85);
  cam.setZoom(z);
  centerCameraOnPlayer(ctx);
}

export function centerCameraOnPlayer(ctx: RoomSceneCameraCtx): void {
  const sessionId = ctx.getSessionId();
  const selfEnt = sessionId ? ctx.playerSprites.get(sessionId) : undefined;
  const cam = ctx.cameras.main;
  resetCameraPan(cam);

  if (selfEnt) {
    ctx.setCameraLerp(selfEnt.container.x, selfEnt.container.y);
    cam.centerOn(selfEnt.container.x, selfEnt.container.y);
    return;
  }

  const players = (ctx.registry.get("players") as PlayerSnap[]) ?? [];
  const self = players.find((p) => p.sessionId === sessionId);
  if (self) {
    const { wx, wy } = gridToWorld(self.x, self.y);
    ctx.setCameraLerp(wx, wy);
    cam.centerOn(wx, wy);
    return;
  }

  ctx.setCameraLerp(null, null);
  cam.centerOn(ctx.getViewportW() / 2, ctx.getViewportH() / 2);
}

/** Pin AE-08 homestead shot — camera + zoom; re-applied after syncEntities. */
export function applyHomesteadScreenshotFrame(ctx: RoomSceneCameraCtx): void {
  const cam = ctx.cameras.main;
  resetCameraPan(cam);

  const homeSpan = HOME_MAP_TILE_W * CELL_PX;
  cam.setBounds(0, 0, homeSpan, homeSpan);

  cam.centerOn(homeSpan / 2, homeSpan / 2);
  ctx.setCameraLerp(homeSpan / 2, homeSpan / 2);

  const zoomForHome = Math.min(cam.width / homeSpan, cam.height / homeSpan);
  cam.setZoom(zoomForHome);

  for (const ent of ctx.playerSprites.values()) {
    ent.container.setVisible(false);
  }
  for (const ent of ctx.npcSprites.values()) {
    ent.container.setVisible(false);
  }
}
