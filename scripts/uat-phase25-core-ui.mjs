/**
 * Phase 25 UAT Tests 1–6 — Core council UI flow with Playwright screenshots.
 *
 * Covers UAT: dev stack join, deliberation chip, council tab, vote toast/minutes,
 * chronicle unread badge, roster relationship hints.
 *
 * Requires: pnpm dev:stack (no LLM_MOCK), real LLM keys in .env.
 * Output: .planning/phases/25-council-vote-debate/uat-screenshots/test-01-06-core/
 *         + uat-test-01-06-report.json
 */
import { mkdir, writeFile } from "node:fs/promises";
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
  sendSpeakOverlay,
} from "./lib/e2e-memory-helpers.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";
import { loadPlaywright } from "./lib/speak-browser-stack.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

const OUT_DIR = resolve(
  root,
  ".planning/phases/25-council-vote-debate/uat-screenshots/test-01-06-core",
);
const REPORT_JSON = resolve(
  root,
  ".planning/phases/25-council-vote-debate/uat-test-01-06-report.json",
);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.UAT_PHASE25_ROOM_ID || `uat-p25-core-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const speakTimeoutMs = Math.max(90_000, e2eSpeakTimeoutMs());
const engageTimeoutMs = Math.max(90_000, speakTimeoutMs / 2);
const phaseTimeoutMs =
  Number.parseInt(process.env.UAT_PHASE25_CORE_TIMEOUT_MS || "900000", 10) || 900_000;
const BANNER_WAIT_MS = Number.parseInt(process.env.E2E_BANNER_WAIT_MS || "", 10) || 60_000;

/** @type {{ tests: string; roomId: string; playerId: string; startedAt: string; screenshots: Array<{step:number;label:string;path:string}>; assertions: Array<{id:string;ok:boolean;detail:string}>; pass: boolean; finishedAt?: string; elapsedMs?: number }} */
const report = {
  tests: "1-6",
  roomId,
  playerId: "",
  startedAt: new Date().toISOString(),
  screenshots: [],
  assertions: [],
  pass: false,
};

let stepIndex = 0;

function log(msg) {
  console.log(msg);
}

function recordAssertion(id, ok, detail) {
  report.assertions.push({ id, ok, detail });
  log(`  ${ok ? "✓" : "✗"} ${id}: ${detail}`);
  if (!ok) throw new Error(`assertion failed: ${id} — ${detail}`);
}

async function screenshot(page, label) {
  stepIndex += 1;
  await mkdir(OUT_DIR, { recursive: true });
  const file = resolve(OUT_DIR, `${String(stepIndex).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const rel = file.replace(`${root}/`, "");
  report.screenshots.push({ step: stepIndex, label, path: rel });
  log(`  📸 ${rel}`);
}

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
  const webRes = await fetch(webBase, { signal: AbortSignal.timeout(8000) });
  if (!webRes.ok) throw new Error(`web ${webBase} → ${webRes.status}`);
}

async function fetchCollectiveState(playerId) {
  const qs = new URLSearchParams({ npcId: "npc-1" });
  const res = await fetch(
    `${httpBase}/rooms/${encodeURIComponent(roomId)}/collective-state?${qs}`,
    { headers: { "X-Player-Id": playerId, "Cache-Control": "no-cache" } },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`collective-state → ${res.status}`);
  return body;
}

async function fetchNpcRelationships() {
  const res = await fetch(
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/npc-relationships`,
    { headers: internalHeaders() },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`npc-relationships → ${res.status}`);
  return body.edges ?? [];
}

async function triggerWorldVote() {
  const res = await fetch(
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/world-vote/trigger`,
    {
      method: "POST",
      headers: internalHeaders(),
      body: JSON.stringify({ force: true, voteKind: "regular", debateRoundsMax: 1 }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`world-vote/trigger → ${res.status}`);
  log(`vote triggered jobId=${body.jobId ?? "?"}`);
  return body;
}

function latestEventOfKind(events, playerId, kind) {
  return (events ?? []).find(
    (e) => e?.kind === kind && Array.isArray(e.playerIds) && e.playerIds[0] === playerId,
  );
}

async function waitCornerMenuConnected(page, timeoutMs = 60_000) {
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-testid="corner-menu"] .corner-menu__status-dot--ok'),
      ),
    { timeout: timeoutMs },
  );
}

