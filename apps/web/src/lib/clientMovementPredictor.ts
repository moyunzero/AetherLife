import { MAX_PREDICT_AHEAD, MAX_VISUAL_ONLY_AHEAD } from "../game/gridMovement.js";
import type { LocalPlayerMotionBridge } from "../game/localPlayerMotion.js";
import {
  createDefaultRoom,
  clientPredictOrigin,
  nextServerStepTarget,
  reconcileMoveAck,
  type ChunkView,
  type ColyseusMoveAckPayload,
  type ColyseusMovePayload,
  type PendingMove,
  type RoomState,
} from "@aetherlife/shared";
import { clientCanStep } from "./chunkWalkability.js";
import { writeLastGridPos } from "./playerSession.js";

export type GridPos = { x: number; y: number };

export type PlayerCell = { x: number; y: number };

export type MovementPredictorPlayer = {
  sessionId: string;
  x: number;
  y: number;
};

export type MovementPredictorContext = {
  roomId: string;
  sessionId: string | null;
  self: MovementPredictorPlayer | undefined;
  otherCells: PlayerCell[];
  map: RoomState | null;
  loadedChunks: ChunkView[];
  motionBridge: LocalPlayerMotionBridge | null;
  sendMove: (payload: ColyseusMovePayload) => void;
  onHint: (hint: string) => void;
  onVisualOverlay: (pos: GridPos | null) => void;
  onPendingCount: (count: number) => void;
  onRttMs: (ms: number) => void;
  onCorrection: () => void;
  /** Local idle facing when clientCanStep fails (no pending / tween). */
  onBlockedFace?: (dx: number, dy: number) => void;
  /** Resolve in-flight click path when ack forces a snap mid-animation. */
  onClickPathAborted?: () => void;
};

const BLOCKED_MOVE_HINT = "该方向无法移动（NPC、门或其他玩家占格）";

export type EnqueueStepOptions = { skipVisual?: boolean };

/**
 * Pure-TS client movement prediction: pending queue, serverTo chain, moveAck reconcile.
 * Phaser locomotion via motionBridge; React only receives overlay/metrics callbacks.
 */
export class ClientMovementPredictor {
  private clientSeq = 0;
  private lastAckedSeq = 0;
  private pending: PendingMove[] = [];
  private authoritativePos: GridPos | null = null;
  private visualPos: GridPos | null = null;
  private deferredAcks = new Map<number, ColyseusMoveAckPayload>();
  private inputBuffer: { dx: number; dy: number } | null = null;
  /** Steps animated without a network packet while pending queue is full. */
  private visualOnlyAhead = 0;

  reset(): void {
    this.clientSeq = 0;
    this.lastAckedSeq = 0;
    this.pending = [];
    this.authoritativePos = null;
    this.visualPos = null;
    this.deferredAcks.clear();
    this.inputBuffer = null;
    this.visualOnlyAhead = 0;
  }

  getInputBuffer(): { dx: number; dy: number } | null {
    return this.inputBuffer;
  }

  getVisualOnlyAhead(): number {
    return this.visualOnlyAhead;
  }

  getVisualPos(): GridPos | null {
    return this.visualPos;
  }

  getAuthoritativePos(): GridPos | null {
    return this.authoritativePos;
  }

  getPendingCount(): number {
    return this.pending.length;
  }

  clearInputBuffer(): void {
    this.inputBuffer = null;
  }

  /** Retry WASD held while walkability was blocked (e.g. chunk not yet in chunksSync). */
  retryBufferedInput(ctx: MovementPredictorContext, animating: boolean): void {
    const buf = this.inputBuffer;
    if (!buf || animating || this.hasInFlightTargetMove()) {
      return;
    }
    if (this.pending.length >= MAX_PREDICT_AHEAD) {
      this.queueVisualOnlyStep(ctx, buf.dx, buf.dy);
      return;
    }
    if (this.enqueueStep(ctx, buf.dx, buf.dy)) {
      this.inputBuffer = null;
    }
  }

