/**
 * Phase 27 E2E — Personal life timeline ship gate (BIO-04/06/10).
 *
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real API keys in .env.
 * Never run with LLM_MOCK=1 or dev:stack:mock — see docs/E2E-POLICY.md.
 *
 * Flow: health → dedicated room → GET seeds (≥1/npc, year-0 labels with month) →
 * force hammer / multi-perspective path → poll ≥2 NPCs same eventAnchorId,
 * divergent bodies → calendar label contains season+month.
 *
 * Timeout: VERIFY_PHASE27_TIMEOUT_MS (default 900000).
 *
 * Task 1 scaffold: real-LLM gate + TODO assertion stubs (fail until Task 2 wires).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertE2eRealLlm } from "./lib/e2e-policy.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE27_ROOM_ID || `verify-p27-${Date.now()}`;

/** @returns {Record<string, string>} */
function internalHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function healthOk() {
  const gsRes = await fetch(`${httpBase}/health`, { signal: AbortSignal.timeout(8000) });
  if (!gsRes.ok) throw new Error(`game-server health ${gsRes.status}`);
  const webRes = await fetch(webBase, { signal: AbortSignal.timeout(8000) });
  if (!webRes.ok) throw new Error(`web ${webBase} → ${webRes.status}`);
}

/**
 * TODO Task 2: GET personal-timeline seeds ≥1 per npc with 太乙元年 + month.
 * @returns {Promise<void>}
 */
async function assertSeedsYearZeroWithMonth() {
  throw new Error(
    "TODO(27-07 Task 2): assertSeedsYearZeroWithMonth — GET seeds ≥1/npc year-0 labels with month",
  );
}

/**
 * TODO Task 2: force multi path → ≥2 NPCs share eventAnchorId with different bodies.
 * @returns {Promise<void>}
 */
async function assertMultiPerspectiveDivergence() {
  throw new Error(
    "TODO(27-07 Task 2): assertMultiPerspectiveDivergence — shared eventAnchorId, divergent bodies",
  );
}

/**
 * TODO Task 2: calendar label contains season + month (e.g. 春·1月).
 * @returns {Promise<void>}
 */
async function assertCalendarLabelSeasonMonth() {
  throw new Error(
    "TODO(27-07 Task 2): assertCalendarLabelSeasonMonth — season+month in calendarLabel",
  );
}

async function main() {
  assertE2eRealLlm("verify:phase27");
  const started = Date.now();
  console.log(`[verify:phase27] room=${roomId} http=${httpBase}`);

  await healthOk();
  console.log("[verify:phase27] health ok");

  // Touch room create so seeds can land (Task 2 will assert).
  const stateRes = await fetch(`${httpBase}/rooms/${encodeURIComponent(roomId)}/state`, {
    headers: { "X-Player-Id": "verify-p27-player" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!stateRes.ok) {
    throw new Error(`room state ${stateRes.status}`);
  }
  console.log("[verify:phase27] room ready");

  await assertSeedsYearZeroWithMonth();
  await assertMultiPerspectiveDivergence();
  await assertCalendarLabelSeasonMonth();

  console.log(
    `[verify:phase27] PASS in ${((Date.now() - started) / 1000).toFixed(1)}s (internalHeaders ready=${Boolean(internalHeaders().Authorization)})`,
  );
}

main().catch((err) => {
  console.error("[verify:phase27] FAIL:", err instanceof Error ? err.message : err);
  console.error("Ensure full stack: pnpm dev:stack (no LLM_MOCK). Game-server :2567, web :5173.");
  process.exit(1);
});
