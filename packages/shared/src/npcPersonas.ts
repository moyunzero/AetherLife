/**
 * Council persona registry — backward-compat barrel (D-SCHEMA-01).
 * @see packages/shared/src/council/
 */
export {
  COUNCIL_MEMORY_PLAYER_ID,
  COUNCIL_NPC_IDS,
  getPersona,
  isCouncilNpcId,
  type CouncilNpcId,
} from "./council/constants.js";

export {
  COUNCIL_ARCHETYPE_ENUM,
  CouncilPersonaSchema,
  VOTING_LEANING_ENUM,
  parseCouncilPersona,
  safeParseCouncilPersona,
  type CouncilArchetype,
  type CouncilLifeNode,
  type CouncilPersona,
  type CouncilRelationship,
  type VotingLeaning,
} from "./council/types.js";

export { COUNCIL_PERSONAS } from "./council/dossiers/index.js";

export { AETHER_NEXUS_LORE, aetherNexusSummaryForPrompt } from "./aetherNexusLore.js";
