/**
 * Semantic attitude state clamp (D-BELIEF-04/08/12).
 *
 * `key_beliefs` should be NPC first-person short sentences (e.g. 「我不信他的承诺」).
 * Mood is a closed Chinese 8-value whitelist — no English aliases.
 */

export const NPC_MOODS = [
  "平静",
  "亲近",
  "警惕",
  "恼火",
  "愉悦",
  "低落",
  "愧疚",
  "戏谑",
] as const;

export type NpcMood = (typeof NPC_MOODS)[number];

const NPC_MOOD_SET: ReadonlySet<string> = new Set(NPC_MOODS);

export const KEY_BELIEF_MAX_COUNT = 5;
export const KEY_BELIEF_MAX_CHARS = 40;
export const SEMANTIC_SUMMARY_MAX_CHARS = 200;

export function isNpcMood(value: string): value is NpcMood {
  return NPC_MOOD_SET.has(value);
}

export type SemanticStateInput = {
  mood?: string | null;
  beliefs?: string[] | null;
  summary?: string | null;
};

/**
 * Clamp LLM/reflect semantic fields. Omitted keys mean "do not write" so the
 * caller can preserve prior DB values (D-BELIEF-07).
 */
export type ClampedSemanticState = {
  mood?: NpcMood;
  beliefs?: string[];
  summary?: string;
};

export function clampSemanticState(input: SemanticStateInput): ClampedSemanticState {
  const out: ClampedSemanticState = {};

  if (typeof input.mood === "string" && input.mood.length > 0 && isNpcMood(input.mood)) {
    out.mood = input.mood;
  }

  if (input.beliefs != null) {
    out.beliefs = input.beliefs
      .map((b) => (typeof b === "string" ? b.trim().slice(0, KEY_BELIEF_MAX_CHARS) : ""))
      .filter((b) => b.length > 0)
      .slice(0, KEY_BELIEF_MAX_COUNT);
  }

  if (typeof input.summary === "string") {
    out.summary = input.summary.slice(0, SEMANTIC_SUMMARY_MAX_CHARS);
  }

  return out;
}
