/**
 * CASUAL deterministic stub — mirrors worker can_use_casual_fast_lane + preview_casual_stub.
 */

import {
  classifySpeakIntent,
  inferSocialFromMessage,
  isCasualGreetingOnly,
  playerRequestsPhysicalAction,
  SpeakIntent,
  type SpeakIntentValue,
} from "./speakIntent.js";
import { stableStringHash } from "./stableStringHash.js";

const META_BRIEF_RE = /简短|一句话|别太长|简单说说|简单说/;

const GREETING_REPLIES = [
  "你好呀，需要我做什么？",
  "嗨，我在呢。",
  "你好，有什么我能帮你的吗？",
  "你好，想聊点什么？",
] as const;

const META_BRIEF_REPLIES = [
  "嗯，我在听。",
  "好的，说吧。",
  "明白，请讲。",
  "好，我听着呢。",
] as const;

const DEFAULT_CASUAL_REPLIES = [
  "好的，我明白了。",
  "嗯，知道了。",
  "好，我记下了。",
] as const;

export function pickCasualReply(msg: string): string {
  const key = msg.trim();
  let pool: readonly string[];
  if (isCasualGreetingOnly(key)) {
    pool = GREETING_REPLIES;
  } else if (META_BRIEF_RE.test(key)) {
    pool = META_BRIEF_REPLIES;
  } else {
    pool = DEFAULT_CASUAL_REPLIES;
  }
  return pool[stableStringHash(key) % pool.length];
}

function deterministicSocialReply(message: string, speakIntent: SpeakIntentValue): string | null {
  const msg = message.trim();
  if (!msg) return null;

  const inferred = inferSocialFromMessage(msg);
  if (inferred !== null) {
    if (inferred === "rude") return "请不要这样说话。";
    if (inferred === "help") return "好的，我会尽力帮忙。";
    return `我听到了：${msg.slice(0, 120)}`;
  }

  if (speakIntent === SpeakIntent.CASUAL || META_BRIEF_RE.test(msg)) {
    if (!playerRequestsPhysicalAction(msg)) {
      return pickCasualReply(msg);
    }
  }

  if (!playerRequestsPhysicalAction(msg) && isCasualGreetingOnly(msg)) {
    return pickCasualReply(msg);
  }

  return null;
}

/** Early speakPartial text for CASUAL deterministic turns. */
export function previewCasualSpeakStub(message: string): string | null {
  const intent = classifySpeakIntent(message);
  if (intent !== SpeakIntent.CASUAL) return null;
  return deterministicSocialReply(message, intent);
}

export type CasualFastLanePreview = {
  intent: SpeakIntentValue;
  stub: string;
};

export function canUseCasualFastLane(message: string): CasualFastLanePreview | null {
  const intent = classifySpeakIntent(message);
  if (intent !== SpeakIntent.CASUAL) return null;
  const stub = deterministicSocialReply(message, intent);
  if (!stub) return null;
  return { intent, stub };
}
