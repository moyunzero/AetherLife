import * as Phaser from "phaser";
import {
  CHUNK_SIZE,
  buildMoveGrid,
  chunkViewsFingerprint,
  createDefaultRoom,
  findGridPath,
  shouldSuppressLocalSchemaSnap,
  type BiomeId,
  type ChunkView,
  type GameObject,
  type GridCell,
  type NpcState,
  type RoomState,
} from "@aetherlife/shared";
import { clientFindPath } from "../lib/chunkWalkability.js";
import {
  MARKER_CY,
  MARKER_LABEL_MAX_WIDTH,
  MARKER_LABEL_Y,
  MARKER_RADIUS,
  MARKER_STROKE,
} from "./entityLayout.js";
import { entityDepth } from "./entityLayout.js";
import { CELL_PX, VIEWPORT_CELLS, gridToWorld, worldSize, worldToGrid } from "./gridLayout.js";
import { isGlobalFloorBlocked } from "./floorBlocked.js";
import {
  ENTITY_LABEL_COLOR,
  ENTITY_LABEL_FONT,
  ENTITY_LABEL_FONT_SIZE,
  npcDisplayName,
  THINKING_PULSE_MS,
} from "./entityLabels.js";
import { playerDisplayName } from "../lib/playerDisplayName.js";
import {
  attachGridMovementKeys,
  CAMERA_LERP,
  GRID_STEP_MS,
  type GridMovementKeyHandle,
} from "./gridMovement.js";
import type { LocalPlayerMotionBridge } from "./localPlayerMotion.js";
import { LocalPlayerMovementController } from "./LocalPlayerMovementController.js";
import type { MovementSyncController } from "./MovementSyncController.js";
import {
  RemotePlayerInterpolator,
  type RemoteInterpDeps,
} from "./RemotePlayerInterpolator.js";
import { theme } from "./theme.js";

const STEP_MS = GRID_STEP_MS;
const SCENE_KEY = "Room";

type PlayerSnap = {
  sessionId: string;
  playerId?: string;
  x: number;
  y: number;
  facing: string;
};

type MapNpcView = Pick<NpcState, "id" | "name" | "x" | "y">;
type MapObjectView = Pick<GameObject, "kind" | "x" | "y" | "state">;

/** Playwright / UAT: inspect NPC snap vs tween after reset. */
export type AetherlifeNpcDebug = {
  animateNpcMoves: boolean;
  npcs: { id: string; x: number; y: number }[];
  sprites: {
    id: string;
    gridX: number;
    gridY: number;
    targetX: number;
    targetY: number;
    tweening: boolean;
  }[];
};

/** Top-down disc marker — canvas 2D game token, not HTML grid boxes. */
type DiscStyle = {
  fill: number;
  fillAlpha: number;
  stroke: number;
  strokeAlpha: number;
  labelColor?: string;
  radius?: number;
};

type EntitySprite = {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  gridX: number;
  gridY: number;
  depthLayer: 0 | 1 | 2;
  targetGridX?: number;
  targetGridY?: number;
  bobTween?: Phaser.Tweens.Tween;
  pulseTween?: Phaser.Tweens.Tween;
  moveTween?: Phaser.Tweens.Tween;
};

function facingFlipX(facing: string): boolean {
  return facing === "left" || facing === "west";
}

function cellHasActor(
  x: number,
  y: number,
  players: PlayerSnap[],
  npcs: MapNpcView[],
): boolean {
  return (
    players.some((p) => p.x === x && p.y === y)
    || npcs.some((n) => n.x === x && n.y === y)
  );
}

export class RoomScene extends Phaser.Scene {
  private floorGfx!: Phaser.GameObjects.Graphics;
  private pathGfx!: Phaser.GameObjects.Graphics;
  private flashGfx!: Phaser.GameObjects.Graphics;
  private playerSprites = new Map<string, EntitySprite>();
  private npcSprites = new Map<string, EntitySprite>();
  private doorSprites = new Map<string, EntitySprite>();
  private zoomBase = 1;
  private zoomMin = 0.5;
  private zoomMax = 2;
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private lastFloorFingerprint = "";
  private pathTarget: { x: number; y: number } | null = null;
  private flashTween: Phaser.Tweens.Tween | null = null;
  private npcResetEpoch = -1;
  private movementController: LocalPlayerMovementController | null = null;
  private remoteInterp = new RemotePlayerInterpolator();
  private keyHandle: GridMovementKeyHandle | null = null;
  private motionBridge: LocalPlayerMotionBridge | null = null;
  private cameraLerpX: number | null = null;
  private cameraLerpY: number | null = null;
  private lastExploreGx = Number.NaN;
  private lastExploreGy = Number.NaN;
  private collectiveDebugText: Phaser.GameObjects.Text | null = null;

  constructor() {
    super({ key: SCENE_KEY });
  }

