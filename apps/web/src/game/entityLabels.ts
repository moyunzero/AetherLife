import type * as Phaser from "phaser";
import { labelPx, nameplateFontPx } from "./entityLayout.js";

/** In-scene entity labels — aligned with 07-UI-SPEC (Source Serif 4, scaled to CELL_PX). */
export const ENTITY_LABEL_FONT = '"Source Serif 4", "Noto Serif SC", serif';

/**
 * Scene nameplates — 宋体系（Web: Noto Serif SC；系统: 宋体/SimSun）。
 * Alternatives (swap `SCENE_LABEL_FONT`):
 * - 黑体: SCENE_LABEL_FONT_SANS
 * - 楷体: SCENE_LABEL_FONT_KAI
 */
export const SCENE_LABEL_FONT =
  '"Noto Serif SC", "Songti SC", "SimSun", "STSong", serif';

export const SCENE_LABEL_FONT_SANS =
  '"Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif';

export const SCENE_LABEL_FONT_KAI =
  '"KaiTi", "STKaiti", "Noto Serif SC", serif';

export const ENTITY_LABEL_COLOR = "#e8e2d6";
export const ENTITY_LABEL_FONT_SIZE = labelPx(11);
export const THINKING_PULSE_MS = 1200;

export const NAMEPLATE_FONT_SIZE_PX = nameplateFontPx();
export const NAMEPLATE_FONT_SIZE = `${NAMEPLATE_FONT_SIZE_PX}px`;
export const NAMEPLATE_PLAYER_COLOR = "#ffffff";
export const NAMEPLATE_NPC_COLOR = "#fff6b8";

/** No stroke, no backdrop — light drop shadow for tile contrast. */
export function applySceneHanLabelBase(label: Phaser.GameObjects.Text): void {
  label.setFontFamily(SCENE_LABEL_FONT);
  label.setStroke("#000000", 0);
  label.setBackgroundColor("");
  label.setPadding(0, 0, 0, 0);
  label.setShadow(1, 1, "rgba(0,0,0,0.45)", 1, false, false);
}

export function applyNameplateStyle(
  label: Phaser.GameObjects.Text,
  kind: "player" | "npc",
): void {
  applySceneHanLabelBase(label);
  label.setFontSize(NAMEPLATE_FONT_SIZE);
  label.setFontStyle("600");
  label.setColor(kind === "npc" ? NAMEPLATE_NPC_COLOR : NAMEPLATE_PLAYER_COLOR);
  label.setWordWrapWidth(0);
}

export function npcDisplayName(name: string): string {
  const trimmed = name.trim();
  return trimmed || "NPC";
}
