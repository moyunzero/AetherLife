import type { CardinalFacing } from "./facing.js";
import { facingToIndex } from "./facing.js";
import { CHAR_DISPLAY_PX, labelOffset } from "./entityLayout.js";

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
/** Walk columns on baked atlas (index 0 ≈ idle stand — not looped). */
export const LPC_NPC1_WALK_FRAMES = 9;
/** Active 8-frame LPC walk loop for NPCs: sheet indices 1–8 (index 0 ≈ idle stand). */
export const LPC_NPC1_WALK_LOOP_START = 1;
export const LPC_NPC1_WALK_LOOP_FRAMES = 8;
/** Player sheet: all 9 walk columns are gait frames (col 0 ≠ idle). */
export const LPC_PLAYER1_WALK_LOOP_START = 0;
export const LPC_PLAYER1_WALK_LOOP_FRAMES = 9;
export const LPC_NPC1_IDLE_FRAMES = 2;
export const LPC_NPC1_FRAMES_PER_FACING = LPC_NPC1_WALK_FRAMES + LPC_NPC1_IDLE_FRAMES;

/** ULPC / pflat generator walk timing (~13.3 fps). */
export const LPC_NPC1_WALK_MS_PER_FRAME = 75;

export function lpcNpc1WalkFrameRate(): number {
  return 1000 / LPC_NPC1_WALK_MS_PER_FRAME;
}

export function lpcWalkLoopSpec(profile: LpcNpcSpriteProfile): { start: number; frames: number } {
  if (profile === "lpc-player-1") {
    return { start: LPC_PLAYER1_WALK_LOOP_START, frames: LPC_PLAYER1_WALK_LOOP_FRAMES };
  }
  return { start: LPC_NPC1_WALK_LOOP_START, frames: LPC_NPC1_WALK_LOOP_FRAMES };
}

export function lpcNpc1WalkCycleMs(profile: LpcNpcSpriteProfile = "lpc-npc-1"): number {
  const { frames } = lpcWalkLoopSpec(profile);
  return frames * LPC_NPC1_WALK_MS_PER_FRAME;
}

export function lpcNpc1WalkLoopFrameRange(
  facing: CardinalFacing,
  profile: LpcNpcSpriteProfile = "lpc-npc-1",
): { start: number; end: number } {
  const { start, frames } = lpcWalkLoopSpec(profile);
  const sheetStart = lpcNpc1FrameIndex(facing, "walk", start);
  const sheetEnd = lpcNpc1FrameIndex(facing, "walk", start + frames - 1);
  return { start: sheetStart, end: sheetEnd };
}

export const LPC_NPC1_IDLE_FRAME_RATE = 4;

/** On-screen height = 2× CELL_PX (64×64 source @ scale 1 → 64px). */
export const LPC_NPC1_SCALE = CHAR_DISPLAY_PX / LPC_NPC1_FRAME;

/** Council + speakable NPCs with dedicated baked LPC sheets (npc-1…12). */
export const LPC_COUNCIL_NPC_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export type LpcCouncilNpcNum = (typeof LPC_COUNCIL_NPC_IDS)[number];
export type LpcNpcSpriteProfile =
  | "lpc-player-1"
  | `lpc-npc-${LpcCouncilNpcNum}`;

/** @deprecated Use LpcNpcSpriteProfile */
export type LpcNpc1SpriteProfile = LpcNpcSpriteProfile;

export const LPC_NPC_PROFILES: LpcNpcSpriteProfile[] = [
  "lpc-player-1",
  ...LPC_COUNCIL_NPC_IDS.map((n) => `lpc-npc-${n}` as const),
];

const NPC_ID_TO_LPC_PROFILE: Record<string, LpcNpcSpriteProfile> = Object.fromEntries(
  LPC_COUNCIL_NPC_IDS.map((n) => [`npc-${n}`, `lpc-npc-${n}` as const]),
);

export function isLpcProfile(profile: string): profile is LpcNpcSpriteProfile {
  return (LPC_NPC_PROFILES as string[]).includes(profile);
}

export function lpcAnimTag(profile: LpcNpcSpriteProfile): string {
  if (profile === "lpc-player-1") return "lpcp1";
  return profile.replace("lpc-npc-", "lpc");
}

export function spriteProfileForPlayer(): LpcNpcSpriteProfile {
  return "lpc-player-1";
}

export function spriteProfileForNpc(npcId: string): LpcNpcSpriteProfile | "stardew" {
  return NPC_ID_TO_LPC_PROFILE[npcId] ?? "stardew";
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

export function lpcNpcAnimKey(
  profile: LpcNpcSpriteProfile,
  kind: "walk" | "idle",
  facing: CardinalFacing,
): string {
  return `${lpcAnimTag(profile)}-${kind}-${facing}`;
}

/** @deprecated Use lpcNpcAnimKey("lpc-npc-1", …) */
export function lpcNpc1AnimKey(kind: "walk" | "idle", facing: CardinalFacing): string {
  return lpcNpcAnimKey("lpc-npc-1", kind, facing);
}

/** Nameplate baseline for LPC 64×64 sprites (origin 0.5, 1). */
export function lpcNpc1NameplateY(footY: number): number {
  const topY = footY - LPC_NPC1_FRAME * LPC_NPC1_SCALE;
  return topY + labelOffset(5);
}
