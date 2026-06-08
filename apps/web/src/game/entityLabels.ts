import type * as Phaser from "phaser";

/** In-scene entity labels — aligned with 07-UI-SPEC (Source Serif 4, 11px, --text). */
export const ENTITY_LABEL_FONT = '"Source Serif 4", "Noto Serif SC", serif';
export const ENTITY_LABEL_COLOR = "#e8e2d6";
export const ENTITY_LABEL_FONT_SIZE = "11px";
export const THINKING_PULSE_MS = 1200;

/**
 * Proximity nameplates — high contrast on Kenney pastoral tiles (13-UAT #6).
 * **Frozen contract:** do not weaken stroke/shadow/size without verify:phase13 + UAT test 6/7.
 */
export const NAMEPLATE_FONT_SIZE = "13px";
export const NAMEPLATE_PLAYER_COLOR = "#ffffff";
export const NAMEPLATE_NPC_COLOR = "#fff4a8";
export const NAMEPLATE_STROKE_COLOR = "#000000";
export const NAMEPLATE_STROKE_WIDTH = 5;

export function applyNameplateStyle(
  label: Phaser.GameObjects.Text,
  kind: "player" | "npc",
): void {
  label.setFontSize(NAMEPLATE_FONT_SIZE);
  label.setFontStyle("700");
  label.setColor(kind === "npc" ? NAMEPLATE_NPC_COLOR : NAMEPLATE_PLAYER_COLOR);
  label.setStroke(NAMEPLATE_STROKE_COLOR, NAMEPLATE_STROKE_WIDTH);
  // shadowFill=true draws a solid dark rectangle behind glyphs — text-only nameplates use stroke only
  label.setShadow(0, 0, "#000000", 0, false, false);
  label.setBackgroundColor("");
  label.setPadding(0, 0, 0, 0);
}

export function npcDisplayName(name: string): string {
  const trimmed = name.trim();
  return trimmed || "NPC";
}
