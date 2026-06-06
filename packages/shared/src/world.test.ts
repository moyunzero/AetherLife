import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, chunkOf, floorMod, globalCell, localInChunk } from "./world.js";

describe("world coordinates", () => {
  it("chunkOf handles negatives", () => {
    expect(chunkOf(-1, -1)).toEqual({ cx: -1, cy: -1 });
    expect(chunkOf(-8, 0)).toEqual({ cx: -1, cy: 0 });
    expect(chunkOf(7, 7)).toEqual({ cx: 0, cy: 0 });
    expect(chunkOf(8, 0)).toEqual({ cx: 1, cy: 0 });
  });

  it("localInChunk wraps correctly", () => {
    expect(localInChunk(7, 7)).toEqual({ lx: 7, ly: 7 });
    expect(localInChunk(8, 0)).toEqual({ lx: 0, ly: 0 });
    expect(localInChunk(-1, -1)).toEqual({ lx: CHUNK_SIZE - 1, ly: CHUNK_SIZE - 1 });
  });

  it("globalCell round-trips", () => {
    const { gx, gy } = globalCell(1, -1, 3, 4);
    expect(chunkOf(gx, gy)).toEqual({ cx: 1, cy: -1 });
    expect(localInChunk(gx, gy)).toEqual({ lx: 3, ly: 4 });
  });
});
