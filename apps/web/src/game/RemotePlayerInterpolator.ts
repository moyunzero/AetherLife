import type Phaser from "phaser";
import { GRID_STEP_MS, STEP_OVERLAP } from "./gridMovement.js";
import { gridToWorld } from "./gridLayout.js";

export type GridCell = { x: number; y: number };

/** Snapshot of authoritative server cell + receive time (for buffer pruning). */
type RemoteSnapshot = GridCell & { t: number };

type RemoteTrack = {
  lastServer: GridCell | null;
  stepQueue: GridCell[];
  snapshots: RemoteSnapshot[];
  pendingSnap: GridCell | null;
};

export type RemoteInterpEntity = {
  container: Phaser.GameObjects.Container;
  gridX: number;
  gridY: number;
  targetGridX?: number;
  targetGridY?: number;
  depthLayer: 0 | 1 | 2;
  moveTween?: Phaser.Tweens.Tween;
};

export type RemoteInterpDeps = {
  tweens: Phaser.Tweens.TweenManager;
  getReducedMotion: () => boolean;
  entityDepth: (gx: number, gy: number, layer: 0 | 1 | 2) => number;
  snapEntityToGrid: (ent: RemoteInterpEntity, gx: number, gy: number) => void;
  stopEntityMotion: (ent: RemoteInterpEntity) => void;
  stepMs?: number;
  onStepStart?: (
    ent: RemoteInterpEntity,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ) => void;
  onStepEnd?: (ent: RemoteInterpEntity, gx: number, gy: number, continuing: boolean) => void;
};

/** Max Manhattan distance before snap (teleport / large desync). */
const MAX_CATCHUP_CELLS = 16;
/** Drop snapshots older than this (ms). */
const SNAPSHOT_MAX_AGE_MS = 600;

function manhattanSteps(fromX: number, fromY: number, toX: number, toY: number): GridCell[] {
  const steps: GridCell[] = [];
  let cx = fromX;
  let cy = fromY;
  while (cx !== toX || cy !== toY) {
    if (cx !== toX) cx += cx < toX ? 1 : -1;
    else cy += cy < toY ? 1 : -1;
    steps.push({ x: cx, y: cy });
  }
  return steps;
}

/**
 * Buffers remote player server cells and plays them back one grid step at a time
 * (no diagonal slide across multiple cells).
 */
export class RemotePlayerInterpolator {
  private tracks = new Map<string, RemoteTrack>();

  reset(): void {
    this.tracks.clear();
  }

  remove(sessionId: string): void {
    this.tracks.delete(sessionId);
  }

  /** Record latest authoritative cell from Colyseus schema. */
  pushServerCell(sessionId: string, gx: number, gy: number, now = performance.now()): void {
    let track = this.tracks.get(sessionId);
    if (!track) {
      track = { lastServer: null, stepQueue: [], snapshots: [], pendingSnap: null };
      this.tracks.set(sessionId, track);
    }

    const lastSnap = track.snapshots[track.snapshots.length - 1];
    if (lastSnap && lastSnap.x === gx && lastSnap.y === gy) return;

    track.snapshots.push({ x: gx, y: gy, t: now });
    while (
      track.snapshots.length > 1 &&
      now - track.snapshots[0]!.t > SNAPSHOT_MAX_AGE_MS
    ) {
      track.snapshots.shift();
    }

    const prev = track.lastServer;
    if (!prev) {
      track.lastServer = { x: gx, y: gy };
      return;
    }
    if (prev.x === gx && prev.y === gy) return;

    const dist = Math.abs(gx - prev.x) + Math.abs(gy - prev.y);
    if (dist > MAX_CATCHUP_CELLS) {
      track.stepQueue = [];
      track.lastServer = { x: gx, y: gy };
      track.pendingSnap = { x: gx, y: gy };
      return;
    }

    track.stepQueue.push(...manhattanSteps(prev.x, prev.y, gx, gy));
    track.lastServer = { x: gx, y: gy };
  }

