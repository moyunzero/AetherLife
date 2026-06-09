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

/** Memory importance — NVIDIA nano by default; never Zhipu (concurrency=1). */
function resolveImportanceProvider(): {
  baseUrl: string;
  apiKeys: string[];
  model: string;
} {
  const provider = (
    process.env.LLM_PROVIDER_IMPORTANCE ??
    process.env.LLM_PROVIDER_REFLECT ??
    "nvidia"
  ).toLowerCase();
  const model =
    process.env.LLM_MODEL_IMPORTANCE ??
    process.env.LLM_MODEL_NVIDIA_NANO ??
    "nvidia/llama-3.1-nemotron-nano-8b-v1";

  if (provider === "groq") {
    const key = process.env.GROQ_API_KEY;
    return {
      baseUrl: "https://api.groq.com/openai/v1",
      apiKeys: key ? [key] : [],
      model,
    };
  }
  if (provider === "agnes") {
    const key = process.env.AGNES_API_KEY;
    return {
      baseUrl: "https://apihub.agnes-ai.com/v1",
      apiKeys: key ? [key] : [],
      model:
        process.env.LLM_MODEL_REFLECT ??
        process.env.LLM_MODEL_IMPORTANCE ??
        "agnes-2.0-flash",
    };
  }
  if (provider === "zhipu") {
    const key = process.env.ZHIPU_API_KEY;
    return {
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKeys: key ? [key] : [],
      model: process.env.LLM_MODEL ?? model,
    };
  }
  if (provider === "siliconflow") {
    const key = process.env.SILICONFLOW_API_KEY;
    return {
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKeys: key ? [key] : [],
      model:
        process.env.LLM_MODEL_SILICONFLOW_FAST ??
        process.env.LLM_MODEL_IMPORTANCE ??
        "Qwen/Qwen3.5-4B",
    };
  }
  if (provider === "nvidia") {
    const key = process.env.NVIDIA_API_KEY;
    return {
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKeys: key ? [key] : [],
      model,
    };
  }
  if (provider === "cerebras") {
    const key = process.env.CEREBRAS_API_KEY;
    return {
      baseUrl: "https://api.cerebras.ai/v1",
      apiKeys: key ? [key] : [],
      model: process.env.LLM_MODEL_CEREBRAS ?? model,
    };
  }
  return {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeys: openRouterKeys(),
    model: process.env.LLM_MODEL_OPENROUTER_FALLBACK ?? "openai/gpt-oss-120b:free",
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

/** OpenRouter 429 → try next key; on exhaustion return default (P1). Exported for unit tests. */
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
      if (status === 429) {
        console.warn(
          "[memory] scoreImportance rate-limited; using default importance",
        );
        return DEFAULT_IMPORTANCE;
      }
      throw err;
    }
  }
  if (lastError) {
    const status = (lastError as { status?: number }).status;
    if (status === 429) {
      console.warn(
        "[memory] scoreImportance rate-limited; using default importance",
      );
      return DEFAULT_IMPORTANCE;
    }
    throw lastError;
  }
  return DEFAULT_IMPORTANCE;
}

export async function scoreImportance(text: string): Promise<number> {
  if (process.env.LLM_MOCK === "1" || process.env.VITEST === "true") {
    return DEFAULT_IMPORTANCE;
  }

  const { baseUrl, apiKeys, model } = resolveImportanceProvider();
  return scoreImportanceWithKeys(text, apiKeys, baseUrl, model);
}
