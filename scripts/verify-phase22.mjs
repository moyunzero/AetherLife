/**
 * Phase 22 E2E — v4 ship gate aggregator (SOLO-04 / SOLO-06).
 *
 * Orchestrates: verify:phase20 → verify:phase21 → inline SOLO-04 + multi-pref C1
 * → verify:phase13 → explicit golden-flow spawns (phase6, phase6:move-only, phase8).
 *
 * Requires: pnpm dev:stack with real LLM API keys (no LLM_MOCK, no dev:stack:mock).
 * Run-all policy (D-02): every step runs even if prior steps fail; exit 1 if any failed.
 *
 * VERIFY_PHASE22_SKIP_GOLDEN=1 — omit golden-flow spawns during incremental dev.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertE2eNoMock,
  assertE2eRealLlm,
  e2eSpeakTimeoutMs,
} from "./lib/e2e-policy.mjs";
import { engageDialogue } from "./lib/dialogue-engage.mjs";
import {
  closeShellDrawer,
  openShellDrawerCollective,
  replyRefusesRecall,
  seedPreferenceMemories,
  sendSpeakOverlay,
} from "./lib/e2e-memory-helpers.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";
import { loadPlaywright } from "./lib/speak-browser-stack.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const speakTimeoutMs = Math.max(90_000, e2eSpeakTimeoutMs());
const BANNER_WAIT_MS = Number.parseInt(process.env.E2E_BANNER_WAIT_MS || "", 10) || 60_000;
const MEMORY_POLL_MS = Number.parseInt(
  process.env.VERIFY_MEMORY_POLL_MS ||
    process.env.VERIFY_PHASE22_MEMORY_POLL_MS ||
    process.env.VERIFY_PHASE20_MEMORY_POLL_MS ||
    "300000",
  10,
);

const GOLDEN_SCRIPTS = ["verify:phase6", "verify:phase6:move-only", "verify:phase8"];

/** @type {Array<{ id: string; script: string }>} */
const STEPS = [
  { id: "phase20", script: "verify:phase20" },
  { id: "phase21", script: "verify:phase21" },
  { id: "inline", script: "__inline__" },
  { id: "phase13", script: "verify:phase13" },
  { id: "golden", script: "__golden__" },
];

function internalHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout: ${label} (${timeoutMs}ms)`);
}

async function healthOk() {
  const gsRes = await fetch(`${httpBase}/health`, { signal: AbortSignal.timeout(8000) });
  if (!gsRes.ok) throw new Error(`game-server health ${gsRes.status}`);
  const gsBody = await gsRes.json().catch(() => ({}));
  if (
    gsBody.service !== "game-server" &&
    gsBody.status !== "ok" &&
    gsBody.ok !== true
  ) {
    throw new Error("game-server unexpected health body");
  }

  const webRes = await fetch(webBase, { signal: AbortSignal.timeout(8000) });
  if (!webRes.ok) throw new Error(`web ${webBase} → ${webRes.status}`);
}

/**
 * @param {string} script
 * @returns {{ ok: boolean; ms: number; exitCode: number }}
 */
function runSpawn(script) {
  const started = Date.now();
  const header = `\n========== verify:phase22 spawn: pnpm ${script} ==========\n`;
  process.stdout.write(header);

  const result = spawnSync("pnpm", [script], {
    cwd: root,
    env: {
      ...process.env,
      E2E_SPEAK_TIMEOUT_MS: process.env.E2E_SPEAK_TIMEOUT_MS || "240000",
      UAT_SPEAK_TIMEOUT_MS: process.env.UAT_SPEAK_TIMEOUT_MS || "180000",
    },
    stdio: "inherit",
    shell: false,
  });
  const ms = Date.now() - started;
  const ok = result.status === 0;
  const exitCode = result.status ?? 1;
  console.log(`verify:phase22: pnpm ${script} → ${ok ? "PASS" : "FAIL"} (${Math.round(ms / 1000)}s)`);
  return { ok, ms, exitCode };
}

async function fetchCollectiveState(roomId, playerId, npcId = "npc-1") {
  const qs = new URLSearchParams({ npcId });
  const res = await fetch(
    `${httpBase}/rooms/${encodeURIComponent(roomId)}/collective-state?${qs}`,
    { headers: { "X-Player-Id": playerId, "Cache-Control": "no-cache" } },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`collective-state → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function latestEventOfKind(events, playerId, kind) {
  return (events ?? []).find(
    (e) =>
      e?.kind === kind &&
      Array.isArray(e.playerIds) &&
      e.playerIds[0] === playerId,
  );
}

/**
 * @param {import('playwright').Page} page
 * @param {number} minCount
 */
async function assertCollectiveEventsWithSummaries(page, minCount) {
  const events = page.locator('[data-testid="collective-recent-events"] li');
  const count = await events.count();
  if (count < minCount) {
    throw new Error(`collective-recent-events expected ≥${minCount} rows, got ${count}`);
  }
  for (let i = 0; i < count; i++) {
    const text = ((await events.nth(i).textContent()) ?? "").trim();
    if (text.length < 4) {
      throw new Error(`collective event ${i} summary too short: "${text}"`);
    }
  }
}

