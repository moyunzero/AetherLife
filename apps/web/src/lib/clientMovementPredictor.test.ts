import { describe, expect, it, vi } from "vitest";
import {
  ClientMovementPredictor,
  type MovementPredictorContext,
} from "./clientMovementPredictor.js";

vi.mock("./chunkWalkability.js", () => ({
  clientCanStep: vi.fn(() => true),
}));

import { clientCanStep } from "./chunkWalkability.js";

function makeMotionBridge(
  overrides?: Partial<NonNullable<MovementPredictorContext["motionBridge"]>>,
): NonNullable<MovementPredictorContext["motionBridge"]> {
  return {
    queueStep: () => {},
    beginPathWalk: () => {},
    playVisualPath: () => {},
    cancelPath: () => {},
    cancelLocomotion: () => {},
    snapTo: () => {},
    getLogicGrid: () => null,
    isLocomoting: () => false,
    faceInputDirection: () => {},
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<MovementPredictorContext>): MovementPredictorContext {
  return {
    roomId: "test-room",
    sessionId: "sess-a",
    self: { sessionId: "sess-a", x: 3, y: 3 },
    otherCells: [],
    map: null,
    loadedChunks: [],
    motionBridge: null,
    sendMove: () => {},
    onHint: () => {},
    onVisualOverlay: () => {},
    onPendingCount: () => {},
    onRttMs: () => {},
    onCorrection: () => {},
    ...overrides,
  };
}

describe("ClientMovementPredictor.syncAuthoritativeFromSchema", () => {
  it("does not rewind authoritative when schema lags behind ack", () => {
    const p = new ClientMovementPredictor();
    const ctx = makeCtx();
    p.pushTargetMove(ctx, { x: 5, y: 3 });
    p.applyAck(ctx, { clientSeq: 1, x: 5, y: 3 }, false);
    expect(p.getPendingCount()).toBe(0);
    expect(p.getAuthoritativePos()).toEqual({ x: 5, y: 3 });

    p.syncAuthoritativeFromSchema({ x: 4, y: 3 });
    expect(p.getAuthoritativePos()).toEqual({ x: 5, y: 3 });
  });

  it("accepts schema on join when authoritative is unset", () => {
    const p = new ClientMovementPredictor();
    p.syncAuthoritativeFromSchema({ x: 2, y: 2 });
    expect(p.getAuthoritativePos()).toEqual({ x: 2, y: 2 });
  });

  it("advances auth along pending path when schema catches up before ack", () => {
    const p = new ClientMovementPredictor();
    const ctx = makeCtx({ self: { sessionId: "sess-a", x: 3, y: 4 } });
    p.enqueueStep(ctx, 1, 0);
    p.enqueueStep(ctx, 1, 0);
    expect(p.getAuthoritativePos()).toBeNull();
    p.syncAuthoritativeFromSchema({ x: 5, y: 4 });
    expect(p.getAuthoritativePos()).toEqual({ x: 5, y: 4 });
    expect(p.getPendingCount()).toBe(2);
  });
});

describe("ClientMovementPredictor.enqueueStep blocked", () => {
  it("does not clear pending or snap when clientCanStep fails", () => {
    const snapTo = vi.fn();
    const p = new ClientMovementPredictor();
    const ctx = makeCtx({
      self: { sessionId: "sess-a", x: 8, y: 4 },
      motionBridge: makeMotionBridge({
        snapTo,
        getLogicGrid: () => ({ x: 10, y: 4 }),
      }),
    });
    p.enqueueStep(ctx, 1, 0);
    expect(p.getPendingCount()).toBe(1);
    vi.mocked(clientCanStep).mockReturnValueOnce(false);
    const blocked = p.enqueueStep(ctx, 1, 0);
    expect(blocked).toBe(false);
    expect(p.getPendingCount()).toBe(1);
    expect(snapTo).not.toHaveBeenCalled();
    vi.mocked(clientCanStep).mockReturnValue(true);
  });

  it("calls onBlockedFace and sendMove without pending when blocked", () => {
    const onBlockedFace = vi.fn();
    const sendMove = vi.fn();
    const onHint = vi.fn();
    const p = new ClientMovementPredictor();
    const ctx = makeCtx({
      self: { sessionId: "sess-a", x: 3, y: 3 },
      onBlockedFace,
      sendMove,
      onHint,
    });
    vi.mocked(clientCanStep).mockReturnValueOnce(false);
    const blocked = p.enqueueStep(ctx, -1, 0);
    expect(blocked).toBe(false);
    expect(p.getPendingCount()).toBe(0);
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(onBlockedFace).toHaveBeenCalledWith(-1, 0);
    expect(sendMove).toHaveBeenCalledWith({ dx: -1, dy: 0 });
    expect(sendMove.mock.calls[0]![0]).not.toHaveProperty("clientSeq");
    vi.mocked(clientCanStep).mockReturnValue(true);
  });

  it("successful enqueueStep does not call onBlockedFace", () => {
    const onBlockedFace = vi.fn();
    const p = new ClientMovementPredictor();
    const ctx = makeCtx({ onBlockedFace });
    p.enqueueStep(ctx, 1, 0);
    expect(onBlockedFace).not.toHaveBeenCalled();
  });
});

describe("ClientMovementPredictor.applyAck stale correction", () => {
  it("ignores corrected snap when logic grid ahead of ack but schema matches ack", () => {
    const snapTo = vi.fn();
    const p = new ClientMovementPredictor();
    const ctx = makeCtx({
      self: { sessionId: "sess-a", x: 8, y: 4 },
      motionBridge: makeMotionBridge({
        snapTo,
        getLogicGrid: () => ({ x: 15, y: 4 }),
      }),
    });
    p.enqueueStep(ctx, 1, 0);
    p.enqueueStep(ctx, 1, 0);
    p.applyAck(ctx, { clientSeq: 1, x: 8, y: 4 }, false);
    expect(snapTo).not.toHaveBeenCalled();
    expect(p.getPendingCount()).toBe(1);
  });

  it("ignores corrected snap when Colyseus schema already ahead of ack", () => {
    const snapTo = vi.fn();
    const p = new ClientMovementPredictor();
    const ctx = makeCtx({
      self: { sessionId: "sess-a", x: 15, y: 4 },
      motionBridge: makeMotionBridge({
        snapTo,
        getLogicGrid: () => ({ x: 15, y: 4 }),
      }),
    });
    p.enqueueStep(ctx, 1, 0);
    p.enqueueStep(ctx, 1, 0);
    p.applyAck(ctx, { clientSeq: 1, x: 8, y: 4 }, false);
    expect(snapTo).not.toHaveBeenCalled();
    expect(p.getAuthoritativePos()).toEqual({ x: 15, y: 4 });
    expect(p.getPendingCount()).toBe(1);
  });
});

describe("ClientMovementPredictor.sendWasd", () => {
  it("waits while target restore move is in flight", () => {
    const sendMove = vi.fn();
    const p = new ClientMovementPredictor();
    const ctx = makeCtx({ sendMove });
    p.pushRestoreMove(ctx, { x: 15, y: 4 });
    p.sendWasd(ctx, 1, 0, false);
    expect(sendMove).toHaveBeenCalledTimes(1);
  });
});

describe("ClientMovementPredictor.retryBufferedInput", () => {
  it("drains inputBuffer when walkability becomes available", () => {
    const sendMove = vi.fn();
    const mocked = vi.mocked(clientCanStep);
    mocked.mockReturnValueOnce(false).mockReturnValue(true);

    const p = new ClientMovementPredictor();
    const ctx = makeCtx({ sendMove, self: { sessionId: "sess-a", x: 7, y: 4 } });
    p.sendWasd(ctx, 1, 0, false);
    expect(sendMove).toHaveBeenCalledTimes(1);
    expect(sendMove.mock.calls[0]![0]).toMatchObject({ dx: 1, dy: 0 });

    p.retryBufferedInput(ctx, false);
    expect(sendMove).toHaveBeenCalledTimes(2);
    expect(sendMove.mock.calls[1]![0]).toMatchObject({ dx: 1, dy: 0, clientSeq: expect.any(Number) });
  });
});

describe("ClientMovementPredictor.visual-only at pending cap", () => {
  it("queues motion without network when pending is full", () => {
    const sendMove = vi.fn();
    const queueStep = vi.fn();
    const p = new ClientMovementPredictor();
    const ctx = makeCtx({
      sendMove,
      self: { sessionId: "sess-a", x: 0, y: 4 },
      motionBridge: makeMotionBridge({
        queueStep,
        getLogicGrid: () => ({ x: 8, y: 4 }),
      }),
    });

    for (let i = 0; i < 8; i++) {
      p.enqueueStep(ctx, 1, 0);
    }
    expect(sendMove).toHaveBeenCalledTimes(8);

    p.sendWasd(ctx, 1, 0, false);
    expect(sendMove).toHaveBeenCalledTimes(8);
    expect(queueStep).toHaveBeenCalledWith(9, 4);
    expect(p.getVisualOnlyAhead()).toBe(1);
  });

  it("faces toward blocked direction at pending cap without extra hint", () => {
    const onBlockedFace = vi.fn();
    const onHint = vi.fn();
    const sendMove = vi.fn();
    const p = new ClientMovementPredictor();
    const ctx = makeCtx({
      sendMove,
      onBlockedFace,
      onHint,
      self: { sessionId: "sess-a", x: 0, y: 4 },
      motionBridge: makeMotionBridge({
        getLogicGrid: () => ({ x: 8, y: 4 }),
      }),
    });

    for (let i = 0; i < 8; i++) {
      p.enqueueStep(ctx, 1, 0);
    }
    vi.mocked(clientCanStep).mockReturnValueOnce(false);

    p.sendWasd(ctx, 0, -1, false);
    expect(onBlockedFace).toHaveBeenCalledWith(0, -1);
    expect(sendMove).toHaveBeenLastCalledWith({ dx: 0, dy: -1 });
    expect(onHint).not.toHaveBeenCalled();
    vi.mocked(clientCanStep).mockReturnValue(true);
  });
});
