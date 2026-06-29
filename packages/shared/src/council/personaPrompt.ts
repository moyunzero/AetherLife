import { getPersona } from "./constants.js";
import { relationshipKindLabelZh } from "./relationshipLabels.js";
import type { CouncilRelationship } from "./types.js";

const SPEAK_PROMPT_CHAR_BUDGET = 800;

/** Runtime edge shape for speak/worker persona injection (REL-04). */
export type RuntimeRelationshipLine = {
  targetId: string;
  kind: string;
  summary: string;
  affection?: number;
  statusTags?: string[];
};

/** Relationship kind priority for compact speak blocks (D-SPEAK-01). */
const RELATIONSHIP_KIND_PRIORITY: Record<string, number> = {
  rival: 0,
  nemesis: 1,
  ally: 2,
  peer: 3,
  respect: 4,
  strategic_ally: 5,
};

function relationshipPriority(kind: string): number {
  return RELATIONSHIP_KIND_PRIORITY[kind] ?? 50;
}

function topRelationships(relationships: CouncilRelationship[], limit = 3): CouncilRelationship[] {
  return [...relationships]
    .sort((a, b) => relationshipPriority(a.kind) - relationshipPriority(b.kind))
    .slice(0, limit);
}

function truncateVotingLogic(votingLogic: string, maxLen = 120): string {
  const stripped = votingLogic.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (stripped.length <= maxLen) return stripped;
  return `${stripped.slice(0, maxLen - 1)}…`;
}

function truncateBackstory(backstory: string, maxLen = 160): string {
  if (backstory.length <= maxLen) return backstory;
  return `${backstory.slice(0, maxLen - 1)}…`;
}

export type PersonaPromptMode = "speak";

export type FormatPersonaPromptOptions = {
  mode?: PersonaPromptMode;
  /** When present, overrides registry `relationships[]` (runtime table wins). */
  runtimeRelationships?: RuntimeRelationshipLine[];
};

/**
 * Compact persona block for worker speak injection (D-SPEAK-01, ≤800 中文字符).
 * Excludes backstoryFull per T-23-02.
 */
export function formatPersonaPromptBlock(
  npcId: string,
  options: FormatPersonaPromptOptions = {},
): string {
  void options.mode;
  const p = getPersona(npcId);
  const relLines =
    options.runtimeRelationships && options.runtimeRelationships.length > 0
      ? options.runtimeRelationships.slice(0, 3).map((r) => {
          const kind = relationshipKindLabelZh(r.kind);
          const tags = r.statusTags?.length ? `[${r.statusTags.join("、")}] ` : "";
          const aff =
            r.affection !== undefined ? `affection=${r.affection} ` : "";
          return `·${r.targetId}(${kind})：${tags}${aff}${r.summary}`;
        })
      : topRelationships(p.relationships).map(
          (r) => `·${r.targetId}(${relationshipKindLabelZh(r.kind)})：${r.summary}`,
        );

  const sections = [
    `【${p.displayName}】`,
    `位面：${p.originPlane}`,
    `职业：${p.profession}`,
    `性格：${p.personality}`,
    `反差：${p.contrastMoe}`,
    `背景：${truncateBackstory(p.backstory)}`,
    relLines.length > 0 ? `关系：\n${relLines.join("\n")}` : "",
    `口吻：${p.speakStyle}`,
    `MBTI/星座：${p.mbti} · ${p.zodiacSign}`,
    `投票逻辑：${truncateVotingLogic(p.votingLogic)}`,
  ].filter(Boolean);

  let block = sections.join("\n");
  if (block.length <= SPEAK_PROMPT_CHAR_BUDGET) return block;

  // Trim backstory further if over budget
  const shorter = sections.map((line) =>
    line.startsWith("背景：") ? `背景：${truncateBackstory(p.backstory, 80)}` : line,
  );
  block = shorter.join("\n");
  if (block.length <= SPEAK_PROMPT_CHAR_BUDGET) return block;

  return block.slice(0, SPEAK_PROMPT_CHAR_BUDGET);
}

export { SPEAK_PROMPT_CHAR_BUDGET };
