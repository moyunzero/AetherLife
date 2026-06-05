/** Player message blocklist — keep in sync with apps/ai-gateway/app/guards/content.py */
export const CONTENT_BLOCKED_CODE = "content_blocked" as const;
export const CONTENT_BLOCKED_MESSAGE = "无法处理该内容" as const;
export const MAX_PLAYER_MESSAGE_LEN = 2000;

const BLOCKLIST_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /system\s+prompt/i,
  /<\s*script/i,
  /\bjailbreak\b/i,
  /\bkill\s+all\b/i,
];

export type ContentCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export function checkPlayerMessageContent(text: string): ContentCheckResult {
  if (text.length > MAX_PLAYER_MESSAGE_LEN) {
    return { allowed: false, reason: "message too long" };
  }
  for (const pat of BLOCKLIST_PATTERNS) {
    if (pat.test(text)) {
      return { allowed: false, reason: "blocklist match" };
    }
  }
  return { allowed: true };
}

export function contentBlockedPayload(): {
  code: typeof CONTENT_BLOCKED_CODE;
  message: typeof CONTENT_BLOCKED_MESSAGE;
} {
  return { code: CONTENT_BLOCKED_CODE, message: CONTENT_BLOCKED_MESSAGE };
}
