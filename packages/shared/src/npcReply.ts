/** Strip model channel / control tokens from NPC reply text before UI display.
 * Not an HTML sanitizer — player/NPC messages render as React text nodes today.
 * If rich text is added, use a proper HTML escape/sanitize layer in addition. */
export function sanitizeNpcReplyText(text: string): string {
  return text
    .replace(/<\|channel\|>\w*/gi, "")
    .replace(/<\|[^|>]+\|>\w*/gi, "")
    .replace(/<\|[^|>]+\|>/gi, "")
    .replace(/\|channel\|>\w*/gi, "")
    .trim();
}
