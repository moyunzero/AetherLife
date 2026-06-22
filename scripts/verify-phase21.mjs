/**
 * Phase 21 E2E — World Echo town loop (SOLO-02/03 smoke).
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real API keys in .env.
 *
 * Replaces Phase 15 journal-quest-strip gate with lore-discover-toast + drawer「已发现」.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertE2eNoMock,
  assertE2eRealLlm,
  e2eSpeakTimeoutMs,
} from "./lib/e2e-policy.mjs";
import {
  assertJournalQuestStripAbsent,
  ensureMinDiscoveredRows,
  exploreUntilLoreDiscover,
  openDrawerDiscoveries,
  readPlayerGrid,
  reloadHomesteadSession,
  waitForExploreReadyAfterSpeak,
} from "./lib/uat-phase21-helpers.mjs";
import {
  closeShellDrawer,
  openShellDrawerHistory,
  openShellDrawerCollective,
  sendSpeakOverlay,
  waitForMemoryContext,
} from "./lib/e2e-memory-helpers.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";
import { loadPlaywright } from "./lib/speak-browser-stack.mjs";

const BOOT_WARN_MS = 5000;
const BOOT_FAIL_MS = 8000;
const BANNER_WAIT_MS = Number.parseInt(process.env.E2E_BANNER_WAIT_MS || "", 10) || 60_000;
const POST_MOVE_QUIET_MS = Number.parseInt(process.env.VERIFY_POST_MOVE_QUIET_MS || "", 10) || 8_000;
/** SOLO-02: Manhattan drift allowed after reload (matches uat-phase21 P21-06). */
const RELOAD_DRIFT_MAX = 2;

function gridDist(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE21_ROOM_ID || process.env.VERIFY_PHASE15_ROOM_ID || `verify-p21-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const speakTimeoutMs = Math.max(90_000, e2eSpeakTimeoutMs());
const MEMORY_SEED = `FACT-P21-${Date.now()}`;
const MEMORY_POLL_MS = Number.parseInt(
  process.env.VERIFY_MEMORY_POLL_MS ||
    process.env.VERIFY_PHASE21_MEMORY_POLL_MS ||
    process.env.VERIFY_PHASE20_MEMORY_POLL_MS ||
    "300000",
  10,
);
const E2E_LORE_TIMEOUT_MS = Number.parseInt(process.env.E2E_LORE_TIMEOUT_MS || "", 10) || 240_000;
const POST_MEMORY_QUIET_MS = Number.parseInt(
  process.env.VERIFY_POST_MEMORY_QUIET_MS || process.env.VERIFY_GATE_QUIET_MS || "",
  10,
) || 15_000;

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout: ${label} (${timeoutMs}ms)`);
}

function internalHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function healthOk() {
  const res = await fetch(`${httpBase}/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
  const body = await res.json().catch(() => ({}));
  if (body.service !== "game-server" && body.status !== "ok" && body.ok !== true) {
    throw new Error("unexpected health body");
  }
}

async function fetchCollectiveState(playerId, npcId = "npc-1") {
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

function latestRudeForPlayer(events, playerId) {
  return (events ?? []).find(
    (e) =>
      e?.kind === "rude" &&
      Array.isArray(e.playerIds) &&
      e.playerIds[0] === playerId,
  );
}

async function main() {
  assertE2eNoMock("verify:phase21");
  assertE2eRealLlm("verify:phase21");
  console.log(`verify:phase21 → ${webUrl} WORLD_SEED=${process.env.WORLD_SEED} seed=${MEMORY_SEED}`);
  await healthOk();

  const playerId = `verifyp21${String(Date.now()).slice(-10)}`;
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
    const bootStart = Date.now();
    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
      state: "visible",
      timeout: 45_000,
    });
    const bootMs = Date.now() - bootStart;
    console.log(`verify:phase21: bootMs=${bootMs}`);
    if (bootMs > BOOT_WARN_MS) {
      console.warn(`verify:phase21: WARN bootMs=${bootMs} exceeds ${BOOT_WARN_MS}ms`);
    }
    if (bootMs > BOOT_FAIL_MS) {
      throw new Error(`bootMs=${bootMs} exceeds fail threshold ${BOOT_FAIL_MS}ms`);
    }

    await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
    await assertJournalQuestStripAbsent(page);

    // Memory seed before explore/lore: avoids lore+ambient worker load and stacked memory tails (ISSUE-055).
    const memorySpeak = await sendSpeakOverlay(page, `请记住 ${MEMORY_SEED} 门禁密码是 7`, {
      speakTimeoutMs,
    });
    console.log(`verify:phase21: memorySpeakMs=${memorySpeak.speakMs}`);
    await waitForMemoryContext({
      httpBase,
      roomId,
      playerId,
      playerMessage: `${MEMORY_SEED} 密码`,
      needle: MEMORY_SEED,
      pollMs: MEMORY_POLL_MS,
      internalHeaders,
      onPoll: (snap) => {
        console.log(
          `verify:phase21: memory poll elapsed=${snap.elapsedMs}ms needle=${snap.needleFound} ` +
            `recent=${snap.recentMemoryCount ?? "?"} ctxCount=${snap.memoryCount ?? "?"} ` +
            `retrieved=${snap.retrievedCount}`,
        );
      },
    });
    console.log(`verify:phase21: memory seed persisted (${MEMORY_SEED})`);
    await closeShellDrawer(page);

    await waitForExploreReadyAfterSpeak(page, { quietMs: POST_MEMORY_QUIET_MS });
    console.log(`verify:phase21: post-memory quietMs=${POST_MEMORY_QUIET_MS}`);

    let hook = "";
    try {
      hook = (await exploreUntilLoreDiscover(page, E2E_LORE_TIMEOUT_MS)).trim();
    } catch (err) {
      console.warn(`verify:phase21: exploreUntilLoreDiscover failed (${err.message}), drawer fallback`);
      const rows = await ensureMinDiscoveredRows(page, 1, Math.min(120_000, E2E_LORE_TIMEOUT_MS));
      hook = rows[0]?.hook?.trim() ?? "";
    }
    if (!hook) {
      throw new Error("lore-discover-toast with non-empty body");
    }
    console.log(`verify:phase21: lore hook len=${hook.length}`);

    await reloadHomesteadSession(page);
    await openDrawerDiscoveries(page);

    const moveReply = await sendSpeakOverlay(page, "移动到我的下方", { speakTimeoutMs });
    console.log(
      `verify:phase21: speakMs=${moveReply.speakMs} text="移动到我的下方" reply="${moveReply.reply.slice(0, 60)}"`,
    );
    await waitForExploreReadyAfterSpeak(page, { quietMs: POST_MOVE_QUIET_MS });
    console.log(`verify:phase21: post-move quietMs=${POST_MOVE_QUIET_MS}`);

    const gridAfterMove = await readPlayerGrid(page);
    if (!gridAfterMove) {
      throw new Error("SOLO-02: readPlayerGrid after move returned null");
    }
    console.log(`verify:phase21: gridAfterMove=${JSON.stringify(gridAfterMove)}`);

    const rudeStart = Date.now();
    const rudeReply = await sendSpeakOverlay(page, "你真没礼貌，滚开", { speakTimeoutMs });
    console.log(
      `verify:phase21: rudeSpeakMs=${rudeReply.speakMs} reply="${rudeReply.reply.slice(0, 60)}"`,
    );

    await waitFor(
      async () => latestRudeForPlayer((await fetchCollectiveState(playerId)).recentEvents, playerId),
      BANNER_WAIT_MS,
      "collective rude event in API",
    );
    console.log(`verify:phase21: rude→apiMs=${Date.now() - rudeStart}`);

    await waitFor(
      async () => page.locator('[data-testid="collective-feedback-banner"]').isVisible(),
      BANNER_WAIT_MS,
      "collective-feedback-banner within banner wait of event",
    );
    console.log(`verify:phase21: rude→bannerMs=${Date.now() - rudeStart}`);

    await openShellDrawerCollective(page);
    await waitFor(
      async () => {
        const events = page.locator('[data-testid="collective-recent-events"] li');
        return (await events.count()) > 0;
      },
      BANNER_WAIT_MS,
      "collective-recent-events after rude speak",
    );
    await closeShellDrawer(page);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
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

    const gridAfterReload = await readPlayerGrid(page);
    const reloadDrift = gridDist(gridAfterMove, gridAfterReload);
    if (reloadDrift > RELOAD_DRIFT_MAX) {
      throw new Error(
        `SOLO-02 reload drift=${reloadDrift} exceeds ${RELOAD_DRIFT_MAX} ` +
          `(after=${JSON.stringify(gridAfterMove)} reload=${JSON.stringify(gridAfterReload)})`,
      );
    }
    console.log(`verify:phase21: SOLO-02 reload drift=${reloadDrift} OK`);

    const { reply: recallReply } = await sendSpeakOverlay(
      page,
      `我之前说的 ${MEMORY_SEED} 门禁密码是多少？`,
      { speakTimeoutMs, engageTimeoutMs: 90_000 },
    );
    console.log(`verify:phase21: recallMs reply="${recallReply.slice(0, 80)}"`);

    const hay = recallReply.toLowerCase();
    if (!hay.includes(MEMORY_SEED.toLowerCase()) && !hay.includes("7")) {
      throw new Error(
        `recall reply missing seed token (seed=${MEMORY_SEED} reply="${recallReply.slice(0, 120)}")`,
      );
    }

    await openShellDrawerHistory(page);
    await waitFor(
      async () => page.locator('[data-testid="npc-memory-callback"]').isVisible(),
      speakTimeoutMs,
      "npc-memory-callback after reload recall",
    );
    console.log("verify:phase21: memory citation + recall OK");
  } finally {
    await browser.close();
  }

  console.log("verify:phase21 OK");
}

main().catch((err) => {
  console.error(`verify:phase21 failed: ${err.message}`);
  console.error("Ensure full stack: pnpm dev:stack (no LLM_MOCK). Game-server :2567, web :5173.");
  process.exit(1);
});