async function openShellDrawerCouncil(page) {
  const drawer = page.locator('[data-testid="shell-drawer"]');
  const chip = page.locator('[data-testid="council-deliberation-chip"]');
  if (!(await drawer.isVisible().catch(() => false))) {
    if (await chip.isVisible().catch(() => false)) {
      await chip.click();
    } else {
      await page.locator('[aria-label="对话历史"]').click();
      await drawer.waitFor({ state: "visible", timeout: 10_000 });
      await page.locator("#shell-drawer-tab-council").click();
    }
  } else {
    await page.locator("#shell-drawer-tab-council").click();
  }
  await drawer.waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#shell-drawer-panel-council").waitFor({ state: "visible", timeout: 10_000 });
}

async function openShellDrawerOnTab(page, tabId) {
  const drawer = page.locator('[data-testid="shell-drawer"]');
  if (!(await drawer.isVisible().catch(() => false))) {
    const chip = page.locator('[data-testid="council-deliberation-chip"]');
    if (tabId === "council" && (await chip.isVisible().catch(() => false))) {
      await chip.click();
    } else {
      await engageDialogue(page, { timeoutMs: 45_000 });
      await page.locator('[aria-label="对话历史"]').click();
    }
  }
  await drawer.waitFor({ state: "visible", timeout: 10_000 });
  await page.locator(`#shell-drawer-tab-${tabId}`).click();
  await page.locator(`#shell-drawer-panel-${tabId}`).waitFor({ state: "visible", timeout: 10_000 });
}

