import { useEffect, useRef } from "react";
import { attachGridMovementKeys, GRID_STEP_MS } from "../game/gridMovement.js";

type Options = {
  enabled: boolean;
  stepMs?: number;
  onMove: (dx: number, dy: number) => void;
};

/** WASD / arrows — React hook wrapper; Phaser RoomScene uses attachGridMovementKeys directly. */
export function useGridMovementKeys({ enabled, stepMs = GRID_STEP_MS, onMove }: Options): void {
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    if (!enabled) return;
    const handle = attachGridMovementKeys({
      enabled: true,
      stepMs,
      onMove: (dx, dy) => onMoveRef.current(dx, dy),
    });
    return () => handle.destroy();
  }, [enabled, stepMs]);
}
