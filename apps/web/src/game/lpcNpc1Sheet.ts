import type { CardinalFacing } from "./facing.js";
import { facingToIndex } from "./facing.js";
import { CHAR_DISPLAY_PX, labelOffset } from "./entityLayout.js";
import { GRID_STEP_MS } from "./gridMovement.js";

/** Universal LPC composite: walk @8–11, idle @22–25; rows ordered up/left/down/right. */
export const LPC_NPC1_WALK_BASE_ROW = 8;
export const LPC_NPC1_IDLE_BASE_ROW = 22;

/** Source row offset within an LPC animation block. */
export const LPC_SOURCE_ROW_BY_FACING: Record<CardinalFacing, number> = {
  up: 0,
  left: 1,
  down: 2,
  right: 3,
};

export const LPC_NPC1_FRAME = 64;
export const LPC_NPC1_WALK_FRAMES = 9;
export const LPC_NPC1_IDLE_FRAMES = 2;
export const LPC_NPC1_FRAMES_PER_FACING = LPC_NPC1_WALK_FRAMES + LPC_NPC1_IDLE_FRAMES;

/** Three overlapped grid steps complete one 9-frame LPC walk cycle. */
export const LPC_NPC1_STEPS_PER_CYCLE = 3;

export const LPC_NPC1_WALK_FRAMES_PER_STEP = LPC_NPC1_WALK_FRAMES / LPC_NPC1_STEPS_PER_CYCLE;

/** Frame ranges per step segment: [0–2], [3–5], [6–8]. */
export function lpcNpc1WalkStepRange(phase: number): { start: number; end: number } {
  const step = phase % LPC_NPC1_STEPS_PER_CYCLE;
  const start = step * LPC_NPC1_WALK_FRAMES_PER_STEP;
  return { start, end: start + LPC_NPC1_WALK_FRAMES_PER_STEP - 1 };
}

/** Animate each 3-frame segment across one full grid tween (not a frozen pose). */
export function lpcNpc1WalkStepFrameRate(): number {
  return (LPC_NPC1_WALK_FRAMES_PER_STEP * 1000) / GRID_STEP_MS;
}

export function lpcNpc1WalkCycleMs(): number {
  return LPC_NPC1_STEPS_PER_CYCLE * GRID_STEP_MS;
}

export function lpcNpc1WalkStepAnimKey(facing: CardinalFacing, phase: number): string {
  return `lpc1-walk-${facing}-s${phase % LPC_NPC1_STEPS_PER_CYCLE}`;
}

export const LPC_NPC1_IDLE_FRAME_RATE = 4;

/** On-screen height = 2× CELL_PX (64×64 source @ scale 1 → 64px). */
export const LPC_NPC1_SCALE = CHAR_DISPLAY_PX / LPC_NPC1_FRAME;

export type LpcNpc1SpriteProfile = "lpc-npc-1";

export function spriteProfileForPlayer(): LpcNpc1SpriteProfile {
  return "lpc-npc-1";
}

export function spriteProfileForNpc(npcId: string): LpcNpc1SpriteProfile | "stardew" {
  return npcId === "npc-1" ? "lpc-npc-1" : "stardew";
}

export function lpcNpc1FrameIndex(
  facing: CardinalFacing,
  kind: "walk" | "idle",
  frameInAnim: number,
): number {
  const facingIndex = facingToIndex(facing);
  const offset = kind === "walk" ? frameInAnim : LPC_NPC1_WALK_FRAMES + frameInAnim;
  return facingIndex * LPC_NPC1_FRAMES_PER_FACING + offset;
}

export function lpcNpc1AnimKey(kind: "walk" | "idle", facing: CardinalFacing): string {
  return `lpc1-${kind}-${facing}`;
}

/** Nameplate baseline for LPC 64×64 sprites (origin 0.5, 1). */
export function lpcNpc1NameplateY(footY: number): number {
  const topY = footY - LPC_NPC1_FRAME * LPC_NPC1_SCALE;
  return topY + labelOffset(5);
}