  private serverChainTail(ctx: MovementPredictorContext): GridPos {
    const tail = this.pending[this.pending.length - 1];
    const self = ctx.self;
    if (tail) return { x: tail.serverToX, y: tail.serverToY };
    const auth = this.authoritativePos ?? (self ? { x: self.x, y: self.y } : { x: 0, y: 0 });
    return auth;
  }

  private logicAheadOfServerTail(ctx: MovementPredictorContext): number {
    const logic = ctx.motionBridge?.getLogicGrid();
    if (!logic) return 0;
    const tail = this.serverChainTail(ctx);
    return Math.abs(logic.x - tail.x) + Math.abs(logic.y - tail.y);
  }

  private queueVisualOnlyStep(
    ctx: MovementPredictorContext,
    dx: number,
    dy: number,
  ): boolean {
    if (this.visualOnlyAhead >= MAX_VISUAL_ONLY_AHEAD) return false;
    const { self, sessionId } = ctx;
    if (!self || !sessionId) return false;

    const logic = ctx.motionBridge?.getLogicGrid();
    const origin = logic ?? clientPredictOrigin(self, this.pending, this.visualPos);
    const toX = origin.x + dx;
    const toY = origin.y + dy;
    const mapState = ctx.map ?? createDefaultRoom(ctx.roomId);

    if (!clientCanStep(mapState, toX, toY, ctx.otherCells, ctx.loadedChunks)) {
      this.notifyBlockedStep(ctx, dx, dy, { hint: false });
      return false;
    }

    const tail = this.serverChainTail(ctx);
    const aheadAfter =
      Math.abs(toX - tail.x) + Math.abs(toY - tail.y);
    if (aheadAfter > MAX_VISUAL_ONLY_AHEAD) return false;

    ctx.motionBridge?.queueStep(toX, toY);
    this.visualOnlyAhead += 1;
    return true;
  }

  /** Blocked step: hint (optional), local facing, server facing sync (no clientSeq / pending). */
  private notifyBlockedStep(
    ctx: MovementPredictorContext,
    dx: number,
    dy: number,
    opts?: { hint?: boolean },
  ): void {
    if (opts?.hint !== false) {
      ctx.onHint(BLOCKED_MOVE_HINT);
    }
    ctx.onBlockedFace?.(dx, dy);
    ctx.sendMove({ dx, dy });
  }

  private maybeQueueVisualStep(
    ctx: MovementPredictorContext,
    gx: number,
    gy: number,
  ): void {
    const logic = ctx.motionBridge?.getLogicGrid();
    if (logic && logic.x === gx && logic.y === gy) return;
    // Always enqueue — local step queue chains tweens; do not require logic to be
    // exactly one cell behind (rapid WASD / pending bursts leave logic lagging).
    ctx.motionBridge?.queueStep(gx, gy);
  }

  /** Schema sync when no in-flight predictions and schema caught up to last ack. */
  syncAuthoritativeFromSchema(self: GridPos): void {
    const auth = this.authoritativePos ?? this.inferAuthFromPending();
    if (this.pending.length > 0) {
      if (
        auth
        && (auth.x !== self.x || auth.y !== self.y)
        && this.schemaAlongPendingPath(self, auth)
      ) {
        this.authoritativePos = { x: self.x, y: self.y };
      }
      return;
    }
    if (auth && (auth.x !== self.x || auth.y !== self.y)) {
      return;
    }
    this.authoritativePos = { x: self.x, y: self.y };
  }

  /** Server chain anchor before the first in-flight step (when authoritativePos not set yet). */
  private inferAuthFromPending(): GridPos | null {
    const head = this.pending[0];
    if (!head) return null;
    if (head.dx !== undefined && head.dy !== undefined) {
      return {
        x: head.serverToX - head.dx,
        y: head.serverToY - head.dy,
      };
    }
    return { x: head.serverToX, y: head.serverToY };
  }

