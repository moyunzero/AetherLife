import { z } from "zod";
import { linkedEdgeSchema } from "./councilRelationships.js";

export const councilDeliberationPhaseSchema = z.enum([
  "proposal",
  "debate",
  "vote",
  "sealed",
]);

export type CouncilDeliberationPhase = z.infer<typeof councilDeliberationPhaseSchema>;

export const councilDeliberationVoteKindSchema = z.enum(["regular", "epoch"]);

export type CouncilDeliberationVoteKind = z.infer<typeof councilDeliberationVoteKindSchema>;

const quoteFeedRowSchema = z
  .object({
    kind: z.literal("quote"),
    npcId: z.string().min(1),
    displayName: z.string().min(1).max(40),
    /** Live Council feed soundbite (= worker feedQuote); max 80 per D-VOTE-UX-01 */
    text: z.string().min(1).max(80),
    travelerRef: z.boolean().optional(),
  })
  .strict();

const voteFeedRowSchema = z
  .object({
    kind: z.literal("vote"),
    npcId: z.string().min(1),
    displayName: z.string().min(1).max(40),
    vote: z.enum(["yes", "no"]),
    reasonZh: z.string().max(120).optional(),
  })
  .strict();

export const councilDeliberationFeedRowSchema = z.discriminatedUnion("kind", [
  quoteFeedRowSchema,
  voteFeedRowSchema,
]);

export type CouncilDeliberationFeedRow = z.infer<typeof councilDeliberationFeedRowSchema>;

export { linkedEdgeSchema };
export type LinkedEdge = z.infer<typeof linkedEdgeSchema>;

export const councilDeliberationSyncPayloadSchema = z
  .object({
    active: z.boolean(),
    voteKind: councilDeliberationVoteKindSchema,
    phase: councilDeliberationPhaseSchema,
    round: z.number().int().min(0),
    roundTotal: z.number().int().min(1),
    proposalTitle: z.string().max(120).optional(),
    feedDelta: z.array(councilDeliberationFeedRowSchema).optional(),
    linkedEdges: z.array(linkedEdgeSchema).optional(),
    resultEntryId: z.string().min(1).optional(),
    yesCount: z.number().int().min(0).max(12).optional(),
    noCount: z.number().int().min(0).max(12).optional(),
    status: z.enum(["accepted", "rejected"]).optional(),
    clearFeed: z.boolean().optional(),
  })
  .strict();

export type CouncilDeliberationPublicState = z.infer<typeof councilDeliberationSyncPayloadSchema>;

export function parseCouncilDeliberationPhase(input: unknown): CouncilDeliberationPhase {
  return councilDeliberationPhaseSchema.parse(input);
}

export function parseCouncilDeliberationFeedRow(input: unknown): CouncilDeliberationFeedRow {
  return councilDeliberationFeedRowSchema.parse(input);
}

export function parseCouncilDeliberationSyncPayload(
  input: unknown,
): CouncilDeliberationPublicState {
  return councilDeliberationSyncPayloadSchema.parse(input);
}

export function safeParseCouncilDeliberationSyncPayload(input: unknown) {
  return councilDeliberationSyncPayloadSchema.safeParse(input);
}
