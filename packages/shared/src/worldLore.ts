import type { BiomeId } from "./chunk.js";
import type { ChunkLore } from "./chunkLoreSchema.js";

/** Public lore fields safe for Colyseus + GET /chunks/.../lore (D-09 strip). */
export type ChunkLorePublic = {
  nameZh: string;
  flavorOneLine: string;
  storyHook: string;
  proceduralBiome: BiomeId;
  moodTag?: string;
};

/** Fixed home chunk (0,0) — no LLM (D-02, 11-UI-SPEC). */
export const HOME_CHUNK_LORE: ChunkLore = {
  nameZh: "晨曦村",
  flavorOneLine: "十二议会使节常驻的始源区枢纽",
  storyHook: "万界融合后，诸位使节在此共议规则与未来。",
  proceduralBiome: "home",
  moodTag: "家园",
  npcRumor: "村民常说清晨的露水会带来好运。",
  hiddenQuestSeed: "home-anchor-no-quest",
};

export function toChunkLorePublic(lore: ChunkLore): ChunkLorePublic {
  const out: ChunkLorePublic = {
    nameZh: lore.nameZh,
    flavorOneLine: lore.flavorOneLine,
    storyHook: lore.storyHook,
    proceduralBiome: lore.proceduralBiome,
  };
  if (lore.moodTag) out.moodTag = lore.moodTag;
  return out;
}
