export type GridCell = { x: number; y: number };

export type PathStepEmitter = (dx: number, dy: number) => boolean;

/** Bridge from MovementSyncController → RoomScene local-player locomotion (no React per-step). */
export type LocalPlayerMotionBridge = {
  queueStep: (gx: number, gy: number) => void;
  beginPathWalk: (
    path: GridCell[],
    emitStep: PathStepEmitter,
    onComplete: () => void,
  ) => void;
  /** Animate path locally only — pair with a single `{ targetX, targetY }` move packet. */
  playVisualPath: (path: GridCell[], onComplete: () => void) => void;
  cancelPath: () => void;
  /** Stop path + WASD step queue and current tween without snapping. */
  cancelLocomotion: () => void;
  snapTo: (gx: number, gy: number) => void;
  getLogicGrid: () => GridCell | null;
  isLocomoting: () => boolean;
  /** Idle facing toward input when step is blocked (no tween). */
  faceInputDirection: (dx: number, dy: number) => void;
};