  /** Snap remote entity to server and clear buffered steps (reduced motion / catch-up). */
  snapToServer(
    sessionId: string,
    ent: RemoteInterpEntity,
    gx: number,
    gy: number,
    deps: RemoteInterpDeps,
  ): void {
    const track = this.tracks.get(sessionId);
    if (track) {
      track.stepQueue = [];
      track.lastServer = { x: gx, y: gy };
      track.snapshots = [{ x: gx, y: gy, t: performance.now() }];
      track.pendingSnap = null;
    }
    deps.stopEntityMotion(ent);
    ent.targetGridX = gx;
    ent.targetGridY = gy;
    deps.snapEntityToGrid(ent, gx, gy);
  }

  /**
   * Drain step queues in the render loop — one grid tween per call when idle.
   */
  advance(
    sprites: Map<string, RemoteInterpEntity>,
    localSessionId: string | null,
    deps: RemoteInterpDeps,
  ): void {
    const stepMs = deps.stepMs ?? GRID_STEP_MS;
    const reduced = deps.getReducedMotion();

    for (const [sessionId, track] of this.tracks) {
      if (sessionId === localSessionId) continue;
      const ent = sprites.get(sessionId);
      if (!ent) continue;

      if (reduced) {
        const server = track.lastServer;
        if (
          server &&
          (ent.gridX !== server.x || ent.gridY !== server.y)
        ) {
          this.snapToServer(sessionId, ent, server.x, server.y, deps);
        }
        continue;
      }

      if (ent.moveTween?.isPlaying()) continue;

      const next = track.stepQueue.shift();
      if (!next) continue;

      if (ent.gridX === next.x && ent.gridY === next.y) continue;

      const dist =
        Math.abs(next.x - ent.gridX) + Math.abs(next.y - ent.gridY);
      if (dist !== 1) {
        this.snapToServer(sessionId, ent, next.x, next.y, deps);
        continue;
      }

      this.tweenRemoteStep(ent, next.x, next.y, track, deps, stepMs);
    }
  }

  private tweenRemoteStep(
    ent: RemoteInterpEntity,
    gx: number,
    gy: number,
    track: RemoteTrack,
    deps: RemoteInterpDeps,
    stepMs: number,
  ): void {
    ent.targetGridX = gx;
    ent.targetGridY = gy;
    const fromX = ent.gridX;
    const fromY = ent.gridY;
    deps.onStepStart?.(ent, fromX, fromY, gx, gy);

    const { wx, wy } = gridToWorld(gx, gy);
    ent.container.setDepth(deps.entityDepth(gx, gy, ent.depthLayer));
    let overlapTriggered = false;

    const finishStep = () => {
      ent.moveTween = undefined;
      deps.onStepEnd?.(ent, gx, gy, track.stepQueue.length > 0);
    };

    ent.moveTween = deps.tweens.add({
      targets: ent.container,
      x: wx,
      y: wy,
      duration: stepMs,
      ease: "Cubic.easeInOut",
      onUpdate: (tween) => {
        if (overlapTriggered || tween.progress < STEP_OVERLAP) return;
        if (track.stepQueue.length === 0) return;
        overlapTriggered = true;
        ent.gridX = gx;
        ent.gridY = gy;
        tween.stop();
        finishStep();
      },
      onComplete: () => {
        if (overlapTriggered) return;
        ent.gridX = gx;
        ent.gridY = gy;
        finishStep();
      },
    });
  }

  takePendingSnap(sessionId: string): GridCell | null {
    const track = this.tracks.get(sessionId);
    if (!track?.pendingSnap) return null;
    const cell = track.pendingSnap;
    track.pendingSnap = null;
    return cell;
  }

  /** Large catch-up pending — snap on next pushServerCell boundary. */
  needsSnap(sessionId: string, ent: RemoteInterpEntity): boolean {
    const track = this.tracks.get(sessionId);
    if (!track?.lastServer) return false;
    const server = track.lastServer;
    if (track.stepQueue.length === 0) {
      return ent.gridX !== server.x || ent.gridY !== server.y;
    }
    const dist =
      Math.abs(server.x - ent.gridX) + Math.abs(server.y - ent.gridY);
    return dist > MAX_CATCHUP_CELLS;
  }
}
