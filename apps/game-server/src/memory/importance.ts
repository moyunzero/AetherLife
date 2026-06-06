import { openRouterKeys } from "./openRouterKeys.js";

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

function resolveProvider(): {
  baseUrl: string;
  apiKeys: string[];
} {
  const provider = (process.env.LLM_PROVIDER ?? "openrouter").toLowerCase();
  if (provider === "groq") {
    const key = process.env.GROQ_API_KEY;
    return {
      baseUrl: "https://api.groq.com/openai/v1",
      apiKeys: key ? [key] : [],
    };
  }
  if (provider === "agnes") {
    const key = process.env.AGNES_API_KEY;
    return {
      baseUrl: "https://apihub.agnes-ai.com/v1",
      apiKeys: key ? [key] : [],
    };
  }
  if (provider === "zhipu") {
    const key = process.env.ZHIPU_API_KEY;
    return {
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKeys: key ? [key] : [],
    };
  }
  return {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeys: openRouterKeys(),
  };
}

async function scoreWithKey(
  text: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<number> {
  const isZhipu = baseUrl.includes("bigmodel.cn");
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      ...(isZhipu ? { thinking: { type: "disabled" } } : {}),
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
    error?: { message?: string };
  };

  if (!res.ok) {
    const err = new Error(body.error?.message ?? `importance failed: ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  const content = body.choices?.[0]?.message?.content ?? "";
  return parseImportanceFromContent(content) ?? DEFAULT_IMPORTANCE;
}

/** OpenRouter 429 → try next key; exported for unit tests. */
export async function scoreImportanceWithKeys(
  text: string,
  apiKeys: string[],
  baseUrl: string,
  model: string,
): Promise<number> {
  if (apiKeys.length === 0) {
    return DEFAULT_IMPORTANCE;
  }

  let lastError: unknown;
  for (let i = 0; i < apiKeys.length; i += 1) {
    try {
      return await scoreWithKey(text, apiKeys[i]!, baseUrl, model);
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      if (status === 429 && i + 1 < apiKeys.length) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export async function scoreImportance(text: string): Promise<number> {
  if (process.env.LLM_MOCK === "1" || process.env.VITEST === "true") {
    return DEFAULT_IMPORTANCE;
  }

  const model = process.env.LLM_MODEL ?? "openrouter/free";
  const { baseUrl, apiKeys } = resolveProvider();
  return scoreImportanceWithKeys(text, apiKeys, baseUrl, model);
}