/**
 * Inline SOLO-04 (rude auto-open + help path) + multi-preference C1 extension (D-17).
 * @returns {Promise<{ ok: boolean }>}
 */
async function runInlineDelta() {
  const roomId = process.env.VERIFY_PHASE22_ROOM_ID || `verify-p22-${Date.now()}`;
  const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
  const playerId = `verifyp22${String(Date.now()).slice(-10)}`;

  console.log(`verify:phase22 inline → ${webUrl} playerId=${playerId}`);

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
    page.setDefaultTimeout(speakTimeoutMs);

    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
      state: "visible",
      timeout: 45_000,
    });
    await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
    await engageDialogue(page);

    // --- SOLO-04 rude path: auto-open without manual drawer helper (D-10) ---
    const rudeStart = Date.now();
    const rudeReply = await sendSpeakOverlay(page, "你真没礼貌，滚开", { speakTimeoutMs });
    console.log(
      `verify:phase22: rudeSpeakMs=${rudeReply.speakMs} reply="${rudeReply.reply.slice(0, 60)}"`,
    );

    await waitFor(
      async () =>
        latestEventOfKind(
          (await fetchCollectiveState(roomId, playerId)).recentEvents,
          playerId,
          "rude",
        ),
      BANNER_WAIT_MS,
      "collective rude event in API",
    );
    console.log(`verify:phase22: rude→apiMs=${Date.now() - rudeStart}`);

    await waitFor(
      async () => page.locator('[data-testid="collective-feedback-banner"]').isVisible(),
      30_000,
      "collective-feedback-banner within 30s of rude",
    );

    await waitFor(
      async () => page.locator('[data-testid="shell-drawer"]').isVisible(),
      30_000,
      "shell-drawer auto-open after rude",
    );
    await page.locator("#shell-drawer-panel-collective").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.locator('[data-testid="attitude-band-chip"]').waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await assertCollectiveEventsWithSummaries(page, 1);
    console.log("verify:phase22: rude auto-open + band/events OK");

    await closeShellDrawer(page);

    // --- SOLO-04 help path: API kind=help, banner, no second auto-open ---
    const helpStart = Date.now();
    const helpReply = await sendSpeakOverlay(page, "请帮帮忙", { speakTimeoutMs });
    console.log(
      `verify:phase22: helpSpeakMs=${helpReply.speakMs} reply="${helpReply.reply.slice(0, 60)}"`,
    );

    await waitFor(
      async () =>
        latestEventOfKind(
          (await fetchCollectiveState(roomId, playerId)).recentEvents,
          playerId,
          "help",
        ),
      BANNER_WAIT_MS,
      "collective help event in API",
    );
    console.log(`verify:phase22: help→apiMs=${Date.now() - helpStart}`);

    await waitFor(
      async () => page.locator('[data-testid="collective-feedback-banner"]').isVisible(),
      30_000,
      "collective-feedback-banner within 30s of help",
    );

    const drawerOpen = await page.locator('[data-testid="shell-drawer"]').isVisible().catch(() => false);
    const collectiveOpen = await page
      .locator("#shell-drawer-panel-collective")
      .isVisible()
      .catch(() => false);
    if (drawerOpen && collectiveOpen) {
      throw new Error("drawer auto-opened again after help speak (D-10 once-only)");
    }
    console.log("verify:phase22: help path — no second auto-open OK");

    await openShellDrawerCollective(page);
    await waitFor(
      async () => {
        const st = await fetchCollectiveState(roomId, playerId);
        const events = st.recentEvents ?? [];
        if (
          !latestEventOfKind(events, playerId, "rude") ||
          !latestEventOfKind(events, playerId, "help")
        ) {
          return false;
        }
        const count = await page.locator('[data-testid="collective-recent-events"] li').count();
        return count >= 2;
      },
      BANNER_WAIT_MS,
      "collective-recent-events ≥2 rows after help",
    );
    await assertCollectiveEventsWithSummaries(page, 2);
    console.log("verify:phase22: collective browse ≥2 events with summaries OK");
    await closeShellDrawer(page);

    // --- Multi-preference C1 extension (D-17) ---
    const suffix = String(Date.now()).slice(-6);
    const prefA = `茶验${suffix}`;
    const prefB = `书验${suffix}`;

    await seedPreferenceMemories(page, {
      httpBase,
      roomId,
      playerId,
      speakTimeoutMs,
      internalHeaders,
      memoryPollMs: MEMORY_POLL_MS,
      preferences: [
        {
          token: prefA,
          seedMessage: `请记住我喜欢喝${prefA}茶`,
          pollMessage: prefA,
        },
        {
          token: prefB,
          seedMessage: `请记住我喜欢看${prefB}书`,
          pollMessage: prefB,
        },
      ],
    });
    console.log(`verify:phase22: preference seeds persisted (${prefA}, ${prefB})`);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
      state: "visible",
      timeout: 45_000,
    });
    await engageDialogue(page);

    const { reply: teaReply } = await sendSpeakOverlay(page, "我喜欢喝什么茶？", {
      speakTimeoutMs,
    });
    if (!teaReply.includes(prefA)) {
      throw new Error(`tea recall missing ${prefA}: "${teaReply.slice(0, 120)}"`);
    }
    if (replyRefusesRecall(teaReply)) {
      throw new Error(`tea recall refused: "${teaReply.slice(0, 120)}"`);
    }
    console.log("verify:phase22: tea preference recall OK");

    const { reply: bookReply } = await sendSpeakOverlay(page, "我喜欢看什么书？", {
      speakTimeoutMs,
    });
    if (!bookReply.includes(prefB)) {
      throw new Error(`book recall missing ${prefB}: "${bookReply.slice(0, 120)}"`);
    }
    if (replyRefusesRecall(bookReply)) {
      throw new Error(`book recall refused: "${bookReply.slice(0, 120)}"`);
    }
    console.log("verify:phase22: book preference recall OK");

    return { ok: true };
  } catch (err) {
    console.error(
      `verify:phase22 inline failed: ${err instanceof Error ? err.message : err}`,
    );
    return { ok: false };
  } finally {
    await browser.close();
  }
}

