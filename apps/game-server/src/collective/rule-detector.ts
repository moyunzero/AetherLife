import type { CollectiveEventKind } from "@aetherlife/shared";

const RUDE_PATTERN =
  /粗鲁|滚蛋?|笨蛋|讨厌|去死|变态|白痴|傻逼|废物|垃圾|混蛋|蠢货|蠢|丑|打你|打我|被打|该打|活该|有病|神经病|脑子有坑|欠揍|闭嘴|侮辱|辱骂|人渣|滚开/;
/** Social friction not covered by fixed kinds — worker LLM refine (D-02). */
const AMBIGUOUS_SOCIAL_PATTERN =
  /是不是傻|什么玩意|什么鬼|烦不烦|别烦|去你的|少说两句|恶心|滚远|搞什么|好丑|真丑/;
const HELP_PATTERN = /帮|帮忙|协助|请你/;
const POLITE_PATTERN = /请|谢谢|您好|麻烦/;
const PRAISE_PATTERN = /棒|厉害|感谢|真好/;
const APOLOGIZE_PATTERN = /对不起|抱歉|不好意思/;

export type SpeakRuleResult =
  | { kind: CollectiveEventKind; summary: string }
  | { ambiguous: true }
  | null;

/** @deprecated Phase 12.1 — speak social perception moved to worker LLM; action rules only on server. */
export function detectSpeakRule(text: string): SpeakRuleResult {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (RUDE_PATTERN.test(trimmed)) {
    return { kind: "rude", summary: "玩家言语粗鲁" };
  }
  if (HELP_PATTERN.test(trimmed)) {
    return { kind: "help", summary: "玩家请求帮助" };
  }
  if (APOLOGIZE_PATTERN.test(trimmed)) {
    return { kind: "apologize", summary: "玩家道歉" };
  }
  if (PRAISE_PATTERN.test(trimmed)) {
    return { kind: "praise", summary: "玩家称赞" };
  }
  if (POLITE_PATTERN.test(trimmed)) {
    return { kind: "polite", summary: "玩家礼貌用语" };
  }

  if (AMBIGUOUS_SOCIAL_PATTERN.test(trimmed)) {
    return { ambiguous: true };
  }

  return null;
}

export type ActionRuleInput = {
  actionType: string;
  initiatorPlayerId: string;
  objectId?: string;
  toNpcId?: string;
  npcId?: string;
  targetX?: number;
  targetY?: number;
};

export type ActionRuleResult =
  | { kind: CollectiveEventKind; summary: string; playerIds: string[] }
  | null;

export function detectCompeteObject(
  objectId: string,
  initiatorPlayerId: string,
  recentByObject: Map<string, { playerId: string; at: number }>,
  now: number,
  windowMs: number,
): ActionRuleResult {
  const prev = recentByObject.get(objectId);
  if (!prev || prev.playerId === initiatorPlayerId) return null;
  if (now - prev.at > windowMs) return null;
  return {
    kind: "compete_object",
    summary: `多名玩家争抢 ${objectId}`,
    playerIds: [prev.playerId, initiatorPlayerId],
  };
}

export function detectCollaborateTransfer(
  toNpcId: string,
  initiatorPlayerId: string,
  recentByNpc: Map<string, { playerId: string; at: number }>,
  now: number,
  windowMs: number,
): ActionRuleResult {
  const prev = recentByNpc.get(toNpcId);
  if (!prev || prev.playerId === initiatorPlayerId) return null;
  if (now - prev.at > windowMs) return null;
  return {
    kind: "collaborate",
    summary: `多名玩家向 ${toNpcId} 协作`,
    playerIds: [prev.playerId, initiatorPlayerId],
  };
}

export function recordObjectInteract(
  objectId: string,
  playerId: string,
  recentByObject: Map<string, { playerId: string; at: number }>,
  now: number,
): void {
  recentByObject.set(objectId, { playerId, at: now });
}

export function recordNpcTransfer(
  toNpcId: string,
  playerId: string,
  recentByNpc: Map<string, { playerId: string; at: number }>,
  now: number,
): void {
  recentByNpc.set(toNpcId, { playerId, at: now });
}
