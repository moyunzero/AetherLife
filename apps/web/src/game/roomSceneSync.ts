import * as Phaser from "phaser";
import {
  chunkViewsFingerprint,
  isBackgroundNpcId,
  isCouncilNpcId,
  shouldSuppressLocalSchemaSnap,
  type ChunkView,
  type RoomState,
} from "@aetherlife/shared";
import { playerDisplayName } from "../lib/playerDisplayName.js";
import type { NpcAmbientUiState } from "./activityLabels.js";
import { biomesFromChunks, preloadAdjacentBiomes } from "./areaLoader.js";
import { ASSET_KEYS, TILE_PX } from "./assetManifest.js";
import { MARKER_STROKE, entityYSortDepth } from "./entityLayout.js";
import { applyBgNameplateStyle } from "./bgNpcLabels.js";
import {
  applyNameplateStyle,
  npcDisplayName,
  THINKING_PULSE_MS,
} from "./entityLabels.js";
import { tickViewportVisibleNpcIds } from "./roomSceneViewport.js";
import {
  applyFacingFromSchema,
  paletteRowForPlayerId,
  refreshNpcChatBubbles,
} from "./entitySprites.js";
import { GRID_STEP_MS } from "./gridMovement.js";
import type { LocalPlayerMotionBridge } from "./localPlayerMotion.js";
import type { MovementSyncController } from "./MovementSyncController.js";
import type { RemoteInterpDeps } from "./RemotePlayerInterpolator.js";
import { truncateNameplate } from "./ProximityNameplate.js";
import {
  cellHasActor,
  facingFlipX,
  type EntitySprite,
  type MapNpcView,
  type MapObjectView,
  type PlayerSnap,
} from "./roomSceneTypes.js";
import { theme } from "./theme.js";
import { isVisualFallbackActive } from "./visualFallback.js";

const STEP_MS = GRID_STEP_MS;

/** Registry key: React sets `roomSync` → Phaser `changedata` → sync. */
export const ROOM_SCENE_SYNC_REGISTRY_KEY = "roomSync";

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

export type RoomSceneSyncHost = {
  floorGfx: Phaser.GameObjects.Graphics | undefined;
  scene: Phaser.Scene;
  game: Phaser.Game;
  registry: Phaser.Data.DataManager;
  cameras: Phaser.Cameras.Scene2D.CameraManager;
  tweens: Phaser.Tweens.TweenManager;
  textures: Phaser.Textures.TextureManager;
  playerSprites: Map<string, EntitySprite>;
  npcSprites: Map<string, EntitySprite>;
  doorSprites: Map<string, EntitySprite>;
  remoteInterp: {
    pushServerCell: (sessionId: string, x: number, y: number) => void;
    takePendingSnap: (sessionId: string) => { x: number; y: number } | null;
    snapToServer: (
      sessionId: string,
      ent: EntitySprite,
      x: number,
      y: number,
      deps: RemoteInterpDeps,
    ) => void;
    needsSnap: (sessionId: string, ent: EntitySprite) => boolean;
    remove: (sessionId: string) => void;
  };
  motionBridge: LocalPlayerMotionBridge | null;
  getMoveMap: () => RoomState;
  getLoadedChunks: () => ChunkView[];
  getLastFloorFingerprint: () => string;
  setLastFloorFingerprint: (fp: string) => void;
  drawFloor: () => void;
  hasPathTarget: () => boolean;
  clearPath: () => void;
  getMovementSync: () => MovementSyncController | undefined;
  getRemoteInterpDeps: () => RemoteInterpDeps;
  getSessionId: () => string | null;
  isLocalLocomoting: () => boolean;
  getNpcResetEpoch: () => number;
  setNpcResetEpoch: (epoch: number) => void;
  setCameraLerp: (x: number, y: number) => void;
  createPlayerEntity: (
    label: string,
    gx: number,
    gy: number,
    paletteRow: number,
    layer: 0 | 1 | 2,
  ) => EntitySprite;
  createNpcEntity: (
    label: string,
    gx: number,
    gy: number,
    npcId: string,
    layer: 0 | 1 | 2,
  ) => EntitySprite;
  createDoorEntity: (
    gx: number,
    gy: number,
    closed: boolean,
    layer: 0 | 1 | 2,
  ) => EntitySprite;
  stopEntityMotion: (ent: EntitySprite) => void;
  tweenNpcTo: (ent: EntitySprite, gx: number, gy: number, npcId: string) => void;
  snapNpcTo: (ent: EntitySprite, gx: number, gy: number) => void;
  tweenEntityTo: (ent: EntitySprite, gx: number, gy: number, duration: number) => void;
  startNpcBob: (
    ent: EntitySprite,
    gx: number,
    gy: number,
    reduced: boolean,
    thinking: boolean,
  ) => void;
  tickExploreGrid: () => void;
  applyHomesteadScreenshotFrame: () => void;
  frameHomesteadScreenshot: () => boolean;
  getNpcAmbientById: () => Record<string, NpcAmbientUiState>;
};

