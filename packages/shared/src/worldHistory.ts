import { z } from "zod";
import { COUNCIL_VOTE_BALLOT_COUNT } from "./council/constants.js";
import { checkPlayerMessageContent } from "./contentGuard.js";
import { aetherCivilFromEpochMinute } from "./personalTimeline.js";

export { COUNCIL_VOTE_BALLOT_COUNT };

export const genesisSignatorySchema = z.object({
  npcId: z.string(),
  displayName: z.string(),
  faction: z.string(),
  stanceManifestoShort: z.string().optional(),
});

export const genesisMinutesSchema = z.object({
  kind: z.literal("genesis_signatories"),
  proposalFull: z.string(),
  signatories: z.array(genesisSignatorySchema).length(12),
  footnote: z.literal("此条为奠基文献，非本届廷议表决。"),
});

export const voteBallotSchema = z.object({
  npcId: z.string(),
  displayName: z.string(),
  vote: z.enum(["yes", "no"]),
  reasonZh: z.string(),
});

export const debateExcerptSchema = z.object({
  round: z.number().int().min(0),
  npcId: z.string().min(1),
  displayName: z.string().min(1),
  fullText: z.string().min(1).max(180),
  feedQuote: z.string().max(80).optional(),
});

export const voteMinutesSchema = z.object({
  kind: z.literal("vote_minutes"),
  proposalFull: z.string(),
  /** 11 non-proposer seats; proposer is recorded on the entry, not in ballots. */
  ballots: z.array(voteBallotSchema).length(COUNCIL_VOTE_BALLOT_COUNT),
  /** Optional debate archive from worker transcript (Phase 25 dual-output). */
  debateExcerpts: z.array(debateExcerptSchema).max(24).optional(),
});

/** Legacy rows stored 12 ballots including proposer; strip proposer before zod parse. */
export function normalizeVoteMinutesInput(
  input: unknown,
  options?: { proposerNpcId?: string | null },
): unknown {
  if (!input || typeof input !== "object") return input;
  const obj = input as { kind?: string; ballots?: Array<{ npcId?: string }> };
  if (obj.kind !== "vote_minutes" || !Array.isArray(obj.ballots)) return input;
  if (obj.ballots.length === COUNCIL_VOTE_BALLOT_COUNT) return input;
  const proposer = options?.proposerNpcId;
  if (obj.ballots.length === 12 && proposer) {
    return {
      ...obj,
      ballots: obj.ballots.filter((b) => b?.npcId !== proposer),
    };
  }
  return input;
}

export const worldHistoryMinutesSchema = z.discriminatedUnion("kind", [
  genesisMinutesSchema,
  voteMinutesSchema,
]);

export type GenesisSignatory = z.infer<typeof genesisSignatorySchema>;
export type GenesisMinutes = z.infer<typeof genesisMinutesSchema>;
export type VoteBallot = z.infer<typeof voteBallotSchema>;
export type DebateExcerpt = z.infer<typeof debateExcerptSchema>;
export type VoteMinutes = z.infer<typeof voteMinutesSchema>;
export type WorldHistoryMinutes = z.infer<typeof worldHistoryMinutesSchema>;

export type WorldHistoryEntryKind = "genesis" | "vote";
export type WorldHistoryStatus = "accepted" | "rejected";
export type WorldHistoryStatusFilter = WorldHistoryStatus | "all";

export type WorldHistoryPublicEntry = {
  id: string;
  sequence: number;
  entryKind: WorldHistoryEntryKind;
  status: WorldHistoryStatus;
  title: string;
  proposalExcerpt: string;
  proposerDisplayName: string;
  gameYear: number;
  gameYearLabel: string;
  yesCount: number | null;
  noCount: number | null;
  tallyLabel: string | null;
  createdAt: string;
  minutes: WorldHistoryMinutes;
};

/** List GET omits minutes; detail GET / sync include full minutes. */
export type WorldHistoryListEntry = Omit<WorldHistoryPublicEntry, "minutes">;

export function toWorldHistoryListEntry(entry: WorldHistoryPublicEntry): WorldHistoryListEntry {
  const { minutes: _minutes, ...listEntry } = entry;
  return listEntry;
}

/** Civil Aether year from epoch minutes (360 days/year; year 0 = 太乙元年). */
export function chronicleGameYearFromMinute(gameMinute: number): number {
  return aetherCivilFromEpochMinute(gameMinute).year;
}

/** Year-only chronicle label — same 「太乙…」family as formatAetherCalendarLabel. */
export function formatChronicleYearLabel(gameYear: number): string {
  if (gameYear <= 0) return "太乙元年";
  return `太乙${gameYear}年`;
}

export function parseWorldHistoryStatusFilter(
  raw: unknown,
): WorldHistoryStatusFilter {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "rejected" || value === "all") return value;
  return "accepted";
}

export function parseWorldHistoryMinutes(
  input: unknown,
  options?: { proposerNpcId?: string | null },
): WorldHistoryMinutes {
  return worldHistoryMinutesSchema.parse(normalizeVoteMinutesInput(input, options));
}

export function safeParseWorldHistoryMinutes(
  input: unknown,
  options?: { proposerNpcId?: string | null },
) {
  return worldHistoryMinutesSchema.safeParse(normalizeVoteMinutesInput(input, options));
}

/** Returns first blocklist failure reason, or null if title and proposal pass. */
export function validateWorldHistoryStrings(fields: {
  title: string;
  proposal: string;
}): string | null {
  for (const text of [fields.title, fields.proposal] as const) {
    const result = checkPlayerMessageContent(text);
    if (!result.allowed) return result.reason;
  }
  return null;
}
