#!/usr/bin/env tsx
/**
 * Export LOCKED council dossiers → worker mirrors (compact + speak JSON + registry fallback).
 * Run: pnpm council:export-personas
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COUNCIL_NPC_IDS, type CouncilNpcId } from "../packages/shared/src/council/constants.js";
import { COUNCIL_PERSONAS } from "../packages/shared/src/council/dossiers/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const compactPath = join(root, "packages/shared/council-personas-compact.json");
const speakPath = join(root, "packages/shared/council-personas-speak.json");
const registryPyPath = join(root, "workers/agent-worker/src/council/registry.py");

type CompactEntry = {
  id: string;
  displayName: string;
  archetype: string;
  debateStyle: string;
  votingLeaning: string;
};

type SpeakEntry = {
  displayName: string;
  originPlane: string;
  profession: string;
  personality: string;
  contrastMoe: string;
  backstory: string;
  speakStyle: string;
  mbti: string;
  zodiacSign: string;
  votingLogic: string;
  relationships: Array<{ targetId: string; kind: string; summary: string }>;
};

const compact: Record<CouncilNpcId, CompactEntry> = {} as Record<CouncilNpcId, CompactEntry>;
const speak: Record<CouncilNpcId, SpeakEntry> = {} as Record<CouncilNpcId, SpeakEntry>;

for (const id of COUNCIL_NPC_IDS) {
  const p = COUNCIL_PERSONAS[id];
  compact[id] = {
    id: p.id,
    displayName: p.displayName,
    archetype: p.archetype,
    debateStyle: p.debateStyle,
    votingLeaning: p.votingLeaning,
  };
  speak[id] = {
    displayName: p.displayName,
    originPlane: p.originPlane,
    profession: p.profession,
    personality: p.personality,
    contrastMoe: p.contrastMoe,
    backstory: p.backstory,
    speakStyle: p.speakStyle,
    mbti: p.mbti,
    zodiacSign: p.zodiacSign,
    votingLogic: p.votingLogic,
    relationships: p.relationships.map((r) => ({
      targetId: r.targetId,
      kind: r.kind,
      summary: r.summary,
    })),
  };
}

writeFileSync(compactPath, `${JSON.stringify(compact, null, 2)}\n`, "utf8");
writeFileSync(speakPath, `${JSON.stringify(speak, null, 2)}\n`, "utf8");
console.log(`Wrote ${compactPath} (${Object.keys(compact).length} seats)`);
console.log(`Wrote ${speakPath} (${Object.keys(speak).length} seats)`);

function pyStr(value: string): string {
  return JSON.stringify(value);
}

function formatFallbackPersonas(): string {
  const lines = ["_FALLBACK_PERSONAS: dict[str, CouncilPersonaCompact] = {"];
  for (const id of COUNCIL_NPC_IDS) {
    const c = compact[id];
    lines.push(`    "${id}": {`);
    lines.push(`        "id": ${pyStr(c.id)},`);
    lines.push(`        "displayName": ${pyStr(c.displayName)},`);
    lines.push(`        "archetype": ${pyStr(c.archetype)},`);
    lines.push(`        "debateStyle": ${pyStr(c.debateStyle)},`);
    lines.push(`        "votingLeaning": ${pyStr(c.votingLeaning)},`);
    lines.push("    },");
  }
  lines.push("}");
  return lines.join("\n");
}

const registrySrc = readFileSync(registryPyPath, "utf8");
const fallbackRe = /_FALLBACK_PERSONAS: dict\[str, CouncilPersonaCompact\] = \{[\s\S]*?\n\}/;
const nextRegistry = registrySrc.replace(fallbackRe, formatFallbackPersonas());
if (nextRegistry === registrySrc) {
  throw new Error(`Could not patch ${registryPyPath} — _FALLBACK_PERSONAS block not found`);
}
writeFileSync(registryPyPath, nextRegistry, "utf8");
console.log(`Patched ${registryPyPath} _FALLBACK_PERSONAS`);
