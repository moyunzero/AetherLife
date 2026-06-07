/**
 * Probe every LLM/embedding model configured in root .env (real API calls).
 * Does NOT use LLM_MOCK. Safe to run locally; never prints API keys.
 *
 * Usage: pnpm verify:llm-models
 * Optional: OUT=docs/LLM-MODEL-VERIFY.md node scripts/verify-llm-models.mjs  (append run section)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EMBED_DIM = 2048;

/** @param {string} path */
function loadEnv(path) {
  if (!existsSync(path)) {
    console.error("Missing .env — copy .env.example and fill API keys.");
    process.exit(1);
  }
  /** @type {Record<string, string>} */
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, eq).trim()] = value;
  }
  return env;
}

/** @param {Record<string, string>} env @param {string} provider */
function resolveLoreFallbackModel(env, provider) {
  const explicit = (env.LLM_MODEL_LORE_FALLBACK ?? "").trim();
  if (explicit) return explicit;
  switch (provider) {
    case "nvidia":
      return env.LLM_MODEL_NVIDIA_LORE ?? "nvidia/llama-3.3-nemotron-super-49b-v1.5";
    case "siliconflow":
      return env.LLM_MODEL_SILICONFLOW_REASON ?? "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B";
    case "zhipu":
      return "glm-4.7-flash";
    case "cerebras":
      return env.LLM_MODEL_CEREBRAS ?? "gpt-oss-120b";
    case "agnes":
      return env.LLM_MODEL_REFLECT ?? "agnes-2.0-flash";
    case "groq":
      return "llama-3.1-8b-instant";
    case "openrouter":
      return env.LLM_MODEL_OPENROUTER_FALLBACK ?? "openrouter/free";
    default:
      return env.LLM_MODEL ?? "glm-4.7-flash";
  }
}

/** @param {unknown} err */
function errMessage(err) {
  if (err instanceof Error) return err.message.slice(0, 240);
  return String(err).slice(0, 240);
}

/** @param {Response} res */
async function readApiError(res) {
  const text = await res.text();
  try {
    const body = JSON.parse(text);
    const msg = body?.error?.message ?? body?.message ?? JSON.stringify(body);
    return String(msg).slice(0, 240);
  } catch {
    return text.slice(0, 240);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {Record<string, string>} [opts.extraHeaders]
 * @param {Record<string, unknown>} [opts.extraBody]
 */
async function probeChat({ baseUrl, apiKey, model, extraHeaders = {}, extraBody = {} }) {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{ role: "user", content: "Reply with exactly: pong" }],
      ...extraBody,
      ...(Object.prototype.hasOwnProperty.call(extraBody, "max_completion_tokens")
        ? {}
        : { max_tokens: 16 }),
    }),
  });
  const latencyMs = Date.now() - started;
  if (!res.ok) {
    return { ok: false, latencyMs, error: await readApiError(res), status: res.status };
  }
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content ?? "";
  return {
    ok: true,
    latencyMs,
    status: res.status,
    preview: String(content).trim().slice(0, 80),
    modelReturned: body?.model ?? model,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.apiKey
 * @param {string} opts.model
 */
async function probeEmbed({ baseUrl, apiKey, model }) {
  const url = `${baseUrl.replace(/\/$/, "")}/embeddings`;
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: "llm model verify probe" }),
  });
  const latencyMs = Date.now() - started;
  if (!res.ok) {
    return { ok: false, latencyMs, error: await readApiError(res), status: res.status };
  }
  const body = await res.json();
  const dim = body?.data?.[0]?.embedding?.length ?? 0;
  return {
    ok: dim === EMBED_DIM,
    latencyMs,
    status: res.status,
    dimensions: dim,
    error: dim === EMBED_DIM ? undefined : `expected ${EMBED_DIM}, got ${dim}`,
  };
}

/** @typedef {{ id: string, role: string, provider: string, model: string, keyLabel: string, consumer: string, ok: boolean, latencyMs: number, status?: number, preview?: string, modelReturned?: string, dimensions?: number, error?: string }} ProbeResult */

