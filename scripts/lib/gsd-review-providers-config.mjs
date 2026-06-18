/**
 * GSD review OpenAI-provider config — merged from .planning/config.json + env.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @param {unknown} value @param {number} fallback */
function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** @param {string} dir @param {string} rootDir */
function assertUnderPhasesRoot(dir, rootDir) {
  const resolved = resolve(dir);
  const rootResolved = resolve(rootDir);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) {
    throw new Error(`Phase path escapes .planning/phases: ${dir}`);
  }
  return resolved;
}

/** @typedef {object} ProviderSpec
 * @property {string} slug
 * @property {string} label
 * @property {string} baseUrl
 * @property {string} apiKeyEnv
 * @property {string} modelEnv
 * @property {string} modelDefault
 * @property {number} timeoutMs
 * @property {number} maxTokens
 */

/** @type {Record<string, ProviderSpec>} */
export const DEFAULT_OPENAI_PROVIDERS = {
  agnes: {
    slug: "agnes",
    label: "Agnes",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    apiKeyEnv: "AGNES_API_KEY",
    modelEnv: "GSD_REVIEW_MODEL_AGNES",
    modelDefault: "agnes-2.0-flash",
    timeoutMs: 180_000,
    maxTokens: 8192,
  },
  nvidia: {
    slug: "nvidia",
    label: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKeyEnv: "NVIDIA_API_KEY",
    modelEnv: "GSD_REVIEW_MODEL_NVIDIA",
    modelDefault: "meta/llama-3.3-70b-instruct",
    timeoutMs: 180_000,
    maxTokens: 8192,
  },
};

/** @returns {Record<string, ProviderSpec>} */
export function loadOpenAiProviders() {
  loadRootEnv(root);
  /** @type {Record<string, Partial<ProviderSpec> & Record<string, unknown>>} */
  let fromConfig = {};
  const configPath = resolve(root, ".planning/config.json");
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      fromConfig = cfg?.review?.openai_providers ?? {};
    } catch {
      // ignore malformed config
    }
  }

  /** @type {Record<string, ProviderSpec>} */
  const merged = {};
  for (const [slug, defaults] of Object.entries(DEFAULT_OPENAI_PROVIDERS)) {
    const override = fromConfig[slug] ?? {};
    merged[slug] = {
      ...defaults,
      slug,
      label: String(override.label ?? defaults.label),
      baseUrl: String(
        override.base_url ?? override.baseUrl ?? defaults.baseUrl,
      ),
      apiKeyEnv: String(
        override.api_key_env ?? override.apiKeyEnv ?? defaults.apiKeyEnv,
      ),
      modelEnv: String(
        override.model_env ?? override.modelEnv ?? defaults.modelEnv,
      ),
      modelDefault: String(
        override.model_default ?? override.modelDefault ?? defaults.modelDefault,
      ),
      timeoutMs: positiveInt(
        override.timeout_ms ?? override.timeoutMs,
        defaults.timeoutMs,
      ),
      maxTokens: positiveInt(
        override.max_tokens ?? override.maxTokens,
        defaults.maxTokens,
      ),
    };
  }
  return merged;
}

/** @param {ProviderSpec} spec */
export function resolveProviderRuntime(spec) {
  const apiKey = (process.env[spec.apiKeyEnv] ?? "").trim();
  const model =
    (process.env[spec.modelEnv] ?? "").trim() || spec.modelDefault;
  return { apiKey, model };
}

/** @param {string} phaseArg e.g. "20" or "20-memory-speak-trust" */
export function resolvePhaseDir(phaseArg) {
  const phasesRoot = resolve(root, ".planning/phases");
  if (!existsSync(phasesRoot)) {
    throw new Error("Missing .planning/phases/");
  }
  const normalized = String(phaseArg).trim();
  if (normalized.includes("-")) {
    const dir = assertUnderPhasesRoot(resolve(phasesRoot, normalized), phasesRoot);
    if (existsSync(dir)) return dir;
  }
  const match = readdirSync(phasesRoot).find(
    (d) =>
      d === normalized ||
      d.startsWith(`${normalized}-`) ||
      d.startsWith(`${normalized.replace(/^0+/, "")}-`),
  );
  if (!match) {
    throw new Error(
      `No phase directory for "${phaseArg}" under .planning/phases/`,
    );
  }
  return assertUnderPhasesRoot(resolve(phasesRoot, match), phasesRoot);
}

/** @param {string} phaseDir */
export function phaseNumberFromDir(phaseDir) {
  const base = phaseDir.split("/").pop() ?? "";
  const m = base.match(/^(\d+(?:\.\d+)?)/);
  return m ? m[1] : base;
}

/** @param {string} phase */
export function defaultPromptPath(phase) {
  const compact = String(phase).replace(/\./g, "");
  return `/tmp/gsd-review-prompt-${compact}.md`;
}

/** @param {string} slug @param {string} phase */
export function defaultOutputPath(slug, phase) {
  const compact = String(phase).replace(/\./g, "");
  return `/tmp/gsd-review-${slug}-${compact}.md`;
}

export { root as repoRoot };
