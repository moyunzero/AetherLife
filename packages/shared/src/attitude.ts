export type AttitudeBand = "hostile" | "wary" | "neutral" | "warm" | "allied";

export const ATTITUDE_SCORE_MIN = -100;
export const ATTITUDE_SCORE_MAX = 100;

/**
 * D-15 band thresholds on effectiveScore.
 * Phase 28 关系网 reuses these cutoffs via relationshipBandFromAffection
 * (maps wary→cool, allied→close; separate ZH labels in councilRelationships).
 */
export function bandFromEffectiveScore(score: number): AttitudeBand {
  if (score < -30) return "hostile";
  if (score < 0) return "wary";
  if (score < 20) return "neutral";
  if (score < 50) return "warm";
  return "allied";
}

/** UI-SPEC locked zh labels for AttitudeBandChip. */
export function bandLabelZh(band: AttitudeBand): string {
  switch (band) {
    case "hostile":
      return "敌意";
    case "wary":
      return "戒备";
    case "neutral":
      return "平常";
    case "warm":
      return "亲近";
    case "allied":
      return "同盟";
  }
}

export function clampAttitudeScore(score: number): number {
  return Math.max(ATTITUDE_SCORE_MIN, Math.min(ATTITUDE_SCORE_MAX, score));
}
