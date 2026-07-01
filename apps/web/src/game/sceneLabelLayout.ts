import { activityFontPx, intentFontPx, labelOffset, MARKER_LABEL_Y, nameplateFontPx } from "./entityLayout.js";
import { spriteNameplateY, type SpriteProfile } from "./entitySprites.js";

/** Tight stack: name baseline → activity baseline (both origin 0.5, 1). */
export const NAME_TO_ACTIVITY_GAP_PX = 2;
export const ACTIVITY_TO_INTENT_GAP_PX = 1;

export function nameLabelY(spriteMode: boolean | undefined, profile?: SpriteProfile): number {
  if (!spriteMode) return MARKER_LABEL_Y;
  return spriteNameplateY(profile ?? "stardew");
}

export function activityLabelY(spriteMode: boolean | undefined, profile?: SpriteProfile): number {
  if (!spriteMode) return MARKER_LABEL_Y + labelOffset(14);
  return nameLabelY(true, profile) + nameplateFontPx() + NAME_TO_ACTIVITY_GAP_PX;
}

export function intentLabelY(spriteMode: boolean | undefined, profile?: SpriteProfile): number {
  if (!spriteMode) return MARKER_LABEL_Y + labelOffset(27);
  return (
    activityLabelY(true, profile) + activityFontPx() + ACTIVITY_TO_INTENT_GAP_PX
  );
}
