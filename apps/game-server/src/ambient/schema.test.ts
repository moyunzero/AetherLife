import { describe, expect, it } from "vitest";
import { createDefaultRoom } from "@aetherlife/shared";
import { syncColyseusFromMap } from "../colyseus/bridge.js";
import { GameRoomState } from "../colyseus/schema.js";

describe("GameRoomState ambient schema defaults", () => {
  it("defaults gameMinute to 360 and activity keys to idle", () => {
    const state = new GameRoomState();
    expect(state.gameMinute).toBe(360);
    expect(state.npc1ActivityKey).toBe("idle");
    expect(state.npc2ActivityKey).toBe("idle");
    expect(state.npc3ActivityKey).toBe("idle");
  });
});

describe("syncColyseusFromMap activity slots", () => {
  it("writes npc1ActivityKey from map.npcs activityKey", () => {
    const map = createDefaultRoom("default");
    map.npcs[0]!.activityKey = "reading";

    const colyseus = new GameRoomState();
    syncColyseusFromMap(colyseus, map);

    expect(colyseus.npc1ActivityKey).toBe("reading");
    expect(colyseus.npc2ActivityKey).toBe("idle");
    expect(colyseus.npc3ActivityKey).toBe("idle");
  });

  it("defaults missing activityKey to idle", () => {
    const map = createDefaultRoom("default");
    delete map.npcs[1]!.activityKey;

    const colyseus = new GameRoomState();
    syncColyseusFromMap(colyseus, map);

    expect(colyseus.npc2ActivityKey).toBe("idle");
  });
});
