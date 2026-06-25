import { describe, expect, it } from "vitest";
import { COUNCIL_NPC_IDS, getPersona } from "../npcPersonas.js";
import { relationshipKindLabelZh } from "./relationshipLabels.js";

describe("relationshipKindLabelZh", () => {
  it("maps every dossier relationship kind to Chinese", () => {
    const kinds = new Set<string>();
    for (const npcId of COUNCIL_NPC_IDS) {
      for (const rel of getPersona(npcId).relationships) {
        kinds.add(rel.kind);
      }
    }
    for (const kind of kinds) {
      const label = relationshipKindLabelZh(kind);
      expect(label).not.toBe(kind);
      expect(label.length).toBeGreaterThan(0);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(80);
  });

  it("labels common kinds", () => {
    expect(relationshipKindLabelZh("rival")).toBe("宿敌");
    expect(relationshipKindLabelZh("nemesis")).toBe("死敌");
    expect(relationshipKindLabelZh("ally")).toBe("同盟");
  });
});
