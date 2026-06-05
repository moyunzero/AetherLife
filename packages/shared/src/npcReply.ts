/** Strip model channel / control tokens from NPC reply text before UI display. */
export function sanitizeNpcReplyText(text: string): string {
  return text
    .replace(/<\|channel\|>\w*/gi, "")
    .replace(/<\|[^|>]+\|>\w*/gi, "")
    .replace(/<\|[^|>]+\|>/gi, "")
    .replace(/\|channel\|>\w*/gi, "")
    .trim();
}
