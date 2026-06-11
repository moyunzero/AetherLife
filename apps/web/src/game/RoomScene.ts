import * as Phaser from "phaser";
import {
  CHUNK_SIZE,
  HOME_MAP_TILE_W,
  chunkViewsFingerprint,
  createDefaultRoom,
  isBackgroundNpcId,
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
import { entityYSortDepth } from "./entityLayout.js";
import { CELL_PX, VIEWPORT_CELLS, gridToWorld, worldSize, worldToGrid } from "./gridLayout.js";
import { isGlobalFloorBlocked } from "./floorBlocked.js";
import {
  applyBgActivityStyle,
  applyBgNameplateStyle,
  BG_NPC_TINT,
} from "./bgNpcLabels.js";
import {
  applyNameplateStyle,
  ENTITY_LABEL_COLOR,
  ENTITY_LABEL_FONT,
  ENTITY_LABEL_FONT_SIZE,
  npcDisplayName,
  THINKING_PULSE_MS,
} from "./entityLabels.js";
import {
  activityLabelY,
  createActivityLabel,
  updateActivityLabels,
  type ActivityTarget,
  type NpcAmbientUiState,
} from "./activityLabels.js";
import {
  createIntentLabel,
  intentLabelY,
  updateIntentLabels,
  type IntentLabelTarget,
} from "./intentLabels.js";
import {
  truncateNameplate,
  updateNameplates,
  type NameplateTarget,
} from "./ProximityNameplate.js";
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
import { biomesFromChunks, preloadAdjacentBiomes, loadCoreAreaPack } from "./areaLoader.js";
import { cardinalFacingFromDelta } from "./facing.js";
import { DecorRenderer } from "./DecorRenderer.js";
import { FloorRenderer } from "./FloorRenderer.js";
import { HomeMapBackground } from "./HomeMapBackground.js";
import {
  applyFacingFromSchema,
  applyStepAnimation,
  applyStepEndAnimation,
  createDoorSprite,
  createNpcSprite,
  createPlayerSprite,
  createSpeechBubble,
  npcVariantForId,
  paletteRowForPlayerId,
  playIdleAnim,
  registerCharacterAnims,
  registerNpcAnims,
  setThinkingBubble,
  SPRITE_NAMEPLATE_Y,
} from "./entitySprites.js";
import type { AnimatableEntity } from "./entitySprites.js";
import { playerDisplayName } from "../lib/playerDisplayName.js";
import { ASSET_KEYS, TILE_PX } from "./assetManifest.js";
import {
  logBootTiming,
  markVisualFallbackFromLoadError,
  isVisualFallbackActive,
} from "./visualFallback.js";
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

type EntitySprite = AnimatableEntity & {
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
  nameplateAlpha?: number;
  nameplateTween?: Phaser.Tweens.Tween;
  nameplateWantShow?: boolean;
  activityLabel?: Phaser.GameObjects.Text;
  activityLabelAlpha?: number;
  activityLabelTween?: Phaser.Tweens.Tween;
  activityLabelWantShow?: boolean;
  intentLabel?: Phaser.GameObjects.Text;
  intentLabelAlpha?: number;
  intentLabelTween?: Phaser.Tweens.Tween;
  intentLabelWantShow?: boolean;
  moveTween?: Phaser.Tweens.Tween;
  npcId?: string;
  playerSessionId?: string;
  spriteMode?: boolean;
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
  private preloadStartMs = 0;
  private floorRenderer = new FloorRenderer();
  private decorRenderer = new DecorRenderer();
  private homeMapBackground = new HomeMapBackground();

  constructor() {
    super({ key: SCENE_KEY });
  }

  preload(): void {
    this.preloadStartMs = performance.now();
    loadCoreAreaPack(this.load);
    this.load.on("loaderror", () => {
      markVisualFallbackFromLoadError(this);
    });
  }

  create(): void {
    logBootTiming(this, this.preloadStartMs);
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
    this.scale.on("resize", this.handleScaleResize, this);
    this.time.delayedCall(0, () => this.fitCamera());
    if (this.useSpriteEntities()) {
      registerCharacterAnims(this);
      registerNpcAnims(this);
    }
    this.setupInput();
    this.movementController = new LocalPlayerMovementController({
      getEntity: () => this.getLocalPlayerEnt(),
      tweens: this.tweens,
      getReducedMotion: () => Boolean(this.registry.get("reducedMotion")),
      snapEntityToGrid: (ent, gx, gy) => this.snapEntityToGrid(ent as EntitySprite, gx, gy),
      stopEntityMotion: (ent) => this.stopEntityMotion(ent as EntitySprite),
      onSnap: (wx, wy) => {
        this.cameraLerpX = wx;
        this.cameraLerpY = wy;
      },
      onStepStart: (ent, fx, fy, tx, ty) =>
        this.handleEntityStepStart(ent as EntitySprite, fx, fy, tx, ty),
      onStepEnd: (ent, gx, gy, cont) =>
        this.handleEntityStepEnd(ent as EntitySprite, gx, gy, cont),
      onFaceInput: (dx, dy) => {
        const ent = this.getLocalPlayerEnt();
        if (!ent?.spriteMode) return;
        playIdleAnim(ent, cardinalFacingFromDelta(dx, dy));
      },
    });
    this.motionBridge = this.movementController.buildBridge();
    this.registry.set("localPlayerMotion", this.motionBridge);

    this.registry.events.on("changedata", this.onRegistryChange, this);
    this.events.on("shutdown", () => {
      this.scale.off("resize", this.handleScaleResize, this);
      this.registry.events.off("changedata", this.onRegistryChange, this);
      this.keyHandle?.destroy();
      this.keyHandle = null;
      this.movementController?.reset();
      this.movementController = null;
      this.remoteInterp.reset();
      this.motionBridge = null;
      this.floorRenderer.destroy();
      this.decorRenderer.destroy();
      this.homeMapBackground.destroy();
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
    this.refreshNameplates();
    this.refreshNpcAmbientLabels();
  }

  private useSpriteEntities(): boolean {
    return !isVisualFallbackActive(this) && this.textures.exists(ASSET_KEYS.spritesCharacters);
  }

  private handleEntityStepStart(
    ent: EntitySprite,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): void {
    applyStepAnimation(ent, fromX, fromY, toX, toY);
  }

  private handleEntityStepEnd(ent: EntitySprite, gx: number, gy: number, continuing: boolean): void {
    ent.container.setDepth(entityYSortDepth(gx, gy, ent.depthLayer));
    applyStepEndAnimation(ent, continuing);
  }

  private refreshNameplates(): void {
    if (this.registry.get("uatHomesteadFrame") === true) return;

    const sessionId = this.getSessionId();
    if (!sessionId) return;
    const logic = this.motionBridge?.getLogicGrid();
    const self = this.playerSprites.get(sessionId);
    const localCell = logic
      ? { x: logic.x, y: logic.y }
      : self
        ? { x: self.gridX, y: self.gridY }
        : null;
    const activeNpcId = (this.registry.get("activeNpcId") as string | null) ?? null;
    const thinkingNpcId = (this.registry.get("thinkingNpcId") as string | null) ?? null;
    const targets: NameplateTarget[] = [];
    for (const ent of this.playerSprites.values()) {
      if (ent.playerSessionId === sessionId) {
        ent.label.setAlpha(0);
        continue;
      }
      targets.push(ent);
    }
    for (const ent of this.npcSprites.values()) {
      targets.push(ent);
    }
    updateNameplates(this, targets, localCell, activeNpcId, thinkingNpcId);
  }

  private getNpcAmbientById(): Record<string, NpcAmbientUiState> {
    const fromRegistry = this.registry.get("npcAmbientById") as
      | Record<string, NpcAmbientUiState>
      | undefined;
    if (fromRegistry && Object.keys(fromRegistry).length > 0) {
      return fromRegistry;
    }
    const activityById =
      (this.registry.get("npcActivityById") as Record<string, string> | undefined) ?? {};
    return Object.fromEntries(
      Object.entries(activityById).map(([id, activityKey]) => [id, { activityKey }]),
    );
  }

  private refreshNpcAmbientLabels(): void {
    if (this.registry.get("uatHomesteadFrame") === true) return;

    const sessionId = this.getSessionId();
    if (!sessionId) return;
    const logic = this.motionBridge?.getLogicGrid();
    const self = this.playerSprites.get(sessionId);
    const localCell = logic
      ? { x: logic.x, y: logic.y }
      : self
        ? { x: self.gridX, y: self.gridY }
        : null;
    const activeNpcId = (this.registry.get("activeNpcId") as string | null) ?? null;
    const thinkingNpcId = (this.registry.get("thinkingNpcId") as string | null) ?? null;
    const speakBusyNpcId = (this.registry.get("speakBusyNpcId") as string | null) ?? null;
    const npcAmbientById = this.getNpcAmbientById();

    const activityTargets: ActivityTarget[] = [];
    const intentTargets: IntentLabelTarget[] = [];
    for (const ent of this.npcSprites.values()) {
      if (!ent.npcId) continue;
      if (ent.activityLabel) activityTargets.push(ent as ActivityTarget);
      if (ent.intentLabel) intentTargets.push(ent as IntentLabelTarget);
    }

    const visibleNpcIds = updateActivityLabels(
      this,
      activityTargets,
      localCell,
      npcAmbientById,
      thinkingNpcId,
      activeNpcId,
      speakBusyNpcId,
    );
    this.registry.set("npcActivityVisible", visibleNpcIds);

    const visibleIntentNpcIds = updateIntentLabels(
      this,
      intentTargets,
      localCell,
      npcAmbientById,
      thinkingNpcId,
      activeNpcId,
      speakBusyNpcId,
      {},
    );
    this.registry.set("npcIntentVisible", visibleIntentNpcIds);
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
      snapEntityToGrid: (ent, gx, gy) =>
        this.snapEntityToGrid(ent as EntitySprite, gx, gy),
      stopEntityMotion: (ent) => this.stopEntityMotion(ent as EntitySprite),
      stepMs: GRID_STEP_MS,
      onStepStart: (ent, fx, fy, tx, ty) =>
        this.handleEntityStepStart(ent as EntitySprite, fx, fy, tx, ty),
      onStepEnd: (ent, gx, gy, cont) =>
        this.handleEntityStepEnd(ent as EntitySprite, gx, gy, cont),
    };
  }

  private tickCameraFollow(delta: number): void {
    if (this.registry.get("uatHomesteadFrame") === true) return;

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
    if (isVisualFallbackActive(this)) {
      this.drawFloorGraphics();
      return;
    }
    this.floorGfx.clear();
    const homeMapActive = this.homeMapBackground.refresh(this);
    if (homeMapActive) {
      // Plan A: Tiled map only inside 40×40; no procedural floor/decor overlay.
      return;
    }
    this.floorRenderer.refresh(
      this,
      this.getLoadedChunks(),
      this.getMoveMap(),
      this.terrainDebug(),
      false,
    );
    this.decorRenderer.refresh(this, this.getLoadedChunks(), false);
  }

  /** Graphics fallback — visualFallback query or loader failure (D-23). */
  private drawFloorGraphics(): void {
    const chunks = this.getLoadedChunks();
    this.floorGfx.clear();
    if (chunks.length === 0) {
      const map = this.getMoveMap();
      for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
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

  private handleScaleResize(): void {
    this.fitCamera();
  }

  private fitCamera(): void {
    const w = this.getViewportW();
    const h = this.getViewportH();
    const cam = this.cameras.main;
    const zx = cam.width / w;
    const zy = cam.height / h;
    const z = Math.min(zx, zy);
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

  /** Pin AE-08 homestead shot — camera + zoom; re-applied after syncEntities. */
  private applyHomesteadScreenshotFrame(): void {
    const cam = this.cameras.main;
    this.stopCameraPan();

    const homeSpan = HOME_MAP_TILE_W * CELL_PX;
    cam.setBounds(0, 0, homeSpan, homeSpan);

    cam.centerOn(homeSpan / 2, homeSpan / 2);
    this.cameraLerpX = homeSpan / 2;
    this.cameraLerpY = homeSpan / 2;

    // Show full Beginning Fields (40×40); UAT script crops Phaser FIT letterbox afterward.
    const zoomForHome = Math.min(cam.width / homeSpan, cam.height / homeSpan);
    cam.setZoom(zoomForHome);

    for (const ent of this.playerSprites.values()) {
      ent.container.setVisible(false);
    }
    for (const ent of this.npcSprites.values()) {
      ent.container.setVisible(false);
    }
  }

  /**
   * AE-08 marketing frame: center on homestead path/well, zoom to home chunk, hide avatars.
   * Used by `uat:phase13:playwright` only — not gameplay state.
   */
  private frameHomesteadScreenshot(): boolean {
    this.registry.set("uatHomesteadFrame", true);
    this.applyHomesteadScreenshotFrame();
    const homeMapActive = this.homeMapBackground.refresh(this);
    if (!homeMapActive) {
      this.decorRenderer.refresh(this, this.getLoadedChunks(), false);
    }
    return true;
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
    if (!this.floorGfx) {
      return;
    }
    const map = this.getMoveMap();
    const chunks = this.getLoadedChunks();
    const floorFp = chunkViewsFingerprint(chunks);
    if (map && floorFp !== this.lastFloorFingerprint) {
      this.lastFloorFingerprint = floorFp;
      this.drawFloor();
      preloadAdjacentBiomes(this, biomesFromChunks(chunks));
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
        ent = this.createPlayerEntity(
          label,
          p.x,
          p.y,
          paletteRowForPlayerId(p.playerId, p.sessionId, sessionId ?? ""),
          2,
        );
        ent.playerSessionId = p.sessionId;
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
      ent.label.setText(truncateNameplate(label));
      if (isSelf) {
        ent.label.setAlpha(0);
      } else {
        applyNameplateStyle(ent.label, "player");
      }
      if (ent.spriteMode) {
        ent.container.setScale(1, 1);
        if (!ent.moveTween?.isPlaying()) {
          applyFacingFromSchema(ent, p.facing);
        }
      } else {
        ent.container.setScale(facingFlipX(p.facing) ? -1 : 1, 1);
      }
      ent.container.setDepth(entityYSortDepth(localX, localY, ent.depthLayer));
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
        ent = this.createNpcEntity(npcDisplayName(npc.name), npc.x, npc.y, npc.id, 1);
        this.npcSprites.set(npc.id, ent);
      }
      if (animateNpcMoves) {
        this.tweenNpcTo(ent, npc.x, npc.y, npc.id);
      } else {
        this.snapNpcTo(ent, npc.x, npc.y);
      }
      ent.label.setText(truncateNameplate(npcDisplayName(npc.name)));
      if (isBackgroundNpcId(npc.id)) {
        applyBgNameplateStyle(ent.label);
      } else {
        applyNameplateStyle(ent.label, "npc");
      }
      if (!ent.spriteMode) {
        ent.body.setFillStyle(theme.npcTint, connected ? 0.85 : 0.35);
        ent.ring.setStrokeStyle(MARKER_STROKE, theme.npcTint, connected ? 0.5 : 0.2);
      } else {
        ent.body.setVisible(false);
        ent.ring.setVisible(false);
        setThinkingBubble(ent, thinkingNpcId === npc.id);
      }

      if (!ent.moveTween?.isPlaying()) {
        this.startNpcBob(ent, ent.gridX, ent.gridY, reduced, thinkingNpcId === npc.id);
      }
      if (thinkingNpcId === npc.id && !reduced && !ent.spriteMode) {
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
      } else if (ent.pulseTween) {
        ent.pulseTween.stop();
        ent.pulseTween = undefined;
        if (!ent.spriteMode) {
          ent.body.setAlpha(1);
          ent.ring.setAlpha(1);
          ent.body.setFillStyle(theme.npcTint, connected ? 0.85 : 0.35);
          ent.ring.setStrokeStyle(MARKER_STROKE, theme.npcTint, connected ? 0.5 : 0.2);
        }
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
        ent = this.createDoorEntity(obj.x, obj.y, obj.state === "closed", 0);
        this.doorSprites.set(key, ent);
      }
      ent.container.setVisible(true);
      this.tweenEntityTo(ent, obj.x, obj.y, STEP_MS);
      if (ent.spriteMode && ent.doorSprite) {
        ent.doorSprite.setFrame(obj.state === "closed" ? 0 : 1);
        ent.body.setVisible(false);
        ent.ring.setVisible(false);
        ent.label.setAlpha(0);
      } else {
        ent.body.setFillStyle(theme.doorFill, connected ? 0.9 : 0.35);
        ent.body.setStrokeStyle(MARKER_STROKE, strokeColor, connected ? 1 : 0.35);
        ent.ring.setStrokeStyle(1, strokeColor, connected ? 0.45 : 0.15);
        ent.label.setText("门");
      }
    }
    for (const [id, ent] of this.doorSprites) {
      if (!seenDoors.has(id)) {
        ent.container.destroy();
        this.doorSprites.delete(id);
      }
    }

    this.tickExploreGrid();

    if (this.registry.get("uatHomesteadFrame") === true) {
      this.applyHomesteadScreenshotFrame();
    }

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
        __aetherlife_visualDebug?: () => {
          playerDisplayHeightPx: number;
          panelFillRatio: number;
          canvasUniqueColors: number;
          visualFallback: boolean;
        } | null;
        __aetherlife_uatFrameHomestead?: () => boolean;
        __aetherlife_ambientDebug?: () => {
          minute: number | null;
          label: string | null;
          npcActivityById: Record<string, string>;
          visibleNpcIds: string[];
          reasonZhById: Record<string, string>;
          visibleIntentNpcIds: string[];
        } | null;
        __aetherlife_bgNpcDebug?: () => {
          visibleBgNameplates: Array<{
            id: string;
            testid: string | null;
            fontSize: string;
            alpha: number;
          }>;
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
      w.__aetherlife_uatFrameHomestead = () => this.frameHomesteadScreenshot();
      w.__aetherlife_visualDebug = () => {
        const sid = this.getSessionId();
        const ent = sid ? this.playerSprites.get(sid) : undefined;
        const avatar = ent?.avatar;
        const canvas = this.game.canvas;
        const stage = document.querySelector(".room-scene-panel__stage");
        if (!avatar || !canvas || !stage) return null;
        const stageRect = stage.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const panelFillRatio =
          stageRect.width * stageRect.height > 0
            ? (canvasRect.width * canvasRect.height) / (stageRect.width * stageRect.height)
            : 0;
        const cam = this.cameras.main;
        const scale = canvasRect.width / cam.width;
        const playerDisplayHeightPx = avatar.displayHeight * scale;
        let canvasUniqueColors = 0;
        if (this.textures.exists(ASSET_KEYS.tilesBiomes)) {
          const src = this.textures.get(ASSET_KEYS.tilesBiomes).getSourceImage() as
            | HTMLCanvasElement
            | HTMLImageElement;
          const probe = document.createElement("canvas");
          probe.width = src.width;
          probe.height = src.height;
          const ctx = probe.getContext("2d");
          if (ctx) {
            ctx.drawImage(src, 0, 0);
            const colors = new Set<string>();
            for (let row = 0; row < 5; row += 1) {
              for (let col = 0; col < 4; col += 1) {
                const x = col * TILE_PX + Math.floor(TILE_PX / 2);
                const y = row * TILE_PX + Math.floor(TILE_PX / 2);
                const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
                colors.add(`${r},${g},${b}`);
              }
            }
            canvasUniqueColors = colors.size;
          }
        }
        return {
          playerDisplayHeightPx,
          panelFillRatio,
          canvasUniqueColors,
          visualFallback: isVisualFallbackActive(this),
        };
      };
      w.__aetherlife_ambientDebug = () => {
        const clock = this.registry.get("gameClock") as
          | { minute?: number; label?: string }
          | undefined;
        const minute = typeof clock?.minute === "number" ? clock.minute : null;
        const npcAmbientById = this.getNpcAmbientById();
        const reasonZhById: Record<string, string> = {};
        for (const [id, ambient] of Object.entries(npcAmbientById)) {
          const reason = ambient.intentReasonZh?.trim() ?? "";
          if (reason) reasonZhById[id] = reason;
        }
        return {
          minute,
          label: clock?.label ?? null,
          npcActivityById:
            (this.registry.get("npcActivityById") as Record<string, string> | undefined) ?? {},
          visibleNpcIds:
            (this.registry.get("npcActivityVisible") as string[] | undefined) ?? [],
          reasonZhById,
          visibleIntentNpcIds:
            (this.registry.get("npcIntentVisible") as string[] | undefined) ?? [],
        };
      };
      w.__aetherlife_bgNpcDebug = () => ({
        visibleBgNameplates: [...this.npcSprites.entries()]
          .filter(([id]) => isBackgroundNpcId(id))
          .filter(([, ent]) => (ent.nameplateAlpha ?? ent.label.alpha) > 0.05)
          .map(([id, ent]) => ({
            id,
            testid: ent.label.getData("testid") as string | null,
            fontSize: String(ent.label.style.fontSize ?? ""),
            alpha: ent.label.alpha,
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
    container.setDepth(entityYSortDepth(gx, gy, layer));

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

  private createPlayerEntity(
    label: string,
    gx: number,
    gy: number,
    paletteRow: number,
    layer: 0 | 1 | 2,
  ): EntitySprite {
    const ent = this.createDiscMarker(label, gx, gy, {
      fill: theme.bgDeep,
      fillAlpha: 0,
      stroke: 0xc9a227,
      strokeAlpha: 0,
    }, layer);
    ent.label.setText(truncateNameplate(label));
    applyNameplateStyle(ent.label, "player");
    if (!this.useSpriteEntities()) return ent;

    ent.spriteMode = true;
    ent.paletteRow = paletteRow;
    ent.facingDir = "down";
    const avatar = createPlayerSprite(this, paletteRow);
    ent.body.setVisible(false);
    ent.ring.setVisible(false);
    ent.label.setText(truncateNameplate(label));
    ent.label.setAlpha(0);
    ent.label.y = SPRITE_NAMEPLATE_Y;
    applyNameplateStyle(ent.label, "player");
    ent.container.addAt(avatar, 0);
    ent.avatar = avatar;
    playIdleAnim(ent, "down");
    return ent;
  }

  private createNpcEntity(
    label: string,
    gx: number,
    gy: number,
    npcId: string,
    layer: 0 | 1 | 2,
  ): EntitySprite {
    const isBg = isBackgroundNpcId(npcId);
    const ent = this.createDiscMarker(label, gx, gy, {
      fill: theme.npcTint,
      fillAlpha: 0.85,
      stroke: theme.npcTint,
      strokeAlpha: 1,
      labelColor: isBg ? "#c8c0a8" : "#c9a227",
    }, layer);
    ent.label.setText(truncateNameplate(label));
    if (isBg) {
      applyBgNameplateStyle(ent.label);
    } else {
      applyNameplateStyle(ent.label, "npc");
    }
    ent.npcId = npcId;
    this.attachNpcActivityLabel(ent, isBg);
    if (!isBg) {
      this.attachNpcIntentLabel(ent);
    }
    if (!this.useSpriteEntities()) return ent;

    ent.spriteMode = true;
    ent.isNpc = true;
    ent.paletteRow = npcVariantForId(npcId);
    ent.facingDir = "down";
    ent.activityLabel?.setY(activityLabelY(true));
    ent.intentLabel?.setY(intentLabelY(true));
    const avatar = createNpcSprite(this, npcId, isBg ? BG_NPC_TINT : undefined);
    const bubble = createSpeechBubble(this);
    ent.body.setVisible(false);
    ent.ring.setVisible(false);
    ent.label.setText(truncateNameplate(label));
    ent.label.setAlpha(0);
    ent.label.y = SPRITE_NAMEPLATE_Y;
    if (isBg) {
      applyBgNameplateStyle(ent.label);
    } else {
      applyNameplateStyle(ent.label, "npc");
    }
    ent.container.addAt(avatar, 0);
    if (!isBg) {
      ent.container.add(bubble);
      ent.bubble = bubble;
    }
    ent.avatar = avatar;
    playIdleAnim(ent, "down");
    return ent;
  }

  private attachNpcActivityLabel(ent: EntitySprite, isBackground = false): void {
    if (!ent.npcId) return;
    const activityLabel = createActivityLabel(this, ent.npcId);
    if (isBackground) {
      applyBgActivityStyle(activityLabel);
      activityLabel.setData("testid", `bg-npc-activity-${ent.npcId}`);
    }
    activityLabel.y = activityLabelY(ent.spriteMode === true);
    ent.container.add(activityLabel);
    ent.activityLabel = activityLabel;
  }

  private attachNpcIntentLabel(ent: EntitySprite): void {
    if (!ent.npcId) return;
    const intentLabel = createIntentLabel(this, ent.npcId);
    intentLabel.y = intentLabelY(ent.spriteMode === true);
    ent.container.add(intentLabel);
    ent.intentLabel = intentLabel;
  }

  private createDoorEntity(
    gx: number,
    gy: number,
    closed: boolean,
    layer: 0 | 1 | 2,
  ): EntitySprite {
    const stroke = closed ? theme.doorClosed : theme.doorOpen;
    const ent = this.createDiscMarker("门", gx, gy, {
      fill: theme.doorFill,
      fillAlpha: 0.9,
      stroke,
      strokeAlpha: 1,
      radius: MARKER_RADIUS - 2,
    }, layer);
    if (!this.useSpriteEntities() || !this.textures.exists(ASSET_KEYS.tilesDecor)) {
      return ent;
    }

    ent.spriteMode = true;
    const doorSprite = createDoorSprite(this, closed);
    ent.body.setVisible(false);
    ent.ring.setVisible(false);
    ent.label.setAlpha(0);
    ent.container.addAt(doorSprite, 0);
    ent.doorSprite = doorSprite;
    return ent;
  }

  private stopEntityMotion(ent: EntitySprite): void {
    ent.bobTween?.stop();
    ent.bobTween = undefined;
    ent.pulseTween?.stop();
    ent.pulseTween = undefined;
    ent.nameplateTween?.stop();
    ent.nameplateTween = undefined;
    ent.activityLabelTween?.stop();
    ent.activityLabelTween = undefined;
    ent.intentLabelTween?.stop();
    ent.intentLabelTween = undefined;
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
    ent.container.setDepth(entityYSortDepth(gx, gy, ent.depthLayer));
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

  /** BFS path for NPC visual walk — terrain + entities, same grid as player movement. */
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
    const path = clientFindPath(
      map,
      fromX,
      fromY,
      toX,
      toY,
      others,
      this.getLoadedChunks(),
      { excludeNpcId: npcId },
    );
    return path;
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
      const dist = Math.abs(ent.gridX - gx) + Math.abs(ent.gridY - gy);
      if (dist === 1) {
        this.tweenEntityOneStep(ent, gx, gy, STEP_MS);
      } else {
        // Match authoritative server cell when terrain path is missing (e.g. blocked dest).
        this.snapEntityToGrid(ent, gx, gy);
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
      ent.moveTween = this.tweens.add({
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
      const fromX = cx;
      const fromY = cy;
      cx = nx;
      cy = ny;
      const { wx, wy } = gridToWorld(nx, ny);
      ent.container.setDepth(entityYSortDepth(nx, ny, ent.depthLayer));
      applyStepAnimation(ent, fromX, fromY, nx, ny);
      ent.moveTween = this.tweens.add({
        targets: ent.container,
        x: wx,
        y: wy,
        duration: STEP_MS,
        ease: "Linear",
        onComplete: () => {
          ent.gridX = nx;
          ent.gridY = ny;
          const continuing = !(cx === gx && cy === gy);
          applyStepEndAnimation(ent, continuing);
          if (continuing) walkNext();
          else ent.moveTween = undefined;
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
    const fromX = ent.gridX;
    const fromY = ent.gridY;
    ent.container.setDepth(entityYSortDepth(gx, gy, ent.depthLayer));
    const { wx, wy } = gridToWorld(gx, gy);
    if (reduced) {
      ent.gridX = gx;
      ent.gridY = gy;
      ent.container.setPosition(wx, wy);
      applyStepEndAnimation(ent, false);
      return;
    }
    applyStepAnimation(ent, fromX, fromY, gx, gy);
    ent.moveTween = this.tweens.add({
      targets: ent.container,
      x: wx,
      y: wy,
      duration,
      ease: "Linear",
      onComplete: () => {
        ent.gridX = gx;
        ent.gridY = gy;
        applyStepEndAnimation(ent, false);
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
    const labelY = ent.spriteMode ? SPRITE_NAMEPLATE_Y : MARKER_LABEL_Y;
    if (reduced || thinking) {
      ent.bobTween?.stop();
      ent.bobTween = undefined;
      ent.label.y = labelY;
      return;
    }
    if (ent.bobTween?.isPlaying()) return;
    ent.bobTween?.stop();
    ent.label.y = labelY;
    ent.bobTween = this.tweens.add({
      targets: ent.label,
      y: labelY - 2,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }
}

export const ROOM_SCENE_KEY = SCENE_KEY;