export function syncRoomEntities(host: RoomSceneSyncHost): void {
  if (!host.floorGfx) {
    return;
  }
  const map = host.getMoveMap();
  const chunks = host.getLoadedChunks();
  const floorFp = chunkViewsFingerprint(chunks);
  if (map && floorFp !== host.getLastFloorFingerprint()) {
    host.setLastFloorFingerprint(floorFp);
    host.drawFloor();
    preloadAdjacentBiomes(host.scene, biomesFromChunks(chunks));
  }

  const connected = host.registry.get("connected") as boolean;
  const players = (host.registry.get("players") as PlayerSnap[]) ?? [];
  const sessionId = host.registry.get("sessionId") as string | null;
  const mapNpcs = (host.registry.get("mapNpcs") as MapNpcView[]) ?? [];
  const mapObjects = (host.registry.get("mapObjects") as MapObjectView[]) ?? [];
  const thinkingNpcId = host.registry.get("thinkingNpcId") as string | null;
  const thinkingNpcIds =
    (host.registry.get("thinkingNpcIds") as string[] | undefined) ?? [];
  const speakingNpcIds =
    (host.registry.get("speakingNpcIds") as string[] | undefined) ?? [];
  const isNpcThinking = (npcId: string) =>
    thinkingNpcIds.includes(npcId) || thinkingNpcId === npcId;
  const isNpcSpeaking = (npcId: string) => speakingNpcIds.includes(npcId);
  const animating = host.registry.get("animating") as boolean;
  const pendingMoves = host.getMovementSync()?.getPendingCount() ?? 0;
  const reduced = host.registry.get("reducedMotion") as boolean;

  if (!animating && host.hasPathTarget()) {
    host.clearPath();
  }

  const remoteDeps = host.getRemoteInterpDeps();

  const seenPlayers = new Set<string>();
  for (const p of players) {
    seenPlayers.add(p.sessionId);
    const isSelf = p.sessionId === sessionId;
    const label = playerDisplayName(p.playerId, isSelf);
    const playerColor = isSelf ? theme.accent : theme.playerOther;
    let ent = host.playerSprites.get(p.sessionId);
    if (!ent) {
      ent = host.createPlayerEntity(
        label,
        p.x,
        p.y,
        paletteRowForPlayerId(p.playerId, p.sessionId, sessionId ?? ""),
        2,
      );
      ent.playerSessionId = p.sessionId;
      host.playerSprites.set(p.sessionId, ent);
      if (isSelf) {
        host.setCameraLerp(ent.container.x, ent.container.y);
      }
    }
    const logic = isSelf ? host.motionBridge?.getLogicGrid() : null;
    const localX = isSelf ? (logic?.x ?? ent.gridX) : ent.gridX;
    const localY = isSelf ? (logic?.y ?? ent.gridY) : ent.gridY;
    if (isSelf) {
      if (
        shouldSuppressLocalSchemaSnap({
          pendingMoves,
          isLocomoting: host.isLocalLocomoting(),
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
      host.remoteInterp.pushServerCell(p.sessionId, p.x, p.y);
      const forced = host.remoteInterp.takePendingSnap(p.sessionId);
      if (forced) {
        host.remoteInterp.snapToServer(p.sessionId, ent, forced.x, forced.y, remoteDeps);
      } else if (host.remoteInterp.needsSnap(p.sessionId, ent)) {
        host.remoteInterp.snapToServer(p.sessionId, ent, p.x, p.y, remoteDeps);
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
  for (const [id, ent] of host.playerSprites) {
    if (!seenPlayers.has(id)) {
      host.remoteInterp.remove(id);
      ent.container.destroy();
      host.playerSprites.delete(id);
    }
  }

  const resetEpoch = (host.registry.get("npcResetEpoch") as number) ?? 0;
  if (resetEpoch !== host.getNpcResetEpoch()) {
    host.setNpcResetEpoch(resetEpoch);
    for (const ent of host.npcSprites.values()) {
      host.stopEntityMotion(ent);
      ent.container.destroy();
    }
    host.npcSprites.clear();
  }

  const seenNpcs = new Set<string>();
  const animateNpcMoves = host.registry.get("npcAnimateMoves") === true;
  for (const npc of mapNpcs) {
    seenNpcs.add(npc.id);
    let ent = host.npcSprites.get(npc.id);
    if (!ent) {
      ent = host.createNpcEntity(npcDisplayName(npc.name), npc.x, npc.y, npc.id, 1);
      host.npcSprites.set(npc.id, ent);
    }
    if (animateNpcMoves) {
      host.tweenNpcTo(ent, npc.x, npc.y, npc.id);
    } else {
      host.snapNpcTo(ent, npc.x, npc.y);
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
    }

    if (!ent.moveTween?.isPlaying()) {
      host.startNpcBob(ent, ent.gridX, ent.gridY, reduced, isNpcThinking(npc.id));
    }
    if (isNpcThinking(npc.id) && !reduced && !ent.spriteMode && !isNpcSpeaking(npc.id)) {
      ent.pulseTween?.stop();
      ent.pulseTween = host.tweens.add({
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

    if (isNpcSpeaking(npc.id) && !reduced) {
      if (!ent.speakHaloTween && !ent.spriteMode) {
        ent.ring.setVisible(true);
        ent.ring.setStrokeStyle(MARKER_STROKE, theme.accent, 0.65);
        ent.speakHaloTween = host.tweens.add({
          targets: ent.ring,
          scaleX: { from: 1, to: 1.28 },
          scaleY: { from: 1, to: 1.28 },
          duration: 900,
          yoyo: true,
          repeat: -1,
        });
      }
    } else if (ent.speakHaloTween) {
      ent.speakHaloTween.stop();
      ent.speakHaloTween = undefined;
      ent.ring.setScale(1, 1);
      if (!ent.spriteMode && !isNpcThinking(npc.id)) {
        ent.ring.setAlpha(1);
        ent.ring.setStrokeStyle(MARKER_STROKE, theme.npcTint, connected ? 0.5 : 0.2);
      }
    }
  }
  for (const [id, ent] of host.npcSprites) {
    if (!seenNpcs.has(id)) {
      host.stopEntityMotion(ent);
      ent.container.destroy();
      host.npcSprites.delete(id);
    }
  }
  refreshNpcChatBubbles(host.npcSprites, host.registry);

  const seenDoors = new Set<string>();
  for (const obj of mapObjects) {
    if (obj.kind !== "door") continue;
    const key = `door-${obj.x}-${obj.y}`;
    seenDoors.add(key);

    if (cellHasActor(obj.x, obj.y, players, mapNpcs)) {
      const hidden = host.doorSprites.get(key);
      if (hidden) {
        hidden.container.destroy();
        host.doorSprites.delete(key);
      }
      continue;
    }

    const strokeColor = obj.state === "closed" ? theme.doorClosed : theme.doorOpen;
    let ent = host.doorSprites.get(key);
    if (!ent) {
      ent = host.createDoorEntity(obj.x, obj.y, obj.state === "closed", 0);
      host.doorSprites.set(key, ent);
    }
    ent.container.setVisible(true);
    host.tweenEntityTo(ent, obj.x, obj.y, STEP_MS);
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
  for (const [id, ent] of host.doorSprites) {
    if (!seenDoors.has(id)) {
      ent.container.destroy();
      host.doorSprites.delete(id);
    }
  }

  host.tickExploreGrid();

  if (host.registry.get("uatHomesteadFrame") === true) {
    host.applyHomesteadScreenshotFrame();
  }

  if (import.meta.env.DEV && typeof window !== "undefined") {
    installDevSyncHooks(host, { animateNpcMoves, mapNpcs, pendingMoves });
  }
}

function installDevSyncHooks(
  host: RoomSceneSyncHost,
  ctx: { animateNpcMoves: boolean; mapNpcs: MapNpcView[]; pendingMoves: number },
): void {
  const w = window as Window & {
    __aetherlife_npcDebug?: () => AetherlifeNpcDebug;
    __aetherlife_sendMoveTo?: (x: number, y: number) => void;
    __aetherlife_moveDebug?: () => {
      gridX: number;
      gridY: number;
      schemaX: number;
      schemaY: number;
      authX: number | null;
      authY: number | null;
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
    __aetherlife_councilNameplateDebug?: () => {
      visibleCouncilNameplates: Array<{
        id: string;
        fontSize: string;
        alpha: number;
      }>;
    } | null;
  };
  w.__aetherlife_moveDebug = () => {
    const sid = host.getSessionId();
    if (!sid) return null;
    const snap = ((host.registry.get("players") as PlayerSnap[]) ?? []).find(
      (pl) => pl.sessionId === sid,
    );
    const ent = host.playerSprites.get(sid);
    if (!snap || !ent) return null;
    const sync = host.getMovementSync();
    const predictor = sync?.getPredictor();
    const pending = sync?.getPendingCount() ?? 0;
    const logic = host.motionBridge?.getLogicGrid();
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
      locomoting: host.isLocalLocomoting(),
      suppressSnap: shouldSuppressLocalSchemaSnap({
        pendingMoves: pending,
        isLocomoting: host.isLocalLocomoting(),
        localX,
        localY,
        schemaX: snap.x,
        schemaY: snap.y,
      }),
    };
  };
  w.__aetherlife_sendMoveTo = (x, y) => {
    void host.getMovementSync()?.sendMoveTo(x, y);
  };
  w.__aetherlife_npcDebug = () => {
    const entries = [...host.npcSprites.entries()];
    const boundsOverlapPairs: Array<{ a: string; b: string }> = [];
    for (let i = 0; i < entries.length; i += 1) {
      const [idA, entA] = entries[i]!;
      const bA = entA.container.getBounds();
      for (let j = i + 1; j < entries.length; j += 1) {
        const [idB, entB] = entries[j]!;
        const bB = entB.container.getBounds();
        const overlap =
          bA.x < bB.x + bB.width &&
          bA.x + bA.width > bB.x &&
          bA.y < bB.y + bB.height &&
          bA.y + bA.height > bB.y;
        if (overlap) boundsOverlapPairs.push({ a: idA, b: idB });
      }
    }
    return {
      animateNpcMoves: ctx.animateNpcMoves,
      npcs: ctx.mapNpcs.map((n) => ({ id: n.id, x: n.x, y: n.y })),
      sprites: entries.map(([id, ent]) => ({
        id,
        gridX: ent.gridX,
        gridY: ent.gridY,
        targetX: ent.targetGridX ?? ent.gridX,
        targetY: ent.targetGridY ?? ent.gridY,
        tweening: Boolean(ent.moveTween?.isPlaying()),
      })),
      boundsOverlapPairs,
      distinctVisualEstimate: entries.length - boundsOverlapPairs.length,
    };
  };
  w.__aetherlife_uatFrameHomestead = () => host.frameHomesteadScreenshot();
  w.__aetherlife_visualDebug = () => {
    const sid = host.getSessionId();
    const ent = sid ? host.playerSprites.get(sid) : undefined;
    const avatar = ent?.avatar;
    const canvas = host.game.canvas;
    const stage = document.querySelector(".room-scene-panel__stage");
    if (!avatar || !canvas || !stage) return null;
    const stageRect = stage.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const panelFillRatio =
      stageRect.width * stageRect.height > 0
        ? (canvasRect.width * canvasRect.height) / (stageRect.width * stageRect.height)
        : 0;
    const cam = host.cameras.main;
    const scale = canvasRect.width / cam.width;
    const playerDisplayHeightPx = avatar.displayHeight * scale;
    let canvasUniqueColors = 0;
    if (host.textures.exists(ASSET_KEYS.tilesBiomes)) {
      const src = host.textures.get(ASSET_KEYS.tilesBiomes).getSourceImage() as
        | HTMLCanvasElement
        | HTMLImageElement;
      const probe = document.createElement("canvas");
      probe.width = src.width;
      probe.height = src.height;
      const ctx2d = probe.getContext("2d");
      if (ctx2d) {
        ctx2d.drawImage(src, 0, 0);
        const colors = new Set<string>();
        for (let row = 0; row < 5; row += 1) {
          for (let col = 0; col < 4; col += 1) {
            const x = col * TILE_PX + Math.floor(TILE_PX / 2);
            const y = row * TILE_PX + Math.floor(TILE_PX / 2);
            const [r, g, b] = ctx2d.getImageData(x, y, 1, 1).data;
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
      visualFallback: isVisualFallbackActive(host.scene),
    };
  };
  w.__aetherlife_ambientDebug = () => {
    const clock = host.registry.get("gameClock") as
      | { minute?: number; label?: string }
      | undefined;
    const minute = typeof clock?.minute === "number" ? clock.minute : null;
    const npcAmbientById = host.getNpcAmbientById();
    const reasonZhById: Record<string, string> = {};
    for (const [id, ambient] of Object.entries(npcAmbientById)) {
      const reason = ambient.intentReasonZh?.trim() ?? "";
      if (reason) reasonZhById[id] = reason;
    }
    return {
      minute,
      label: clock?.label ?? null,
      npcActivityById:
        (host.registry.get("npcActivityById") as Record<string, string> | undefined) ?? {},
      visibleNpcIds:
        (host.registry.get("npcActivityVisible") as string[] | undefined) ?? [],
      reasonZhById,
      visibleIntentNpcIds:
        (host.registry.get("npcIntentVisible") as string[] | undefined) ?? [],
    };
  };
  w.__aetherlife_bgNpcDebug = () => ({
    visibleBgNameplates: [...host.npcSprites.entries()]
      .filter(([id]) => isBackgroundNpcId(id))
      .filter(([, ent]) => (ent.nameplateAlpha ?? ent.label.alpha) > 0.05)
      .map(([id, ent]) => ({
        id,
        testid: ent.label.getData("testid") as string | null,
        fontSize: String(ent.label.style.fontSize ?? ""),
        alpha: ent.label.alpha,
      })),
  });
  w.__aetherlife_councilNameplateDebug = () => ({
    visibleCouncilNameplates: [...host.npcSprites.entries()]
      .filter(([id]) => isCouncilNpcId(id))
      .filter(([, ent]) => (ent.nameplateAlpha ?? ent.label.alpha) > 0.05)
      .map(([id, ent]) => ({
        id,
        fontSize: String(ent.label.style.fontSize ?? ""),
        alpha: ent.label.alpha,
      })),
  });
}
