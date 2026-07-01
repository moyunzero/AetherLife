/** Shared grid locomotion timing — Phaser tweens + keyboard repeat. */
export const GRID_STEP_MS = 200;
export const STEP_OVERLAP = 0.72;
export const MAX_PREDICT_AHEAD = 8;
/** Visual-only steps while network pending is full (keeps sprite moving at chunk boundaries). */
export const MAX_VISUAL_ONLY_AHEAD = 4;
/** Per-frame camera follow toward local player container (0–1, higher = snappier). */
export const CAMERA_LERP = 0.14;
/** Max wait for in-flight move acks around click-to-move (ms). Real RTT + chunk load often >800ms. */
export const CLICK_PENDING_DRAIN_MS = 3000;
/** Poll interval while draining pending queue before click-to-move (ms). */
export const PENDING_POLL_MS = 50;
/**
 * Hold this long before WASD auto-repeat starts.
 * Prevents a short tap (keydown + keyup <~200ms) from firing a second step via setInterval.
 */
export const HOLD_REPEAT_DELAY_MS = Math.max(GRID_STEP_MS + 80, 200);

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

export function deltaForMoveKey(key: string): [number, number] | null {
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

export type GridMovementKeyHandle = {
  destroy: () => void;
};

/** WASD / arrows on `window` — used by Phaser RoomScene and MovementPanel fallback. */
export function attachGridMovementKeys(options: {
  enabled: boolean;
  stepMs?: number;
  holdRepeatDelayMs?: number;
  onMove: (dx: number, dy: number) => void;
}): GridMovementKeyHandle {
  const {
    enabled,
    stepMs = GRID_STEP_MS,
    holdRepeatDelayMs = HOLD_REPEAT_DELAY_MS,
    onMove,
  } = options;
  let interval: number | undefined;
  let repeatDelayTimer: number | undefined;
  let heldKey: string | null = null;

  const fireHeld = () => {
    const key = heldKey;
    if (!key) return;
    const delta = deltaForMoveKey(key);
    if (!delta) return;
    onMove(delta[0], delta[1]);
  };

  const stopRepeat = () => {
    if (interval !== undefined) {
      window.clearInterval(interval);
      interval = undefined;
    }
    if (repeatDelayTimer !== undefined) {
      window.clearTimeout(repeatDelayTimer);
      repeatDelayTimer = undefined;
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!enabled) return;
    const key = event.key.toLowerCase();
    if (!MOVE_KEYS.has(key) || blocksMovementKeys(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (heldKey === key) return;

    heldKey = key;
    fireHeld();
    stopRepeat();
    repeatDelayTimer = window.setTimeout(() => {
      repeatDelayTimer = undefined;
      if (heldKey !== key) return;
      interval = window.setInterval(() => fireHeld(), stepMs);
    }, holdRepeatDelayMs);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (heldKey !== key) return;
    heldKey = null;
    stopRepeat();
  };

  const onBlur = () => {
    heldKey = null;
    stopRepeat();
  };

  if (enabled) {
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
  }

  return {
    destroy: () => {
      heldKey = null;
      stopRepeat();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    },
  };
}
