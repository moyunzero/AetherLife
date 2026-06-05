/**
 * E2E / UAT policy — real LLM only. See docs/E2E-POLICY.md
 */

const E2E_DOC = "docs/E2E-POLICY.md";

/** @returns {void} */
export function assertE2eNoMock(scriptName) {
  if (process.env.LLM_MOCK === "1") {
    throw new Error(
      `${scriptName}: LLM_MOCK=1 is forbidden for E2E/UAT. ` +
        `Use pnpm dev:stack (real worker). See ${E2E_DOC}`,
    );
  }
}

/** @returns {void} */
export function assertE2eLlmConfigured(scriptName) {
  if (process.env.SKIP_E2E_LLM_CHECK === "1") return;
  const hasKey =
    process.env.OPENROUTER_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.AGNES_API_KEY;
  if (!hasKey) {
    throw new Error(
      `${scriptName}: E2E requires a live LLM API key ` +
        `(OPENROUTER_API_KEY / GROQ_API_KEY / AGNES_API_KEY). See ${E2E_DOC}`,
    );
  }
}

/** No mock + live LLM key (chat / speak / embed E2E). */
export function assertE2eRealLlm(scriptName) {
  assertE2eNoMock(scriptName);
  assertE2eLlmConfigured(scriptName);
}

/** Speak / NL turn timeout for real models (ms). */
export function e2eSpeakTimeoutMs() {
  const raw = Number(process.env.E2E_SPEAK_TIMEOUT_MS || 180_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 180_000;
}
