import { activityDisplayZh } from "@aetherlife/shared";
import type { Mobility } from "./schedule.js";

/** Per-NPC voice pools — motivation/emotion only; never activity paraphrase. */
const ZONE_SUFFIX = (zoneId: string): string => {
  const idx = zoneId.lastIndexOf(":");
  return idx >= 0 ? zoneId.slice(idx + 1) : zoneId;
};

const NPC_ZONE_POOLS: Record<string, Record<string, string[]>> = {
  "npc-1": {
    orchard: ["心里还惦记着件事", "想先把思路理清楚", "今天适合慢慢琢磨"],
    plaza: ["想听听大家最近在忙啥", "出来透口气也好", "说不定能碰见熟人"],
    default: ["先把念头安放好", "这会儿不想被打扰"],
  },
  "npc-2": {
    orchard: ["手头的活计得抓紧", "得把该办的事列清楚", "今天要把节奏稳住"],
    plaza: ["看看有没有能帮上忙的", "走动走动心里踏实", "想跟人说两句家常"],
    default: ["先把正事想好", "心里有个数才安心"],
  },
  "npc-3": {
    orchard: ["有话想直说就别憋着", "先把该问的问清楚", "今天得把话说在前头"],
    plaza: ["看看广场里有什么新鲜事", "有事就当面讲明白", "不想错过碰面的机会"],
    default: ["直来直去省得误会", "先把想法说清楚"],
  },
};

/**
 * Selects the phrase pool for a given NPC within a zone.
 *
 * @param npcId - NPC identifier (e.g., "npc-1"). If unknown, falls back to the default NPC pool.
 * @param zoneId - Zone identifier; zone suffix (text after the last `:`) is used to pick a zone-specific pool.
 * @returns An array of Chinese motivation/emotion strings for the requested NPC and zone. Falls back in this order when a zone-specific pool is missing: the NPC's `default`, then `orchard`, then a single-item fallback `["心里有点事"]`.
 */
function poolFor(npcId: string, zoneId: string): string[] {
  const byNpc = NPC_ZONE_POOLS[npcId] ?? NPC_ZONE_POOLS["npc-1"]!;
  const suffix = ZONE_SUFFIX(zoneId);
  return byNpc[suffix] ?? byNpc.default ?? byNpc.orchard ?? ["心里有点事"];
}

/**
 * Compute a stable pseudo-random index from a string seed.
 *
 * @param seed - Input string used to deterministically derive the index
 * @param size - Exclusive upper bound for the index; must be a positive integer
 * @returns An integer in the range [0, size) deterministically derived from `seed`
 */
function stableIndex(seed: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % size;
}

/**
 * Selects a deterministic Chinese motivation reason for an NPC at segment start.
 *
 * Chooses from per-NPC, zone-aware phrase pools using a stable hash of `npcId`, `zoneId`, and `activityKey`. If the chosen phrase contains the activity's Chinese label (with a leading "在" removed), the next phrase is used. The result is truncated to at most 18 characters.
 *
 * @param npcId - NPC identifier used to pick the phrase pool
 * @param zoneId - Zone identifier used to select zone-specific phrases
 * @param activityKey - Activity key whose display label is avoided in the chosen phrase
 * @returns The selected Chinese motivation reason, truncated to at most 18 characters
 */
export function pickIntentFallbackReasonZh(
  npcId: string,
  zoneId: string,
  activityKey: string,
  _mobility?: Mobility,
): string {
  const pool = poolFor(npcId, zoneId);
  const seed = `${npcId}|${zoneId}|${activityKey}`;
  let pick = pool[stableIndex(seed, pool.length)]!;
  const activityLabel = activityDisplayZh(activityKey);
  if (activityLabel && pick.includes(activityLabel.replace(/^在/, ""))) {
    pick = pool[(stableIndex(seed, pool.length) + 1) % pool.length]!;
  }
  return pick.slice(0, 18);
}
