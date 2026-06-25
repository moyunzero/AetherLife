import { describe, expect, it } from "vitest";
import { AETHER_NEXUS_LORE } from "../aetherNexusLore.js";
import { mainNpcDisplayName } from "../npcDisplayNames.js";
import {
  COUNCIL_NPC_IDS,
  getPersona,
  isCouncilNpcId,
} from "./constants.js";
import { formatPersonaPromptBlock } from "./personaPrompt.js";
import { COUNCIL_ARCHETYPE_ENUM, VOTING_LEANING_ENUM } from "./types.js";

const SPEAKABLE_TRIO = ["npc-1", "npc-2", "npc-3"] as const;

const TRIO_DISPLAY_NAMES: Record<(typeof SPEAKABLE_TRIO)[number], string> = {
  "npc-1": "莫玄虚",
  "npc-2": "阿斯托利亚",
  "npc-3": "诸葛知危",
};

describe("COUNCIL_NPC_IDS", () => {
  it("has exactly 12 entries npc-1..npc-12", () => {
    expect(COUNCIL_NPC_IDS).toHaveLength(12);
    expect([...COUNCIL_NPC_IDS]).toEqual([
      "npc-1",
      "npc-2",
      "npc-3",
      "npc-4",
      "npc-5",
      "npc-6",
      "npc-7",
      "npc-8",
      "npc-9",
      "npc-10",
      "npc-11",
      "npc-12",
    ]);
  });
});

describe("isCouncilNpcId", () => {
  it("accepts council ids and rejects background villagers", () => {
    expect(isCouncilNpcId("npc-1")).toBe(true);
    expect(isCouncilNpcId("bg-villager-1")).toBe(false);
  });
});

describe("CouncilArchetype", () => {
  it("covers all 12 archetype slugs from registry", () => {
    expect(COUNCIL_ARCHETYPE_ENUM.options).toHaveLength(12);
    expect(COUNCIL_ARCHETYPE_ENUM.options).toEqual(
      expect.arrayContaining([
        "order_keeper",
        "expansionist",
        "logician",
        "chaos_agent",
        "pacifist",
        "power_broker",
        "mediator",
        "guardian",
        "aesthete",
        "brawler",
        "perfectionist",
        "explorer",
      ]),
    );
  });
});

describe("VotingLeaning", () => {
  it("is for | against | swing", () => {
    expect(VOTING_LEANING_ENUM.options).toEqual(["for", "against", "swing"]);
  });
});

describe("AETHER_NEXUS_LORE", () => {
  it("exports locked world name", () => {
    expect(AETHER_NEXUS_LORE.nameZh).toBe("太乙万界交汇");
  });
});

describe("getPersona speakable trio", () => {
  it.each(SPEAKABLE_TRIO)("returns LOCKED displayName for %s", (npcId) => {
    const persona = getPersona(npcId);
    expect(persona.displayName).toBe(TRIO_DISPLAY_NAMES[npcId]);
  });

  it.each(SPEAKABLE_TRIO)("%s has 11 relationships covering other seats", (npcId) => {
    const persona = getPersona(npcId);
    expect(persona.relationships).toHaveLength(11);
    const targets = new Set(persona.relationships.map((r) => r.targetId));
    expect(targets.size).toBe(11);
    for (const otherId of COUNCIL_NPC_IDS) {
      if (otherId === npcId) continue;
      expect(targets.has(otherId)).toBe(true);
    }
  });
});

describe("mainNpcDisplayName", () => {
  it("derives display names from registry", () => {
    expect(mainNpcDisplayName("npc-1")).toBe("莫玄虚");
    expect(mainNpcDisplayName("npc-2")).toBe("阿斯托利亚");
    expect(mainNpcDisplayName("npc-3")).toBe("诸葛知危");
  });
});

describe("formatPersonaPromptBlock", () => {
  it.each(SPEAKABLE_TRIO)("%s block is ≤800 Chinese characters", (npcId) => {
    const block = formatPersonaPromptBlock(npcId, { mode: "speak" });
    expect(block.length).toBeLessThanOrEqual(800);
    expect(block).not.toContain("backstoryFull");
  });

  it("includes required speak fields for npc-1", () => {
    const p = getPersona("npc-1");
    const block = formatPersonaPromptBlock("npc-1", { mode: "speak" });
    expect(block).toContain(p.displayName);
    expect(block).toContain(p.originPlane);
    expect(block).toContain(p.profession);
    expect(block).toContain(p.personality);
    expect(block).toContain(p.contrastMoe);
    expect(block).toContain(p.speakStyle);
    expect(block).toContain(p.mbti);
    expect(block).toContain(p.zodiacSign);
    expect(block).not.toContain(p.backstoryFull ?? "__none__");
  });
});