/**
 * Explicit golden-flow spawns (D-03) — spawn verify:phase6/8 scripts directly, not agent-verify e2e oracle.
 * @returns {Promise<boolean>}
 */
async function runGoldenSpawns() {
  if (process.env.VERIFY_PHASE22_SKIP_GOLDEN === "1") {
    console.log("verify:phase22: VERIFY_PHASE22_SKIP_GOLDEN=1 — skipping golden spawns");
    return true;
  }

  let allOk = true;
  for (const script of GOLDEN_SCRIPTS) {
    const { ok } = runSpawn(script);
    if (!ok) allOk = false;
  }
  return allOk;
}

/**
 * @param {{ id: string; script: string }} step
 */
async function runStep(step) {
  const started = Date.now();
  const header = `\n========== verify:phase22 step: ${step.id} (${step.script}) ==========\n`;
  process.stdout.write(header);

  let ok = false;
  let exitCode = 1;

  try {
    if (step.script === "__inline__") {
      const result = await runInlineDelta();
      ok = result.ok;
      exitCode = ok ? 0 : 1;
    } else if (step.script === "__golden__") {
      ok = await runGoldenSpawns();
      exitCode = ok ? 0 : 1;
    } else {
      const spawn = runSpawn(step.script);
      ok = spawn.ok;
      exitCode = spawn.exitCode;
    }
  } catch (err) {
    console.error(
      `verify:phase22: step ${step.id} error: ${err instanceof Error ? err.message : err}`,
    );
    ok = false;
    exitCode = 1;
  }

  const ms = Date.now() - started;
  console.log(
    `verify:phase22: step ${step.id} → ${ok ? "PASS" : "FAIL"} (${Math.round(ms / 1000)}s)`,
  );
  return { ...step, ok, ms, exitCode };
}

async function main() {
  assertE2eNoMock("verify:phase22");
  assertE2eRealLlm("verify:phase22");
  console.log(`verify:phase22 v4 ship gate WORLD_SEED=${process.env.WORLD_SEED}`);
  await healthOk();
  console.log("verify:phase22: stack health OK");

  const only = process.env.VERIFY_PHASE22_ONLY?.trim();
  if (only) {
    const step = STEPS.find((s) => s.id === only);
    if (!step) {
      console.error(`verify:phase22: unknown VERIFY_PHASE22_ONLY=${only}`);
      process.exit(1);
    }
    const r = await runStep(step);
    process.exit(r.ok ? 0 : 1);
  }

  const steps =
    process.env.VERIFY_PHASE22_SKIP_GOLDEN === "1"
      ? STEPS.filter((s) => s.script !== "__golden__")
      : STEPS;

  /** @type {Array<Awaited<ReturnType<typeof runStep>>>} */
  const results = [];
  const t0 = Date.now();

  for (const step of steps) {
    const r = await runStep(step);
    results.push(r);
  }

  const failed = results.filter((r) => !r.ok);
  const totalMs = Date.now() - t0;
  console.log(
    `\nverify:phase22 done: ${results.length - failed.length}/${results.length} pass, ${Math.round(totalMs / 60000)} min`,
  );

  if (failed.length > 0) {
    console.error("Failed steps:");
    for (const f of failed) {
      console.error(`  - ${f.id}: ${f.script}`);
    }
    process.exit(1);
  }

  console.log("verify:phase22 OK");
}

main().catch((err) => {
  console.error(`verify:phase22 failed: ${err instanceof Error ? err.message : err}`);
  console.error(
    "Ensure full stack: pnpm dev:stack (no LLM_MOCK). Game-server :2567, web :5173.",
  );
  process.exit(1);
});
