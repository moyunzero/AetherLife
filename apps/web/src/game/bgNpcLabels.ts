import type * as Phaser from "phaser";
import { ENTITY_LABEL_FONT } from "./entityLabels.js";

/** Wave 5 background tier — separate from frozen main NPC nameplate (entityLabels.ts). */
export const BG_NAMEPLATE_FONT_SIZE = "11px";
export const BG_NAMEPLATE_COLOR = "#c8c0a8";
export const BG_NAMEPLATE_STROKE_COLOR = "#000000";
export const BG_NAMEPLATE_STROKE_WIDTH = 4;

export const BG_ACTIVITY_FONT_SIZE = "9px";
export const BG_ACTIVITY_COLOR = "#9aa890";
export const BG_ACTIVITY_STROKE_COLOR = "#000000";
export const BG_ACTIVITY_STROKE_WIDTH = 2;

export const BG_NPC_TINT = 0xcccccc;
export const BG_NPC_NAMEPLATE_TESTID = "bg-npc-nameplate";

/**
 * Apply the Wave 5 background NPC nameplate visual style to a Phaser Text label.
 *
 * Sets font size and weight, fill and stroke colors, shadow, clears background and padding,
 * and stores the nameplate test id on the label's data.
 *
 * @param label - The Phaser Text object to be styled and mutated
 */
export function applyBgNameplateStyle(label: Phaser.GameObjects.Text): void {
  label.setFontSize(BG_NAMEPLATE_FONT_SIZE);
  label.setFontStyle("600");
  label.setColor(BG_NAMEPLATE_COLOR);
  label.setStroke(BG_NAMEPLATE_STROKE_COLOR, BG_NAMEPLATE_STROKE_WIDTH);
  label.setShadow(0, 0, "#000000", 0, false, false);
  label.setBackgroundColor("");
  label.setPadding(0, 0, 0, 0);
  label.setData("testid", BG_NPC_NAMEPLATE_TESTID);
}

/**
 * Apply background activity styling to a Phaser GameObjects.Text label.
 *
 * @param label - The text object to style with background activity font, fill, and stroke
 */
export function applyBgActivityStyle(label: Phaser.GameObjects.Text): void {
  label.setFontSize(BG_ACTIVITY_FONT_SIZE);
  label.setFontStyle("500");
  label.setColor(BG_ACTIVITY_COLOR);
  label.setStroke(BG_ACTIVITY_STROKE_COLOR, BG_ACTIVITY_STROKE_WIDTH);
}