  create(): void {
    this.floorGfx = this.add.graphics();
    this.pathGfx = this.add.graphics();
    this.flashGfx = this.add.graphics();
    this.floorGfx.setDepth(0);
    this.pathGfx.setDepth(1);
    this.flashGfx.setDepth(2);
    this.cameras.main.setBackgroundColor(theme.bgDeep);
    // Edge vignette: screen-space CSS only (.room-scene-panel__canvas inset shadow).
    // World-anchored Graphics at depth 50 occluded the player when gridY was small (ISSUE-009).

    this.drawFloor();
    this.fitCamera();
    this.setupInput();
    this.movementController = new LocalPlayerMovementController({
      getEntity: () => this.getLocalPlayerEnt(),
      tweens: this.tweens,
      getReducedMotion: () => Boolean(this.registry.get("reducedMotion")),
      entityDepth,
      snapEntityToGrid: (ent, gx, gy) => this.snapEntityToGrid(ent as EntitySprite, gx, gy),
      stopEntityMotion: (ent) => this.stopEntityMotion(ent as EntitySprite),
      onSnap: (wx, wy) => {
        this.cameraLerpX = wx;
        this.cameraLerpY = wy;
      },
    });
    this.motionBridge = this.movementController.buildBridge();
    this.registry.set("localPlayerMotion", this.motionBridge);

    this.registry.events.on("changedata", this.onRegistryChange, this);
    this.events.on("shutdown", () => {
      this.registry.events.off("changedata", this.onRegistryChange, this);
      this.keyHandle?.destroy();
      this.keyHandle = null;
      this.movementController?.reset();
      this.movementController = null;
      this.remoteInterp.reset();
      this.motionBridge = null;
    });

    this.syncEntities();
    if (this.collectiveDebug()) {
      this.collectiveDebugText = this.add
        .text(8, this.scale.height - 8, "", {
          fontFamily: ENTITY_LABEL_FONT,
          fontSize: "11px",
          color: "#9a9284",
          backgroundColor: "#1a1814cc",
          padding: { x: 6, y: 4 },
        })
        .setScrollFactor(0)
        .setDepth(120)
        .setOrigin(0, 1);
    }
  }

  update(_time: number, delta: number): void {
    this.movementController?.tickPausedPath();
    this.remoteInterp.advance(
      this.playerSprites,
      this.getSessionId(),
      this.getRemoteInterpDeps(),
    );
    this.tickCameraFollow(delta);
    this.tickExploreGrid();
    this.tickCollectiveDebug();
  }

  /** Explore HUD coords — game-loop tick (Wave 2); React reads registry `exploreGrid`. */
  private tickExploreGrid(): void {
    const connected = this.registry.get("connected") as boolean;
    const sessionId = this.getSessionId();
    if (!connected || !sessionId) {
      if (this.registry.get("exploreGrid") != null) {
        this.registry.set("exploreGrid", null);
      }
      this.lastExploreGx = Number.NaN;
      this.lastExploreGy = Number.NaN;
      return;
    }

    const players = (this.registry.get("players") as PlayerSnap[]) ?? [];
    const self = players.find((p) => p.sessionId === sessionId);
    if (!self) return;

    const logic = this.motionBridge?.getLogicGrid();
    const visual = this.getMovementSync()?.getPredictor().getVisualPos();
    const gx = logic?.x ?? visual?.x ?? self.x;
    const gy = logic?.y ?? visual?.y ?? self.y;
    if (gx === this.lastExploreGx && gy === this.lastExploreGy) return;

    this.lastExploreGx = gx;
    this.lastExploreGy = gy;
    this.registry.set("exploreGrid", { gx, gy });
  }

  getLocalPlayerMotionBridge(): LocalPlayerMotionBridge | null {
    return this.motionBridge;
  }

  private getSessionId(): string | null {
    return (this.registry.get("sessionId") as string | null) ?? null;
  }

  private getLocalPlayerEnt(): EntitySprite | undefined {
    const sid = this.getSessionId();
    if (!sid) return undefined;
    return this.playerSprites.get(sid);
  }

  private isLocalLocomoting(): boolean {
    return this.movementController?.isLocalLocomoting() ?? false;
  }

  private getRemoteInterpDeps(): RemoteInterpDeps {
    return {
      tweens: this.tweens,
      getReducedMotion: () => Boolean(this.registry.get("reducedMotion")),
      entityDepth,
      snapEntityToGrid: (ent, gx, gy) =>
        this.snapEntityToGrid(ent as EntitySprite, gx, gy),
      stopEntityMotion: (ent) => this.stopEntityMotion(ent as EntitySprite),
      stepMs: GRID_STEP_MS,
    };
  }

