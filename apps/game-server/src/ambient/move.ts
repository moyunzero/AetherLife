import {
  canStepGlobal,
  type GlobalMoveGrid,
  type GridCell,
  type RoomState,
} from "@aetherlife/shared";
import { findGridPath } from "../colyseus/move-handler.js";

export type NpcStepInput = {
  npcX: number;
  npcY: number;
  targetGx: number;
  targetGy: number;
  grid: GlobalMoveGrid;
  playerCells: readonly GridCell[];
  otherNpcCells: readonly GridCell[];
};

export type NpcStepResult = {
  moved: boolean;
  x: number;
  y: number;
};

function cellOccupied(cells: readonly GridCell[], x: number, y: number): boolean {
  return cells.some((c) => c.x === x && c.y === y);
}

/** At most one global grid step toward target; rejects player and other-NPC cells (MP-07). */
export function stepNpcTowardTarget(input: NpcStepInput): NpcStepResult {
  const { npcX, npcY, targetGx, targetGy, grid, playerCells, otherNpcCells } = input;

  const path = findGridPath(npcX, npcY, targetGx, targetGy, grid);
  if (!path || path.length < 2) {
    return { moved: false, x: npcX, y: npcY };
  }

  const next = path[1]!;

  if (cellOccupied(playerCells, next.x, next.y)) {
    return { moved: false, x: npcX, y: npcY };
  }
  if (cellOccupied(otherNpcCells, next.x, next.y)) {
    return { moved: false, x: npcX, y: npcY };
  }
  if (!canStepGlobal(next.x, next.y, grid)) {
    return { moved: false, x: npcX, y: npcY };
  }

  return { moved: true, x: next.x, y: next.y };
}

export function buildOtherNpcCells(map: RoomState, excludeNpcId: string): GridCell[] {
  return map.npcs
    .filter((npc) => npc.id !== excludeNpcId)
    .map((npc) => ({ x: npc.x, y: npc.y }));
}
