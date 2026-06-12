import type Phaser from "phaser";
import {
  GRID_STEP_MS,
  MAX_PREDICT_AHEAD,
  STEP_OVERLAP,
} from "./gridMovement.js";
import { gridToWorld } from "./gridLayout.js";
import { entityYSortDepth, entityYSortDepthFromCenter } from "./entityLayout.js";
import type {
  GridCell as MotionCell,
  LocalPlayerMotionBridge,
  PathStepEmitter,
} from "./localPlayerMotion.js";

/** Minimal entity surface for local-player locomotion tweens. */
export type MovementEntity = {
  container: Phaser.GameObjects.Container;
  gridX: number;
  gridY: number;
  targetGridX?: number;
  targetGridY?: number;
  depthLayer: 0 | 1 | 2;
  moveTween?: Phaser.Tweens.Tween;
};

export type LocalPlayerMovementDeps = {
  getEntity: () => MovementEntity | undefined;
  tweens: Phaser.Tweens.TweenManager;
  getReducedMotion: () => boolean;
  snapEntityToGrid: (ent: MovementEntity, gx: number, gy: number) => void;
  stopEntityMotion: (ent: MovementEntity) => void;
  /** Called after snapTo so the scene can reset camera lerp anchors. */
  onSnap?: (wx: number, wy: number) => void;
  onStepStart?: (
    ent: MovementEntity,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ) => void;
  onStepEnd?: (ent: MovementEntity, gx: number, gy: number, continuing: boolean) => void;
  onFaceInput?: (dx: number, dy: number) => void;
};

/**
 * Phaser-side local player locomotion: WASD step queue, click path tweens, overlap chaining.
 * Network prediction stays in MovementSyncController; this only drives sprites.
 */
export class LocalPlayerMovementController {
  private localStepQueue: MotionCell[] = [];
  private localPathState: {
    cells: MotionCell[];
    index: number;
    emitStep: PathStepEmitter;
    onComplete: () => void;
    paused: boolean;
    fromX: number;
    fromY: number;
  } | null = null;

  constructor(private readonly deps: LocalPlayerMovementDeps) {}

  buildBridge(): LocalPlayerMotionBridge {
    return {
      queueStep: (gx, gy) => this.queueLocalStep(gx, gy),
      beginPathWalk: (path, emitStep, onComplete) =>
        this.beginLocalPathWalk(path, emitStep, onComplete),
      playVisualPath: (path, onComplete) =>
        this.beginLocalPathWalk(path, () => true, onComplete),
      cancelPath: () => this.cancelLocalPath(),
      cancelLocomotion: () => this.cancelLocalLocomotion(),
      snapTo: (gx, gy) => this.snapLocalPlayer(gx, gy),
      getLogicGrid: () => this.getLocalLogicGrid(),
      isLocomoting: () => this.isLocalLocomoting(),
      faceInputDirection: (dx, dy) => {
        if (dx === 0 && dy === 0) return;
        this.deps.onFaceInput?.(dx, dy);
      },
    };
  }

  /** Resume path walk when emitStep was paused (per-step network). */
  tickPausedPath(): void {
    if (this.localPathState?.paused) {
      this.advanceLocalPath();
    }
  }

  /** Per-frame drain so queued steps start as soon as the prior tween finishes. */
  tickLocalMovement(): void {
    const ent = this.deps.getEntity();
    if (ent) this.drainLocalStepQueue(ent);
  }

  reset(): void {
    this.localStepQueue = [];
    this.localPathState = null;
  }

  private getLocalLogicGrid(): MotionCell | null {
    const ent = this.deps.getEntity();
    if (!ent) return null;
    return { x: ent.gridX, y: ent.gridY };
  }

  isLocalLocomoting(): boolean {
    const ent = this.deps.getEntity();
    return (
      this.localStepQueue.length > 0
      || this.localPathState !== null
      || Boolean(ent?.moveTween?.isPlaying())
    );
  }

  private queueLocalStep(gx: number, gy: number): void {
    if (this.localStepQueue.length >= MAX_PREDICT_AHEAD) {
      this.localStepQueue.shift();
    }
    this.localStepQueue.push({ x: gx, y: gy });
    const ent = this.deps.getEntity();
    if (ent) this.drainLocalStepQueue(ent);
  }

  private cancelLocalPath(): void {
    this.localPathState = null;
  }