  private tickCameraFollow(delta: number): void {
    const sessionId = this.getSessionId();
    if (!sessionId) return;

    const selfEnt = this.playerSprites.get(sessionId);
    const cam = this.cameras.main;
    const reduced = this.registry.get("reducedMotion") as boolean;

    let targetX: number;
    let targetY: number;

    if (selfEnt) {
      targetX = selfEnt.container.x;
      targetY = selfEnt.container.y;
    } else {
      const players = (this.registry.get("players") as PlayerSnap[]) ?? [];
      const self = players.find((p) => p.sessionId === sessionId);
      if (!self) return;
      const w = gridToWorld(self.x, self.y);
      targetX = w.wx;
      targetY = w.wy;
    }

    if (reduced) {
      this.stopCameraPan();
      cam.centerOn(targetX, targetY);
      this.cameraLerpX = targetX;
      this.cameraLerpY = targetY;
      return;
    }

    if (this.cameraLerpX == null || this.cameraLerpY == null) {
      this.stopCameraPan();
      cam.centerOn(targetX, targetY);
      this.cameraLerpX = targetX;
      this.cameraLerpY = targetY;
      return;
    }

    const dt = Math.min(delta, 50);
    const t = 1 - (1 - CAMERA_LERP) ** (dt / 16.67);
    this.cameraLerpX += (targetX - this.cameraLerpX) * t;
    this.cameraLerpY += (targetY - this.cameraLerpY) * t;
    this.stopCameraPan();
    cam.centerOn(this.cameraLerpX, this.cameraLerpY);
  }

  private onRegistryChange(parent: Phaser.Data.DataManager, key: string): void {
    if (key === "roomSync") this.syncEntities();
  }

  private getViewportW(): number {
    return VIEWPORT_CELLS * CELL_PX;
  }

  private getViewportH(): number {
    return VIEWPORT_CELLS * CELL_PX;
  }

  private getLoadedChunks(): ChunkView[] {
    return (this.registry.get("loadedChunks") as ChunkView[] | undefined) ?? [];
  }

  private terrainDebug(): boolean {
    if (import.meta.env.DEV) return true;
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("terrainDebug") === "1";
  }

  private collectiveDebug(): boolean {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("collectiveDebug") === "1";
  }

  private tickCollectiveDebug(): void {
    if (!this.collectiveDebugText) return;
    const line = this.registry.get("collectiveAttitudeLine") as string | null | undefined;
    const next = line?.trim() ? line : "";
    if (this.collectiveDebugText.text !== next) {
      this.collectiveDebugText.setText(next);
    }
    this.collectiveDebugText.setY(this.scale.height - 8);
  }

  private getMoveMap(): RoomState {
    const map = this.registry.get("moveMap") as RoomState | undefined;
    return map ?? createDefaultRoom();
  }

  private getMovementSync(): MovementSyncController | undefined {
    return this.registry.get("movementSync") as MovementSyncController | undefined;
  }

  private movementDisabled(): boolean {
    const connected = this.registry.get("connected") as boolean;
    const sync = this.getMovementSync();
    const animating = sync?.isAnimating() ?? (this.registry.get("animating") as boolean);
    return !connected || animating;
  }

  private biomeColors(biome: BiomeId | "void", walkable: boolean) {
    if (biome === "void") {
      return walkable ? theme.biomeVoid.walkable : theme.biomeVoid.blocked;
    }
    const pair = theme.biomeColors[biome];
    return walkable ? pair.walkable : pair.blocked;
  }

