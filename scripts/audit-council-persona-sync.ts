#!/usr/bin/env tsx
/**
 * Audit council persona mirrors against LOCKED dossiers.
 * Run: pnpm council:audit-personas
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COUNCIL_NPC_IDS, type CouncilNpcId } from "../packages/shared/src/council/constants.js";
import { COUNCIL_PERSONAS } from "../packages/shared/src/council/dossiers/index.js";
import { MAIN_NPC_DISPLAY_NAMES } from "../packages/shared/src/npcDisplayNames.js";
import { COUNCIL_PERSONALITY_SEEDS } from "../packages/shared/src/council/personalitySeed.js";
import compact from "../packages/shared/council-personas-compact.json" with { type: "json" };
import speak from "../packages/shared/council-personas-speak.json" with { type: "json" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

type Issue = { npcId: string; source: string; field: string; expected: string; actual: string };

const issues: Issue[] = [];

function report(npcId: string, source: string, field: string, expected: string, actual: string) {
  if (expected !== actual) {
    issues.push({ npcId, source, field, expected, actual });
  }
}

const speakFields = [
  "displayName",
  "originPlane",
  "profession",
  "personality",
  "contrastMoe",
  "backstory",
  "speakStyle",
  "mbti",
  "zodiacSign",
  "votingLogic",
] as const;

for (const id of COUNCIL_NPC_IDS) {
  const p = COUNCIL_PERSONAS[id];
  const c = compact[id as CouncilNpcId];
  const s = speak[id as CouncilNpcId];

  if (!c) {
    issues.push({ npcId: id, source: "compact.json", field: "*", expected: "present", actual: "missing" });
  } else {
    for (const f of ["displayName", "archetype", "debateStyle", "votingLeaning"] as const) {
      report(id, "compact.json", f, p[f], c[f]);
    }
  }

  if (!s) {
    issues.push({ npcId: id, source: "speak.json", field: "*", expected: "present", actual: "missing" });
  } else {
    for (const f of speakFields) {
      report(id, "speak.json", f, p[f], s[f]);
    }
    if (s.relationships.length !== p.relationships.length) {
      report(
        id,
        "speak.json",
        "relationships.length",
        String(p.relationships.length),
        String(s.relationships.length),
      );
    }
  }
}

// registry.py fallback
const registrySrc = readFileSync(join(root, "workers/agent-worker/src/council/registry.py"), "utf8");
const fallbackStart = registrySrc.indexOf("_FALLBACK_PERSONAS:");
const fallbackBody = registrySrc.slice(fallbackStart);
for (const id of COUNCIL_NPC_IDS) {
  const p = COUNCIL_PERSONAS[id];
  const blockRe = new RegExp(`"${id}":\\s*\\{([^}]+)\\}`, "s");
  const bm = fallbackBody.match(blockRe);
  if (!bm) {
    issues.push({ npcId: id, source: "registry.py fallback", field: "*", expected: "present", actual: "missing" });
    continue;
  }
  const block = bm[1]!;
  for (const f of ["displayName", "archetype", "votingLeaning", "debateStyle"] as const) {
    const fm = block.match(new RegExp(`"${f}":\\s*"([^"]+)"`));
    report(id, "registry.py fallback", f, p[f], fm?.[1] ?? "");
  }
}

// collective/constants.py personality seeds
const constantsPy = readFileSync(
  join(root, "workers/agent-worker/src/collective/constants.py"),
  "utf8",
);
const seedBlock = constantsPy.match(/NPC_PERSONALITY_SEED[^=]*=\s*\{([\s\S]*?)\n\}/);
const pySeeds: Record<string, number> = {};
if (seedBlock?.[1]) {
  const entryRe = /"(npc-\d+)":\s*(-?\d+)/g;
  let sm: RegExpExecArray | null;
  while ((sm = entryRe.exec(seedBlock[1])) !== null) {
    pySeeds[sm[1]!] = Number(sm[2]);
  }
}
for (const id of COUNCIL_NPC_IDS) {
  const expected = COUNCIL_PERSONALITY_SEEDS[id];
  const actual = pySeeds[id];
  if (actual === undefined) {
    issues.push({ npcId: id, source: "collective/constants.py", field: "seed", expected: String(expected), actual: "missing" });
  } else if (actual !== expected) {
    report(id, "collective/constants.py", "seed", String(expected), String(actual));
  }
}

for (const id of COUNCIL_NPC_IDS) {
  report(
    id,
    "MAIN_NPC_DISPLAY_NAMES",
    "displayName",
    COUNCIL_PERSONAS[id].displayName,
    MAIN_NPC_DISPLAY_NAMES[id] ?? "",
  );
}

// ambient_intent.py loads from council-personas-compact.json at import time
const ambientSrc = readFileSync(join(root, "workers/agent-worker/src/graph/ambient_intent.py"), "utf8");
if (!ambientSrc.includes("council-personas-compact.json")) {
  issues.push({
    npcId: "*",
    source: "ambient_intent.py",
    field: "loader",
    expected: "council-personas-compact.json",
    actual: "missing reference",
  });
}

console.log(`Council persona sync audit: ${issues.length} issue(s)\n`);
for (const i of issues) {
  console.log(`[${i.npcId}] ${i.source} :: ${i.field}`);
  console.log(`  expected: ${i.expected.slice(0, 120)}${i.expected.length > 120 ? "…" : ""}`);
  console.log(`  actual:   ${i.actual.slice(0, 120)}${i.actual.length > 120 ? "…" : ""}`);
  console.log();
}

process.exit(issues.length > 0 ? 1 : 0);
