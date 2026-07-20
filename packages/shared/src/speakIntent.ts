/** Rule-based speak intent — mirrors workers/agent-worker/src/graph/speak_intent.py */

export const SpeakIntent = {
  CASUAL: "casual",
  PHYSICAL: "physical",
  RECALL: "recall",
  SOCIAL_EDGE: "social_edge",
  NARRATIVE: "narrative",
} as const;

export type SpeakIntentValue = (typeof SpeakIntent)[keyof typeof SpeakIntent];

/** Short-term dialogue turn — mirrors game-server dialogue-session + worker recent_turns. */
export type DialogueTurn = { role: "player" | "npc"; text: string };

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
  /来这边|这边(儿)?|来一趟|过来一趟|来一下|叫你来|让你来|你来|你来不/,
  /找你有事|有事找|有事情找|事情找|传话|叫你去|你去不|你去吗|去不去|你去一趟|你去一下/,
  /(?<![有])找你|找一下/,
  /麻烦.{0,6}去/,
  /您去一下/,
  /(去|到|往).{0,8}(那边|那里|那儿)/,
  /(可以去|过去).{0,12}(那边|那里|那儿)/,
  /(那边|那里|那儿).{0,16}(你去|去不|走去|过去|去吗)/,
  /过去/,
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

const INSULT_MARKERS = [
  "粗鲁",
  "丑",
  "滚",
  "蠢",
  "有病",
  "变态",
  "活该",
  "什么玩意",
  "傻",
  "废物",
  "去死",
  "讨厌",
  "笨蛋",
  "侮辱",
  "辱骂",
];

const HELP_OFFER_RE = /(?:我可以|我能|我愿意|我想|我来|让我)(?:帮|协助)/;
/** Avoid narrative false positives (帮别人 / 帮腔) — 帮 + request pronoun/cue only. */
const HELP_REQUEST_FALLBACK_RE = /帮[我你他她它个一上下把忙]/;

/** Player volunteers to help the NPC — not a help request. Mirrors social_turn.player_offers_help */
export function playerOffersHelp(message: string): boolean {
  const msg = (message || "").trim();
  if (!msg) return false;
  if (HELP_OFFER_RE.test(msg)) return true;
  if (msg.startsWith("我帮你")) return true;
  if (msg.startsWith("帮你")) return true;
  return false;
}

function messageImpliesHelpRequest(message: string): boolean {
  const msg = (message || "").trim();
  if (!msg || playerOffersHelp(msg)) return false;
  if (
    ["帮帮我", "帮个忙", "请帮", "你能帮", "能帮我", "能请你帮", "帮忙"].some((marker) =>
      msg.includes(marker),
    )
  ) {
    return true;
  }
  if (HELP_REQUEST_FALLBACK_RE.test(msg)) return true;
  if (!msg.includes("请")) return false;
  const normalized = msg.replace(/回复/g, "").replace(/请假/g, "");
  return normalized.includes("请");
}

export function playerRequestsMove(message: string): boolean {
  const text = (message || "").trim();
  if (!text) return false;
  return MOVE_PATTERNS.some((p) => p.test(text));
}

export function playerRequestsInteract(message: string): boolean {
  const text = (message || "").trim();
  if (!text) return false;
  return INTERACT_PATTERNS.some((p) => p.test(text));
}

export function playerRequestsPhysicalAction(message: string): boolean {
  return playerRequestsMove(message) || playerRequestsInteract(message);
}

export function isRecallQuestion(message: string): boolean {
  const msg = (message || "").trim();
  if (!msg) return false;
  return RECALL_MARKERS.some((marker) => msg.includes(marker));
}

/** Heuristic social edge — mirrors collective/social_turn.infer_social_from_message */
export function inferSocialFromMessage(message: string): "rude" | "help" | null {
  const msg = (message || "").trim();
  if (!msg) return null;
  if (INSULT_MARKERS.some((marker) => msg.includes(marker))) return "rude";
  if (messageImpliesHelpRequest(msg)) return "help";
  return null;
}

/** Pure greeting only — excludes "你好狂啊" etc. that merely start with 你好. */
export function isCasualGreetingOnly(message: string): boolean {
  const msg = (message || "").trim();
  if (!msg) return false;
  return CASUAL_GREETING_ONLY_RE.test(msg);
}

export function classifySpeakIntent(
  message: string,
  recentTurns?: readonly DialogueTurn[] | null,
): SpeakIntentValue {
  const msg = (message || "").trim();
  if (!msg) return SpeakIntent.NARRATIVE;
  if (playerRequestsPhysicalAction(msg)) return SpeakIntent.PHYSICAL;
  if (isRecallQuestion(msg)) return SpeakIntent.RECALL;
  if (recentTurns?.length && msg.length < 20 && inferSocialFromMessage(msg) === null) {
    return SpeakIntent.NARRATIVE;
  }
  if (inferSocialFromMessage(msg) !== null) return SpeakIntent.SOCIAL_EDGE;
  if (isCasualGreetingOnly(msg)) return SpeakIntent.CASUAL;
  if (META_BRIEF_RE.test(msg)) return SpeakIntent.CASUAL;
  if (NARRATIVE_MARKERS.some((marker) => msg.includes(marker))) return SpeakIntent.NARRATIVE;
  return SpeakIntent.NARRATIVE;
}

export function shouldSkipMemoryContext(intent: SpeakIntentValue): boolean {
  return intent === SpeakIntent.PHYSICAL || intent === SpeakIntent.CASUAL;
}
