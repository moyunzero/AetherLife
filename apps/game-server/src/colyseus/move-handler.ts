import {
  buildGlobalMoveGrid,
  canStepGlobal,
  findGlobalGridPath,
  findNearestGlobalWalkable,
  type GlobalMoveGrid,
  type RoomState,
} from "@aetherlife/shared";
import type { ChunkLoader } from "../world/chunk-loader.js";
import type { GameRoomState } from "./schema.js";

export type MoveResult =
  | { ok: true; x: number; y: number; facing: Facing }
  | { ok: false; reason: string; facing: Facing; facingUpdated: boolean };

export type { GlobalMoveGrid as MoveGrid } from "@aetherlife/shared";

function facingFromDelta(dx: number, dy: number): Facing {
  if (dy < 0) return "n";
  if (dy > 0) return "s";
  if (dx < 0) return "w";
  return "e";
}

function moveFail(
  player: { facing: string } | undefined,
  reason: string,
): Extract<MoveResult, { ok: false }> {
  return {
    ok: false,
    reason,
    facing: (player?.facing ?? "s") as Facing,
    facingUpdated: false,
  };
}

export function buildMoveGrid(
  map: RoomState,
  state: GameRoomState,
  sessionId: string,
  loader: ChunkLoader,
  options?: { excludeNpcId?: string },
): GlobalMoveGrid {
  const otherPlayers: { x: number; y: number }[] = [];
  state.players.forEach((p, sid) => {
    if (sid !== sessionId) {
      otherPlayers.push({ x: p.x, y: p.y });
    }
  });
  return buildGlobalMoveGrid({
    homeMap: map,
    otherPlayerCells: otherPlayers,
    isTerrainWalkable: (gx, gy) => loader.getWalkability(gx, gy) === true,
    excludeNpcId: options?.excludeNpcId,
  });
}

export { findGlobalGridPath as findGridPath, findNearestGlobalWalkable as findNearestWalkableCell };

export function applyPlayerMove(
  state: GameRoomState,
  sessionId: string,
  dx: number,
  dy: number,
  grid: GlobalMoveGrid,
): MoveResult {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
    return moveFail(state.players.get(sessionId), "dx and dy must be integers");
  }
  if (Math.abs(dx) + Math.abs(dy) !== 1) {
    return moveFail(state.players.get(sessionId), "move must be a single grid step");
  }

  const player = state.players.get(sessionId);
  if (!player) {
    return moveFail(undefined, "unknown player");
  }

  const nx = player.x + dx;
  const ny = player.y + dy;
  if (!canStepGlobal(nx, ny, grid)) {
    const nextFacing = facingFromDelta(dx, dy);
    const facingUpdated = player.facing !== nextFacing;
    player.facing = nextFacing;
    return {
      ok: false,
      reason: "cell blocked",
      facing: player.facing as Facing,
      facingUpdated,
    };
  }

  player.x = nx;
  player.y = ny;
  player.facing = facingFromDelta(dx, dy);
  return { ok: true, x: nx, y: ny, facing: player.facing as Facing };
}

/** Click-to-move: walk full path to target in one authoritative update. */
export function applyPlayerMoveTo(
  state: GameRoomState,
  sessionId: string,
  targetX: number,
  targetY: number,
  grid: GlobalMoveGrid,
): MoveResult {
  if (!Number.isInteger(targetX) || !Number.isInteger(targetY)) {
    return moveFail(state.players.get(sessionId), "target must be integers");
  }

  const player = state.players.get(sessionId);
  if (!player) {
    return moveFail(undefined, "unknown player");
  }

  const path = findGlobalGridPath(player.x, player.y, targetX, targetY, grid);
  if (!path) {
    return moveFail(player, "no path to target");
  }

  const last = path[path.length - 1]!;
  player.x = last.x;
  player.y = last.y;
  if (path.length >= 2) {
    const prev = path[path.length - 2]!;
    player.facing = facingFromDelta(last.x - prev.x, last.y - prev.y);
  }
  return { ok: true, x: last.x, y: last.y, facing: player.facing as Facing };
}
