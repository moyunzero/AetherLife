import { z } from "zod";

/** Machine-readable archetype slugs — one per council seat (npc-1…npc-12). */
export const COUNCIL_ARCHETYPE_ENUM = z.enum([
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
]);

export type CouncilArchetype = z.infer<typeof COUNCIL_ARCHETYPE_ENUM>;

export const VOTING_LEANING_ENUM = z.enum(["for", "against", "swing"]);

export type VotingLeaning = z.infer<typeof VOTING_LEANING_ENUM>;

export type CouncilRelationship = {
  targetId: string;
  kind: string;
  summary: string;
};

export type CouncilLifeNode = {
  age: string;
  event: string;
};

export type CouncilPersona = {
  id: string;
  displayName: string;
  displayNameEn?: string;
  gender: string;
  faction: string;
  originPlane: string;
  mbti: string;
  zodiacSign: string;
  profession: string;
  archetype: CouncilArchetype;
  personality: string;
  contrastMoe: string;
  votingLogic: string;
  backstory: string;
  backstoryFull?: string;
  relationships: CouncilRelationship[];
  stanceManifesto: string;
  stanceManifestoShort?: string;
  appearance?: string;
  lifeNodes?: CouncilLifeNode[];
  abilitiesNote?: string;
  councilRole?: string;
  promptSummary?: string;
  ltmSeeds?: string[];
  votingLeaning: VotingLeaning;
  speakStyle: string;
  debateStyle: string;
  speakExample?: string;
  dailyHabits?: string;
};

const CouncilRelationshipSchema = z
  .object({
    targetId: z.string().min(1),
    kind: z.string().min(1),
    summary: z.string().min(1),
  })
  .strict();

const CouncilLifeNodeSchema = z
  .object({
    age: z.string().min(1),
    event: z.string().min(1),
  })
  .strict();

export const CouncilPersonaSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    displayNameEn: z.string().min(1).optional(),
    gender: z.string().min(1),
    faction: z.string().min(1),
    originPlane: z.string().min(1),
    mbti: z.string().min(1),
    zodiacSign: z.string().min(1),
    profession: z.string().min(1),
    archetype: COUNCIL_ARCHETYPE_ENUM,
    personality: z.string().min(1),
    contrastMoe: z.string().min(1),
    votingLogic: z.string().min(1),
    backstory: z.string().min(1),
    backstoryFull: z.string().min(1).optional(),
    relationships: z.array(CouncilRelationshipSchema).length(11),
    stanceManifesto: z.string().min(1),
    stanceManifestoShort: z.string().min(1).optional(),
    appearance: z.string().min(1).optional(),
    lifeNodes: z.array(CouncilLifeNodeSchema).optional(),
    abilitiesNote: z.string().min(1).optional(),
    councilRole: z.string().min(1).optional(),
    promptSummary: z.string().min(1).optional(),
    ltmSeeds: z.array(z.string().min(1)).optional(),
    votingLeaning: VOTING_LEANING_ENUM,
    speakStyle: z.string().min(1),
    debateStyle: z.string().min(1),
    speakExample: z.string().min(1).optional(),
    dailyHabits: z.string().min(1).optional(),
  })
  .strict();

export function parseCouncilPersona(input: unknown): CouncilPersona {
  return CouncilPersonaSchema.parse(input);
}

export function safeParseCouncilPersona(input: unknown) {
  return CouncilPersonaSchema.safeParse(input);
}