  private drawFloor(): void {
    const chunks = this.getLoadedChunks();
    this.floorGfx.clear();
    if (chunks.length === 0) {
      const map = this.getMoveMap();
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          const blocked = isGlobalFloorBlocked(map, chunks, x, y);
          this.floorGfx.fillStyle(blocked ? theme.floorBlocked : theme.floorWalkable, 1);
          this.floorGfx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
          this.floorGfx.lineStyle(1, theme.gridLine, 1);
          this.floorGfx.strokeRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
        }
      }
      return;
    }

    for (const chunk of chunks) {
      for (const tile of chunk.tiles) {
        const gx = chunk.cx * CHUNK_SIZE + tile.lx;
        const gy = chunk.cy * CHUNK_SIZE + tile.ly;
        const fill = this.biomeColors(tile.biome, tile.walkable);
        this.floorGfx.fillStyle(fill, 1);
        this.floorGfx.fillRect(gx * CELL_PX, gy * CELL_PX, CELL_PX, CELL_PX);
        this.floorGfx.lineStyle(1, theme.gridLine, 1);
        this.floorGfx.strokeRect(gx * CELL_PX, gy * CELL_PX, CELL_PX, CELL_PX);
      }
      if (this.terrainDebug()) {
        const left = chunk.cx * CHUNK_SIZE * CELL_PX;
        const top = chunk.cy * CHUNK_SIZE * CELL_PX;
        const size = CHUNK_SIZE * CELL_PX;
        this.floorGfx.lineStyle(1, theme.accentDim, 0.55);
        this.floorGfx.strokeRect(left, top, size, size);
      }
    }
  }

  private fitCamera(): void {
    const w = this.getViewportW();
    const h = this.getViewportH();
    const cam = this.cameras.main;
    const zx = cam.width / w;
    const zy = cam.height / h;
    const z = Math.min(zx, zy) * 0.92;
    this.zoomBase = z;
    this.zoomMin = z * 0.55;
    this.zoomMax = z * 1.85;
    cam.setZoom(z);
    this.centerCameraOnPlayer();
  }

  /** Phaser cam.pan() returns Camera, not Tween — stop via panEffect.reset(). */
  private stopCameraPan(): void {
    this.cameras.main.panEffect.reset();
  }

  /** One-shot camera snap (fit / no local sprite). Per-frame follow is `tickCameraFollow`. */
  private centerCameraOnPlayer(): void {
    const sessionId = this.getSessionId();
    const selfEnt = sessionId ? this.playerSprites.get(sessionId) : undefined;
    const cam = this.cameras.main;
    this.stopCameraPan();

    if (selfEnt) {
      this.cameraLerpX = selfEnt.container.x;
      this.cameraLerpY = selfEnt.container.y;
      cam.centerOn(selfEnt.container.x, selfEnt.container.y);
      return;
    }

    const players = (this.registry.get("players") as PlayerSnap[]) ?? [];
    const self = players.find((p) => p.sessionId === sessionId);
    if (self) {
      const { wx, wy } = gridToWorld(self.x, self.y);
      this.cameraLerpX = wx;
      this.cameraLerpY = wy;
      cam.centerOn(wx, wy);
      return;
    }

    this.cameraLerpX = null;
    this.cameraLerpY = null;
    cam.centerOn(this.getViewportW() / 2, this.getViewportH() / 2);
  }

  private setupInput(): void {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.movementDisabled()) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const { x, y } = worldToGrid(world.x, world.y);
      const map = this.getMoveMap();
      const chunks = this.getLoadedChunks();
      if (isGlobalFloorBlocked(map, chunks, x, y)) {
        this.flashCell(x, y);
        return;
      }

      const sync = this.getMovementSync();
      void sync?.sendMoveTo(x, y);
      this.pathTarget = { x, y };
      this.drawPathPreview(x, y);
    });

    this.input.on(
      "wheel",
      (
        _pointer: Phaser.Input.Pointer,
        _gameObjects: unknown,
        _deltaX: number,
        deltaY: number,
      ) => {
        const cam = this.cameras.main;
        const next = Phaser.Math.Clamp(cam.zoom - deltaY * 0.001, this.zoomMin, this.zoomMax);
        cam.setZoom(next);
      },
    );

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.input.pointer1.isDown && this.input.pointer2.isDown) {
        this.pinchStartDist = Phaser.Math.Distance.Between(
          this.input.pointer1.x,
          this.input.pointer1.y,
          this.input.pointer2.x,
          this.input.pointer2.y,
        );
        this.pinchStartZoom = this.cameras.main.zoom;
      }
    });

    this.input.on("pointermove", () => {
      if (!this.input.pointer1.isDown || !this.input.pointer2.isDown) return;
      if (this.pinchStartDist <= 0) return;
      const dist = Phaser.Math.Distance.Between(
        this.input.pointer1.x,
        this.input.pointer1.y,
        this.input.pointer2.x,
        this.input.pointer2.y,
      );
      const ratio = dist / this.pinchStartDist;
      const next = Phaser.Math.Clamp(this.pinchStartZoom * ratio, this.zoomMin, this.zoomMax);
      this.cameras.main.setZoom(next);
    });

    this.input.on("pointerup", () => {
      this.pinchStartDist = 0;
    });

    this.keyHandle?.destroy();
    this.keyHandle = attachGridMovementKeys({
      enabled: true,
      stepMs: GRID_STEP_MS,
      onMove: (dx, dy) => {
        if (this.movementDisabled()) return;
        this.getMovementSync()?.sendWasd(dx, dy);
      },
    });
  }

  private flashCell(x: number, y: number): void {
    this.flashGfx.clear();
    this.flashGfx.fillStyle(theme.destructive, 0.55);
    this.flashGfx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
    this.flashTween?.stop();
    this.flashTween = this.tweens.add({
      targets: this.flashGfx,
      alpha: { from: 1, to: 0 },
      duration: 200,
      onComplete: () => {
        this.flashGfx.clear();
        this.flashGfx.setAlpha(1);
      },
    });
  }

  private drawPathPreview(targetX: number, targetY: number): void {
    const reduced = this.registry.get("reducedMotion") as boolean;
    if (reduced) {
      this.pathGfx.clear();
      return;
    }

    const sessionId = this.registry.get("sessionId") as string | null;
    const players = (this.registry.get("players") as PlayerSnap[]) ?? [];
    const self = players.find((p) => p.sessionId === sessionId);
    if (!self) {
      this.pathGfx.clear();
      return;
    }

    const selfEnt = sessionId ? this.playerSprites.get(sessionId) : undefined;
    const originX = selfEnt?.gridX ?? self.x;
    const originY = selfEnt?.gridY ?? self.y;

    const map = this.getMoveMap();
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
      this.getLoadedChunks(),
    );
    this.pathGfx.clear();
    if (!path || path.length < 2) return;

    this.pathGfx.lineStyle(3, theme.accentDim, 0.4);
    const first = path[0]!;
    let prev = gridToWorld(first.x, first.y);
    for (let i = 1; i < path.length; i += 1) {
      const cell = path[i]!;
      const next = gridToWorld(cell.x, cell.y);
      this.pathGfx.beginPath();
      this.pathGfx.moveTo(prev.wx, prev.wy);
      this.pathGfx.lineTo(next.wx, next.wy);
      this.pathGfx.strokePath();
      prev = next;
    }
  }

  private clearPath(): void {
    this.pathGfx.clear();
    this.pathTarget = null;
  }

  syncEntities(): void {
    const map = this.getMoveMap();
    const chunks = this.getLoadedChunks();
    const floorFp = chunkViewsFingerprint(chunks);
    if (map && floorFp !== this.lastFloorFingerprint) {
      this.lastFloorFingerprint = floorFp;
      this.drawFloor();
    }

    const connected = this.registry.get("connected") as boolean;
    const players = (this.registry.get("players") as PlayerSnap[]) ?? [];
    const sessionId = this.registry.get("sessionId") as string | null;
    const mapNpcs = (this.registry.get("mapNpcs") as MapNpcView[]) ?? [];
    const mapObjects = (this.registry.get("mapObjects") as MapObjectView[]) ?? [];
    const thinkingNpcId = this.registry.get("thinkingNpcId") as string | null;
    const animating = this.registry.get("animating") as boolean;
    const pendingMoves = this.getMovementSync()?.getPendingCount() ?? 0;
    const reduced = this.registry.get("reducedMotion") as boolean;

    if (!animating && this.pathTarget) {
      this.clearPath();
    }

    const remoteDeps = this.getRemoteInterpDeps();

    const seenPlayers = new Set<string>();
    for (const p of players) {
      seenPlayers.add(p.sessionId);
      const isSelf = p.sessionId === sessionId;
      const label = playerDisplayName(p.playerId, isSelf);
      const playerColor = isSelf ? theme.accent : theme.playerOther;
      let ent = this.playerSprites.get(p.sessionId);
      if (!ent) {
        ent = this.createDiscMarker(label, p.x, p.y, {
          fill: theme.bgDeep,
          fillAlpha: 0,
          stroke: playerColor,
          strokeAlpha: 1,
          labelColor: isSelf ? "#c9a227" : undefined,
        }, 2);
        this.playerSprites.set(p.sessionId, ent);
        if (isSelf) {
          this.cameraLerpX = ent.container.x;
          this.cameraLerpY = ent.container.y;
        }
      }
      const logic = isSelf ? this.motionBridge?.getLogicGrid() : null;
      const localX = isSelf ? (logic?.x ?? ent.gridX) : ent.gridX;
      const localY = isSelf ? (logic?.y ?? ent.gridY) : ent.gridY;
      if (isSelf) {
        if (
          shouldSuppressLocalSchemaSnap({
            pendingMoves,
            isLocomoting: this.isLocalLocomoting(),
            localX,
            localY,
            schemaX: p.x,
            schemaY: p.y,
          })
        ) {
          ent.targetGridX = ent.gridX;
          ent.targetGridY = ent.gridY;
        }
      } else {
        this.remoteInterp.pushServerCell(p.sessionId, p.x, p.y);
        const forced = this.remoteInterp.takePendingSnap(p.sessionId);
        if (forced) {
          this.remoteInterp.snapToServer(p.sessionId, ent, forced.x, forced.y, remoteDeps);
        } else if (this.remoteInterp.needsSnap(p.sessionId, ent)) {
          this.remoteInterp.snapToServer(p.sessionId, ent, p.x, p.y, remoteDeps);
        }
      }
      ent.body.setFillStyle(theme.bgDeep, 0);
      ent.body.setStrokeStyle(MARKER_STROKE, playerColor, connected ? 1 : 0.35);
      ent.ring.setStrokeStyle(MARKER_STROKE, playerColor, connected ? 0.45 : 0.15);
      ent.label.setText(label);
      ent.label.setColor(isSelf ? "#c9a227" : ENTITY_LABEL_COLOR);
      ent.container.setScale(facingFlipX(p.facing) ? -1 : 1, 1);
      ent.container.setDepth(entityDepth(localX, localY, ent.depthLayer));
    }
    for (const [id, ent] of this.playerSprites) {
      if (!seenPlayers.has(id)) {
        this.remoteInterp.remove(id);
        ent.container.destroy();
        this.playerSprites.delete(id);
      }
    }

    const resetEpoch = (this.registry.get("npcResetEpoch") as number) ?? 0;
    if (resetEpoch !== this.npcResetEpoch) {
      this.npcResetEpoch = resetEpoch;
      for (const ent of this.npcSprites.values()) {
        this.stopEntityMotion(ent);
        ent.container.destroy();
      }
      this.npcSprites.clear();
    }

    const seenNpcs = new Set<string>();
    const animateNpcMoves = this.registry.get("npcAnimateMoves") === true;
    for (const npc of mapNpcs) {
      seenNpcs.add(npc.id);
      let ent = this.npcSprites.get(npc.id);
      if (!ent) {
        ent = this.createDiscMarker(npcDisplayName(npc.name), npc.x, npc.y, {
          fill: theme.npcTint,
          fillAlpha: 0.85,
          stroke: theme.npcTint,
          strokeAlpha: 1,
          labelColor: "#c9a227",
        }, 1);
        this.npcSprites.set(npc.id, ent);
      }
      if (animateNpcMoves) {
        this.tweenNpcTo(ent, npc.x, npc.y, npc.id);
      } else {
        this.snapNpcTo(ent, npc.x, npc.y);
      }
      ent.label.setText(npcDisplayName(npc.name));
      ent.body.setFillStyle(theme.npcTint, connected ? 0.85 : 0.35);
      ent.ring.setStrokeStyle(MARKER_STROKE, theme.npcTint, connected ? 0.5 : 0.2);

      if (!ent.moveTween?.isPlaying()) {
        this.startNpcBob(ent, ent.gridX, ent.gridY, reduced, thinkingNpcId === npc.id);
      }
      if (thinkingNpcId === npc.id && !reduced) {
        ent.pulseTween?.stop();
        ent.pulseTween = this.tweens.add({
          targets: [ent.body, ent.ring],
          alpha: { from: 1, to: 0.45 },
          duration: THINKING_PULSE_MS,
          yoyo: true,
          repeat: -1,
          onUpdate: () => {
            ent!.body.setFillStyle(theme.accent, ent!.body.alpha);
          },
        });
      }
    }
    for (const [id, ent] of this.npcSprites) {
      if (!seenNpcs.has(id)) {
        this.stopEntityMotion(ent);
        ent.container.destroy();
        this.npcSprites.delete(id);
      }
    }

    const seenDoors = new Set<string>();
    for (const obj of mapObjects) {
      if (obj.kind !== "door") continue;
      const key = `door-${obj.x}-${obj.y}`;
      seenDoors.add(key);

      if (cellHasActor(obj.x, obj.y, players, mapNpcs)) {
        const hidden = this.doorSprites.get(key);
        if (hidden) {
          hidden.container.destroy();
          this.doorSprites.delete(key);
        }
        continue;
      }

      const strokeColor = obj.state === "closed" ? theme.doorClosed : theme.doorOpen;
      let ent = this.doorSprites.get(key);
      if (!ent) {
        ent = this.createDiscMarker("门", obj.x, obj.y, {
          fill: theme.doorFill,
          fillAlpha: 0.9,
          stroke: strokeColor,
          strokeAlpha: 1,
          radius: MARKER_RADIUS - 2,
        }, 0);
        this.doorSprites.set(key, ent);
      }
      ent.container.setVisible(true);
      this.tweenEntityTo(ent, obj.x, obj.y, STEP_MS);
      ent.body.setFillStyle(theme.doorFill, connected ? 0.9 : 0.35);
      ent.body.setStrokeStyle(MARKER_STROKE, strokeColor, connected ? 1 : 0.35);
      ent.ring.setStrokeStyle(1, strokeColor, connected ? 0.45 : 0.15);
      ent.label.setText("门");
    }
    for (const [id, ent] of this.doorSprites) {
      if (!seenDoors.has(id)) {
        ent.container.destroy();
        this.doorSprites.delete(id);
      }
    }

    this.tickExploreGrid();

    if (import.meta.env.DEV && typeof window !== "undefined") {
      const w = window as Window & {
        __aetherlife_npcDebug?: () => AetherlifeNpcDebug;
        __aetherlife_sendMoveTo?: (x: number, y: number) => void;
        __aetherlife_moveDebug?: () => {
          gridX: number;
          gridY: number;
          schemaX: number;
          schemaY: number;
          pending: number;
          visualOnlyAhead: number;
          inputBuffer: { dx: number; dy: number } | null;
          locomoting: boolean;
          suppressSnap: boolean;
        } | null;
      };
      w.__aetherlife_moveDebug = () => {
        const sid = this.getSessionId();
        if (!sid) return null;
        const snap = ((this.registry.get("players") as PlayerSnap[]) ?? []).find(
          (pl) => pl.sessionId === sid,
        );
        const ent = this.playerSprites.get(sid);
        if (!snap || !ent) return null;
        const sync = this.getMovementSync();
        const predictor = sync?.getPredictor();
        const pending = sync?.getPendingCount() ?? 0;
        const logic = this.motionBridge?.getLogicGrid();
        const localX = logic?.x ?? ent.gridX;
        const localY = logic?.y ?? ent.gridY;
        const auth = predictor?.getAuthoritativePos();
        return {
          gridX: localX,
          gridY: localY,
          schemaX: snap.x,
          schemaY: snap.y,
          authX: auth?.x ?? null,
          authY: auth?.y ?? null,
          pending,
          visualOnlyAhead: predictor?.getVisualOnlyAhead() ?? 0,
          inputBuffer: predictor?.getInputBuffer() ?? null,
          locomoting: this.isLocalLocomoting(),
          suppressSnap: shouldSuppressLocalSchemaSnap({
            pendingMoves: pending,
            isLocomoting: this.isLocalLocomoting(),
            localX,
            localY,
            schemaX: snap.x,
            schemaY: snap.y,
          }),
        };
      };
      w.__aetherlife_sendMoveTo = (x, y) => {
        void this.getMovementSync()?.sendMoveTo(x, y);
      };
      w.__aetherlife_npcDebug = () => ({
        animateNpcMoves,
        npcs: mapNpcs.map((n) => ({ id: n.id, x: n.x, y: n.y })),
        sprites: [...this.npcSprites.entries()].map(([id, ent]) => ({
          id,
          gridX: ent.gridX,
          gridY: ent.gridY,
          targetX: ent.targetGridX ?? ent.gridX,
          targetY: ent.targetGridY ?? ent.gridY,
          tweening: Boolean(ent.moveTween?.isPlaying()),
        })),
      });
    }
  }

  /** Top-down disc + label — Phaser canvas markers, not MovementPanel grid boxes. */
  private createDiscMarker(
    label: string,
    gx: number,
    gy: number,
    style: DiscStyle,
    layer: 0 | 1 | 2 = 1,
  ): EntitySprite {
    const { wx, wy } = gridToWorld(gx, gy);
    const container = this.add.container(wx, wy);
    container.setDepth(entityDepth(gx, gy, layer));

    const r = style.radius ?? MARKER_RADIUS;
    const body = this.add.circle(0, MARKER_CY, r, style.fill, style.fillAlpha);
    body.setStrokeStyle(MARKER_STROKE, style.stroke, style.strokeAlpha);

    const ring = this.add.circle(0, MARKER_CY, r + 5, 0, 0);
    ring.setStrokeStyle(1, style.stroke, style.strokeAlpha * 0.45);
    ring.setFillStyle(0, 0);

    const text = this.add.text(0, MARKER_LABEL_Y, label, {
      fontSize: ENTITY_LABEL_FONT_SIZE,
      fontFamily: ENTITY_LABEL_FONT,
      color: style.labelColor ?? ENTITY_LABEL_COLOR,
      align: "center",
      wordWrap: { width: MARKER_LABEL_MAX_WIDTH, useAdvancedWrap: true },
    });
    text.setOrigin(0.5, 1);
    container.add([ring, body, text]);
    return {
      container,
      body,
      ring,
      label: text,
      gridX: gx,
      gridY: gy,
      depthLayer: layer,
    };
  }

  private stopEntityMotion(ent: EntitySprite): void {
    ent.bobTween?.stop();
    ent.bobTween = undefined;
    ent.pulseTween?.stop();
    ent.pulseTween = undefined;
    ent.moveTween?.stop();
    ent.moveTween = undefined;
    this.tweens.killTweensOf(ent.container);
  }

  private snapEntityToGrid(ent: EntitySprite, gx: number, gy: number): void {
    const scaleX = ent.container.scaleX;
    const scaleY = ent.container.scaleY;
    ent.gridX = gx;
    ent.gridY = gy;
    const { wx, wy } = gridToWorld(gx, gy);
    ent.container.setPosition(wx, wy);
    ent.container.setScale(scaleX, scaleY);
    ent.container.setDepth(entityDepth(gx, gy, ent.depthLayer));
  }

  private tweenEntityTo(ent: EntitySprite, gx: number, gy: number, duration: number): void {
    if (
      ent.targetGridX === gx &&
      ent.targetGridY === gy &&
      ent.moveTween?.isPlaying()
    ) {
      return;
    }

    if (ent.gridX === gx && ent.gridY === gy && !ent.moveTween?.isPlaying()) {
      ent.targetGridX = gx;
      ent.targetGridY = gy;
      this.snapEntityToGrid(ent, gx, gy);
      return;
    }

    this.stopEntityMotion(ent);
    this.tweenEntityOneStep(ent, gx, gy, duration);
  }

  /** BFS path for NPC visual walk — exclude self so goal cell is reachable. */
  private pathForNpcMove(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    npcId: string,
  ): GridCell[] | null {
    const map = this.getMoveMap();
    const players = (this.registry.get("players") as PlayerSnap[]) ?? [];
    const others = players.map((p) => ({ x: p.x, y: p.y }));
    const grid = buildMoveGrid(map, others, { excludeNpcId: npcId });
    return findGridPath(fromX, fromY, toX, toY, grid);
  }

  /** Load / reset: snap NPC to persisted grid (Stardew-style, no walk-in on refresh). */
  private snapNpcTo(ent: EntitySprite, gx: number, gy: number): void {
    ent.targetGridX = gx;
    ent.targetGridY = gy;
    this.stopEntityMotion(ent);
    this.snapEntityToGrid(ent, gx, gy);
  }

  /** NPC moves step-by-step (~140ms/cell), matching player sendMoveTo animation. */
  private tweenNpcTo(ent: EntitySprite, gx: number, gy: number, npcId: string): void {
    if (ent.gridX === gx && ent.gridY === gy) {
      ent.targetGridX = gx;
      ent.targetGridY = gy;
      this.stopEntityMotion(ent);
      this.snapEntityToGrid(ent, gx, gy);
      return;
    }

    if (
      ent.targetGridX === gx &&
      ent.targetGridY === gy &&
      ent.moveTween?.isPlaying()
    ) {
      return;
    }

    const reduced = this.registry.get("reducedMotion") as boolean;
    const path = this.pathForNpcMove(ent.gridX, ent.gridY, gx, gy, npcId);

    this.stopEntityMotion(ent);
    ent.targetGridX = gx;
    ent.targetGridY = gy;
    this.snapEntityToGrid(ent, ent.gridX, ent.gridY);

    if (reduced) {
      this.snapEntityToGrid(ent, gx, gy);
      return;
    }

    if (!path || path.length <= 1) {
      this.tweenEntityOneStep(ent, gx, gy, STEP_MS);
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
      ent.gridX = cell.x;
      ent.gridY = cell.y;
      const { wx, wy } = gridToWorld(cell.x, cell.y);
      ent.moveTween = this.tweens.add({
        targets: ent.container,
        x: wx,
        y: wy,
        duration: STEP_MS,
        ease: "Linear",
        onComplete: () => {
          if (stepIndex < path.length) {
            walkNext();
          } else {
            ent.moveTween = undefined;
          }
        },
      });
    };
    walkNext();
  }

  /** Local player: never linear-tween across multiple cells (looks diagonal). */
  private tweenLocalPlayerTo(
    ent: EntitySprite,
    gx: number,
    gy: number,
    reduced: boolean,
    clickPathAnimating = false,
  ): void {
    ent.targetGridX = gx;
    ent.targetGridY = gy;
    if (ent.gridX === gx && ent.gridY === gy) return;
    if (reduced) {
      this.stopEntityMotion(ent);
      this.snapEntityToGrid(ent, gx, gy);
      return;
    }
    const manhattan = Math.abs(ent.gridX - gx) + Math.abs(ent.gridY - gy);
    if (clickPathAnimating) {
      this.stopEntityMotion(ent);
      if (manhattan <= 1) {
        this.tweenEntityTo(ent, gx, gy, STEP_MS);
      } else {
        this.snapEntityToGrid(ent, gx, gy);
      }
      return;
    }
    if (manhattan <= 1) {
      this.tweenEntityTo(ent, gx, gy, STEP_MS);
      return;
    }
    this.walkLocalPlayerSteps(ent, gx, gy);
  }

  private walkLocalPlayerSteps(ent: EntitySprite, gx: number, gy: number): void {
    if (
      ent.targetGridX === gx &&
      ent.targetGridY === gy &&
      ent.moveTween?.isPlaying()
    ) {
      return;
    }
    this.stopEntityMotion(ent);
    ent.targetGridX = gx;
    ent.targetGridY = gy;
    let cx = ent.gridX;
    let cy = ent.gridY;

    const walkNext = (): void => {
      if (cx === gx && cy === gy) {
        ent.moveTween = undefined;
        return;
      }
      let nx = cx;
      let ny = cy;
      if (cx !== gx) nx += cx < gx ? 1 : -1;
      else if (cy !== gy) ny += cy < gy ? 1 : -1;
      cx = nx;
      cy = ny;
      ent.gridX = nx;
      ent.gridY = ny;
      const { wx, wy } = gridToWorld(nx, ny);
      ent.container.setDepth(entityDepth(nx, ny, ent.depthLayer));
      ent.moveTween = this.tweens.add({
        targets: ent.container,
        x: wx,
        y: wy,
        duration: STEP_MS,
        ease: "Linear",
        onComplete: () => {
          if (cx === gx && cy === gy) ent.moveTween = undefined;
          else walkNext();
        },
      });
    };
    walkNext();
  }

  private tweenEntityOneStep(
    ent: EntitySprite,
    gx: number,
    gy: number,
    duration: number,
  ): void {
    const reduced = this.registry.get("reducedMotion") as boolean;
    ent.targetGridX = gx;
    ent.targetGridY = gy;
    ent.container.setDepth(entityDepth(gx, gy, ent.depthLayer));
    const { wx, wy } = gridToWorld(gx, gy);
    if (reduced) {
      ent.gridX = gx;
      ent.gridY = gy;
      ent.container.setPosition(wx, wy);
      return;
    }
    ent.moveTween = this.tweens.add({
      targets: ent.container,
      x: wx,
      y: wy,
      duration,
      ease: "Linear",
      onComplete: () => {
        ent.gridX = gx;
        ent.gridY = gy;
        ent.moveTween = undefined;
      },
    });
  }

  private startNpcBob(
    ent: EntitySprite,
    _gx: number,
    _gy: number,
    reduced: boolean,
    thinking: boolean,
  ): void {
    if (reduced || thinking) return;
    ent.label.y = MARKER_LABEL_Y;
    ent.bobTween = this.tweens.add({
      targets: ent.label,
      y: MARKER_LABEL_Y - 2,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }
}

export const ROOM_SCENE_KEY = SCENE_KEY;
