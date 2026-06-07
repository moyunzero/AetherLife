import * as Phaser from "phaser";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  chunkOf,
  createDefaultRoom,
  type BiomeId,
  type ChunkView,
  type GameObject,
  type NpcState,
  type RoomState,
} from "@aetherlife/shared";
import type { PlayerSnapshot } from "../hooks/useColyseusRoom.js";
import type { LocalPlayerMotionBridge } from "../game/localPlayerMotion.js";
import type { MovementSyncController } from "../game/MovementSyncController.js";
import { ExploreCoordsStrip } from "./ExploreCoordsStrip.js";
import { LoreDiscoverToast } from "./LoreDiscoverToast.js";
import { biomeAt } from "../lib/chunkWalkability.js";
import type { ChunkLoreEntry, LoreDiscoverToast as LoreDiscoverToastPayload } from "../hooks/useChunkLore.js";
import { lorePlaceLabel } from "../hooks/useChunkLore.js";
import { VIEWPORT_CELLS, worldSize } from "../game/gridLayout.js";
import { ROOM_SCENE_KEY, RoomScene } from "../game/RoomScene.js";
import { theme } from "../game/theme.js";

export type MapNpcView = Pick<NpcState, "id" | "name" | "x" | "y">;
export type MapObjectView = Pick<GameObject, "kind" | "x" | "y" | "state">;

type Props = {
  bootOk: boolean;
  connected: boolean;
  players: PlayerSnapshot[];
  sessionId: string | null;
  width: number;
  height: number;
  moveMap: RoomState;
  mapNpcs: MapNpcView[];
  mapObjects: MapObjectView[];
  animating: boolean;
  /** Client prediction queue depth — suppress schema snap while >0. */
  pendingMoves?: number;
  moveHint: string | null;
  thinkingNpcId: string | null;
  /** When false, NPCs snap to grid (load / reset); when true, live moves animate step-by-step. */
  npcAnimateMoves: boolean;
  /** Bumped on new game — destroys NPC sprites so no tween carries over. */
  npcResetEpoch: number;
  remoteInterpMs?: number;
  loadedChunks?: ChunkView[];
  loreForChunk?: (cx: number, cy: number) => ChunkLoreEntry | undefined;
  discoverToast?: LoreDiscoverToastPayload | null;
  onDismissDiscoverToast?: () => void;
  motionBridgeRef?: MutableRefObject<LocalPlayerMotionBridge | null>;
  /** Phaser-first movement; RoomScene reads from registry. */
  movementSyncRef?: MutableRefObject<MovementSyncController | null>;
  /** DEV: one-line collective attitude (collectiveDebug=1). */
  collectiveAttitudeLine?: string | null;
  onBootFailed?: () => void;
};

const BOOT_TIMEOUT_MS = 5000;

function noopDismiss(): void {}

/** System reduce-motion or `?reducedMotion=1` — disables tweens (less eye strain). */
export function readReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).get("reducedMotion") === "1") {
    return true;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type RegistrySnapshot = {
  width: number;
  height: number;
  moveMap: RoomState;
  players: PlayerSnapshot[];
  sessionId: string | null;
  mapNpcs: MapNpcView[];
  mapObjects: MapObjectView[];
  connected: boolean;
  animating: boolean;
  pendingMoves: number;
  moveHint: string | null;
  thinkingNpcId: string | null;
  npcAnimateMoves: boolean;
  npcResetEpoch: number;
  reducedMotion: boolean;
  remoteInterpMs: number;
  loadedChunks: ChunkView[];
  movementSync: MovementSyncController | null;
  collectiveAttitudeLine: string | null;
};

function pushRoomRegistry(game: Phaser.Game, snap: RegistrySnapshot): void {
  game.registry.set("gridW", snap.width);
  game.registry.set("gridH", snap.height);
  game.registry.set("moveMap", snap.moveMap);
  game.registry.set("players", snap.players);
  game.registry.set("sessionId", snap.sessionId);
  game.registry.set("mapNpcs", snap.mapNpcs);
  game.registry.set("mapObjects", snap.mapObjects);
  game.registry.set("connected", snap.connected);
  game.registry.set("animating", snap.animating);
  game.registry.set("pendingMoves", snap.pendingMoves);
  game.registry.set("moveHint", snap.moveHint);
  game.registry.set("thinkingNpcId", snap.thinkingNpcId);
  game.registry.set("npcAnimateMoves", snap.npcAnimateMoves);
  game.registry.set("npcResetEpoch", snap.npcResetEpoch);
  game.registry.set("reducedMotion", snap.reducedMotion);
  game.registry.set("remoteInterpMs", snap.remoteInterpMs);
  game.registry.set("loadedChunks", snap.loadedChunks);
  game.registry.set("movementSync", snap.movementSync);
  game.registry.set("collectiveAttitudeLine", snap.collectiveAttitudeLine);
  game.registry.set("roomSync", Date.now());
}

export async function probePhaserBoot(timeoutMs = BOOT_TIMEOUT_MS): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (import.meta.env.VITE_PHASER_FORCE_FALLBACK === "1") return false;

  return new Promise((resolve) => {
    const parent = document.createElement("div");
    parent.style.cssText = "position:fixed;left:-9999px;width:320px;height:320px;opacity:0";
    document.body.appendChild(parent);

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        game?.destroy(true, false);
      } catch {
        /* ignore */
      }
      parent.remove();
      resolve(ok);
    };

    const timer = window.setTimeout(() => finish(false), timeoutMs);
    let game: Phaser.Game | null = null;
    try {
      const { w, h } = worldSize(VIEWPORT_CELLS, VIEWPORT_CELLS);
      game = new Phaser.Game({
        type: Phaser.AUTO,
        width: w,
        height: h,
        parent,
        backgroundColor: theme.bgDeep,
        roundPixels: true,
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        scene: [RoomScene],
      });
      pushRoomRegistry(game, {
        width: 8,
        height: 8,
        moveMap: createDefaultRoom(),
        players: [],
        sessionId: null,
        mapNpcs: [],
        mapObjects: [],
        connected: false,
        animating: false,
        pendingMoves: 0,
        moveHint: null,
        thinkingNpcId: null,
        npcAnimateMoves: false,
        npcResetEpoch: 0,
        reducedMotion: false,
        remoteInterpMs: 130,
        loadedChunks: [],
        movementSync: null,
      });
      game.events.once("ready", () => finish(true));
    } catch {
      finish(false);
    }
  });
}

