/**
 * Phase 25 UAT Test 8 — Player influence / traveler reference (D-VOTE-PLAY-03…06).
 *
 * Flow (mirrors verify:phase25 traveler slice):
 *   rude speak → collective event → seed speak (旅者) → force world-vote →
 *   council chip/feed must contain 旅者|据近期旅者言行 (no player display name).
 *
 * Requires: pnpm dev:stack + VOTE_FORCE_TRIGGER=1, real LLM keys.
 * Output: .planning/phases/25-council-vote-debate/uat-screenshots/test-08-traveler/
 *         + uat-test-08-report.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertE2eNoMock,
  assertE2eRealLlm,
  e2eSpeakTimeoutMs,
} from "./lib/e2e-policy.mjs";
import { closeShellDrawer, sendSpeakOverlay } from "./lib/e2e-memory-helpers.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";
import { loadPlaywright } from "./lib/speak-browser-stack.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

const OUT_DIR = resolve(
  root,
  ".planning/phases/25-council-vote-debate/uat-screenshots/test-08-traveler",
);
const REPORT_JSON = resolve(
  root,
  ".planning/phases/25-council-vote-debate/uat-test-08-report.json",
);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.UAT_PHASE25_ROOM_ID || `uat-p25-t8-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const speakTimeoutMs = Math.max(120_000, e2eSpeakTimeoutMs());
const engageTimeoutMs = Math.max(90_000, speakTimeoutMs / 2);
const phaseTimeoutMs =
  Number.parseInt(process.env.UAT_PHASE25_TRAVELER_TIMEOUT_MS || "900000", 10) || 900_000;
const BANNER_WAIT_MS = Number.parseInt(process.env.E2E_BANNER_WAIT_MS || "", 10) || 90_000;

const TRAVELER_MARKERS = /旅者|据近期旅者言行/;

/** @type {{
 *   test: number;
 *   name: string;
 *   roomId: string;
 *   playerId: string;
 *   startedAt: string;
 *   screenshots: Array<{ step: number; label: string; path: string }>;
 *   assertions: Array<{ id: string; ok: boolean; detail: string; at: string }>;
 *   pass: boolean;
 *   mode: string;
 *   finishedAt?: string;
 *   elapsedMs?: number;
 *   error?: string;
 * }} */
const report = {
  test: 8,
  name: "Player influence in proposal (traveler reference)",
  roomId,
  playerId: "",
  startedAt: new Date().toISOString(),
  screenshots: [],
  assertions: [],
  pass: false,
  mode: "playwright-e2e-real-llm-vote",
};

let stepIndex = 0;

function log(msg) {
  console.log(msg);
}

