/**
 * Phase 28 E2E — Council relationship advanced ship gate (D-VERIFY-01).
 *
 * Wave 0 scaffold: real-LLM gate + health + dedicated room.
 * TODO (plan 12): mutual-chat activity/bubble smoke + 关系网 tab/band chips.
 *
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real API keys in .env.
 * Never run with LLM_MOCK=1 or dev:stack:mock — see docs/E2E-POLICY.md.
 *
 * Timeout: VERIFY_PHASE28_TIMEOUT_MS (default 900000).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertE2eRealLlm } from "./lib/e2e-policy.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE28_ROOM_ID || `verify-p28-${Date.now()}`;
const phaseTimeoutMs =
  Number.parseInt(process.env.VERIFY_PHASE28_TIMEOUT_MS || "900000", 10) || 900_000;

function publicHeaders(playerId = "verify-p28-player") {
  return { "X-Player-Id": playerId };
}

async function healthOk() {
  const gsRes = await fetch(`${httpBase}/health`, { signal: AbortSignal.timeout(8000) });
  if (!gsRes.ok) throw new Error(`game-server health ${gsRes.status}`);
  const gsBody = await gsRes.json().catch(() => ({}));
  if (gsBody.service !== "game-server" && gsBody.status !== "ok" && gsBody.ok !== true) {
    throw new Error("game-server unexpected health body");
  }
  const webRes = await fetch(webBase, { signal: AbortSignal.timeout(8000) });
  if (!webRes.ok) throw new Error(`web ${webBase} → ${webRes.status}`);
}

async function ensureRoom() {
  const res = await fetch(`${httpBase}/rooms/${encodeURIComponent(roomId)}/state`, {
    headers: publicHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`room state ${res.status}`);
}

/**
 * TODO plan 12 (D-VERIFY-01): at least one NPC mutual-chat activity / bubble smoke.
 * Placeholder keeps Wave 0 script importable and health-gated.
 */
async function assertMutualChatSmokeTodo() {
  console.log(
    "[verify:phase28] TODO plan 12: mutual-chat activity/bubble smoke (D-MUTUAL-02 / D-VERIFY-01)",
  );
}

/**
 * TODO plan 12 (D-VERIFY-01 / D-GRAPH-02): 关系网 tab renders band chips (no raw integers).
 */
async function assertRelationshipGraphTodo() {
  console.log(
    "[verify:phase28] TODO plan 12: 关系网 tab + band chips via GET npc-relationships (D-GRAPH-01/02)",
  );
}

async function main() {
  const t0 = Date.now();
  assertE2eRealLlm("verify:phase28");

  console.log(
    `[verify:phase28] room=${roomId} http=${httpBase} timeoutMs=${phaseTimeoutMs}`,
  );

  await healthOk();
  console.log("[verify:phase28] health ok");

  await ensureRoom();
  console.log("[verify:phase28] room ready");

  await assertMutualChatSmokeTodo();
  await assertRelationshipGraphTodo();

  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[verify:phase28] SCAFFOLD PASS in ${elapsedSec}s (asserts filled in plan 12)`,
  );
}

main().catch((err) => {
  console.error("[verify:phase28] FAIL:", err instanceof Error ? err.message : err);
  console.error("Ensure full stack: pnpm dev:stack (no LLM_MOCK). Game-server :2567, web :5173.");
  process.exit(1);
});