export function PhaserGame({
  bootOk,
  connected,
  players,
  sessionId,
  width,
  height,
  moveMap,
  mapNpcs,
  mapObjects,
  animating,
  pendingMoves = 0,
  moveHint,
  thinkingNpcId,
  npcAnimateMoves,
  npcResetEpoch,
  remoteInterpMs = 130,
  loadedChunks = [],
  loreForChunk,
  discoverToast = null,
  onDismissDiscoverToast,
  motionBridgeRef,
  movementSyncRef,
  collectiveAttitudeLine = null,
  onBootFailed,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const onBootFailedRef = useRef(onBootFailed);
  onBootFailedRef.current = onBootFailed;

  const [exploreGrid, setExploreGrid] = useState<{ gx: number; gy: number } | null>(null);
  const exploreCoords = useMemo(() => {
    if (!exploreGrid) return null;
    const biome: BiomeId | "void" = biomeAt(loadedChunks, exploreGrid.gx, exploreGrid.gy);
    const { cx, cy } = chunkOf(exploreGrid.gx, exploreGrid.gy);
    const loreEntry = loreForChunk?.(cx, cy);
    const labels = lorePlaceLabel(loreEntry, biome);
    return {
      gx: exploreGrid.gx,
      gy: exploreGrid.gy,
      biome,
      ...labels,
    };
  }, [exploreGrid, loadedChunks, loreForChunk]);

  const registryRef = useRef({
    width,
    height,
    moveMap,
    players,
    sessionId,
    mapNpcs,
    mapObjects,
    connected,
    animating,
    pendingMoves,
    moveHint,
    thinkingNpcId,
    npcAnimateMoves,
    npcResetEpoch,
    remoteInterpMs,
    loadedChunks,
    collectiveAttitudeLine,
  });
  registryRef.current = {
    width,
    height,
    moveMap,
    players,
    sessionId,
    mapNpcs,
    mapObjects,
    connected,
    animating,
    pendingMoves,
    moveHint,
    thinkingNpcId,
    npcAnimateMoves,
    npcResetEpoch,
    remoteInterpMs,
    loadedChunks,
    collectiveAttitudeLine,
  };

  useEffect(() => {
    if (!bootOk || !parentRef.current) return;

    const { w, h } = worldSize(VIEWPORT_CELLS, VIEWPORT_CELLS);
    let destroyed = false;
    let bootTimer: number | undefined;
    const reducedMotion = readReducedMotion();
    const snap = registryRef.current;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: w,
      height: h,
      parent: parentRef.current,
      backgroundColor: theme.bgDeep,
      roundPixels: true,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [RoomScene],
    });

    pushRoomRegistry(game, {
      width: snap.width,
      height: snap.height,
      moveMap: snap.moveMap,
      players: snap.players,
      sessionId: snap.sessionId,
      mapNpcs: snap.mapNpcs,
      mapObjects: snap.mapObjects,
      connected: snap.connected,
      animating: snap.animating,
      pendingMoves: snap.pendingMoves,
      moveHint: snap.moveHint,
      thinkingNpcId: snap.thinkingNpcId,
      npcAnimateMoves: snap.npcAnimateMoves,
      npcResetEpoch: snap.npcResetEpoch,
      reducedMotion,
      remoteInterpMs: snap.remoteInterpMs,
      loadedChunks: snap.loadedChunks,
      movementSync: movementSyncRef?.current ?? null,
      collectiveAttitudeLine,
    });

    gameRef.current = game;

    bootTimer = window.setTimeout(() => {
      if (!destroyed) onBootFailedRef.current?.();
    }, BOOT_TIMEOUT_MS);

    game.events.once("ready", () => {
      if (bootTimer) clearTimeout(bootTimer);
      const scene = game.scene.getScene(ROOM_SCENE_KEY) as RoomScene | undefined;
      if (scene?.scene.isActive()) {
        if (motionBridgeRef) {
          motionBridgeRef.current = scene.getLocalPlayerMotionBridge();
        }
      } else {
        game.scene.start(ROOM_SCENE_KEY);
      }
    });

    return () => {
      destroyed = true;
      if (bootTimer) clearTimeout(bootTimer);
      game.destroy(true, false);
      gameRef.current = null;
    };
  }, [bootOk]);

  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;

    type ExploreGrid = { gx: number; gy: number } | null;
    const onExploreGrid = (
      _parent: Phaser.Data.DataManager,
      key: string,
      value: ExploreGrid,
    ) => {
      if (key === "exploreGrid") {
        setExploreGrid(value);
      }
    };
    // Phaser: first registry.set emits `setdata`; updates emit `changedata` (ISSUE-011).
    game.registry.events.on("setdata", onExploreGrid);
    game.registry.events.on("changedata", onExploreGrid);
    const initial = game.registry.get("exploreGrid") as ExploreGrid | undefined;
    setExploreGrid(initial ?? null);

    return () => {
      game.registry.events.off("setdata", onExploreGrid);
      game.registry.events.off("changedata", onExploreGrid);
    };
  }, [bootOk]);

  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;

    const reducedMotion = readReducedMotion();

    pushRoomRegistry(game, {
      width,
      height,
      moveMap,
      players,
      sessionId,
      mapNpcs,
      mapObjects,
      connected,
      animating,
      pendingMoves,
      moveHint,
      thinkingNpcId,
      npcAnimateMoves,
      npcResetEpoch,
      reducedMotion,
      remoteInterpMs,
      loadedChunks,
      movementSync: movementSyncRef?.current ?? null,
      collectiveAttitudeLine,
    });
    game.registry.events.emit("changedata", game.registry, "roomSync");

    const scene = game.scene.getScene(ROOM_SCENE_KEY) as RoomScene | undefined;
    if (scene && motionBridgeRef) {
      motionBridgeRef.current = scene.getLocalPlayerMotionBridge();
    }
    scene?.syncEntities();
  }, [
    players,
    sessionId,
    mapNpcs,
    mapObjects,
    connected,
    moveMap,
    animating,
    pendingMoves,
    moveHint,
    thinkingNpcId,
    npcAnimateMoves,
    npcResetEpoch,
    width,
    height,
    loadedChunks,
    collectiveAttitudeLine,
  ]);

  return (
    <section
      className="room-scene-panel"
      data-testid="room-scene"
      onPointerDownCapture={() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.closest(".composer")) {
          active.blur();
        }
      }}
    >
      <h2 className="room-scene-panel__title">房间</h2>
      <p className="room-scene-panel__subtitle">探索周边地形 — 走出家园格即可进入新生态</p>
      {connected && exploreCoords ? (
        <ExploreCoordsStrip
          gx={exploreCoords.gx}
          gy={exploreCoords.gy}
          biome={exploreCoords.biome}
          placeName={exploreCoords.placeName}
          flavorLine={exploreCoords.flavor}
          lorePending={exploreCoords.pending}
        />
      ) : null}
      <div className="room-scene-panel__stage">
        <div
          ref={parentRef}
          data-testid="phaser-parent"
          className="room-scene-panel__canvas"
        />
        <div className="room-scene-panel__overlay" aria-live="polite">
          {!connected ? (
            <p className="room-scene-panel__hint">正在连接 Colyseus…</p>
          ) : null}
          {connected && moveHint ? (
            <p className="room-scene-panel__hint room-scene-panel__hint--warn" role="status">
              {moveHint}
            </p>
          ) : null}
          {connected && animating ? (
            <p className="room-scene-panel__hint">移动中…</p>
          ) : null}
          <LoreDiscoverToast
            toast={discoverToast}
            onDismiss={onDismissDiscoverToast ?? noopDismiss}
          />
        </div>
      </div>
    </section>
  );
}
