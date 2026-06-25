/**
 * World Lore seed — LOCKED per 23-CONTEXT.md <world_lore> (D-WORLD-04).
 * Chronicle UI and world_history table are Phase 24; Phase 23 exports constants only.
 */

export type AetherNexusLore = {
  nameZh: string;
  nameEn: string;
  origin: string;
  beginningFieldsRole: string;
  historyEvolution: string;
  coreConflicts: string[];
};

export const AETHER_NEXUS_LORE: AetherNexusLore = {
  nameZh: "太乙万界交汇",
  nameEn: "Aether Nexus",
  origin:
    "上古「万界崩裂纪」，无数独立小说世界因天道失衡、系统冲突与量子融合灾变剧烈碰撞；部分位面碎片重叠融合，形成规则混乱的太乙交汇界。",
  beginningFieldsRole:
    "唯一被 12 大原位面共同承认的中立缓冲区「始源区」；12 位顶尖代表在此设使馆，共同书写「融合后的共享世界历史」。",
  historyEvolution:
    "世界历史经议会提案 + 投票动态演化；重大事件（位面规则入侵、新遗迹觉醒等）须 12 人多数票确认。玩家行动可作提案证据，影响历史走向。",
  coreConflicts: [
    "仙道秩序 vs 帝国扩张",
    "系统逻辑 vs 混乱乐子",
    "和平治愈 vs 废土进化",
    "守护稳定 vs 自由探索",
  ],
};

/** Player-facing name for the home map / diplomatic buffer zone (LOCKED Phase 23 UAT). */
export const BEGINNING_FIELDS_NAME_ZH = "始源区";

/** Internal English key — code comments, Tiled assets, spawn constants. */
export const BEGINNING_FIELDS_NAME_EN = "Beginning Fields";

/** Compact world summary for LLM/registry imports (≤200 中文字符). */
export function aetherNexusSummaryForPrompt(): string {
  const { nameZh, beginningFieldsRole, coreConflicts } = AETHER_NEXUS_LORE;
  return `${nameZh}：${beginningFieldsRole} 当前核心冲突：${coreConflicts.join(" · ")}。`;
}