/** @param {ProbeResult} r */
function formatRow(r) {
  const status = r.ok ? "PASS" : "FAIL";
  const detail = r.ok
    ? r.dimensions != null
      ? `${r.dimensions}d ${r.latencyMs}ms`
      : `"${r.preview ?? ""}" ${r.latencyMs}ms`
    : `HTTP ${r.status ?? "?"} — ${r.error ?? "unknown"}`;
  return `| ${r.id} | ${r.role} | ${r.provider} | \`${r.model}\` | ${r.keyLabel} | ${r.consumer} | **${status}** | ${detail} |`;
}

async function main() {
  const env = loadEnv(resolve(root, ".env"));
  if (env.LLM_MOCK === "1") {
    console.warn("Warning: LLM_MOCK=1 in .env — this script still calls real APIs.");
  }

  const orKey1 = env.OPENROUTER_API_KEY ?? "";
  const orKey2 = env.OPENROUTER_API_KEY_2 ?? "";
  const groqKey = env.GROQ_API_KEY ?? "";
  const agnesKey = env.AGNES_API_KEY ?? "";
  const zhipuKey = env.ZHIPU_API_KEY ?? "";
  const nvidiaKey = env.NVIDIA_API_KEY ?? "";
  const siliconflowKey = env.SILICONFLOW_API_KEY ?? "";
  const cerebrasKey = env.CEREBRAS_API_KEY ?? "";
  const cerebrasModel = env.LLM_MODEL_CEREBRAS ?? "gpt-oss-120b";

  const llmProvider = (env.LLM_PROVIDER ?? "zhipu").toLowerCase();
  const npcModelPin = (env.LLM_MODEL_NPC ?? "").trim();
  const npcModel = npcModelPin || env.LLM_MODEL || "glm-4.7-flash";

  const orHeaders = {
    "HTTP-Referer": env.OPENROUTER_HTTP_REFERER ?? "http://localhost:5173",
    "X-Title": env.OPENROUTER_APP_TITLE ?? "AetherLife",
  };
  const zhipuThinking = { thinking: { type: "disabled" } };

  /** @type {ProbeResult[]} */
  const results = [];
  let seq = 0;
  /** @param {Omit<ProbeResult, "id"> & { id?: string }} partial */
  function push(partial) {
    seq += 1;
    results.push({ id: partial.id ?? String(seq).padStart(2, "0"), ...partial });
  }

  const fallbacks = (env.LLM_MODEL_FALLBACKS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // --- Zhipu NPC primary (LLM_PROVIDER=zhipu) ---
  if (llmProvider === "zhipu") {
    if (!zhipuKey) {
      push({
        role: "NPC chat (primary)",
        provider: "zhipu",
        model: npcModel,
        keyLabel: "ZHIPU_API_KEY",
        consumer: "worker npc_loop; summarize; importance",
        ok: false,
        latencyMs: 0,
        error: "missing ZHIPU_API_KEY",
      });
    } else {
      push({
        role: "NPC chat (primary)",
        provider: "zhipu",
        model: npcModel,
        keyLabel: "ZHIPU_API_KEY",
        consumer: "worker npc_loop; summarize; importance; game-server importance",
        ...(await probeChat({
          baseUrl: "https://open.bigmodel.cn/api/paas/v4",
          apiKey: zhipuKey,
          model: npcModel,
          extraBody: zhipuThinking,
        })),
      });
    }
  }

  // --- OpenRouter NPC primary + fallbacks (when provider is openrouter) ---
  if (llmProvider === "openrouter") {
    if (!orKey1) {
      push({
        role: "NPC chat (primary)",
        provider: "openrouter",
        model: npcModel,
        keyLabel: "OPENROUTER_API_KEY",
        consumer: "worker npc_loop; ai-gateway parse_intent",
        ok: false,
        latencyMs: 0,
        error: "missing OPENROUTER_API_KEY",
      });
    } else {
      push({
        role: "NPC chat (primary)",
        provider: "openrouter",
        model: npcModel,
        keyLabel: "OPENROUTER_API_KEY",
        consumer: "worker npc_loop; ai-gateway parse_intent",
        ...(await probeChat({
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: orKey1,
          model: npcModel,
          extraHeaders: orHeaders,
        })),
      });
      for (const model of fallbacks) {
        push({
          role: "NPC fallback",
          provider: "openrouter",
          model,
          keyLabel: "OPENROUTER_API_KEY",
          consumer: "worker npc_loop models_to_try",
          ...(await probeChat({
            baseUrl: "https://openrouter.ai/api/v1",
            apiKey: orKey1,
            model,
            extraHeaders: orHeaders,
          })),
        });
      }
    }
  }

  // --- OpenRouter key 2 smoke (when OpenRouter is primary or embed failover) ---
  if (orKey2 && llmProvider === "openrouter") {
    push({
      role: "NPC chat (key 2)",
      provider: "openrouter",
      model: npcModel,
      keyLabel: "OPENROUTER_API_KEY_2",
      consumer: "worker npc_loop / lore / embed failover",
      ...(await probeChat({
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: orKey2,
        model: npcModel,
        extraHeaders: orHeaders,
      })),
    });
  }

  // --- Reflect (Agnes) ---
  const reflectModel = env.LLM_MODEL_REFLECT ?? "agnes-2.0-flash";
  if (!agnesKey) {
    push({
      role: "Memory reflect",
      provider: "agnes",
      model: reflectModel,
      keyLabel: "AGNES_API_KEY",
      consumer: "worker reflect.py",
      ok: false,
      latencyMs: 0,
      error: "missing AGNES_API_KEY",
    });
  } else {
    push({
      role: "Memory reflect",
      provider: "agnes",
      model: reflectModel,
      keyLabel: "AGNES_API_KEY",
      consumer: "worker reflect.py",
      ...(await probeChat({
        baseUrl: "https://apihub.agnes-ai.com/v1",
        apiKey: agnesKey,
        model: reflectModel,
      })),
    });
  }

  // --- Lore T1 / T0 (LLM_PROVIDER_LORE) ---
  const loreProvider = (env.LLM_PROVIDER_LORE ?? env.LLM_PROVIDER ?? "openrouter").toLowerCase();
  const loreT1 = env.LLM_MODEL_LORE_T1 ?? "agnes-2.0-flash";
  const loreT0 = env.LLM_MODEL_LORE_T0 ?? "agnes-2.0-flash";
  /** @type {Record<string, { baseUrl: string, key: string, keyLabel: string, extraHeaders?: Record<string, string> }>} */
  const loreProviderConfig = {
    groq: { baseUrl: "https://api.groq.com/openai/v1", key: groqKey, keyLabel: "GROQ_API_KEY" },
    agnes: { baseUrl: "https://apihub.agnes-ai.com/v1", key: agnesKey, keyLabel: "AGNES_API_KEY" },
    openrouter: {
      baseUrl: "https://openrouter.ai/api/v1",
      key: orKey1,
      keyLabel: "OPENROUTER_API_KEY",
      extraHeaders: orHeaders,
    },
    zhipu: {
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      key: zhipuKey,
      keyLabel: "ZHIPU_API_KEY",
    },
    cerebras: {
      baseUrl: "https://api.cerebras.ai/v1",
      key: cerebrasKey,
      keyLabel: "CEREBRAS_API_KEY",
    },
    siliconflow: {
      baseUrl: "https://api.siliconflow.cn/v1",
      key: siliconflowKey,
      keyLabel: "SILICONFLOW_API_KEY",
    },
    nvidia: {
      baseUrl: "https://integrate.api.nvidia.com/v1",
      key: nvidiaKey,
      keyLabel: "NVIDIA_API_KEY",
    },
  };
  const loreCfg = loreProviderConfig[loreProvider] ?? loreProviderConfig.openrouter;
  for (const [role, model] of [
    ["Lore T1", loreT1],
    ["Lore T0", loreT0],
  ]) {
    if (!loreCfg.key) {
      push({
        role,
        provider: loreProvider,
        model,
        keyLabel: loreCfg.keyLabel,
        consumer: "worker lore_loop",
        ok: false,
        latencyMs: 0,
        error: `missing ${loreCfg.keyLabel}`,
      });
      continue;
    }
    push({
      role,
      provider: loreProvider,
      model,
      keyLabel: loreCfg.keyLabel,
      consumer: "worker lore_loop (first vs repeat chunk)",
      ...(await probeChat({
        baseUrl: loreCfg.baseUrl,
        apiKey: loreCfg.key,
        model,
        extraHeaders: loreCfg.extraHeaders ?? {},
      })),
    });
  }

  // --- Lore fallback (LLM_PROVIDER_LORE_FALLBACK) ---
  const loreFbProvider = (env.LLM_PROVIDER_LORE_FALLBACK ?? "nvidia").toLowerCase();
  const loreFbModel = resolveLoreFallbackModel(env, loreFbProvider);
  const loreFbCfg = loreProviderConfig[loreFbProvider];
  if (!loreFbCfg) {
    push({
      role: "Lore fallback",
      provider: loreFbProvider,
      model: loreFbModel,
      keyLabel: "UNKNOWN_PROVIDER",
      consumer: "worker lore_loop after primary lore failure",
      ok: false,
      latencyMs: 0,
      error: `unsupported LLM_PROVIDER_LORE_FALLBACK=${loreFbProvider}`,
    });
  } else if (!loreFbCfg.key) {
    push({
      role: "Lore fallback",
      provider: loreFbProvider,
      model: loreFbModel,
      keyLabel: loreFbCfg.keyLabel,
      consumer: "worker lore_loop after primary lore failure",
      ok: false,
      latencyMs: 0,
      error: `missing ${loreFbCfg.keyLabel}`,
    });
  } else {
    push({
      role: "Lore fallback",
      provider: loreFbProvider,
      model: loreFbModel,
      keyLabel: loreFbCfg.keyLabel,
      consumer: "worker lore_loop after primary lore failure",
      ...(await probeChat({
        baseUrl: loreFbCfg.baseUrl,
        apiKey: loreFbCfg.key,
        model: loreFbModel,
        extraHeaders: loreFbCfg.extraHeaders ?? {},
        extraBody: loreFbProvider === "zhipu" ? zhipuThinking : {},
      })),
    });
  }

  // --- Importance JSON (LLM_PROVIDER_IMPORTANCE, Phase 11.7) ---
  const importanceProvider = (env.LLM_PROVIDER_IMPORTANCE ?? "nvidia").toLowerCase();
  const importanceModel =
    env.LLM_MODEL_IMPORTANCE ??
    env.LLM_MODEL_NVIDIA_NANO ??
    "nvidia/llama-3.1-nemotron-nano-8b-v1";
  const importanceCfg = loreProviderConfig[importanceProvider];
  if (!importanceCfg) {
    push({
      role: "Memory importance",
      provider: importanceProvider,
      model: importanceModel,
      keyLabel: "UNKNOWN_PROVIDER",
      consumer: "worker importance.py; game-server importance.ts",
      ok: false,
      latencyMs: 0,
      error: `unsupported LLM_PROVIDER_IMPORTANCE=${importanceProvider}`,
    });
  } else if (!importanceCfg.key) {
    push({
      role: "Memory importance",
      provider: importanceProvider,
      model: importanceModel,
      keyLabel: importanceCfg.keyLabel,
      consumer: "worker importance.py; game-server importance.ts",
      ok: false,
      latencyMs: 0,
      error: `missing ${importanceCfg.keyLabel}`,
    });
  } else {
    push({
      role: "Memory importance",
      provider: importanceProvider,
      model: importanceModel,
      keyLabel: importanceCfg.keyLabel,
      consumer: "worker importance.py; game-server importance.ts",
      ...(await probeChat({
        baseUrl: importanceCfg.baseUrl,
        apiKey: importanceCfg.key,
        model: importanceModel,
        extraHeaders: importanceCfg.extraHeaders ?? {},
      })),
    });
  }

  // --- Social JSON (LLM_PROVIDER_SOCIAL, Phase 11.7) ---
  const socialProvider = (env.LLM_PROVIDER_SOCIAL ?? "siliconflow").toLowerCase();
  const socialModel = env.LLM_MODEL_SOCIAL ?? env.LLM_MODEL_SILICONFLOW_FAST ?? "Qwen/Qwen3.5-4B";
  const socialCfg = loreProviderConfig[socialProvider];
  if (!socialCfg) {
    push({
      role: "NPC social JSON",
      provider: socialProvider,
      model: socialModel,
      keyLabel: "UNKNOWN_PROVIDER",
      consumer: "worker llm_social_turn.py",
      ok: false,
      latencyMs: 0,
      error: `unsupported LLM_PROVIDER_SOCIAL=${socialProvider}`,
    });
  } else if (!socialCfg.key) {
    push({
      role: "NPC social JSON",
      provider: socialProvider,
      model: socialModel,
      keyLabel: socialCfg.keyLabel,
      consumer: "worker llm_social_turn.py",
      ok: false,
      latencyMs: 0,
      error: `missing ${socialCfg.keyLabel}`,
    });
  } else {
    push({
      role: "NPC social JSON",
      provider: socialProvider,
      model: socialModel,
      keyLabel: socialCfg.keyLabel,
      consumer: "worker llm_social_turn.py",
      ...(await probeChat({
        baseUrl: socialCfg.baseUrl,
        apiKey: socialCfg.key,
        model: socialModel,
        extraHeaders: socialCfg.extraHeaders ?? {},
      })),
    });
  }

  // --- Cerebras gpt-oss-120b slot (always probe when key present) ---
  if (!cerebrasKey) {
    push({
      role: "Cerebras chat (reserved)",
      provider: "cerebras",
      model: cerebrasModel,
      keyLabel: "CEREBRAS_API_KEY",
      consumer: "worker factory when LLM_PROVIDER=cerebras or lore/NPC fallback",
      ok: false,
      latencyMs: 0,
      error: "missing CEREBRAS_API_KEY",
    });
  } else {
    push({
      role: "Cerebras chat (reserved)",
      provider: "cerebras",
      model: cerebrasModel,
      keyLabel: "CEREBRAS_API_KEY",
      consumer: "worker factory + client rate limit (5 req/min)",
      ...(await probeChat({
        baseUrl: "https://api.cerebras.ai/v1",
        apiKey: cerebrasKey,
        model: cerebrasModel,
        extraBody: { max_completion_tokens: 16 },
      })),
    });
  }

  // --- Embedding ---
  const embedModel = env.EMBED_MODEL ?? "nvidia/llama-nemotron-embed-vl-1b-v2:free";
  const embedBase = env.EMBED_BASE_URL ?? "https://openrouter.ai/api/v1";
  if (!orKey1) {
    push({
      role: "Memory embed",
      provider: "openrouter",
      model: embedModel,
      keyLabel: "OPENROUTER_API_KEY",
      consumer: "game-server embed.ts → pgvector",
      ok: false,
      latencyMs: 0,
      error: "missing OPENROUTER_API_KEY",
    });
  } else {
    push({
      role: "Memory embed",
      provider: "openrouter",
      model: embedModel,
      keyLabel: "OPENROUTER_API_KEY",
      consumer: "game-server embed.ts → pgvector",
      ...(await probeEmbed({ baseUrl: embedBase, apiKey: orKey1, model: embedModel })),
    });
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const stamp = new Date().toISOString();

  console.log(`\nLLM model probe — ${stamp}`);
  console.log(`Results: ${passed}/${results.length} passed\n`);
  for (const r of results) {
    const mark = r.ok ? "✓" : "✗";
    console.log(
      `${mark} [${r.id}] ${r.role} | ${r.provider}/${r.model} | ${r.keyLabel} | ${r.latencyMs}ms${
        r.ok ? (r.preview ? ` | ${r.preview}` : r.dimensions ? ` | ${r.dimensions}d` : "") : ` | ${r.error}`
      }`,
    );
  }

  const tableHeader = `| # | Role | Provider | Model | Key | Consumer | Result | Detail |
|---|------|----------|-------|-----|----------|--------|--------|`;
  const tableBody = results.map(formatRow).join("\n");

  const mdSection = `
## Run ${stamp}

Command: \`pnpm verify:llm-models\`

Summary: **${passed}/${results.length} passed**, ${failed} failed.

${tableHeader}
${tableBody}
`;

  const outPath = process.env.OUT ? resolve(root, process.env.OUT) : null;
  if (outPath) {
    const marker = "<!-- verify-llm-models:runs -->";
    let existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
    if (!existing.includes(marker)) {
      existing = `${existing.trim()}\n\n${marker}\n`;
    }
    const parts = existing.split(marker);
    writeFileSync(outPath, `${parts[0].trimEnd()}\n\n${marker}\n${mdSection.trim()}\n`, "utf8");
    console.log(`\nWrote latest run to ${outPath}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
