/**
 * OpenAI-compatible chat completion for GSD cross-AI plan review.
 * Used by Agnes API and NVIDIA NIM (same pattern as Ollama in gsd-core review.md).
 */

import { readFileSync } from "node:fs";

/** @param {Response} res */
export async function readApiError(res) {
  const text = await res.text();
  try {
    const body = JSON.parse(text);
    const msg = body?.error?.message ?? body?.message ?? JSON.stringify(body);
    return String(msg).slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.prompt - full user message (review prompt)
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @param {Record<string, string>} [opts.extraHeaders]
 * @param {Record<string, unknown>} [opts.extraBody]
 * @returns {Promise<{ ok: boolean, content: string, latencyMs: number, error?: string, status?: number, modelReturned?: string }>}
 */
export async function runOpenAiReview({
  baseUrl,
  apiKey,
  model,
  prompt,
  timeoutMs = 180_000,
  maxTokens = 8192,
  temperature = 0.2,
  extraHeaders = {},
  extraBody = {},
}) {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        ...extraBody,
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    const latencyMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      content: "",
      latencyMs,
      error: message.includes("abort") ? `timeout ${timeoutMs}ms` : message.slice(0, 400),
    };
  }
  clearTimeout(timer);

  const latencyMs = Date.now() - started;
  if (!res.ok) {
    return {
      ok: false,
      content: "",
      latencyMs,
      status: res.status,
      error: await readApiError(res),
    };
  }

  const body = await res.json();
  const content = String(body?.choices?.[0]?.message?.content ?? "").trim();
  if (!content) {
    return {
      ok: false,
      content: "",
      latencyMs,
      status: res.status,
      error: "empty content in choices[0].message",
      modelReturned: body?.model ?? model,
    };
  }

  return {
    ok: true,
    content,
    latencyMs,
    status: res.status,
    modelReturned: body?.model ?? model,
  };
}

/** @param {string} promptFile */
export function readPromptFile(promptFile) {
  return readFileSync(promptFile, "utf8");
}

/**
 * Quick connectivity probe (pong).
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {number} [opts.timeoutMs]
 */
export async function probeOpenAiProvider({ baseUrl, apiKey, model, timeoutMs = 60_000 }) {
  return runOpenAiReview({
    baseUrl,
    apiKey,
    model,
    prompt: "Reply with exactly: pong",
    timeoutMs,
    maxTokens: 16,
    temperature: 0,
  });
}
