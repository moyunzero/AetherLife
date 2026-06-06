import { describe, expect, it } from "vitest";
import {
  clientPredictOrigin,
  leadingVisualAfterAck,
  nextServerStepTarget,
  reconcileMoveAck,
  type PendingMove,
} from "./moveAck.js";

function pending(
  seq: number,
  toX: number,
  toY: number,
  serverToX = toX,
  serverToY = toY,
  dx?: number,
  dy?: number,
): PendingMove {
  return { clientSeq: seq, toX, toY, serverToX, serverToY, dx, dy, sentAt: 0 };
}

describe("clientPredictOrigin", () => {
  it("chains from pending tail before visual ref or schema", () => {
    expect(
      clientPredictOrigin(
        { x: 5, y: 4 },
        [pending(1, 6, 4), pending(2, 7, 4)],
        { x: 6, y: 4 },
      ),
    ).toEqual({ x: 7, y: 4 });
  });
});

describe("leadingVisualAfterAck", () => {
  it("advances visual to pending tail on intermediate ack", () => {
    expect(
      leadingVisualAfterAck(
        { x: 6, y: 4 },
        pending(1, 6, 4),
        { clientSeq: 1, x: 5, y: 4 },
        [pending(2, 7, 4)],
      ),
    ).toEqual({ x: 7, y: 4 });
  });

  it("syncs visual forward when overlay lagged behind ack", () => {
    expect(
      leadingVisualAfterAck(
        { x: 6, y: 4 },
        pending(3, 6, 4, 8, 4, 1, 0),
        { clientSeq: 3, x: 8, y: 4 },
        [],
      ),
    ).toEqual({ x: 8, y: 4 });
  });

  it("aligns click-to-move overlay to ack destination (not stale origin)", () => {
    expect(
      leadingVisualAfterAck(
        { x: 10, y: 4 },
        pending(1, 15, 4, 15, 4),
        { clientSeq: 1, x: 15, y: 4 },
        [],
      ),
    ).toEqual({ x: 15, y: 4 });
  });
});

describe("nextServerStepTarget", () => {
  it("chains from last pending server cell, not visual overlay", () => {
    const queue = [pending(1, 8, 4, 6, 4)];
    expect(nextServerStepTarget({ x: 5, y: 4 }, queue, 1, 0)).toEqual({
      serverToX: 7,
      serverToY: 4,
    });
  });

  it("uses authoritative base when pending empty (not stale schema self)", () => {
    expect(nextServerStepTarget({ x: 10, y: 4 }, [], 1, 0)).toEqual({
      serverToX: 11,
      serverToY: 4,
    });
  });
});

describe("reconcileMoveAck", () => {
  it("ignores stale ack when a higher seq was already acked", () => {
    const result = reconcileMoveAck(
      { clientSeq: 1, x: 5, y: 4 },
      [pending(2, 6, 4), pending(3, 7, 4)],
      2,
      { x: 7, y: 4 },
      { x: 6, y: 4 },
    );
    expect(result.visualPos).toEqual({ x: 7, y: 4 });
    expect(result.corrected).toBe(false);
    expect(result.pending).toHaveLength(2);
  });

  it("does not rollback visual on intermediate ack while more pending remain", () => {
    const result = reconcileMoveAck(
      { clientSeq: 1, x: 5, y: 4 },
      [pending(1, 5, 4), pending(2, 6, 4)],
      0,
      { x: 6, y: 4 },
      { x: 4, y: 4 },
    );
    expect(result.visualPos).toEqual({ x: 6, y: 4 });
    expect(result.pending).toEqual([pending(2, 6, 4)]);
    expect(result.corrected).toBe(false);
  });

  it("does not clear visual on successful ack (hook waits for onStateChange)", () => {
    const result = reconcileMoveAck(
      { clientSeq: 2, x: 6, y: 4 },
      [pending(2, 6, 4)],
      1,
      { x: 6, y: 4 },
      { x: 6, y: 4 },
    );
    expect(result.visualPos).toEqual({ x: 6, y: 4 });
    expect(result.pending).toEqual([]);
  });

  it("leaves leading visual unchanged when queue drains on success", () => {
    const result = reconcileMoveAck(
      { clientSeq: 3, x: 7, y: 4 },
      [pending(3, 7, 4)],
      2,
      { x: 7, y: 4 },
      { x: 5, y: 4 },
    );
    expect(result.visualPos).toEqual({ x: 7, y: 4 });
    expect(result.corrected).toBe(false);
    expect(result.pending).toEqual([]);
  });

  it("ignores orphan ack without rolling back leading visual", () => {
    const result = reconcileMoveAck(
      { clientSeq: 1, x: 5, y: 4 },
      [],
      3,
      { x: 7, y: 4 },
      { x: 6, y: 4 },
    );
    expect(result.visualPos).toEqual({ x: 7, y: 4 });
    expect(result.corrected).toBe(false);
  });

  it("accepts ack at serverTo while visual overlay leads ahead", () => {
    const result = reconcileMoveAck(
      { clientSeq: 1, x: 6, y: 4 },
      [pending(1, 8, 4, 6, 4, 1, 0)],
      0,
      { x: 8, y: 4 },
      { x: 5, y: 4 },
    );
    expect(result.corrected).toBe(false);
    expect(result.advanceAuthoritative).toBe(true);
    expect(result.visualPos).toEqual({ x: 8, y: 4 });
    expect(result.pending).toEqual([]);
  });

  it("accepts ack via authoritative + dx/dy when serverTo chain drifted", () => {
    const result = reconcileMoveAck(
      { clientSeq: 2, x: 6, y: 4 },
      [pending(2, 7, 4, 99, 99, 1, 0)],
      1,
      { x: 7, y: 4 },
      { x: 5, y: 4 },
    );
    expect(result.corrected).toBe(false);
    expect(result.advanceAuthoritative).toBe(true);
    expect(result.pending).toEqual([]);
  });

  it("defers out-of-order ack until earlier seq is acked", () => {
    const result = reconcileMoveAck(
      { clientSeq: 2, x: 6, y: 4 },
      [pending(1, 5, 4, 5, 4, 1, 0), pending(2, 6, 4, 6, 4, 1, 0)],
      0,
      { x: 6, y: 4 },
      { x: 4, y: 4 },
    );
    expect(result.deferred).toBe(true);
    expect(result.pending).toHaveLength(2);
    expect(result.corrected).toBe(false);
  });

  it("rolls back and clears queue when server rejects a predicted step", () => {
    const result = reconcileMoveAck(
      { clientSeq: 2, x: 5, y: 4 },
      [pending(2, 6, 4, 6, 4), pending(3, 7, 4, 7, 4)],
      1,
      { x: 7, y: 4 },
      { x: 5, y: 4 },
    );
    expect(result.visualPos).toEqual({ x: 5, y: 4 });
    expect(result.pending).toEqual([]);
    expect(result.corrected).toBe(true);
    expect(result.hint).toBeTruthy();
  });
});
