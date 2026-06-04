import { EMBED_DIMENSIONS } from "@aetherlife/npc-memory";

const DEFAULT_MODEL = "nvidia/llama-nemotron-embed-vl-1b-v2:free";
const DEFAULT_BASE = "https://openrouter.ai/api/v1";

function mockEmbed(text: string): number[] {
  const vec = new Array(EMBED_DIMENSIONS).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % EMBED_DIMENSIONS]! += text.charCodeAt(i) / 255;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export async function embedText(text: string): Promise<number[]> {
  if (process.env.LLM_MOCK === "1" || process.env.VITEST === "true") {
    return mockEmbed(text);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY required for embeddings");
  }

  const baseUrl = (process.env.EMBED_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
  const model = process.env.EMBED_MODEL ?? DEFAULT_MODEL;

  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: text }),
  });

  const body = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(body.error?.message ?? `embed failed: ${res.status}`);
  }

  const embedding = body.data?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBED_DIMENSIONS) {
    throw new Error(`unexpected embed dimensions: ${embedding?.length ?? 0}`);
  }

  return embedding;
}
