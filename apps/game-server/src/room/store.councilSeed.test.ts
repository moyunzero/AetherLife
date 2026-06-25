import { beforeEach, describe, expect, it, vi } from "vitest";

describe("getOrCreate council seed hook", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("fires async seed only on first create, not on touch", async () => {
    const seedSpy = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../memory/councilSeed.js", () => ({
      seedCouncilMemoriesIfNeeded: seedSpy,
    }));

    const { clearAllRooms, getOrCreate } = await import("./store.js");
    clearAllRooms();
    getOrCreate("room-hook");
    getOrCreate("room-hook");

    expect(seedSpy).toHaveBeenCalledTimes(1);
    expect(seedSpy).toHaveBeenCalledWith("room-hook");
  });
});
