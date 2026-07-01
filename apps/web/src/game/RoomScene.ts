import * as Phaser from "phaser";
import {
  createDefaultRoom,
  isBackgroundNpcId,
  type ChunkView,
  type GridCell,
  type RoomState,
} from "@aetherlife/shared";
import {
  MARKER_CY,
  MARKER_LABEL_MAX_WIDTH,
  MARKER_LABEL_Y,
  MARKER_RADIUS,
  MARKER_STROKE,
} from "./entityLayout.js";
import { entityYSortDepth } from "./entityLayout.js";
import { CELL_PX, VIEWPORT_CELLS, gridToWorld } from "./gridLayout.js";
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
import { loadCoreAreaPack } from "./areaLoader.js";
import { cardinalFacingFromDelta } from "./facing.js";
import { DecorRenderer } from "./DecorRenderer.js";
import { FloorRenderer } from "./FloorRenderer.js";
import { HomeMapBackground } from "./HomeMapBackground.js";
import {
  applyStepAnimation,
  applyStepEndAnimation,
  createDoorSprite,
  createNpcSprite,
  createPlayerSprite,
  createSpeechBubble,
  npcVariantForId,
  playIdleAnim,
  registerCharacterAnims,
  registerLpcNpc1Anims,
  registerNpcAnims,
  spriteNameplateY,
  spriteProfileForNpc,
} from "./entitySprites.js";
import { spriteProfileForPlayer } from "./lpcNpc1Sheet.js";
import { ASSET_KEYS } from "./assetManifest.js";
import {
  logBootTiming,
  markVisualFallbackFromLoadError,
  isVisualFallbackActive,
} from "./visualFallback.js";
import { theme } from "./theme.js";
import {
  applyHomesteadScreenshotFrame as applyHomesteadScreenshotFrameImpl,
  centerCameraOnPlayer as centerCameraOnPlayerImpl,
  fitCameraToViewport,
  resetCameraPan,
  tickCameraFollow as tickCameraFollowImpl,
  type RoomSceneCameraCtx,
} from "./roomSceneCamera.js";
import { drawFloor as drawFloorImpl, drawFloorGraphics as drawFloorGraphicsImpl, type RoomSceneFloorCtx } from "./roomSceneFloor.js";
import {
  clearPathPreview,
  drawPathPreview as drawPathPreviewImpl,
  flashBlockedCell,
  setupRoomSceneInput,
  type RoomSceneInputCtx,
} from "./roomSceneInput.js";
import {
  pathForNpcMove as pathForNpcMoveImpl,
  snapNpcTo as snapNpcToImpl,
  tweenNpcTo as tweenNpcToImpl,
  type RoomSceneNpcMotionCtx,
} from "./roomSceneNpcMotion.js";
import {
  ROOM_SCENE_SYNC_REGISTRY_KEY,
  syncRoomEntities,
  type RoomSceneSyncHost,
} from "./roomSceneSync.js";
import {
  tickViewportVisibleNpcIds,
  VIEWPORT_NPC_TICK_MS,
} from "./roomSceneViewport.js";

export type { AetherlifeNpcDebug } from "./roomSceneSync.js";
import {
  facingFlipX,
  type EntitySprite,
  type PlayerSnap,
  type DiscStyle,
} from "./roomSceneTypes.js";