function recordAssertion(id, ok, detail) {
  report.assertions.push({ id, ok, detail, at: new Date().toISOString() });
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
  return file;
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
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timeout: ${label} (${timeoutMs}ms)`);
}

async function healthOk() {
  const gsRes = await fetch(`${httpBase}/health`, { signal: AbortSignal.timeout(8000) });
  if (!gsRes.ok) throw new Error(`game-server health ${gsRes.status}`);
  const webRes = await fetch(webBase, { signal: AbortSignal.timeout(8000) });
  if (!webRes.ok) throw new Error(`web ${webBase} → ${webRes.status}`);
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

async function fetchNpcRelationships() {
  const res = await fetch(
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/npc-relationships`,
    { headers: internalHeaders() },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`npc-relationships → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body.edges ?? [];
}

async function fetchWorldVoteContext() {
  const res = await fetch(
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/world-vote/context`,
    { headers: internalHeaders() },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`world-vote/context → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
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
  if (!res.ok) {
    throw new Error(`world-vote/trigger → ${res.status}: ${JSON.stringify(body)}`);
  }
  log(`  vote triggered jobId=${body.jobId ?? "?"}`);
  return body;
}

function latestEventOfKind(events, playerId, kind) {
  return (events ?? []).find(
    (e) => e?.kind === kind && Array.isArray(e.playerIds) && e.playerIds[0] === playerId,
  );
}

function assertTravelerSemantics({ chipTitle, feedText, contextBody, playerId }) {
  const hay = [chipTitle, feedText, JSON.stringify(contextBody ?? {})].join("\n");
  if (!TRAVELER_MARKERS.test(hay)) {
    throw new Error(`traveler marker missing (hay="${hay.slice(0, 240)}")`);
  }
  if (playerId && hay.includes(playerId)) {
    throw new Error(`player id leaked into traveler UI: ${playerId}`);
  }
}

async function waitRoomReady(page) {
  await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
    state: "visible",
    timeout: 45_000,
  });
  await page
    .locator('[data-testid="phaser-boot-loading"]')
    .waitFor({ state: "hidden", timeout: 90_000 })
    .catch(() => {});
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-testid="corner-menu"] .corner-menu__status-dot--ok'),
      ),
    { timeout: 90_000 },
  );
  const coach = page.locator('[data-testid="onboarding-coach"]');
  if (await coach.isVisible().catch(() => false)) {
    await page.locator(".onboarding-coach__skip").click().catch(() => {});
  }
}

async function engageDialogueRobust(page, timeoutMs = 90_000) {
  const dialogueBar = page.locator('[data-testid="dialogue-bar"]');
  if (await dialogueBar.isVisible().catch(() => false)) return;

  const deadline = Date.now() + timeoutMs;
  const canvas = page.locator('[data-testid="phaser-stage-fill"] canvas').first();
  const cornerMenu = page.locator('[data-testid="corner-menu"]');

  while (Date.now() < deadline) {
    if (await dialogueBar.isVisible().catch(() => false)) return;

    await cornerMenu.locator(".corner-menu__trigger").click().catch(() => {});
    const npcChip = page.locator("#npc-avatar-npc-1");
    if (await npcChip.isVisible().catch(() => false)) {
      await npcChip.click();
    } else {
      await cornerMenu.locator(".corner-menu__trigger").click().catch(() => {});
      const box = await canvas.boundingBox();
      if (box) {
        for (const fx of [0.5, 0.35, 0.65, 0.25, 0.75, 0.4, 0.6]) {
          for (const fy of [0.5, 0.35, 0.65, 0.25, 0.75, 0.4, 0.6]) {
            await canvas.click({
              position: { x: Math.round(box.width * fx), y: Math.round(box.height * fy) },
            });
            if (await dialogueBar.isVisible().catch(() => false)) return;
          }
        }
      }
    }

    try {
      await dialogueBar.waitFor({ state: "visible", timeout: 2000 });
      return;
    } catch {
      await page.waitForTimeout(400);
    }
  }

  throw new Error(`engageDialogueRobust: dialogue-bar not visible within ${timeoutMs}ms`);
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
  await page.locator("#shell-drawer-panel-council").waitFor({
    state: "visible",
    timeout: 10_000,
  });
}

async function main() {
  const t0 = Date.now();
  assertE2eNoMock("uat:phase25:traveler");
  assertE2eRealLlm("uat:phase25:traveler");

  log(`uat:phase25:traveler → ${webUrl}`);
  log(`screenshots → ${OUT_DIR.replace(`${root}/`, "")}`);
  log(`timeoutMs=${phaseTimeoutMs}\n`);

  await healthOk();

  const playerId = `uatp25t8${String(Date.now()).slice(-8)}`;
  report.playerId = playerId;

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  /** @type {import('playwright').Page | null} */
  let page = null;

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      localStorage.setItem("aetherlife-onboarding-v1", "done");
    });
    await context.addInitScript(
      ({ key, id }) => {
        localStorage.setItem(key, id);
      },
      { key: "aetherlife:playerId", id: playerId },
    );
    page = await context.newPage();
    page.setDefaultTimeout(speakTimeoutMs);

    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await waitRoomReady(page);
    await engageDialogueRobust(page, 90_000);
    await screenshot(page, "01-room-ready");

    await waitFor(
      async () => (await fetchNpcRelationships()).length >= 1,
      120_000,
      "npc_relationships seeded",
    );

    log("Rude speak → collective rude event…");
    const rudeReply = await sendSpeakOverlay(page, "你真没礼貌，滚开", {
      speakTimeoutMs,
      engageTimeoutMs,
      skipEngage: true,
    });
    recordAssertion("rude-speak-reply", rudeReply.reply.length > 0, rudeReply.reply.slice(0, 60));
    await screenshot(page, "02-after-rude-speak");

    let rudeEvent = null;
    try {
      await waitFor(
        async () => {
          rudeEvent = latestEventOfKind(
            (await fetchCollectiveState(playerId)).recentEvents,
            playerId,
            "rude",
          );
          return Boolean(rudeEvent);
        },
        BANNER_WAIT_MS,
        "collective rude event",
      );
      recordAssertion("collective-rude-event", true, JSON.stringify(rudeEvent).slice(0, 120));
    } catch {
      const state = await fetchCollectiveState(playerId);
      const anyPlayerEvent = (state.recentEvents ?? []).find(
        (e) => Array.isArray(e.playerIds) && e.playerIds[0] === playerId,
      );
      log(
        `  WARN: rude event not seen in ${BANNER_WAIT_MS}ms; recent=${JSON.stringify(anyPlayerEvent ?? null).slice(0, 100)}`,
      );
      recordAssertion(
        "collective-rude-event",
        Boolean(anyPlayerEvent),
        anyPlayerEvent ? `fallback kind=${anyPlayerEvent.kind}` : "no collective event — speak seed only",
      );
    }

    log("Seed speak with 旅者诉求…");
    const seedReply = await sendSpeakOverlay(
      page,
      "请记住议会应关注旅者诉求与始源区秩序",
      { speakTimeoutMs, engageTimeoutMs, skipEngage: true },
    );
    recordAssertion("seed-speak-reply", seedReply.reply.length > 0, seedReply.reply.slice(0, 60));
    await screenshot(page, "03-after-seed-speak");

    await waitFor(
      async () => {
        const ctx = await fetchWorldVoteContext();
        const n =
          (ctx.collectiveSummaries ?? []).length + (ctx.speakSummaries ?? []).length;
        return n >= 1;
      },
      120_000,
      "vote-context summaries after seed speak",
    );
    const voteCtxBefore = await fetchWorldVoteContext();
    const summaryCount =
      (voteCtxBefore.collectiveSummaries ?? []).length +
      (voteCtxBefore.speakSummaries ?? []).length;
    recordAssertion(
      "vote-context-has-summaries",
      summaryCount >= 1,
      `collective=${(voteCtxBefore.collectiveSummaries ?? []).length} speak=${(voteCtxBefore.speakSummaries ?? []).length}`,
    );

    log("Triggering world vote…");
    await triggerWorldVote();
    const remainingMs = () => Math.max(30_000, phaseTimeoutMs - (Date.now() - t0));

    await waitFor(
      async () => page.locator('[data-testid="council-deliberation-chip"]').isVisible(),
      remainingMs(),
      "council-deliberation-chip",
    );
    await screenshot(page, "04-deliberation-chip");

    await openShellDrawerCouncil(page);
    await waitFor(
      async () => page.locator('[data-testid="council-deliberation-banner"]').isVisible(),
      remainingMs(),
      "council-deliberation-banner",
    );
    await waitFor(
      async () => {
        const feed = page.locator('[data-testid="council-deliberation-feed"] li');
        return (await feed.count()) >= 1;
      },
      remainingMs(),
      "council-deliberation-feed quote row",
    );

    const chipTitle =
      (await page
        .locator('[data-testid="council-deliberation-chip"] .council-deliberation-chip__title')
        .textContent()
        .catch(() => "")) ?? "";
    const feedText =
      (await page.locator('[data-testid="council-deliberation-feed"]').textContent().catch(() => "")) ??
      "";
    const voteCtxDuring = await fetchWorldVoteContext();

    await screenshot(page, "05-council-feed-traveler-check");

    assertTravelerSemantics({
      chipTitle: chipTitle.trim(),
      feedText: feedText.trim(),
      contextBody: voteCtxDuring,
      playerId,
    });
    recordAssertion(
      "traveler-marker-in-ui-or-context",
      TRAVELER_MARKERS.test([chipTitle, feedText].join("\n")) ||
        TRAVELER_MARKERS.test(JSON.stringify(voteCtxDuring)),
      `chip="${chipTitle.slice(0, 40)}" feed="${feedText.slice(0, 80)}"`,
    );

    const travelerPrefix = page.locator(".council-deliberation-feed__traveler-prefix");
    if (await travelerPrefix.first().isVisible().catch(() => false)) {
      await screenshot(page, "06-traveler-prefix-visible");
      recordAssertion("traveler-prefix-ui", true, "据近期旅者言行… prefix in feed");
    } else {
      recordAssertion(
        "traveler-prefix-ui",
        TRAVELER_MARKERS.test(feedText),
        "marker in feed text without dedicated prefix element",
      );
    }

    recordAssertion(
      "no-player-id-in-feed",
      !feedText.includes(playerId),
      `playerId=${playerId}`,
    );

    report.pass = true;
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Date.now() - t0;
    await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
    log(`\n✅ UAT Test 8 PASS (${Math.round(report.elapsedMs / 1000)}s)`);
    log(`report → ${REPORT_JSON.replace(`${root}/`, "")}`);
  } catch (innerErr) {
    if (page) {
      await screenshot(page, "99-failure").catch(() => {});
    }
    throw innerErr;
  } finally {
    await browser.close();
  }
}

main().catch(async (err) => {
  report.pass = false;
  report.error = err.message;
  report.finishedAt = new Date().toISOString();
  await mkdir(OUT_DIR, { recursive: true }).catch(() => {});
  await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  console.error(`\n❌ uat:phase25:traveler failed: ${err.message}`);
  process.exit(1);
});
