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

/**
 * Determines whether a terrain cell at the given global grid coordinates is walkable.
 *
 * Treats an unknown/undefined terrain value as walkable.
 *
 * @param gx - Global grid X coordinate
 * @param gy - Global grid Y coordinate
 * @returns `true` if the cell is walkable, `false` otherwise
 */
function executorTerrainWalkable(gx: number, gy: number): boolean {
  const terrain = isTerrainWalkableInRegion(gx, gy);
  if (terrain === undefined) return true;
  return terrain;
}

/**
 * Create a GlobalMoveGrid configured for executor pathfinding and collision checks.
 *
 * @param map - The room state used as the grid's home map
 * @param otherPlayers - Cells occupied by other players to treat as moving obstacles
 * @param options.excludeNpcId - NPC id to exclude from blocking (so that the acting NPC is not treated as an obstacle)
 * @returns A GlobalMoveGrid configured with executor terrain-walkability and the provided player cells
 */
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

/**
 * Get the four orthogonal neighbor cells of (cx, cy) that lie inside the map and are not blocked.
 *
 * @param map - The room state used for map width/height bounds
 * @param cx - X coordinate of the central cell
 * @param cy - Y coordinate of the central cell
 * @param grid - Movement grid used to determine if a cell is blocked
 * @returns The subset of up/down/left/right neighbor cells that are within map bounds and where `grid.isBlocked` is false
 */
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

/**
 * Selects the candidate cell nearest to the target coordinates using Manhattan distance.
 *
 * @param cells - Candidate grid cells to consider
 * @param targetX - Target x coordinate
 * @param targetY - Target y coordinate
 * @returns The cell from `cells` with the smallest Manhattan distance to `(targetX, targetY)`
 */
function pickClosestCell(cells: GridCell[], targetX: number, targetY: number): GridCell {
  cells.sort((a, b) => {
    const da = Math.abs(a.x - targetX) + Math.abs(a.y - targetY);
    const db = Math.abs(b.x - targetX) + Math.abs(b.y - targetY);
    return da - db;
  });
  return cells[0]!;
}

/**
 * Selects a walkable destination cell for an NPC near a requested coordinate, applying optional snapping anchors.
 *
 * Attempts to use the requested cell if it is not blocked. If blocked, tries in order:
 * 1. The walkable orthogonal neighbors around `moveSnapAnchor` (if provided).
 * 2. The walkable orthogonal neighbors around `moveAnchor` (if provided).
 * 3. The nearest global walkable cell according to the executor movement grid.
 *
 * @param map - The room state used to build the movement grid and validate bounds.
 * @param requestedX - The originally requested destination x coordinate.
 * @param requestedY - The originally requested destination y coordinate.
 * @param otherPlayers - Additional live player cells to consider as obstacles when building the grid.
 * @param gridOpts - Options passed to the executor grid builder (e.g., `excludeNpcId` to ignore the acting NPC).
 * @param moveSnapAnchor - Optional anchor cell whose walkable neighbors are preferred when snapping from a blocked destination.
 * @param moveAnchor - Optional fallback anchor cell whose orthogonal walkable neighbors are considered if `moveSnapAnchor` yields none.
 * @returns The chosen walkable destination cell `{ x, y }`.
 * @throws ExecutorError - Throws `ExecutorError("cell blocked")` if the globally nearest walkable cell is still blocked.
 */
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

/**
 * Applies a single game action for the specified acting NPC and returns the updated room state with recorded events.
 *
 * Processes actions: "move" (validates bounds, snaps destination, updates NPC position), "interact" (toggles doors, picks up items, or records interaction), "speak" (records truncated content), "wait" (records duration), and "transfer" (moves an item between NPC inventories). The function clones the provided room state before modifying it and accumulates human-readable event messages describing state changes.
 *
 * @param room - Current room state to apply the action to (will not be mutated; a cloned state is returned)
 * @param action - Action to apply
 * @param actingNpcId - ID of the NPC performing the action
 * @param options - Optional execution options (e.g., movement snapping anchors and other player cells)
 * @returns An object containing the updated room state and an array of event messages describing what occurred
 * @throws ExecutorError - When the action is invalid or cannot be completed, for example:
 *   - "unknown npc <id>" if the acting NPC cannot be found
 *   - "move out of bounds" when a requested move is outside the map
 *   - "cell blocked" when a moved-to cell cannot be resolved to a walkable position
 *   - "unknown object <id>" when an interact target does not exist
 *   - "cannot transfer item to self" when attempting to transfer to the same NPC
 *   - "unknown target npc <id>" when a transfer recipient is missing
 *   - "item <itemId> not in <npcId> inventory" when transferring a non-owned item
 *   - "unsupported action <type>" for unrecognized action types
 */
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
