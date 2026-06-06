/** One client-predicted step awaiting server moveAck. */
export type PendingMove = {
  clientSeq: number;
  /** Client visual target after this step. */
  toX: number;
  toY: number;
  /** Authoritative cell the server should reach (dx/dy from server chain, not visual). */
  serverToX: number;
  serverToY: number;
  /** Unit step for WASD; server applies from its current cell each time. */
  dx?: number;
  dy?: number;
  sentAt: number;
};

export type MoveAckInput = {
  clientSeq: number;
  x: number;
  y: number;
};

export type MoveAckReconcileResult = {
  pending: PendingMove[];
  lastAckedSeq: number;
  visualPos: { x: number; y: number } | null;
  corrected: boolean;
  hint: string | null;
  recordRtt: boolean;
  /** Update authoritativePosRef to ack.x/y after this reconcile. */
  advanceAuthoritative: boolean;
  /** Earlier pending seq still in flight — caller should buffer this ack and retry. */
  deferred: boolean;
};

function ackMatchesMove(
  move: PendingMove,
  ack: MoveAckInput,
  authoritative: { x: number; y: number } | null | undefined,
): boolean {
  if (move.serverToX === ack.x && move.serverToY === ack.y) return true;
  if (
    authoritative &&
    move.dx !== undefined &&
    move.dy !== undefined &&
    ack.x === authoritative.x + move.dx &&
    ack.y === authoritative.y + move.dy
  ) {
    return true;
  }
  return false;
}

const SYNC_HINT = "位置已与服务器同步。";

function manhattan(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function isLeadingAlongStep(
  visual: { x: number; y: number },
  ack: MoveAckInput,
  move: PendingMove,
): boolean {
  if (move.dx !== undefined && move.dy !== undefined) {
    if (move.dx !== 0) return (visual.x - ack.x) * move.dx > 0;
    if (move.dy !== 0) return (visual.y - ack.y) * move.dy > 0;
  }
  return manhattan(visual, ack) > manhattan({ x: move.toX, y: move.toY }, ack);
}

/** Visual overlay after a successful ack — chains to pending tail or keeps leading overlay. */
export function leadingVisualAfterAck(
  visualPos: { x: number; y: number } | null,
  move: PendingMove,
  ack: MoveAckInput,
  nextPending: PendingMove[],
): { x: number; y: number } | null {
  if (nextPending.length > 0) {
    const tail = nextPending[nextPending.length - 1]!;
    return { x: tail.toX, y: tail.toY };
  }
  if (!visualPos) return null;
  // Click-to-move (no dx/dy): server ack is the full path destination — align overlay to ack.
  if (move.dx === undefined && move.dy === undefined) {
    return { x: ack.x, y: ack.y };
  }
  if (isLeadingAlongStep(visualPos, ack, move)) return visualPos;
  return { x: ack.x, y: ack.y };
}

/** Client prediction origin: pending tail → visual overlay → schema self. */
export function clientPredictOrigin(
  self: { x: number; y: number },
  pending: readonly PendingMove[],
  visualPos: { x: number; y: number } | null,
): { x: number; y: number } {
  const tail = pending.length > 0 ? pending[pending.length - 1]! : null;
  if (tail) return { x: tail.toX, y: tail.toY };
  if (visualPos) return visualPos;
  return { x: self.x, y: self.y };
}

/** Authoritative cell after dx/dy on the in-flight server chain (not visual overlay). */
export function nextServerStepTarget(
  authoritative: { x: number; y: number },
  pending: PendingMove[],
  dx: number,
  dy: number,
): { serverToX: number; serverToY: number } {
  const tail = pending.length > 0 ? pending[pending.length - 1]! : null;
  const baseX = tail ? tail.serverToX : authoritative.x;
  const baseY = tail ? tail.serverToY : authoritative.y;
  return { serverToX: baseX + dx, serverToY: baseY + dy };
}

/**
 * Reconcile a server moveAck against the client prediction queue.
 * Ignores stale acks; only rolls back visual position on server rejection.
 */
export function reconcileMoveAck(
  ack: MoveAckInput,
  pending: PendingMove[],
  lastAckedSeq: number,
  visualPos: { x: number; y: number } | null,
  authoritative: { x: number; y: number } | null | undefined,
): MoveAckReconcileResult {
  const hasRttEntry = pending.some((m) => m.clientSeq === ack.clientSeq);
  const noop = {
    pending,
    lastAckedSeq,
    visualPos,
    corrected: false,
    hint: null,
    recordRtt: hasRttEntry,
    advanceAuthoritative: false,
    deferred: false,
  };

  if (ack.clientSeq < lastAckedSeq) {
    return noop;
  }

  const move = pending.find((m) => m.clientSeq === ack.clientSeq);
  const minPendingSeq =
    pending.length > 0 ? Math.min(...pending.map((m) => m.clientSeq)) : Number.POSITIVE_INFINITY;

  if (!move && ack.clientSeq < minPendingSeq) {
    return {
      ...noop,
      lastAckedSeq: Math.max(lastAckedSeq, ack.clientSeq),
    };
  }

  // Out-of-order ack: wait for the earliest in-flight seq before reconciling later ones.
  if (move && ack.clientSeq > minPendingSeq) {
    return { ...noop, deferred: true };
  }

  const nextLastAcked = Math.max(lastAckedSeq, ack.clientSeq);

  if (move && ackMatchesMove(move, ack, authoritative)) {
    const nextPending = pending.filter((m) => m.clientSeq > ack.clientSeq);
    return {
      pending: nextPending,
      lastAckedSeq: nextLastAcked,
      visualPos: leadingVisualAfterAck(visualPos, move, ack, nextPending),
      corrected: false,
      hint: null,
      recordRtt: hasRttEntry,
      advanceAuthoritative: true,
      deferred: false,
    };
  }

  if (move) {
    return {
      pending: [],
      lastAckedSeq: nextLastAcked,
      visualPos: { x: ack.x, y: ack.y },
      corrected: true,
      hint: SYNC_HINT,
      recordRtt: hasRttEntry,
      advanceAuthoritative: true,
      deferred: false,
    };
  }

  return {
    ...noop,
    lastAckedSeq: nextLastAcked,
  };
}