  /** True when Colyseus self lies on the predicted server chain between auth and pending tail. */
  private schemaAlongPendingPath(self: GridPos, auth: GridPos): boolean {
    const tail = this.pending[this.pending.length - 1];
    if (!tail) return false;
    const toTail = Math.abs(tail.serverToX - auth.x) + Math.abs(tail.serverToY - auth.y);
    const toSelf = Math.abs(self.x - auth.x) + Math.abs(self.y - auth.y);
    const selfToTail =
      Math.abs(tail.serverToX - self.x) + Math.abs(tail.serverToY - self.y);
    return toSelf > 0 && toSelf <= toTail && selfToTail <= toTail;
  }

  private hasInFlightTargetMove(): boolean {
    return this.pending.some((m) => m.dx === undefined && m.dy === undefined);
  }

  /** Restore saved grid on join (single target move). Returns false if target is not walkable. */
  pushRestoreMove(ctx: MovementPredictorContext, target: GridPos): boolean {
    const mapState = ctx.map ?? createDefaultRoom(ctx.roomId);
    if (!clientCanStep(mapState, target.x, target.y, ctx.otherCells, ctx.loadedChunks)) {
      return false;
    }
    const seq = ++this.clientSeq;
    this.pending.push({
      clientSeq: seq,
      toX: target.x,
      toY: target.y,
      serverToX: target.x,
      serverToY: target.y,
      sentAt: Date.now(),
    });
    this.visualPos = { x: target.x, y: target.y };
    ctx.motionBridge?.snapTo(target.x, target.y);
    ctx.onPendingCount(this.pending.length);
    ctx.sendMove({ targetX: target.x, targetY: target.y, clientSeq: seq });
    return true;
  }

  enqueueStep(
    ctx: MovementPredictorContext,
    dx: number,
    dy: number,
    opts?: EnqueueStepOptions,
  ): boolean {
    if (this.pending.length >= MAX_PREDICT_AHEAD) return false;

    const { self, sessionId } = ctx;
    if (!self || !sessionId) return false;

    const auth = this.authoritativePos ?? { x: self.x, y: self.y };
    const { serverToX, serverToY } = nextServerStepTarget(auth, this.pending, dx, dy);
    const mapState = ctx.map ?? createDefaultRoom(ctx.roomId);

    if (!clientCanStep(mapState, serverToX, serverToY, ctx.otherCells, ctx.loadedChunks)) {
      // Do not clear pending or snap — authoritativePos often lags schema during prediction.
      this.notifyBlockedStep(ctx, dx, dy);
      return false;
    }

    const seq = ++this.clientSeq;
    this.pending.push({
      clientSeq: seq,
      toX: serverToX,
      toY: serverToY,
      serverToX,
      serverToY,
      dx,
      dy,
      sentAt: Date.now(),
    });
    this.visualPos = { x: serverToX, y: serverToY };
    this.visualOnlyAhead = 0;
    if (!opts?.skipVisual) {
      this.maybeQueueVisualStep(ctx, serverToX, serverToY);
    }
    ctx.onPendingCount(this.pending.length);
    ctx.sendMove({ dx, dy, clientSeq: seq });
    return true;
  }

  sendWasd(ctx: MovementPredictorContext, dx: number, dy: number, animating: boolean): void {
    if (animating) return;
    if (this.hasInFlightTargetMove()) return;
    if (this.pending.length >= MAX_PREDICT_AHEAD) {
      this.inputBuffer = { dx, dy };
      this.queueVisualOnlyStep(ctx, dx, dy);
    } else if (!this.enqueueStep(ctx, dx, dy)) {
      this.inputBuffer = { dx, dy };
    } else {
      this.inputBuffer = null;
    }
  }

  /** Single authoritative target packet (click-to-move). */
  pushTargetMove(ctx: MovementPredictorContext, target: GridPos): number {
    const seq = ++this.clientSeq;
    this.pending.push({
      clientSeq: seq,
      toX: target.x,
      toY: target.y,
      serverToX: target.x,
      serverToY: target.y,
      sentAt: Date.now(),
    });
    this.visualPos = { x: target.x, y: target.y };
    ctx.onPendingCount(this.pending.length);
    ctx.sendMove({ targetX: target.x, targetY: target.y, clientSeq: seq });
    return seq;
  }

  /** Edge case: no self snapshot yet. */
  sendTargetOnly(ctx: MovementPredictorContext, targetX: number, targetY: number): void {
    this.pushTargetMove(ctx, { x: targetX, y: targetY });
  }

