import type { GameAction } from "@aetherlife/game-actions";
import {
  buildGlobalMoveGrid,
  findNearestGlobalWalkable,
  findNpc,
  type GlobalMoveGrid,
  type GridCell,
  type RoomState,
} from "@aetherlife/shared";
import { isTerrainWalkableInRegion } from "../world/region-walkability.js";

export type ApplyGameActionOptions = {
  /** All live player cells (Colyseus + map snapshot); defaults to map.player only. */
  otherPlayerCells?: readonly GridCell[];
  /** NPC / intent anchor — when requested cell is blocked, snap to walkable neighbors of this cell first. */
  moveSnapAnchor?: GridCell;
  /** Initiating human's cell — fallback snap anchor when intent neighbors are unavailable. */
  moveAnchorCell?: GridCell;
};

export class ExecutorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutorError";
  }
}

function executorTerrainWalkable(gx: number, gy: number): boolean {
  const terrain = isTerrainWalkableInRegion(gx, gy);
  if (terrain === undefined) return true;
  return terrain;
}

function buildExecutorGrid(
  map: RoomState,
  otherPlayers: readonly GridCell[],
  options?: { excludeNpcId?: string },
): GlobalMoveGrid {
  return buildGlobalMoveGrid({
    homeMap: map,
    otherPlayerCells: otherPlayers,
    isTerrainWalkable: executorTerrainWalkable,
    excludeNpcId: options?.excludeNpcId,
  });
}

function walkableNeighbors(
  map: RoomState,
  cx: number,
  cy: number,
  grid: GlobalMoveGrid,
): GridCell[] {
  return [
    { x: cx, y: cy - 1 },
    { x: cx, y: cy + 1 },
    { x: cx - 1, y: cy },
    { x: cx + 1, y: cy },
  ].filter(
    (c) =>
      c.x >= 0 &&
      c.y >= 0 &&
      c.x < map.width &&
      c.y < map.height &&
      !grid.isBlocked(c.x, c.y),
  );
}

function pickClosestCell(cells: GridCell[], targetX: number, targetY: number): GridCell {
  cells.sort((a, b) => {
    const da = Math.abs(a.x - targetX) + Math.abs(a.y - targetY);
    const db = Math.abs(b.x - targetX) + Math.abs(b.y - targetY);
    return da - db;
  });
  return cells[0]!;
}

function snapNpcMoveDest(
  map: RoomState,
  requestedX: number,
  requestedY: number,
  otherPlayers: readonly GridCell[],
  gridOpts: { excludeNpcId: string },
  moveSnapAnchor?: GridCell,
  moveAnchor?: GridCell,
): GridCell {
  const grid = buildExecutorGrid(map, otherPlayers, gridOpts);
  if (!grid.isBlocked(requestedX, requestedY)) {
    return { x: requestedX, y: requestedY };
  }

  if (moveSnapAnchor) {
    const intentNeighbors = walkableNeighbors(
      map,
      moveSnapAnchor.x,
      moveSnapAnchor.y,
      grid,
    );
    if (intentNeighbors.length > 0) {
      return pickClosestCell(intentNeighbors, requestedX, requestedY);
    }
  }

  if (moveAnchor) {
    const neighbors = [
      { x: moveAnchor.x, y: moveAnchor.y - 1 },
      { x: moveAnchor.x, y: moveAnchor.y + 1 },
      { x: moveAnchor.x - 1, y: moveAnchor.y },
      { x: moveAnchor.x + 1, y: moveAnchor.y },
    ].filter(
      (c) =>
        c.x >= 0 &&
        c.y >= 0 &&
        c.x < map.width &&
        c.y < map.height &&
        !grid.isBlocked(c.x, c.y),
    );
    if (neighbors.length > 0) {
      neighbors.sort((a, b) => {
        const da = Math.abs(a.x - requestedX) + Math.abs(a.y - requestedY);
        const db = Math.abs(b.x - requestedX) + Math.abs(b.y - requestedY);
        return da - db;
      });
      return neighbors[0]!;
    }
  }

  const snapped = findNearestGlobalWalkable(requestedX, requestedY, grid);
  if (grid.isBlocked(snapped.x, snapped.y)) {
    throw new ExecutorError("cell blocked");
  }
  return snapped;
}

function resolveActingNpc(room: RoomState, actingNpcId: string) {
  const npc = findNpc(room, actingNpcId);
  if (!npc) {
    throw new ExecutorError(`unknown npc ${actingNpcId}`);
  }
  return npc;
}

export function applyGameAction(
  room: RoomState,
  action: GameAction,
  actingNpcId: string,
  options?: ApplyGameActionOptions,
): { room: RoomState; events: string[] } {
  const next: RoomState = structuredClone(room);
  const acting = resolveActingNpc(next, actingNpcId);
  const events: string[] = [];

  switch (action.type) {
    case "move": {
      if (
        action.x < 0 ||
        action.y < 0 ||
        action.x >= next.width ||
        action.y >= next.height
      ) {
        throw new ExecutorError("move out of bounds");
      }
      const otherPlayers =
        options?.otherPlayerCells ?? [{ x: next.player.x, y: next.player.y }];
      const gridOpts = { excludeNpcId: acting.id };
      const dest = snapNpcMoveDest(
        next,
        action.x,
        action.y,
        otherPlayers,
        gridOpts,
        options?.moveSnapAnchor,
        options?.moveAnchorCell,
      );
      acting.x = dest.x;
      acting.y = dest.y;
      events.push(`${acting.id} moved to (${dest.x}, ${dest.y})`);
      break;
    }
    case "interact": {
      const obj = next.objects.find((o) => o.id === action.objectId);
      if (!obj) {
        throw new ExecutorError(`unknown object ${action.objectId}`);
      }
      if (obj.kind === "door") {
        obj.state = obj.state === "open" ? "closed" : "open";
        events.push(`door ${obj.id} is now ${obj.state}`);
      } else if (obj.kind === "pickup" && !acting.inventory.includes(obj.id)) {
        acting.inventory.push(obj.id);
        events.push(`${acting.id} picked up ${obj.id}`);
      } else {
        events.push(`${acting.id} interacted with ${obj.id}`);
      }
      break;
    }
    case "speak": {
      events.push(`${acting.id} spoke to ${action.targetId}: ${action.content.slice(0, 80)}`);
      break;
    }
    case "wait": {
      events.push(`${acting.id} waited ${action.durationMs}ms`);
      break;
    }
    case "transfer": {
      if (action.toNpcId === actingNpcId) {
        throw new ExecutorError("cannot transfer item to self");
      }
      const target = findNpc(next, action.toNpcId);
      if (!target) {
        throw new ExecutorError(`unknown target npc ${action.toNpcId}`);
      }
      const itemIndex = acting.inventory.indexOf(action.itemId);
      if (itemIndex === -1) {
        throw new ExecutorError(`item ${action.itemId} not in ${acting.id} inventory`);
      }
      acting.inventory.splice(itemIndex, 1);
      target.inventory.push(action.itemId);
      events.push(`${acting.id} transferred ${action.itemId} to ${target.id}`);
      break;
    }
    default: {
      const _exhaustive: never = action;
      throw new ExecutorError(`unsupported action ${(_exhaustive as GameAction).type}`);
    }
  }

  return { room: next, events };
}
