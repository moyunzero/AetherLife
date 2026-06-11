/** Rule-based speak intent — mirrors workers/agent-worker/src/graph/speak_intent.py */

export const SpeakIntent = {
  CASUAL: "casual",
  PHYSICAL: "physical",
  RECALL: "recall",
  SOCIAL_EDGE: "social_edge",
  NARRATIVE: "narrative",
} as const;

export type SpeakIntentValue = (typeof SpeakIntent)[keyof typeof SpeakIntent];

const RECALL_MARKERS = [
  "记得",
  "还记得",
  "多少",
  "是什么",
  "是啥",
  "之前",
  "上次",
  "刚才",
  "告诉",
  "说过",
  "提过",
] as const;

const NARRATIVE_MARKERS = [
  "哪里",
  "为什么",
  "怎么",
  "讲讲",
  "历史",
  "世界",
  "故事",
  "是什么",
  "做什么",
  "在干嘛",
  "干什么",
  "在忙",
] as const;

const CASUAL_GREETING_ONLY_RE =
  /^(你好(呀|啊|哦|呐|呢)?|嗨(呀|啊)?|hello|hi|hey|早上好|晚上好|下午好|在吗|在不在)([～!！?？。…]*)?$/i;
const META_BRIEF_RE = /简短|一句话|别太长|简单说说|简单说/;

const MOVE_PATTERNS: RegExp[] = [
  /移动/,
  /走到/,
  /走去/,
  /走一步/,
  /向[左右上下]/,
  /去\s*[\(（]?\s*\d+\s*[,，]\s*\d+\s*[\)）]?/,
  /左侧|右侧|左边|右边|上方|下方|下面|下边|旁边|附近|旁白|到我|来我|过来/,
  /\bmove\b/i,
  /\bgo to\b/i,
];

const INTERACT_PATTERNS: RegExp[] = [
  /开门/,
  /打开门/,
  /把门打开/,
  /开一下门/,
  /打开\s*door/i,
  /\bopen\b.*\bdoor\b/i,
  /\binteract\b/i,
];

const INSULT_MARKERS = ["丑", "滚", "蠢", "有病", "变态", "活该", "什么玩意", "傻", "废物", "去死"];

/**
 * Determines whether a message expresses a request to move or go somewhere.
 *
 * @param message - The input text to analyze for movement intent
 * @returns `true` if any movement pattern matches the trimmed message, `false` otherwise
 */
export function playerRequestsMove(message: string): boolean {
  const text = (message || "").trim();
  if (!text) return false;
  return MOVE_PATTERNS.some((p) => p.test(text));
}

/**
 * Determines whether a message requests an interaction (for example, opening or interacting with doors).
 *
 * @param message - The input text to analyze
 * @returns `true` if the message requests an interaction (such as opening or interacting with doors), `false` otherwise
 */
export function playerRequestsInteract(message: string): boolean {
  const text = (message || "").trim();
  if (!text) return false;
  return INTERACT_PATTERNS.some((p) => p.test(text));
}

/**
 * Determines whether the message requests a physical action (movement or interaction).
 *
 * @returns `true` if the message requests movement or an interaction, `false` otherwise.
 */
export function playerRequestsPhysicalAction(message: string): boolean {
  return playerRequestsMove(message) || playerRequestsInteract(message);
}

/**
 * Detects whether a message is phrased as a recall-style question.
 *
 * @param message - The text to analyze
 * @returns `true` if the message contains any recall marker, `false` otherwise.
 */
export function isRecallQuestion(message: string): boolean {
  const msg = (message || "").trim();
  if (!msg) return false;
  return RECALL_MARKERS.some((marker) => msg.includes(marker));
}

/**
 * Determine whether a message expresses a rude tone, a help request, or neither.
 *
 * @param message - The text to analyze
 * @returns `"rude"` if the message contains insult-like tokens, `"help"` if the message contains help/request tokens (for example the Chinese characters "帮" or "请"), `null` otherwise
 */
export function inferSocialFromMessage(message: string): "rude" | "help" | null {
  const msg = (message || "").trim();
  if (!msg) return null;
  if (INSULT_MARKERS.some((marker) => msg.includes(marker))) return "rude";
  if (msg.includes("帮") || msg.includes("请")) return "help";
  return null;
}

/**
 * Determines whether the trimmed message is a standalone casual greeting (pure greeting only; excludes messages that only start with a greeting such as "你好狂啊").
 *
 * @returns `true` if the trimmed message matches the casual-greeting-only pattern (a pure greeting), `false` otherwise.
 */
export function isCasualGreetingOnly(message: string): boolean {
  const msg = (message || "").trim();
  if (!msg) return false;
  return CASUAL_GREETING_ONLY_RE.test(msg);
}

/**
 * Classifies a user's message into one of the speak intent categories.
 *
 * Empty or unrecognized messages default to `SpeakIntent.NARRATIVE`.
 *
 * @returns The inferred speak intent: one of `SpeakIntent.PHYSICAL`, `SpeakIntent.RECALL`, `SpeakIntent.SOCIAL_EDGE`, `SpeakIntent.CASUAL`, or `SpeakIntent.NARRATIVE`.
 */
export function classifySpeakIntent(message: string): SpeakIntentValue {
  const msg = (message || "").trim();
  if (!msg) return SpeakIntent.NARRATIVE;
  if (playerRequestsPhysicalAction(msg)) return SpeakIntent.PHYSICAL;
  if (isRecallQuestion(msg)) return SpeakIntent.RECALL;
  if (inferSocialFromMessage(msg) !== null) return SpeakIntent.SOCIAL_EDGE;
  if (isCasualGreetingOnly(msg)) return SpeakIntent.CASUAL;
  if (META_BRIEF_RE.test(msg)) return SpeakIntent.CASUAL;
  if (NARRATIVE_MARKERS.some((marker) => msg.includes(marker))) return SpeakIntent.NARRATIVE;
  return SpeakIntent.NARRATIVE;
}

/**
 * Determines whether memory context should be omitted for a given speak intent.
 *
 * @param intent - The speak intent to evaluate
 * @returns `true` if memory context should be skipped for `PHYSICAL` or `CASUAL`, `false` otherwise
 */
export function shouldSkipMemoryContext(intent: SpeakIntentValue): boolean {
  return intent === SpeakIntent.PHYSICAL || intent === SpeakIntent.CASUAL;
}