  prepareClickOrigin(ctx: MovementPredictorContext, auth: GridPos): void {
    this.visualPos = { x: auth.x, y: auth.y };
    ctx.onVisualOverlay(null);
    ctx.motionBridge?.snapTo(auth.x, auth.y);
  }

  applyAck(ctx: MovementPredictorContext, data: ColyseusMoveAckPayload, animating: boolean): void {
    const self = ctx.self;
    const authBefore =
      this.authoritativePos ?? (self ? { x: self.x, y: self.y } : null);
    const pendingBefore = this.pending;
    const result = reconcileMoveAck(
      data,
      this.pending,
      this.lastAckedSeq,
      this.visualPos,
      authBefore,
    );

    const localGrid =
      ctx.motionBridge?.getLogicGrid() ??
      this.visualPos ??
      (self ? { x: self.x, y: self.y } : null);

    if (result.corrected && localGrid && (localGrid.x !== data.x || localGrid.y !== data.y)) {
      this.visualOnlyAhead = 0;
      const failedSeq = data.clientSeq;
      this.pending = pendingBefore.filter((m) => m.clientSeq !== failedSeq);
      this.lastAckedSeq = Math.max(this.lastAckedSeq, failedSeq);
      const auth = this.authoritativePos;
      if (self && (self.x !== data.x || self.y !== data.y)) {
        this.authoritativePos = { x: self.x, y: self.y };
      } else if (auth) {
        this.authoritativePos = auth;
      } else {
        this.authoritativePos = { x: data.x, y: data.y };
      }
      ctx.onPendingCount(this.pending.length);
      this.deferredAcks.delete(failedSeq);
      const nextSeq = this.lastAckedSeq + 1;
      const buffered = this.deferredAcks.get(nextSeq);
      if (buffered) {
        this.applyAck(ctx, buffered, animating);
      }
      const buf = this.inputBuffer;
      if (
        buf
        && !animating
        && !this.hasInFlightTargetMove()
        && this.pending.length < MAX_PREDICT_AHEAD
        && this.enqueueStep(ctx, buf.dx, buf.dy)
      ) {
        this.inputBuffer = null;
      }
      return;
    }

    if (result.deferred) {
      this.deferredAcks.set(data.clientSeq, data);
      return;
    }

    if (result.recordRtt) {
      const sentAt = this.pending.find((m) => m.clientSeq === data.clientSeq)?.sentAt;
      if (sentAt) {
        ctx.onRttMs(Date.now() - sentAt);
      }
    }

    this.pending = result.pending;
    this.lastAckedSeq = result.lastAckedSeq;
    this.visualPos = result.visualPos;
    if (result.corrected || result.pending.length === 0) {
      ctx.onVisualOverlay(result.visualPos);
    }
    ctx.onPendingCount(this.pending.length);

    if (result.corrected) {
      this.visualOnlyAhead = 0;
      ctx.onCorrection();
      if (result.hint) ctx.onHint(result.hint);
      if (animating) {
        ctx.motionBridge?.cancelLocomotion();
        ctx.onClickPathAborted?.();
      }
      ctx.motionBridge?.snapTo(data.x, data.y);
    }

    if (!result.corrected && result.recordRtt) {
      this.visualOnlyAhead = Math.max(0, this.logicAheadOfServerTail(ctx));
    }

    if (result.advanceAuthoritative) {
      this.authoritativePos = { x: data.x, y: data.y };
    }

    writeLastGridPos(ctx.roomId, data.x, data.y);
    this.deferredAcks.delete(data.clientSeq);

    const nextSeq = this.lastAckedSeq + 1;
    const buffered = this.deferredAcks.get(nextSeq);
    if (buffered) {
      this.applyAck(ctx, buffered, animating);
    }

    const buf = this.inputBuffer;
    if (
      buf
      && !animating
      && this.pending.length < MAX_PREDICT_AHEAD
      && this.enqueueStep(ctx, buf.dx, buf.dy)
    ) {
      this.inputBuffer = null;
    }
  }
}
