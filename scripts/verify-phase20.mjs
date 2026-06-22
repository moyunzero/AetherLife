/**
 * Phase 20 E2E — Cross-session memory recall + refusal guard + speak latency smoke (SOLO-01 / SOLO-05).
 *
 * Requires: `pnpm dev:stack` with real LLM API keys in `.env` (no LLM_MOCK, no dev:stack:mock).
 * See docs/E2E-POLICY.md — verify:phase* must use real LLM (glm-4.7-flash concurrency=1 on Zhipu).
 *
 * PHASE20_RELAXED=1 — dev/local only: latency threshold breaches log WARN instead of throw.
 *   Invalid for phase-done / REQUIREMENTS Verified (D-12). Default strict mode throws.
 *
 * Retry policy (D-13): on 429 / LLM timeout / gateway 5xx, one strict rerun after 60s backoff;
 *   phase-done fails only if the second strict run fails. Logs `retry=1 reason=<…>`.
 *
 * No JournalQuestStrip / collective / town loop (D-07, D-08).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertE2eNoMock,
  assertE2eRealLlm,
  e2eSpeakTimeoutMs,
} from "./lib/e2e-policy.mjs";
import { engageDialogue } from "./lib/dialogue-engage.mjs";
import {
  closeShellDrawer,
  openShellDrawerHistory,
  replyRefusesRecall,
  sendSpeakOverlay,
  waitForMemoryContext,
} from "./lib/e2e-memory-helpers.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";

const BOOT_WARN_MS = 5000;
const BOOT_FAIL_MS = 12_000;
const RETRY_BACKOFF_MS = 60_000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const gwBase = process.env.AI_GATEWAY_URL || "http://127.0.0.1:8000";
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE20_ROOM_ID || `verify-p20-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const speakTimeoutMs = Math.max(90_000, e2eSpeakTimeoutMs());
const memoryPollMs = Number.parseInt(
  process.env.VERIFY_MEMORY_POLL_MS || process.env.VERIFY_PHASE20_MEMORY_POLL_MS || "600000",
  10,
);

const T_THINK_MS = Number.parseInt(process.env.PHASE20_T_THINK_MS || "800", 10);
const T_FIRST_MS = Number.parseInt(process.env.PHASE20_T_FIRST_MS || "8000", 10);
const PHASE20_RELAXED = process.env.PHASE20_RELAXED === "1";

function internalHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {unknown} err
 */
function retryReason(err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/429/.test(msg)) return "429";
  if (/timeout/i.test(msg)) return "timeout";
  if (/5\d{2}/.test(msg)) return "5xx";
  if (/ECONNRESET|fetch failed/i.test(msg)) return "gateway";
  return "transient";
}

/**
 * @param {unknown} err
 */
function isRetryable(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|timeout|5\d{2}|ECONNRESET|fetch failed/i.test(msg);
}

async function healthOk() {
  for (const [label, base] of [
    ["game-server", httpBase],
    ["ai-gateway", gwBase],
  ]) {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`${label} health ${res.status}`);
    const body = await res.json().catch(() => ({}));
    if (label === "game-server") {
      if (
        body.service !== "game-server" ||
        (body.status !== "ok" && body.ok !== true)
      ) {
        throw new Error(`${label} unexpected health body`);
      }
    } else if (body.status !== "ok") {
      throw new Error(`${label} unexpected health body`);
    }
  }
}

