import { describe, expect, it } from "vitest";
import { CHAR_DISPLAY_PX } from "./entityLayout.js";
import { GRID_STEP_MS } from "./gridMovement.js";
import {
  LPC_NPC1_FRAMES_PER_FACING,
  LPC_NPC1_IDLE_BASE_ROW,
  LPC_NPC1_STEPS_PER_CYCLE,
  LPC_NPC1_WALK_FRAMES,
  LPC_NPC1_WALK_FRAMES_PER_STEP,
  LPC_NPC1_FRAME,
  LPC_NPC1_SCALE,
  LPC_SOURCE_ROW_BY_FACING,
  lpcNpc1AnimKey,
  lpcNpc1FrameIndex,
  lpcNpc1WalkCycleMs,
  lpcNpc1WalkStepAnimKey,
  lpcNpc1WalkStepFrameRate,
  lpcNpc1WalkStepRange,
  spriteProfileForNpc,
  spriteProfileForPlayer,
} from "./lpcNpc1Sheet.js";

describe("lpcNpc1Sheet", () => {
  it("routes all players and npc-1 to lpc profile", () => {
    expect(spriteProfileForPlayer()).toBe("lpc-npc-1");
    expect(spriteProfileForNpc("npc-1")).toBe("lpc-npc-1");
    expect(spriteProfileForNpc("npc-2")).toBe("stardew");
  });

  it("packs walk then idle per facing row", () => {
    expect(LPC_NPC1_FRAMES_PER_FACING).toBe(LPC_NPC1_WALK_FRAMES + 2);
    expect(lpcNpc1FrameIndex("down", "walk", 0)).toBe(0);
    expect(lpcNpc1FrameIndex("left", "walk", 0)).toBe(11);
  });

  it("uses three animated frames per grid step", () => {
    expect(LPC_NPC1_STEPS_PER_CYCLE).toBe(3);
    expect(LPC_NPC1_WALK_FRAMES_PER_STEP).toBe(3);
    expect(lpcNpc1WalkStepRange(0)).toEqual({ start: 0, end: 2 });
    expect(lpcNpc1WalkStepRange(1)).toEqual({ start: 3, end: 5 });
    expect(lpcNpc1WalkStepRange(2)).toEqual({ start: 6, end: 8 });
  });

  it("syncs segment playback to grid step duration", () => {
    const rate = lpcNpc1WalkStepFrameRate();
    const segmentMs = (LPC_NPC1_WALK_FRAMES_PER_STEP / rate) * 1000;
    expect(segmentMs).toBeCloseTo(GRID_STEP_MS, 1);
    expect(lpcNpc1WalkCycleMs()).toBe(3 * GRID_STEP_MS);
  });

  it("matches CHAR_DISPLAY_PX on-screen height", () => {
    expect(LPC_NPC1_SCALE * LPC_NPC1_FRAME).toBe(CHAR_DISPLAY_PX);
  });

  it("maps LPC source rows up/left/down/right", () => {
    expect(LPC_SOURCE_ROW_BY_FACING.down).toBe(2);
    expect(LPC_NPC1_IDLE_BASE_ROW).toBe(22);
  });

  it("builds step walk and idle anim keys", () => {
    expect(lpcNpc1WalkStepAnimKey("down", 0)).toBe("lpc1-walk-down-s0");
    expect(lpcNpc1AnimKey("idle", "up")).toBe("lpc1-idle-up");
  });
});
