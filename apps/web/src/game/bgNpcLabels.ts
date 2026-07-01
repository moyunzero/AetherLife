import type * as Phaser from "phaser";
import { applySceneHanLabelBase, SCENE_LABEL_FONT } from "./entityLabels.js";
import { activityFontPx, nameplateFontPx } from "./entityLayout.js";

/** Wave 5 background tier — separate from main NPC nameplate (entityLabels.ts). */
export const BG_NAMEPLATE_FONT_SIZE_PX = Math.max(12, nameplateFontPx() - 1);
export const BG_NAMEPLATE_FONT_SIZE = `${BG_NAMEPLATE_FONT_SIZE_PX}px`;
export const BG_NAMEPLATE_COLOR = "#e8e0c8";

export const BG_ACTIVITY_FONT_SIZE_PX = activityFontPx();
export const BG_ACTIVITY_FONT_SIZE = `${BG_ACTIVITY_FONT_SIZE_PX}px`;
export const BG_ACTIVITY_COLOR = "#d0dcc4";

export const BG_NPC_TINT = 0xcccccc;
export const BG_NPC_NAMEPLATE_TESTID = "bg-npc-nameplate";

export function applyBgNameplateStyle(label: Phaser.GameObjects.Text): void {
  applySceneHanLabelBase(label);
  label.setFontSize(BG_NAMEPLATE_FONT_SIZE);
  label.setFontStyle("bold");
  label.setColor(BG_NAMEPLATE_COLOR);
  label.setData("testid", BG_NPC_NAMEPLATE_TESTID);
}

export function applyBgActivityStyle(label: Phaser.GameObjects.Text): void {
  applySceneHanLabelBase(label);
  label.setFontSize(BG_ACTIVITY_FONT_SIZE);
  label.setFontStyle("normal");
  label.setColor(BG_ACTIVITY_COLOR);
}
