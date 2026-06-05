import { createDefaultRoom } from "@aetherlife/shared";
import { describe, expect, it } from "vitest";
import {
  applyPlayerMove,
  applyPlayerMoveTo,
  buildMoveGrid,
  findGridPath,
} from "./move-handler.js";
import { GameRoomState, PlayerSchema } from "./schema.js";

function roomWithPlayer(x: number, y: number, sessionId = "s1") {
  const state = new GameRoomState();
  const player = new PlayerSchema();
  player.sessionId = sessionId;
  player.x = x;
  player.y = y;
  state.players.set(sessionId, player);
  return state;
}

describe("applyPlayerMove", () => {
  it("moves one grid step", () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(4, 4);
    const grid = buildMoveGrid(map, state, "s1");

    const result = applyPlayerMove(state, "s1", 1, 0, grid);
    expect(result).toEqual({ ok: true, x: 5, y: 4, facing: "e" });
  });

  it("rejects non-unit steps", () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(4, 4);
    const grid = buildMoveGrid(map, state, "s1");

    expect(applyPlayerMove(state, "s1", 2, 0, grid).ok).toBe(false);
  });

  it("rejects step into npc cell", () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(3, 2);
    const grid = buildMoveGrid(map, state, "s1");

    expect(applyPlayerMove(state, "s1", -1, 0, grid).ok).toBe(false);
  });

  it("rejects out of bounds", () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(0, 0);
    const grid = buildMoveGrid(map, state, "s1");

    expect(applyPlayerMove(state, "s1", -1, 0, grid).ok).toBe(false);
  });
});

describe("applyPlayerMoveTo", () => {
  it("walks full path to distant target in one update", () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(4, 4);
    const grid = buildMoveGrid(map, state, "s1");

    const result = applyPlayerMoveTo(state, "s1", 6, 4, grid);
    expect(result).toEqual({ ok: true, x: 6, y: 4, facing: "e" });
  });

  it("paths around closed door", () => {
    const map = createDefaultRoom();
    map.objects[0]!.state = "closed";
    const state = roomWithPlayer(4, 4);
    const grid = buildMoveGrid(map, state, "s1");

    const path = findGridPath(4, 4, 4, 0, grid);
    expect(path).not.toBeNull();
    expect(path!.some((c) => c.x === 3 && c.y === 3)).toBe(false);

    const result = applyPlayerMoveTo(state, "s1", 4, 0, grid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.y).toBe(0);
    }
  });

  it("fails when target is on npc", () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(4, 4);
    const grid = buildMoveGrid(map, state, "s1");

    expect(applyPlayerMoveTo(state, "s1", 2, 2, grid).ok).toBe(false);
  });

  it("fails when target is door (open or closed)", () => {
    const map = createDefaultRoom();
    map.objects[0]!.state = "closed";
    const state = roomWithPlayer(4, 4);
    const grid = buildMoveGrid(map, state, "s1");

    expect(applyPlayerMoveTo(state, "s1", 3, 3, grid).ok).toBe(false);

    map.objects[0]!.state = "open";
    const gridOpen = buildMoveGrid(map, state, "s1");
    expect(applyPlayerMoveTo(state, "s1", 3, 3, gridOpen).ok).toBe(false);
  });
});
