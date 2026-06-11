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

function poolFor(npcId: string, zoneId: string): string[] {
  const byNpc = NPC_ZONE_POOLS[npcId] ?? NPC_ZONE_POOLS["npc-1"]!;
  const suffix = ZONE_SUFFIX(zoneId);
  return byNpc[suffix] ?? byNpc.default ?? byNpc.orchard ?? ["心里有点事"];
}

function stableIndex(seed: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % size;
}

/**
 * Rule-based motivation reasonZh at segment start (before async LLM).
 * 12–18 chars; must not match activityDisplayZh for activityKey.
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
