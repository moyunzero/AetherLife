const DEFAULT_IMPORTANCE = 5;

function clampImportance(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_IMPORTANCE;
  return Math.min(10, Math.max(1, Math.round(value)));
}

function parseImportanceFromContent(content: string): number | null {
  const trimmed = content.trim();
  try {
    const parsed = JSON.parse(trimmed) as { importance?: unknown };
    if (typeof parsed.importance === "number") {
      return clampImportance(parsed.importance);
    }
  } catch {
    const match = trimmed.match(/\b([1-9]|10)\b/);
    if (match) return clampImportance(Number(match[1]));
  }
  return null;
}

export async function scoreImportance(text: string): Promise<number> {
  if (process.env.LLM_MOCK === "1" || process.env.VITEST === "true") {
    return DEFAULT_IMPORTANCE;
  }

  const provider = (process.env.LLM_PROVIDER ?? "openrouter").toLowerCase();
  const model = process.env.LLM_MODEL ?? "openrouter/free";
  let baseUrl = "https://openrouter.ai/api/v1";
  let apiKey = process.env.OPENROUTER_API_KEY;

  if (provider === "groq") {
    baseUrl = "https://api.groq.com/openai/v1";
    apiKey = process.env.GROQ_API_KEY;
  }

  if (!apiKey) {
    return DEFAULT_IMPORTANCE;
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            'Rate the long-term importance of this NPC memory from 1 (trivial) to 10 (critical). Reply JSON only: {"importance":N}',
        },
        { role: "user", content: text.slice(0, 500) },
      ],
    }),
  });

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = body.choices?.[0]?.message?.content ?? "";
  return parseImportanceFromContent(content) ?? DEFAULT_IMPORTANCE;
}
