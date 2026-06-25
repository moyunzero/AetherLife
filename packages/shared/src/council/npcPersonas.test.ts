import { describe, expect, it } from "vitest";
import { AETHER_NEXUS_LORE } from "../aetherNexusLore.js";
import { mainNpcDisplayName } from "../npcDisplayNames.js";
import {
  COUNCIL_NPC_IDS,
  getPersona,
  isCouncilNpcId,
} from "./constants.js";
import { COUNCIL_PERSONAS } from "./dossiers/index.js";
import { formatPersonaPromptBlock } from "./personaPrompt.js";
import {
  COUNCIL_ARCHETYPE_ENUM,
  CouncilPersonaSchema,
  VOTING_LEANING_ENUM,
} from "./types.js";

const SPEAKABLE_TRIO = ["npc-1", "npc-2", "npc-3"] as const;

const TRIO_DISPLAY_NAMES: Record<(typeof SPEAKABLE_TRIO)[number], string> = {
  "npc-1": "莫玄虚",
  "npc-2": "阿斯托利亚",
  "npc-3": "诸葛知危",
};

const EXPECTED_VOTING_LEANING: Record<(typeof COUNCIL_NPC_IDS)[number], string> = {
  "npc-1": "against",
  "npc-2": "for",
  "npc-3": "swing",
  "npc-4": "swing",
  "npc-5": "swing",
  "npc-6": "against",
  "npc-7": "swing",
  "npc-8": "against",
  "npc-9": "swing",
  "npc-10": "for",
  "npc-11": "against",
  "npc-12": "for",
};

const EXPECTED_DISPLAY_NAMES: Record<(typeof COUNCIL_NPC_IDS)[number], string> = {
  "npc-1": "莫玄虚",
  "npc-2": "阿斯托利亚",
  "npc-3": "诸葛知危",
  "npc-4": "糖果",
  "npc-5": "白星烬",
  "npc-6": "瓦伦丁",
  "npc-7": "纳兰温言",
  "npc-8": "克里斯",
  "npc-9": "楚浅歌",
  "npc-10": "斯卡蒂",
  "npc-11": "叶秋水",
  "npc-12": "海莲娜",
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
    expect(isCouncilNpcId("npc-12")).toBe(true);
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

describe("COUNCIL_PERSONAS full registry (PERSONA-01)", () => {
  it("has all 12 dossier keys", () => {
    expect(Object.keys(COUNCIL_PERSONAS)).toHaveLength(12);
    for (const id of COUNCIL_NPC_IDS) {
      expect(COUNCIL_PERSONAS[id]).toBeDefined();
    }
  });

  it("has unique ids and displayNames across all 12 seats", () => {
    const ids = COUNCIL_NPC_IDS.map((id) => COUNCIL_PERSONAS[id].id);
    const names = COUNCIL_NPC_IDS.map((id) => COUNCIL_PERSONAS[id].displayName);
    expect(new Set(ids).size).toBe(12);
    expect(new Set(names).size).toBe(12);
  });

  it.each(COUNCIL_NPC_IDS)("%s passes CouncilPersonaSchema zod parse", (npcId) => {
    const result = CouncilPersonaSchema.safeParse(COUNCIL_PERSONAS[npcId]);
    expect(result.success).toBe(true);
  });

  it.each(COUNCIL_NPC_IDS)("%s has 11 relationships covering other seats", (npcId) => {
    const persona = COUNCIL_PERSONAS[npcId];
    expect(persona.relationships).toHaveLength(11);
    const targets = new Set(persona.relationships.map((r) => r.targetId));
    expect(targets.size).toBe(11);
    for (const otherId of COUNCIL_NPC_IDS) {
      if (otherId === npcId) continue;
      expect(targets.has(otherId)).toBe(true);
    }
  });

  it.each(COUNCIL_NPC_IDS)("%s has non-empty debateStyle", (npcId) => {
    expect(COUNCIL_PERSONAS[npcId].debateStyle.trim().length).toBeGreaterThan(0);
  });

  it.each(COUNCIL_NPC_IDS)("%s matches LOCKED displayName and votingLeaning", (npcId) => {
    const persona = COUNCIL_PERSONAS[npcId];
    expect(persona.displayName).toBe(EXPECTED_DISPLAY_NAMES[npcId]);
    expect(persona.votingLeaning).toBe(EXPECTED_VOTING_LEANING[npcId]);
  });
});

describe("voting split (PERSONA-05)", () => {
  it("distributes leanings 4 against / 3 for / 5 swing", () => {
    const counts = { for: 0, against: 0, swing: 0 };
    for (const id of COUNCIL_NPC_IDS) {
      counts[COUNCIL_PERSONAS[id].votingLeaning]++;
    }
    expect(counts).toEqual({ against: 4, for: 3, swing: 5 });
  });

  it("is NOT unanimous — dramatic tension gate (D-ARCH-03)", () => {
    const leanings = new Set(COUNCIL_NPC_IDS.map((id) => COUNCIL_PERSONAS[id].votingLeaning));
    expect(leanings.size).toBeGreaterThan(1);
  });

  it("matches locked against seats npc-1,6,8,11", () => {
    for (const id of ["npc-1", "npc-6", "npc-8", "npc-11"] as const) {
      expect(COUNCIL_PERSONAS[id].votingLeaning).toBe("against");
    }
  });

  it("matches locked for seats npc-2,10,12", () => {
    for (const id of ["npc-2", "npc-10", "npc-12"] as const) {
      expect(COUNCIL_PERSONAS[id].votingLeaning).toBe("for");
    }
  });

  it("matches locked swing seats npc-3,4,5,7,9", () => {
    for (const id of ["npc-3", "npc-4", "npc-5", "npc-7", "npc-9"] as const) {
      expect(COUNCIL_PERSONAS[id].votingLeaning).toBe("swing");
    }
  });
});

describe("getPersona", () => {
  it.each(COUNCIL_NPC_IDS)("returns dossier for %s", (npcId) => {
    const persona = getPersona(npcId);
    expect(persona.id).toBe(npcId);
    expect(persona.displayName).toBe(EXPECTED_DISPLAY_NAMES[npcId]);
  });

  it("throws for non-council ids", () => {
    expect(() => getPersona("bg-villager-1")).toThrow(/not a council npc id/);
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
  it("derives display names from registry for all 12 seats", () => {
    for (const id of COUNCIL_NPC_IDS) {
      expect(mainNpcDisplayName(id)).toBe(EXPECTED_DISPLAY_NAMES[id]);
    }
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

describe("registry core key snapshots", () => {
  it.each(COUNCIL_NPC_IDS)("%s core keys match dossier", (npcId) => {
    const p = COUNCIL_PERSONAS[npcId];
    expect({
      displayName: p.displayName,
      archetype: p.archetype,
      votingLeaning: p.votingLeaning,
    }).toMatchSnapshot();
  });
});
