import { z } from "zod";
import { checkPlayerMessageContent } from "./contentGuard.js";

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

export const voteMinutesSchema = z.object({
  kind: z.literal("vote_minutes"),
  proposalFull: z.string(),
  ballots: z.array(voteBallotSchema).length(12),
});

export const worldHistoryMinutesSchema = z.discriminatedUnion("kind", [
  genesisMinutesSchema,
  voteMinutesSchema,
]);

export type GenesisSignatory = z.infer<typeof genesisSignatorySchema>;
export type GenesisMinutes = z.infer<typeof genesisMinutesSchema>;
export type VoteBallot = z.infer<typeof voteBallotSchema>;
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

/** 1 game-day = 1440 minutes; year 1 = minutes 0..1439 */
export function chronicleGameYearFromMinute(gameMinute: number): number {
  return Math.floor(Math.max(0, gameMinute) / 1440) + 1;
}

export function formatChronicleYearLabel(gameYear: number): string {
  if (gameYear <= 1) return "太乙纪·元年";
  return `太乙纪·${gameYear}年`;
}

export function parseWorldHistoryStatusFilter(
  raw: unknown,
): WorldHistoryStatusFilter {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "rejected" || value === "all") return value;
  return "accepted";
}

export function parseWorldHistoryMinutes(input: unknown): WorldHistoryMinutes {
  return worldHistoryMinutesSchema.parse(input);
}

export function safeParseWorldHistoryMinutes(input: unknown) {
  return worldHistoryMinutesSchema.safeParse(input);
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
