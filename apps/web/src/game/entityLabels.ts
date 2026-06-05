/** In-scene entity labels — aligned with 07-UI-SPEC (Source Serif 4, 11px, --text). */
export const ENTITY_LABEL_FONT = '"Source Serif 4", "Noto Serif SC", serif';
export const ENTITY_LABEL_COLOR = "#e8e2d6";
export const ENTITY_LABEL_FONT_SIZE = "11px";
export const THINKING_PULSE_MS = 1200;

export function npcDisplayName(name: string): string {
  const trimmed = name.trim();
  return trimmed || "NPC";
}
