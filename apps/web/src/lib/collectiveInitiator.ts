export type CollectiveEventLike = {
  kind: string;
  playerIds?: string[];
  createdAt?: string;
};

export function resolveCollectiveInitiatorPlayerId(event: CollectiveEventLike): string | null {
  const ids = event.playerIds;
  if (!ids?.length) return null;
  if (event.kind === "compete_object" || event.kind === "collaborate") {
    return ids[1] ?? null;
  }
  return ids[0] ?? null;
}

export function collectiveKindLabelZh(kind: string): string {
  switch (kind) {
    case "rude":
      return "冒犯";
    case "help":
      return "互助";
    case "speak":
      return "对话";
    default:
      return "见闻";
  }
}

const FEEDBACK_KINDS = new Set(["rude", "help"]);

export function collectiveFeedbackMessage(kind: string): string | null {
  if (kind === "rude") return "你的言行引起了小镇里的议论。";
  if (kind === "help") return "村民们注意到了你的善意。";
  return null;
}

export function shouldShowCollectiveFeedbackBanner(
  event: CollectiveEventLike | undefined,
  playerId: string,
  nowMs: number = Date.now(),
): boolean {
  if (!event || !FEEDBACK_KINDS.has(event.kind)) return false;
  const initiator = resolveCollectiveInitiatorPlayerId(event);
  if (!initiator || initiator !== playerId) return false;
  if (!event.createdAt) return false;
  const created = Date.parse(event.createdAt);
  if (Number.isNaN(created)) return false;
  return nowMs - created <= 30_000;
}
