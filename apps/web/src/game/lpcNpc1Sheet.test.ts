import { describe, expect, it } from "vitest";
import { CHAR_DISPLAY_PX } from "./entityLayout.js";
import {
  LPC_NPC1_FRAMES_PER_FACING,
  LPC_NPC1_IDLE_BASE_ROW,
  LPC_NPC1_WALK_FRAMES,
  LPC_NPC1_WALK_LOOP_FRAMES,
  LPC_NPC1_WALK_LOOP_START,
  LPC_PLAYER1_WALK_LOOP_FRAMES,
  LPC_PLAYER1_WALK_LOOP_START,
  LPC_NPC1_WALK_MS_PER_FRAME,
  LPC_NPC1_FRAME,
  LPC_NPC1_SCALE,
  LPC_SOURCE_ROW_BY_FACING,
  lpcNpcAnimKey,
  lpcNpc1FrameIndex,
  lpcNpc1WalkCycleMs,
  lpcNpc1WalkFrameRate,
  lpcNpc1WalkLoopFrameRange,
  spriteProfileForNpc,
  spriteProfileForPlayer,
} from "./lpcNpc1Sheet.js";

describe("lpcNpc1Sheet", () => {
  it("routes player to lpc-player-1 and npc-1..12 to lpc npc profiles", () => {
    expect(spriteProfileForPlayer()).toBe("lpc-player-1");
    expect(spriteProfileForNpc("npc-1")).toBe("lpc-npc-1");
    expect(spriteProfileForNpc("npc-2")).toBe("lpc-npc-2");
    expect(spriteProfileForNpc("npc-3")).toBe("lpc-npc-3");
    expect(spriteProfileForNpc("npc-4")).toBe("lpc-npc-4");
    expect(spriteProfileForNpc("npc-12")).toBe("lpc-npc-12");
    expect(spriteProfileForNpc("npc-99")).toBe("stardew");
  });

  it("packs walk then idle per facing row", () => {
    expect(LPC_NPC1_FRAMES_PER_FACING).toBe(LPC_NPC1_WALK_FRAMES + 2);
    expect(lpcNpc1FrameIndex("down", "walk", 0)).toBe(0);
    expect(lpcNpc1FrameIndex("left", "walk", 0)).toBe(11);
  });

  it("loops NPC walk indices 1–8 (skip idle-like frame 0)", () => {
    expect(LPC_NPC1_WALK_LOOP_START).toBe(1);
    expect(LPC_NPC1_WALK_LOOP_FRAMES).toBe(8);
    expect(lpcNpc1WalkLoopFrameRange("down", "lpc-npc-1")).toEqual({ start: 1, end: 8 });
    expect(lpcNpc1WalkLoopFrameRange("left", "lpc-npc-2")).toEqual({ start: 12, end: 19 });
  });

  it("loops player walk indices 0–8 (full 9-column gait)", () => {
    expect(LPC_PLAYER1_WALK_LOOP_START).toBe(0);
    expect(LPC_PLAYER1_WALK_LOOP_FRAMES).toBe(9);
    expect(lpcNpc1WalkLoopFrameRange("down", "lpc-player-1")).toEqual({ start: 0, end: 8 });
    expect(lpcNpc1WalkLoopFrameRange("up", "lpc-player-1")).toEqual({ start: 33, end: 41 });
  });

  it("uses ULPC walk timing (75 ms/frame)", () => {
    expect(LPC_NPC1_WALK_MS_PER_FRAME).toBe(75);
    expect(lpcNpc1WalkFrameRate()).toBeCloseTo(1000 / 75, 5);
    expect(lpcNpc1WalkCycleMs("lpc-npc-1")).toBe(8 * 75);
    expect(lpcNpc1WalkCycleMs("lpc-player-1")).toBe(9 * 75);
  });

  it("matches CHAR_DISPLAY_PX on-screen height", () => {
    expect(LPC_NPC1_SCALE * LPC_NPC1_FRAME).toBe(CHAR_DISPLAY_PX);
  });

  it("maps LPC source rows up/left/down/right", () => {
    expect(LPC_SOURCE_ROW_BY_FACING.down).toBe(2);
    expect(LPC_NPC1_IDLE_BASE_ROW).toBe(22);
  });

  it("NPC step duration covers one LPC walk loop (not player WASD 200ms)", async () => {
    const { NPC_GRID_STEP_MS, GRID_STEP_MS } = await import("./gridMovement.js");
    const { lpcNpc1WalkCycleMs } = await import("./lpcNpc1Sheet.js");
    expect(NPC_GRID_STEP_MS).toBe(lpcNpc1WalkCycleMs("lpc-npc-1"));
    expect(NPC_GRID_STEP_MS).toBeGreaterThan(GRID_STEP_MS);
  });
});