  private cancelLocalLocomotion(): void {
    this.localPathState = null;
    this.localStepQueue = [];
    const ent = this.deps.getEntity();
    if (!ent) return;
    ent.moveTween?.stop();
    ent.moveTween = undefined;
  }

  private hasMoreLocalSteps(): boolean {
    if (this.localStepQueue.length > 0) return true;
    const state = this.localPathState;
    if (!state) return false;
    return state.index < state.cells.length;
  }

  private beginLocalPathWalk(
    path: MotionCell[],
    emitStep: PathStepEmitter,
    onComplete: () => void,
  ): void {
    const ent = this.deps.getEntity();
    if (!ent || path.length === 0) {
      onComplete();
      return;
    }
    this.localStepQueue = [];
    this.deps.stopEntityMotion(ent);
    this.localPathState = {
      cells: path,
      index: 0,
      emitStep,
      onComplete,
      paused: false,
      fromX: ent.gridX,
      fromY: ent.gridY,
    };
    this.advanceLocalPath();
  }

  private advanceLocalPath(): void {
    const ent = this.deps.getEntity();
    const state = this.localPathState;
    if (!ent || !state) return;

    if (state.index >= state.cells.length) {
      this.localPathState = null;
      state.onComplete();
      return;
    }

    const target = state.cells[state.index]!;
    const dx = target.x - ent.gridX;
    const dy = target.y - ent.gridY;
    if (Math.abs(dx) + Math.abs(dy) !== 1) {
      this.localPathState = null;
      state.onComplete();
      return;
    }

    if (!state.paused) {
      const ok = state.emitStep(dx, dy);
      if (!ok) {
        state.paused = true;
        return;
      }
    }

    state.paused = false;
    state.index += 1;
    this.tweenLocalStep(ent, target.x, target.y, () => {
      this.advanceLocalPath();
    });
  }

  private snapLocalPlayer(gx: number, gy: number): void {
    const ent = this.deps.getEntity();
    if (!ent) return;
    this.localStepQueue = [];
    this.localPathState = null;
    this.deps.stopEntityMotion(ent);
    this.deps.snapEntityToGrid(ent, gx, gy);
    const { wx, wy } = gridToWorld(gx, gy);
    this.deps.onSnap?.(wx, wy);
  }

  private drainLocalStepQueue(ent: MovementEntity): void {
    if (ent.moveTween?.isPlaying()) {
      return;
    }
    const next = this.localStepQueue.shift();
    if (!next) return;
    this.tweenLocalStep(ent, next.x, next.y, () => {
      this.drainLocalStepQueue(ent);
    });
  }

  private tweenLocalStep(
    ent: MovementEntity,
    gx: number,
    gy: number,
    onComplete?: () => void,
  ): void {
    const reduced = this.deps.getReducedMotion();
    ent.targetGridX = gx;
    ent.targetGridY = gy;
    if (reduced) {
      this.deps.snapEntityToGrid(ent, gx, gy);
      onComplete?.();
      return;
    }

    const fromX = ent.gridX;
    const fromY = ent.gridY;
    this.deps.onStepStart?.(ent, fromX, fromY, gx, gy);

    const { wx, wy } = gridToWorld(gx, gy);
    ent.container.setDepth(entityYSortDepth(gx, gy, ent.depthLayer));
    let overlapTriggered = false;

    const finishStep = (via: "overlap" | "complete") => {
      ent.moveTween = undefined;
      this.deps.onStepEnd?.(ent, gx, gy, this.hasMoreLocalSteps());
      onComplete?.();
    };

    ent.moveTween = this.deps.tweens.add({
      targets: ent.container,
      x: wx,
      y: wy,
      duration: GRID_STEP_MS,
      ease: "Cubic.easeInOut",
      onUpdate: (tween) => {
        const target = tween.targets[0] as Phaser.GameObjects.Container;
        ent.container.setDepth(
          entityYSortDepthFromCenter(target.x, target.y, ent.depthLayer),
        );
        if (overlapTriggered || tween.progress < STEP_OVERLAP) return;
        if (!this.hasMoreLocalSteps()) return;
        overlapTriggered = true;
        ent.gridX = gx;
        ent.gridY = gy;
        tween.stop();
        finishStep("overlap");
      },
      onComplete: () => {
        if (overlapTriggered) return;
        ent.gridX = gx;
        ent.gridY = gy;
        finishStep("complete");
      },
    });
  }
}
