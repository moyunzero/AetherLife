import type { Room } from "@colyseus/sdk";
import {
  CHUNK_SIZE,
  COLYSEUS_CLIENT_MESSAGES,
  COLYSEUS_SERVER_MESSAGES,
  createDefaultRoom,
  floorMod,
  type ChunkView,
  type ColyseusMoveAckPayload,
  type RoomState,
} from "@aetherlife/shared";
import { clientFindPath } from "../lib/chunkWalkability.js";
import {
  ClientMovementPredictor,
  type MovementPredictorContext,
} from "../lib/clientMovementPredictor.js";
import { writeLastGridPos } from "../lib/playerSession.js";
import type { PlayerSnapshot } from "../hooks/useColyseusRoom.js";
import {
  CLICK_PENDING_DRAIN_MS,
  PENDING_POLL_MS,
} from "./gridMovement.js";
import type { LocalPlayerMotionBridge } from "./localPlayerMotion.js";

const BLOCKED_PATH_HINT = "无法到达该格（被 NPC、门或其他玩家挡住）";

export type MovementSyncCallbacks = {
  onHint: (hint: string) => void;
  onPendingCount: (count: number) => void;
  onRttMs: (ms: number) => void;
  onCorrection: () => void;
  onAnimating: (animating: boolean) => void;
  onVisualPos: (pos: { x: number; y: number } | null) => void;
};

