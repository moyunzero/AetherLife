/** Primary + secondary OpenRouter keys (deduped, order preserved). */
export function openRouterKeys(): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  const csv = process.env.OPENROUTER_API_KEYS?.split(",") ?? [];
  for (const part of csv) {
    const k = part.trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  for (const k of [process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_API_KEY_2]) {
    if (k && !seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}
