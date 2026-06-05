import * as Phaser from "phaser";
import { useEffect, useRef } from "react";
import { createDefaultRoom, type GameObject, type NpcState, type RoomState } from "@aetherlife/shared";
import type { PlayerSnapshot } from "../hooks/useColyseusRoom.js";
import { worldSize } from "../game/gridLayout.js";
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
  moveHint: string | null;
  thinkingNpcId: string | null;
  /** When false, NPCs snap to grid (load / reset); when true, live moves animate step-by-step. */
  npcAnimateMoves: boolean;
  /** Bumped on new game — destroys NPC sprites so no tween carries over. */
  npcResetEpoch: number;
  remoteInterpMs?: number;
  onMove: (dx: number, dy: number) => void;
  onMoveTo: (x: number, y: number) => void;
  onBootFailed?: () => void;
};

const MOVE_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);

function deltaForKey(key: string): [number, number] | null {
  const map: Record<string, [number, number]> = {
    w: [0, -1],
    s: [0, 1],
    a: [-1, 0],
    d: [1, 0],
    arrowup: [0, -1],
    arrowdown: [0, 1],
    arrowleft: [-1, 0],
    arrowright: [1, 0],
  };
  return map[key] ?? null;
}

function blocksMovementKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const field = target.closest(".composer__input");
  if (!(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)) {
    return false;
  }
  return !field.disabled;
}

const BOOT_TIMEOUT_MS = 5000;

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
  moveHint: string | null;
  thinkingNpcId: string | null;
  npcAnimateMoves: boolean;
  npcResetEpoch: number;
  reducedMotion: boolean;
  remoteInterpMs: number;
  onMove: (dx: number, dy: number) => void;
  onMoveTo: (x: number, y: number) => void;
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
  game.registry.set("moveHint", snap.moveHint);
  game.registry.set("thinkingNpcId", snap.thinkingNpcId);
  game.registry.set("npcAnimateMoves", snap.npcAnimateMoves);
  game.registry.set("npcResetEpoch", snap.npcResetEpoch);
  game.registry.set("reducedMotion", snap.reducedMotion);
  game.registry.set("remoteInterpMs", snap.remoteInterpMs);
  game.registry.set("onMove", snap.onMove);
  game.registry.set("onMoveTo", snap.onMoveTo);
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
      const { w, h } = worldSize(8, 8);
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
        moveHint: null,
        thinkingNpcId: null,
        npcAnimateMoves: false,
        npcResetEpoch: 0,
        reducedMotion: false,
        remoteInterpMs: 130,
        onMove: () => {},
        onMoveTo: () => {},
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
  moveHint,
  thinkingNpcId,
  npcAnimateMoves,
  npcResetEpoch,
  remoteInterpMs = 130,
  onMove,
  onMoveTo,
  onBootFailed,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const onBootFailedRef = useRef(onBootFailed);
  onBootFailedRef.current = onBootFailed;

  const callbacksRef = useRef({ onMove, onMoveTo });
  callbacksRef.current = { onMove, onMoveTo };

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
    moveHint,
    thinkingNpcId,
    npcAnimateMoves,
    npcResetEpoch,
    remoteInterpMs,
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
    moveHint,
    thinkingNpcId,
    npcAnimateMoves,
    npcResetEpoch,
    remoteInterpMs,
  };

  useEffect(() => {
    if (!bootOk || !parentRef.current) return;

    const { w, h } = worldSize(width, height);
    let destroyed = false;
    let bootTimer: number | undefined;
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
      moveHint: snap.moveHint,
      thinkingNpcId: snap.thinkingNpcId,
      npcAnimateMoves: snap.npcAnimateMoves,
      npcResetEpoch: snap.npcResetEpoch,
      reducedMotion,
      remoteInterpMs: snap.remoteInterpMs,
      onMove: (dx, dy) => callbacksRef.current.onMove(dx, dy),
      onMoveTo: (x, y) => callbacksRef.current.onMoveTo(x, y),
    });

    gameRef.current = game;

    bootTimer = window.setTimeout(() => {
      if (!destroyed) onBootFailedRef.current?.();
    }, BOOT_TIMEOUT_MS);

    game.events.once("ready", () => {
      if (bootTimer) clearTimeout(bootTimer);
      const scene = game.scene.getScene(ROOM_SCENE_KEY) as RoomScene | undefined;
      if (scene?.scene.isActive()) {
        /* boot ok */
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
  }, [bootOk, width, height]);

  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
      moveHint,
      thinkingNpcId,
      npcAnimateMoves,
      npcResetEpoch,
      reducedMotion,
      remoteInterpMs,
      onMove: (dx, dy) => callbacksRef.current.onMove(dx, dy),
      onMoveTo: (x, y) => callbacksRef.current.onMoveTo(x, y),
    });
    game.registry.events.emit("changedata", game.registry, "roomSync");

    const scene = game.scene.getScene(ROOM_SCENE_KEY) as RoomScene | undefined;
    scene?.syncEntities();
  }, [
    players,
    sessionId,
    mapNpcs,
    mapObjects,
    connected,
    moveMap,
    animating,
    moveHint,
    thinkingNpcId,
    npcAnimateMoves,
    npcResetEpoch,
    width,
    height,
  ]);

  useEffect(() => {
    const movementDisabled = !connected || animating;
    const handler = (event: KeyboardEvent) => {
      if (movementDisabled || event.repeat) return;
      const key = event.key.toLowerCase();
      if (!MOVE_KEYS.has(key) || blocksMovementKeys(event.target)) return;
      const delta = deltaForKey(key);
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      callbacksRef.current.onMove(delta[0], delta[1]);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [connected, animating]);

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
      <p className="room-scene-panel__subtitle">点选格子或 WASD 移动</p>
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
      <div
        ref={parentRef}
        data-testid="phaser-parent"
        className="room-scene-panel__canvas"
        style={{ width: "100%" }}
      />
    </section>
  );
}
