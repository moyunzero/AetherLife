import { createDefaultRoom } from "@aetherlife/shared";
import { describe, expect, it } from "vitest";
import { mergeHomeChunkBase } from "./home-merge.js";
import { generateChunkBase } from "./noise.js";

describe("mergeHomeChunkBase", () => {
  it("forces home biome on chunk (0,0)", () => {
    const room = createDefaultRoom();
    const base = generateChunkBase(0, 0, 99);
    const merged = mergeHomeChunkBase(base, room);
    expect(merged.tiles.every((t) => t.biome === "home" && t.walkable)).toBe(true);
  });

  it("leaves non-home chunks unchanged", () => {
    const room = createDefaultRoom();
    const base = generateChunkBase(1, 0, 42);
    const merged = mergeHomeChunkBase(base, room);
    expect(merged).toEqual(base);
  });

  it("default room has door cell for executor blocking", () => {
    const room = createDefaultRoom();
    const door = room.objects.find((o) => o.kind === "door");
    expect(door).toBeDefined();
    expect(door!.x).toBe(3);
    expect(door!.y).toBe(3);
  });
});