async function main() {
  const t0 = Date.now();
  assertE2eNoMock("uat:phase25:core-ui");
  assertE2eRealLlm("uat:phase25:core-ui");
  log(`uat:phase25:core-ui → ${webUrl}`);
  await healthOk();

  const playerId = `uatp25core${String(Date.now()).slice(-8)}`;
  report.playerId = playerId;

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

    // Test 1: join room
    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
      state: "visible",
      timeout: 45_000,
    });
    await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
    await waitCornerMenuConnected(page);
    await engageDialogue(page, { timeoutMs: engageTimeoutMs });
    await screenshot(page, "01-room-ready");
    recordAssertion("T1-room", true, "room scene + corner menu connected");

    await waitFor(
      async () => (await fetchNpcRelationships()).length >= 1,
      120_000,
      "npc_relationships seeded",
    );

    await sendSpeakOverlay(page, "你真没礼貌，滚开", { speakTimeoutMs, engageTimeoutMs });
    await waitFor(
      async () =>
        latestEventOfKind((await fetchCollectiveState(playerId)).recentEvents, playerId, "rude"),
      BANNER_WAIT_MS,
      "collective rude event",
    );
    await sendSpeakOverlay(page, "请记住议会应关注旅者诉求与始源区秩序", {
      speakTimeoutMs,
      engageTimeoutMs,
    });

    await triggerWorldVote();
    const remainingMs = () => Math.max(30_000, phaseTimeoutMs - (Date.now() - t0));

    // Test 2: deliberation chip
    await waitFor(
      async () => page.locator('[data-testid="council-deliberation-chip"]').isVisible(),
      remainingMs(),
      "council-deliberation-chip",
    );
    await screenshot(page, "02-deliberation-chip");
    recordAssertion("T2-chip", true, "council-deliberation-chip visible");

    await openShellDrawerCouncil(page);

    // Test 3: banner, progress, feed
    await waitFor(
      async () => page.locator('[data-testid="council-deliberation-banner"]').isVisible(),
      remainingMs(),
      "council-deliberation-banner",
    );
    await waitFor(
      async () => page.locator('[data-testid="council-deliberation-progress"]').isVisible(),
      remainingMs(),
      "council-deliberation-progress",
    );
    await waitFor(
      async () => (await page.locator('[data-testid="council-deliberation-feed"] li').count()) >= 1,
      remainingMs(),
      "council-deliberation-feed",
    );
    await screenshot(page, "03-council-tab-banner-progress-feed");
    recordAssertion("T3-council-tab", true, "banner + progress + feed ≥1 row");

    // Test 4: vote toast + minutes modal
    await waitFor(
      async () => {
        const toast = page.locator('[data-testid="council-vote-toast"]');
        if (!(await toast.isVisible().catch(() => false))) return false;
        const title =
          (await toast.locator(".council-vote-toast__title").textContent().catch(() => "")) ?? "";
        return /廷议通过|提案未采纳|纪元大议落槌/.test(title);
      },
      remainingMs(),
      "council-vote-toast",
    );
    await screenshot(page, "04-vote-result-toast");

    await openShellDrawerOnTab(page, "council");
    await waitFor(
      async () => page.locator('[data-testid="shell-drawer-tab-chronicle-unread"]').isVisible(),
      30_000,
      "chronicle-unread",
    );
    await screenshot(page, "05-chronicle-unread-badge");
    recordAssertion("T5-chronicle-unread", true, "unread badge before chronicle open");

    await closeShellDrawer(page);
    await page.locator('[data-testid="council-vote-toast"]').click();
    await page.locator('[data-testid="world-history-minutes-modal"]').waitFor({
      state: "visible",
      timeout: 30_000,
    });
    const ballotCount = await page
      .locator('[data-testid="world-history-minutes-ballots"] .world-history-minutes-modal__card')
      .count();
    recordAssertion("T4-minutes", ballotCount === 11, `11 ballot cards (got ${ballotCount})`);
    const debateExcerptCount = await page
      .locator('[data-testid="world-history-minutes-debate-excerpts"] li')
      .count();
    recordAssertion(
      "T4-debate-excerpts",
      debateExcerptCount >= 1,
      `debate excerpts ≥1 (got ${debateExcerptCount})`,
    );
    await screenshot(page, "06-minutes-modal-11-ballots");
    if (debateExcerptCount >= 1) {
      await screenshot(page, "06b-minutes-debate-excerpts");
    }

    await page.keyboard.press("Escape");
    const minutesModal = page.locator('[data-testid="world-history-minutes-modal"]');
    await minutesModal.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    const minutesBackdrop = page.locator('[data-testid="world-history-minutes-backdrop"]');
    if (await minutesBackdrop.isVisible().catch(() => false)) {
      await minutesBackdrop.click({ position: { x: 8, y: 8 } });
      await minutesModal.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    }

    await openShellDrawerOnTab(page, "chronicle");
    await closeShellDrawer(page);
    const unreadAfter = await page
      .locator('[data-testid="shell-drawer-tab-chronicle-unread"]')
      .isVisible()
      .catch(() => false);
    recordAssertion("T5-unread-cleared", !unreadAfter, "unread cleared after chronicle tab");

    // Test 6: roster hints
    const chip = page.locator('[data-testid="council-deliberation-chip"]');
    if (await chip.isVisible().catch(() => false)) {
      await chip.click();
    } else {
      await engageDialogue(page, { timeoutMs: engageTimeoutMs });
      await page.locator('[aria-label="对话历史"]').click();
    }
    await page.locator("#shell-drawer-tab-council").click();
    const rosterDetails = page.locator('[data-testid="council-roster-row"] details');
    await rosterDetails.first().waitFor({ state: "attached", timeout: 10_000 });
    for (let i = 0; i < (await rosterDetails.count()); i++) {
      await rosterDetails.nth(i).evaluate((el) => {
        el.open = true;
      });
    }
    const hintVisible = await page
      .locator('[data-testid="council-roster-relationship-hint"]')
      .first()
      .isVisible()
      .catch(() => false);
    await screenshot(page, "07-roster-relationship-hints");
    recordAssertion(
      "T6-roster-hint",
      hintVisible,
      hintVisible ? "council-roster-relationship-hint visible" : "hint absent (check linkedEdges)",
    );
    await closeShellDrawer(page);

    report.pass = true;
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  report.elapsedMs = Date.now() - t0;
  await writeFile(REPORT_JSON, JSON.stringify(report, null, 2));
  log(`uat:phase25:core-ui OK (${Math.round(report.elapsedMs / 1000)}s) — ${report.screenshots.length} screenshots`);
}

main().catch(async (err) => {
  report.finishedAt = new Date().toISOString();
  report.elapsedMs = Date.now() - (Date.parse(report.startedAt) || Date.now());
  await writeFile(REPORT_JSON, JSON.stringify({ ...report, pass: false, error: err.message }, null, 2)).catch(
    () => {},
  );
  console.error(`uat:phase25:core-ui failed: ${err.message}`);
  process.exit(1);
});
