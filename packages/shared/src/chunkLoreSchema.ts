import { z } from "zod";
import { checkPlayerMessageContent } from "./contentGuard.js";

/** Must stay aligned with BiomeId in chunk.ts */
export const CHUNK_LORE_BIOME_ENUM = z.enum([
  "home",
  "meadow",
  "scrub",
  "wetland",
  "highland",
]);

export const ChunkLoreSchema = z
  .object({
    nameZh: z.string().min(1).max(32),
    flavorOneLine: z.string().min(1).max(80),
    storyHook: z.string().min(1).max(200),
    proceduralBiome: CHUNK_LORE_BIOME_ENUM,
    moodTag: z.string().min(1).max(24),
    npcRumor: z.string().min(1).max(160),
    hiddenQuestSeed: z.string().min(1).max(120),
  })
  .strict();

export type ChunkLore = z.infer<typeof ChunkLoreSchema>;

export function parseChunkLore(input: unknown): ChunkLore {
  return ChunkLoreSchema.parse(input);
}

export function safeParseChunkLore(input: unknown) {
  return ChunkLoreSchema.safeParse(input);
}

/** Returns first blocklist failure reason, or null if all player-visible strings pass. */
export function validateChunkLoreStrings(lore: ChunkLore): string | null {
  const fields = [lore.nameZh, lore.flavorOneLine, lore.storyHook, lore.npcRumor] as const;
  for (const text of fields) {
    const result = checkPlayerMessageContent(text);
    if (!result.allowed) return result.reason;
  }
  return null;
}