async function loadPlaywright() {
  const pwEntry = resolve(root, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) {
    throw new Error("playwright not installed — cd scripts/.pw-deps && pnpm install");
  }
  return chromium;
}

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout: ${label} (${timeoutMs}ms)`);
}

/**
 * @param {number | null} thinkingMs
 * @param {number | null} firstTextMs
 */
function assertLatencySmoke(thinkingMs, firstTextMs) {
  const breaches = [];
  if (thinkingMs != null && thinkingMs > T_THINK_MS) {
    breaches.push(`thinkingMs=${thinkingMs} > ${T_THINK_MS}`);
  }
  if (firstTextMs != null && firstTextMs > T_FIRST_MS) {
    breaches.push(`firstTextMs=${firstTextMs} > ${T_FIRST_MS}`);
  }
  if (!breaches.length) return;

  const msg = `latency smoke: ${breaches.join("; ")}`;
  if (PHASE20_RELAXED) {
    console.warn(`verify:phase20: WARN ${msg} (PHASE20_RELAXED=1 — not valid for phase-done)`);
    return;
  }
  throw new Error(msg);
}

async function runScenario() {
  const memorySeed = `FACT-P20-${Date.now()}`;
  const nickSeed = `验名${String(Date.now()).slice(-5)}`;

  console.log(
    `verify:phase20 → ${webUrl} WORLD_SEED=${process.env.WORLD_SEED} seed=${memorySeed} nick=${nickSeed}`,
  );
  await healthOk();

  const playerId = `verifyp20${String(Date.now()).slice(-10)}`;
  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(
      ({ key, id }) => {
        localStorage.setItem(key, id);
      },
      { key: "aetherlife:playerId", id: playerId },
    );
    const page = await context.newPage();
    const bootStart = Date.now();
    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    await page.locator('[data-testid="phaser-stage-fill"] canvas').first().waitFor({
      state: "visible",
      timeout: 45_000,
    });
    await page.locator('[data-testid="dialogue-overlay"]').waitFor({
      state: "attached",
      timeout: 30_000,
    });

    const bootMs = Date.now() - bootStart;
    console.log(`verify:phase20: bootMs=${bootMs}`);
    if (bootMs > BOOT_WARN_MS) {
      console.warn(`verify:phase20: WARN bootMs=${bootMs} exceeds ${BOOT_WARN_MS}ms`);
    }
    if (bootMs > BOOT_FAIL_MS) {
      throw new Error(`bootMs=${bootMs} exceeds fail threshold ${BOOT_FAIL_MS}ms`);
    }

    await engageDialogue(page, { timeoutMs: 90_000 });

    const casual = await sendSpeakOverlay(page, "你好，用一句话简短回复", {
      speakTimeoutMs,
      engageTimeoutMs: 90_000,
    });
    console.log(
      `verify:phase20: latency smoke speakMs=${casual.speakMs} thinkingMs=${casual.thinkingMs} firstTextMs=${casual.firstTextMs}`,
    );
    assertLatencySmoke(casual.thinkingMs, casual.firstTextMs);

    await sendSpeakOverlay(page, `请记住 ${memorySeed} 门禁密码是 7`, { speakTimeoutMs });
    await sendSpeakOverlay(page, `请记住我叫${nickSeed}`, { speakTimeoutMs });

    await waitForMemoryContext({
      httpBase,
      roomId,
      playerId,
      playerMessage: `${memorySeed} 密码`,
      needle: memorySeed,
      pollMs: memoryPollMs,
      internalHeaders,
    });
    await waitForMemoryContext({
      httpBase,
      roomId,
      playerId,
      playerMessage: `我叫什么`,
      needle: nickSeed,
      pollMs: memoryPollMs,
      internalHeaders,
    });
    console.log(`verify:phase20: memory seeds persisted (${memorySeed}, ${nickSeed})`);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator('[data-testid="immersive-shell"]').waitFor({
      state: "visible",
      timeout: 45_000,
    });
    await page.locator('[data-testid="phaser-stage-fill"] canvas').first().waitFor({
      state: "visible",
      timeout: 45_000,
    });
    await page.waitForFunction(
      () =>
        Boolean(
          document.querySelector('[data-testid="corner-menu"] .corner-menu__status-dot--ok'),
        ),
      { timeout: 60_000 },
    );
    await engageDialogue(page, { timeoutMs: 90_000 });

    const { reply: recallReply } = await sendSpeakOverlay(
      page,
      `我之前说的 ${memorySeed} 门禁密码是多少？`,
      { speakTimeoutMs, engageTimeoutMs: 90_000 },
    );

    await openShellDrawerHistory(page);

    await waitFor(
      async () => page.locator('[data-testid="npc-memory-callback"]').isVisible(),
      speakTimeoutMs,
      "npc-memory-callback after reload recall",
    );

    const recallHay = recallReply.toLowerCase();
    if (!recallHay.includes(memorySeed.toLowerCase()) && !recallHay.includes("7")) {
      throw new Error(
        `password recall missing seed token (seed=${memorySeed} reply="${recallReply.slice(0, 120)}")`,
      );
    }
    if (replyRefusesRecall(recallReply)) {
      throw new Error(`password recall refused despite memory callback: "${recallReply.slice(0, 120)}"`);
    }
    console.log("verify:phase20: password recall + memory callback OK");

    await closeShellDrawer(page);

    const { reply: nickReply } = await sendSpeakOverlay(page, "我叫什么？", { speakTimeoutMs });
    if (!nickReply.includes(nickSeed)) {
      throw new Error(`nickname recall missing ${nickSeed}: "${nickReply.slice(0, 120)}"`);
    }
    if (replyRefusesRecall(nickReply)) {
      throw new Error(`nickname recall refused: "${nickReply.slice(0, 120)}"`);
    }
    console.log("verify:phase20: nickname recall OK");
  } finally {
    await browser.close();
  }

  console.log("verify:phase20 OK");
}

async function main() {
  assertE2eNoMock("verify:phase20");
  assertE2eRealLlm("verify:phase20");

  try {
    await runScenario();
  } catch (err) {
    if (!isRetryable(err)) throw err;
    const reason = retryReason(err);
    console.warn(
      `verify:phase20: retry=1 reason=${reason} backoff=${RETRY_BACKOFF_MS}ms (${err instanceof Error ? err.message : err})`,
    );
    await sleep(RETRY_BACKOFF_MS);
    await runScenario();
  }
}

main().catch((err) => {
  console.error(`verify:phase20 failed: ${err instanceof Error ? err.message : err}`);
  console.error("Ensure full stack: pnpm dev:stack (no LLM_MOCK). Game-server :2567, ai-gateway :8000, web :5173.");
  process.exit(1);
});

export { main };