export type MovementSyncDataSources = {
  getRoomId: () => string;
  getPlayers: () => PlayerSnapshot[];
  getSessionId: () => string | null;
  getMap: () => RoomState | null;
  getLoadedChunks: () => ChunkView[];
  getMotionBridge: () => LocalPlayerMotionBridge | null;
  getJoinGeneration: () => number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Phaser-first movement orchestration: prediction, click path, pending drain.
 * RoomScene drives input + moveAck; React holds instance and HUD callbacks.
 */
export class MovementSyncController {
  private readonly predictor = new ClientMovementPredictor();
  private readonly callbacks: MovementSyncCallbacks;
  private sources: MovementSyncDataSources | null = null;
  private room: Room | null = null;
  private offMoveAck: (() => void) | undefined;
  private animating = false;
  private clickPathEnd: (() => void) | null = null;
  private lastChunkPrefetchMs = 0;

  constructor(callbacks: MovementSyncCallbacks) {
    this.callbacks = callbacks;
  }

  setDataSources(sources: MovementSyncDataSources): void {
    this.sources = sources;
  }

  /** Attach Colyseus room and subscribe moveAck (RoomScene or hook on join). */
  attachRoom(room: Room | null): void {
    this.offMoveAck?.();
    this.offMoveAck = undefined;
    this.room = room;
    if (!room || !this.sources) return;

    this.offMoveAck = room.onMessage(
      COLYSEUS_SERVER_MESSAGES.moveAck,
      (data: ColyseusMoveAckPayload) => {
        if (this.sources!.getJoinGeneration() !== this.boundGeneration) return;
        this.applyAck(data);
      },
    );
  }

  private boundGeneration = 0;

  setJoinGeneration(gen: number): void {
    this.boundGeneration = gen;
  }

  detachRoom(): void {
    this.offMoveAck?.();
    this.offMoveAck = undefined;
    this.room = null;
  }

  reset(): void {
    this.detachRoom();
    this.predictor.reset();
    this.animating = false;
    this.clickPathEnd = null;
  }

  getPredictor(): ClientMovementPredictor {
    return this.predictor;
  }

  getPendingCount(): number {
    return this.predictor.getPendingCount();
  }

  isAnimating(): boolean {
    return this.animating;
  }

  syncAuthoritativeFromSchema(self: { x: number; y: number }): void {
    this.predictor.syncAuthoritativeFromSchema(self);
  }

  pushRestoreMove(self: PlayerSnapshot, snapshots: PlayerSnapshot[], target: { x: number; y: number }): void {
    this.predictor.pushRestoreMove(this.buildCtx(self, snapshots), target);
  }

  sendWasd(dx: number, dy: number): void {
    const ctx = this.buildCtx();
    this.predictor.retryBufferedInput(ctx, this.animating);
    this.predictor.sendWasd(ctx, dx, dy, this.animating);
    this.maybePrefetchChunksNearEdge(dx, dy);
  }

  /** Proactively load adjacent chunks before the player crosses an 8×8 boundary. */
  private maybePrefetchChunksNearEdge(dx: number, dy: number): void {
    const sources = this.sources;
    const sid = sources?.getSessionId();
    const self = sid
      ? sources.getPlayers().find((p) => p.sessionId === sid)
      : undefined;
    if (!self || !this.room) return;

    const lx = floorMod(self.x, CHUNK_SIZE);
    const ly = floorMod(self.y, CHUNK_SIZE);
    const nearEdge =
      (dx > 0 && lx >= CHUNK_SIZE - 3)
      || (dx < 0 && lx <= 2)
      || (dy > 0 && ly >= CHUNK_SIZE - 3)
      || (dy < 0 && ly <= 2);
    if (!nearEdge) return;

    const now = Date.now();
    if (now - this.lastChunkPrefetchMs < 400) return;
    this.lastChunkPrefetchMs = now;
    this.room.send(COLYSEUS_CLIENT_MESSAGES.requestChunksSync, {});
  }

  async sendMoveTo(targetX: number, targetY: number): Promise<void> {
    if (this.animating) return;
    const sources = this.sources;
    if (!sources) return;

    const sid = sources.getSessionId();
    const self = sources.getPlayers().find((p) => p.sessionId === sid);

    if (!self || !sid) {
      this.predictor.sendTargetOnly(this.buildCtx(), targetX, targetY);
      return;
    }

    this.animating = true;
    this.callbacks.onAnimating(true);
    this.predictor.clearInputBuffer();
    const ctx = this.buildCtx();

    try {
      const drainDeadline = Date.now() + CLICK_PENDING_DRAIN_MS;
      while (this.predictor.getPendingCount() > 0 && Date.now() < drainDeadline) {
        await sleep(PENDING_POLL_MS);
      }
      if (this.predictor.getPendingCount() > 0) {
        this.callbacks.onHint("位置同步中，请稍后再试。");
        return;
      }

      sources.getMotionBridge()?.cancelLocomotion();

      const selfNow = sources.getPlayers().find((p) => p.sessionId === sid);
      if (!selfNow) return;

      const bridge = sources.getMotionBridge();
      const logic = bridge?.getLogicGrid();
      const auth = this.predictor.getAuthoritativePos() ?? { x: selfNow.x, y: selfNow.y };
      const origin = logic ?? auth;
      this.predictor.prepareClickOrigin(ctx, origin);

      const mapForPath = sources.getMap() ?? createDefaultRoom(sources.getRoomId());
      const others = sources
        .getPlayers()
        .filter((p) => p.sessionId !== sid)
        .map((p) => ({ x: p.x, y: p.y }));
      const path = clientFindPath(
        mapForPath,
        origin.x,
        origin.y,
        targetX,
        targetY,
        others,
        sources.getLoadedChunks(),
      );
      if (!path) {
        this.callbacks.onHint(BLOCKED_PATH_HINT);
        return;
      }
      if (path.length <= 1) return;

      const dest = path[path.length - 1]!;
      this.predictor.pushTargetMove(ctx, dest);

      if (!bridge) {
        const ackDeadline = Date.now() + CLICK_PENDING_DRAIN_MS;
        while (this.predictor.getPendingCount() > 0 && Date.now() < ackDeadline) {
          await sleep(PENDING_POLL_MS);
        }
        return;
      }

      await new Promise<void>((resolve) => {
        const finish = () => {
          this.clickPathEnd = null;
          resolve();
        };
        this.clickPathEnd = finish;
        bridge.playVisualPath(
          path.slice(1).map((c) => ({ x: c.x, y: c.y })),
          finish,
        );
      });

      const ackDeadline = Date.now() + CLICK_PENDING_DRAIN_MS;
      while (this.predictor.getPendingCount() > 0 && Date.now() < ackDeadline) {
        await sleep(PENDING_POLL_MS);
      }
    } finally {
      this.animating = false;
      this.callbacks.onAnimating(false);
    }
  }

  applyAck(data: ColyseusMoveAckPayload): void {
    this.predictor.applyAck(this.buildCtx(), data, this.animating);
  }

  onSchemaSelf(self: { x: number; y: number }): void {
    const rid = this.sources?.getRoomId();
    if (rid) writeLastGridPos(rid, self.x, self.y);
    this.syncAuthoritativeFromSchema(self);
  }

  /** After chunksSync updates loadedChunks — drain inputBuffer if walkability now allows. */
  onLoadedChunksUpdated(): void {
    this.predictor.retryBufferedInput(this.buildCtx(), this.animating);
  }

  private buildCtx(
    selfOverride?: PlayerSnapshot,
    snapshotsOverride?: PlayerSnapshot[],
  ): MovementPredictorContext {
    const sources = this.sources;
    const sid = sources?.getSessionId() ?? null;
    const players = snapshotsOverride ?? sources?.getPlayers() ?? [];
    const self =
      selfOverride ??
      (sid ? players.find((p) => p.sessionId === sid) : undefined);

    return {
      roomId: sources?.getRoomId() ?? "default",
      sessionId: sid,
      self: self
        ? { sessionId: self.sessionId, x: self.x, y: self.y }
        : undefined,
      otherCells: players
        .filter((p) => p.sessionId !== sid)
        .map((p) => ({ x: p.x, y: p.y })),
      map: sources?.getMap() ?? null,
      loadedChunks: sources?.getLoadedChunks() ?? [],
      motionBridge: sources?.getMotionBridge() ?? null,
      sendMove: (payload) => {
        this.room?.send(COLYSEUS_CLIENT_MESSAGES.move, payload);
      },
      onHint: this.callbacks.onHint,
      onVisualOverlay: this.callbacks.onVisualPos,
      onPendingCount: this.callbacks.onPendingCount,
      onRttMs: this.callbacks.onRttMs,
      onCorrection: this.callbacks.onCorrection,
      onClickPathAborted: () => {
        this.clickPathEnd?.();
        this.clickPathEnd = null;
      },
    };
  }
}
