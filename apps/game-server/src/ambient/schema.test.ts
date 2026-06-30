import { describe, expect, it } from "vitest";
import { createDefaultRoom } from "@aetherlife/shared";
import { syncColyseusFromMap } from "../colyseus/bridge.js";
import { GameRoomState } from "../colyseus/schema.js";

describe("GameRoomState ambient schema defaults", () => {
  it("defaults gameMinute to 360 and schemaVersion to 2", () => {
    const state = new GameRoomState();
    expect(state.gameMinute).toBe(360);
    expect(state.schemaVersion).toBe(2);
    expect(state.npcs.size).toBe(0);
  });
});

describe("syncColyseusFromMap activity slots", () => {
  it("writes npc-1 activityKey from map.npcs activityKey", () => {
    const map = createDefaultRoom("default");
    map.npcs.find((n) => n.id === "npc-1")!.activityKey = "reading";

    const colyseus = new GameRoomState();
    syncColyseusFromMap(colyseus, map);

    expect(colyseus.npcs.get("npc-1")!.activityKey).toBe("reading");
    expect(colyseus.npcs.get("npc-2")!.activityKey).toBe("idle");
    expect(colyseus.npcs.get("npc-3")!.activityKey).toBe("idle");
  });

  it("defaults missing activityKey to idle", () => {
    const map = createDefaultRoom("default");
    delete map.npcs.find((n) => n.id === "npc-2")!.activityKey;

    const colyseus = new GameRoomState();
    syncColyseusFromMap(colyseus, map);

    expect(colyseus.npcs.get("npc-2")!.activityKey).toBe("idle");
  });
});