const STEP_MS = GRID_STEP_MS;
const SCENE_KEY = "Room";

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
  private lastViewportTickMs = 0;
  private lastViewportNpcIdsKey = "";
  private collectiveDebugText: Phaser.GameObjects.Text | null = null;
  private preloadStartMs = 0;
  private readonly onLoadError = (): void => {
    markVisualFallbackFromLoadError(this);
  };
  private floorRenderer = new FloorRenderer();
  private decorRenderer = new DecorRenderer();
  private homeMapBackground = new HomeMapBackground();

  private cameraCtx(): RoomSceneCameraCtx {
    return {
      scene: this,
      registry: this.registry,
      cameras: this.cameras,
      playerSprites: this.playerSprites,
      npcSprites: this.npcSprites,
      homeMapBackground: this.homeMapBackground,
      getSessionId: () => this.getSessionId(),
      getViewportW: () => this.getViewportW(),
      getViewportH: () => this.getViewportH(),
      getLoadedChunks: () => this.getLoadedChunks(),
      getZoomState: () => ({ base: this.zoomBase, min: this.zoomMin, max: this.zoomMax }),
      setZoomState: (base, min, max) => {
        this.zoomBase = base;
        this.zoomMin = min;
        this.zoomMax = max;
      },
      getCameraLerp: () => ({ x: this.cameraLerpX, y: this.cameraLerpY }),
      setCameraLerp: (x, y) => {
        this.cameraLerpX = x;
        this.cameraLerpY = y;
      },
    };
  }

  private floorCtx(): RoomSceneFloorCtx {
    return {
      scene: this,
      floorGfx: this.floorGfx,
      floorRenderer: this.floorRenderer,
      decorRenderer: this.decorRenderer,
      homeMapBackground: this.homeMapBackground,
      getLoadedChunks: () => this.getLoadedChunks(),
      getMoveMap: () => this.getMoveMap(),
      terrainDebug: () => this.terrainDebug(),
    };
  }

  private inputCtx(): RoomSceneInputCtx {
    return {
      scene: this,
      input: this.input,
      cameras: this.cameras,
      tweens: this.tweens,
      registry: this.registry,
      flashGfx: this.flashGfx,
      pathGfx: this.pathGfx,
      playerSprites: this.playerSprites,
      npcSprites: this.npcSprites,
      onNpcSelected: (npcId) => {
        const cb = this.registry.get("onNpcSpriteClick") as ((id: string) => void) | undefined;
        cb?.(npcId);
      },
      getMoveMap: () => this.getMoveMap(),
      getLoadedChunks: () => this.getLoadedChunks(),
      getMovementSync: () => this.getMovementSync(),
      movementDisabled: () => this.movementDisabled(),
      getPathTarget: () => this.pathTarget,
      setPathTarget: (target) => {
        this.pathTarget = target;
      },
      getZoomBounds: () => ({ min: this.zoomMin, max: this.zoomMax }),
      getPinchState: () => ({ startDist: this.pinchStartDist, startZoom: this.pinchStartZoom }),
      setPinchState: (startDist, startZoom) => {
        this.pinchStartDist = startDist;
        this.pinchStartZoom = startZoom;
      },
      setKeyHandle: (handle) => {
        this.keyHandle?.destroy();
        this.keyHandle = handle ?? null;
      },
    };
  }

  private npcMotionCtx(): RoomSceneNpcMotionCtx {
    return {
      registry: this.registry,
      tweens: this.tweens,
      getMoveMap: () => this.getMoveMap(),
      getLoadedChunks: () => this.getLoadedChunks(),
      stopEntityMotion: (ent) => this.stopEntityMotion(ent),
      snapEntityToGrid: (ent, gx, gy) => this.snapEntityToGrid(ent, gx, gy),
      tweenEntityOneStep: (ent, gx, gy, duration) => this.tweenEntityOneStep(ent, gx, gy, duration),
    };
  }

  private syncCtx(): RoomSceneSyncHost {
    return {
      floorGfx: this.floorGfx,
      scene: this,
      game: this.game,
      registry: this.registry,
      cameras: this.cameras,
      tweens: this.tweens,
      textures: this.textures,
      playerSprites: this.playerSprites,
      npcSprites: this.npcSprites,
      doorSprites: this.doorSprites,
      remoteInterp: this.remoteInterp,
      motionBridge: this.motionBridge,
      getMoveMap: () => this.getMoveMap(),
      getLoadedChunks: () => this.getLoadedChunks(),
      getLastFloorFingerprint: () => this.lastFloorFingerprint,
      setLastFloorFingerprint: (fp) => {
        this.lastFloorFingerprint = fp;
      },
      drawFloor: () => this.drawFloor(),
      hasPathTarget: () => this.pathTarget !== null,
      clearPath: () => this.clearPath(),
      getMovementSync: () => this.getMovementSync(),
      getRemoteInterpDeps: () => this.getRemoteInterpDeps(),
      getSessionId: () => this.getSessionId(),
      isLocalLocomoting: () => this.isLocalLocomoting(),
      getNpcResetEpoch: () => this.npcResetEpoch,
      setNpcResetEpoch: (epoch) => {
        this.npcResetEpoch = epoch;
      },
      setCameraLerp: (x, y) => {
        this.cameraLerpX = x;
        this.cameraLerpY = y;
      },
      createPlayerEntity: (label, gx, gy, paletteRow, layer) =>
        this.createPlayerEntity(label, gx, gy, paletteRow, layer),
      createNpcEntity: (label, gx, gy, npcId, layer) =>
        this.createNpcEntity(label, gx, gy, npcId, layer),
      createDoorEntity: (gx, gy, closed, layer) =>
        this.createDoorEntity(gx, gy, closed, layer),
      stopEntityMotion: (ent) => this.stopEntityMotion(ent),
      tweenNpcTo: (ent, gx, gy, npcId) => this.tweenNpcTo(ent, gx, gy, npcId),
      snapNpcTo: (ent, gx, gy) => this.snapNpcTo(ent, gx, gy),
      tweenEntityTo: (ent, gx, gy, duration) => this.tweenEntityTo(ent, gx, gy, duration),
      startNpcBob: (ent, gx, gy, reduced, thinking) =>
        this.startNpcBob(ent, gx, gy, reduced, thinking),
      tickExploreGrid: () => this.tickExploreGrid(),
      applyHomesteadScreenshotFrame: () => this.applyHomesteadScreenshotFrame(),
      frameHomesteadScreenshot: () => this.frameHomesteadScreenshot(),
      getNpcAmbientById: () => this.getNpcAmbientById(),
    };
  }

  constructor() {
    super({ key: SCENE_KEY });
  }

  preload(): void {
    this.preloadStartMs = performance.now();
    loadCoreAreaPack(this.load);
    this.load.on("loaderror", this.onLoadError);
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
      registerLpcNpc1Anims(this);
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
      this.load.off("loaderror", this.onLoadError);
      this.input.removeAllListeners();
      this.keyHandle?.destroy();
      this.keyHandle = null;
      this.movementController?.reset();
      this.movementController = null;
      this.remoteInterp.reset();
      this.motionBridge = null;
      this.registry.set("localPlayerMotion", null);
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
    this.movementController?.tickLocalMovement();
    this.remoteInterp.advance(
      this.playerSprites,
      this.getSessionId(),
      this.getRemoteInterpDeps(),
    );
    this.tickCameraFollow(delta);
    this.tickExploreGrid();
    this.tickViewportVisibleNpcIds();
    this.tickCollectiveDebug();
    this.refreshNameplates();
    this.refreshNpcAmbientLabels();
  }

  private useSpriteEntities(): boolean {
    return (
      !isVisualFallbackActive(this)
      && this.textures.exists(ASSET_KEYS.spritesLpcNpc1)
      && this.textures.exists(ASSET_KEYS.spritesNpcs)
    );
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
    const thinkingNpcIds =
      (this.registry.get("thinkingNpcIds") as string[] | undefined) ?? [];
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
    updateNameplates(this, targets, localCell, activeNpcId, thinkingNpcId, thinkingNpcIds);
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

  /** Avatar strip filter — publish sorted ids when camera overlap set changes (≤10Hz). */
  private tickViewportVisibleNpcIds(): void {
    const now = this.time.now;
    if (now - this.lastViewportTickMs < VIEWPORT_NPC_TICK_MS) return;
    this.lastViewportTickMs = now;

    const ids = tickViewportVisibleNpcIds(this.cameras.main, this.npcSprites);
    const key = ids.join(",");
    if (key === this.lastViewportNpcIdsKey) return;
    this.lastViewportNpcIdsKey = key;
    this.registry.set("viewportVisibleNpcIds", ids);
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
    tickCameraFollowImpl(this.cameraCtx(), delta);
  }

  private onRegistryChange(parent: Phaser.Data.DataManager, key: string): void {
    if (key === ROOM_SCENE_SYNC_REGISTRY_KEY) this.syncEntities();
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

  private drawFloor(): void {
    drawFloorImpl(this.floorCtx());
  }

  /** Graphics fallback — visualFallback query or loader failure (D-23). */
  private drawFloorGraphics(): void {
    drawFloorGraphicsImpl(this.floorCtx());
  }

  private handleScaleResize(): void {
    this.fitCamera();
  }

  private fitCamera(): void {
    fitCameraToViewport(this.cameraCtx());
  }

  /** Phaser cam.pan() returns Camera, not Tween — stop via panEffect.reset(). */
  private stopCameraPan(): void {
    resetCameraPan(this.cameras.main);
  }

  /** Pin AE-08 homestead shot — camera + zoom; re-applied after syncEntities. */
  private applyHomesteadScreenshotFrame(): void {
    applyHomesteadScreenshotFrameImpl(this.cameraCtx());
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
    centerCameraOnPlayerImpl(this.cameraCtx());
  }

  private setupInput(): void {
    setupRoomSceneInput(this.inputCtx());
  }

  private flashCell(x: number, y: number): void {
    this.flashTween?.stop();
    this.flashTween = flashBlockedCell(this.inputCtx(), x, y);
  }

  private drawPathPreview(targetX: number, targetY: number): void {
    drawPathPreviewImpl(this.inputCtx(), targetX, targetY);
  }

  private clearPath(): void {
    clearPathPreview(this.inputCtx());
  }

  syncEntities(): void {
    syncRoomEntities(this.syncCtx());
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
    ent.spriteProfile = spriteProfileForPlayer();
    ent.paletteRow = paletteRow;
    ent.facingDir = "down";
    const avatar = createPlayerSprite(this, paletteRow);
    ent.body.setVisible(false);
    ent.ring.setVisible(false);
    ent.label.setText(truncateNameplate(label));
    ent.label.setAlpha(0);
    ent.label.y = spriteNameplateY(ent.spriteProfile);
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
    ent.spriteProfile = spriteProfileForNpc(npcId);
    ent.paletteRow = npcVariantForId(npcId);
    ent.facingDir = "down";
    ent.activityLabel?.setY(activityLabelY(true, ent.spriteProfile));
    ent.intentLabel?.setY(intentLabelY(true, ent.spriteProfile));
    const avatar = createNpcSprite(this, npcId, isBg ? BG_NPC_TINT : undefined);
    const bubble = createSpeechBubble(this, ent.spriteProfile);
    ent.body.setVisible(false);
    ent.ring.setVisible(false);
    ent.label.setText(truncateNameplate(label));
    ent.label.setAlpha(0);
    ent.label.y = spriteNameplateY(ent.spriteProfile);
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
    activityLabel.y = activityLabelY(ent.spriteMode === true, ent.spriteProfile);
    ent.container.add(activityLabel);
    ent.activityLabel = activityLabel;
  }

  private attachNpcIntentLabel(ent: EntitySprite): void {
    if (!ent.npcId) return;
    const intentLabel = createIntentLabel(this, ent.npcId);
    intentLabel.y = intentLabelY(ent.spriteMode === true, ent.spriteProfile);
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
    return pathForNpcMoveImpl(this.npcMotionCtx(), fromX, fromY, toX, toY, npcId);
  }

  /** Load / reset: snap NPC to persisted grid (Stardew-style, no walk-in on refresh). */
  private snapNpcTo(ent: EntitySprite, gx: number, gy: number): void {
    snapNpcToImpl(this.npcMotionCtx(), ent, gx, gy);
  }

  /** NPC moves step-by-step (~140ms/cell), matching player sendMoveTo animation. */
  private tweenNpcTo(ent: EntitySprite, gx: number, gy: number, npcId: string): void {
    tweenNpcToImpl(this.npcMotionCtx(), ent, gx, gy, npcId);
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
    const labelY = ent.spriteMode
      ? spriteNameplateY(ent.spriteProfile ?? "stardew")
      : MARKER_LABEL_Y;
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
