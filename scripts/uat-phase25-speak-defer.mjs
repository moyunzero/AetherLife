/**
 * Phase 25 UAT Test 7 — Speak defer during deliberation (D-VOTE-UX-06).
 *
 * Hybrid automation (deterministic UI defer + real speak):
 *   1. Playwright: real player speak → speakQueueBusy
 *   2. Internal POST council-deliberation-sync → chip/banner/progress + deferred feed/toast
 *   (Avoids worker vote-queue backlog; tests client contract from 25-04 / useCouncilDeliberation.)
 *
 * Requires: pnpm dev:stack (no LLM_MOCK), real LLM keys in .env.
 * Output: .planning/phases/25-council-vote-debate/uat-screenshots/test-07-speak-defer/
 *         + uat-test-07-report.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertE2eNoMock,
  assertE2eRealLlm,
  e2eSpeakTimeoutMs,
} from "./lib/e2e-policy.mjs";
import { closeShellDrawer } from "./lib/e2e-memory-helpers.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";
import { loadPlaywright } from "./lib/speak-browser-stack.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

const OUT_DIR = resolve(
  root,
  ".planning/phases/25-council-vote-debate/uat-screenshots/test-07-speak-defer",
);
const REPORT_JSON = resolve(
  root,
  ".planning/phases/25-council-vote-debate/uat-test-07-report.json",
);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.UAT_PHASE25_ROOM_ID || `uat-p25-t7-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const speakTimeoutMs = Math.max(120_000, e2eSpeakTimeoutMs());
const phaseTimeoutMs =
  Number.parseInt(process.env.UAT_PHASE25_SPEAK_DEFER_TIMEOUT_MS || "600000", 10) || 600_000;

const THINKING_LOCATOR =
  '[data-testid="dialogue-overlay"] .dialogue-overlay__thinking, ' +
  '.dialogue-bar__summary-text--thinking, ' +
  '[data-testid="composer-speak-status"]';

/** @type {{ test: number; name: string; roomId: string; playerId: string; startedAt: string; screenshots: Array<{step:number;label:string;path:string}>; assertions: Array<{id:string;ok:boolean;detail:string;at:string}>; pass: boolean; finishedAt?: string; elapsedMs?: number; error?: string }} */
const report = {
  test: 7,
  name: "Speak defer during deliberation",
  roomId,
  playerId: "",
  startedAt: new Date().toISOString(),
  screenshots: [],
  assertions: [],
  pass: false,
  mode: "hybrid-speak-plus-internal-sync",
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

async function dismissOnboarding(page) {
  const coach = page.locator('[data-testid="onboarding-coach"]');
  if (await coach.isVisible().catch(() => false)) {
    const skip = page.locator(".onboarding-coach__skip");
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    } else {
      await page.locator('[data-testid="onboarding-next"]').click({ clickCount: 4 }).catch(() => {});
    }
    await coach.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
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
    undefined,
    { timeout: 90_000 },
  );
  await dismissOnboarding(page);
}

/** Corner menu + canvas grid — more reliable than engageDialogue alone on fresh rooms. */
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
        const fractions = [0.5, 0.35, 0.65, 0.25, 0.75, 0.4, 0.6];
        for (const fx of fractions) {
          for (const fy of fractions) {
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


async function healthOk() {
  const gsRes = await fetch(`${httpBase}/health`, { signal: AbortSignal.timeout(8000) });
  if (!gsRes.ok) throw new Error(`game-server health ${gsRes.status}`);
  const webRes = await fetch(webBase, { signal: AbortSignal.timeout(8000) });
  if (!webRes.ok) throw new Error(`web ${webBase} → ${webRes.status}`);
}

async function pushCouncilSync(payload) {
  const res = await fetch(
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/council-deliberation-sync`,
    {
      method: "POST",
      headers: internalHeaders(),
      body: JSON.stringify(payload),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`council-deliberation-sync → ${res.status}: ${JSON.stringify(body)}`);
  }
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

/** @param {import('playwright').Page} page */
async function readCouncilUiState(page) {
  return page.evaluate(() => {
    const speakBusy = Boolean(
      document.querySelector('[data-testid="composer-speak-status"]') ||
        document.querySelector('[data-testid="dialogue-overlay-streaming"]') ||
        document.querySelector(".dialogue-overlay__thinking"),
    );
    const chip = document.querySelector('[data-testid="council-deliberation-chip"]');
    const banner = document.querySelector('[data-testid="council-deliberation-banner"]');
    const progress = document.querySelector('[data-testid="council-deliberation-progress"]');
    const feed = document.querySelectorAll(
      '[data-testid="council-deliberation-feed"] li, [data-testid="council-deliberation-feed"] .council-deliberation-feed__row',
    );
    const toasts = document.querySelectorAll('[data-testid="council-vote-toast"]');
    return {
      speakBusy,
      chipVisible: Boolean(chip),
      chipTitle: chip?.textContent?.trim() ?? "",
      bannerVisible: Boolean(banner),
      bannerText: banner?.textContent?.trim() ?? "",
      progressText: progress?.textContent?.trim() ?? "",
      feedRowCount: feed.length,
      toastCount: toasts.length,
      composerBusy: document
        .querySelector("textarea.composer__input")
        ?.getAttribute("aria-busy") === "true",
    };
  });
}

/** Submit speak and wait until NPC thinking/busy — do not wait for reply. */
async function submitSpeakAndWaitBusy(page, text) {
  await closeShellDrawer(page);
  await engageDialogueRobust(page, 60_000);

  const composer = page.locator("textarea.composer__input");
  await page.waitForFunction(
    () => {
      const input = document.querySelector("textarea.composer__input");
      return input && !input.disabled && input.getAttribute("aria-busy") !== "true";
    },
    { timeout: speakTimeoutMs },
  );

  await composer.fill(text);
  await page.locator("button.composer__submit").click();

  await page.locator(THINKING_LOCATOR).first().waitFor({ state: "visible", timeout: 30_000 });
}

async function waitSpeakIdle(page, timeoutMs) {
  await page.waitForFunction(
    () => {
      const busyStatus = document.querySelector('[data-testid="composer-speak-status"]');
      const thinking = document.querySelector(".dialogue-overlay__thinking");
      const streaming = document.querySelector('[data-testid="dialogue-overlay-streaming"]');
      const input = document.querySelector("textarea.composer__input");
      const composerBusy = input?.getAttribute("aria-busy") === "true";
      return !busyStatus && !thinking && !streaming && !composerBusy;
    },
    { timeout: timeoutMs },
  );
}

async function main() {
  const t0 = Date.now();
  assertE2eNoMock("uat:phase25:speak-defer");
  assertE2eRealLlm("uat:phase25:speak-defer");

  log(`uat:phase25:speak-defer → ${webUrl}`);
  log(`screenshots → ${OUT_DIR.replace(`${root}/`, "")}`);
  log(`timeoutMs=${phaseTimeoutMs}\n`);

  await healthOk();

  const playerId = `uatp25t7${String(Date.now()).slice(-8)}`;
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

    // Sanity: Colyseus must receive councilDeliberationSync on this shard before speak defer test.
    await pushCouncilSync({
      active: true,
      voteKind: "regular",
      phase: "proposal",
      round: 0,
      roundTotal: 2,
      proposalTitle: "UAT-07 preflight",
    });
    await waitFor(
      async () => page.locator('[data-testid="council-deliberation-chip"]').isVisible(),
      20_000,
      "council chip after preflight sync",
    );
    log("Preflight sync OK — client receives councilDeliberationSync");

    const speakText = "用一句话简短问好即可。";
    log("Submitting speak (real LLM)…");
    await submitSpeakAndWaitBusy(page, speakText);
    await screenshot(page, "02-speak-busy");

    const busyAfterSubmit = await readCouncilUiState(page);
    recordAssertion(
      "speak-busy-active",
      busyAfterSubmit.speakBusy || busyAfterSubmit.composerBusy,
      JSON.stringify(busyAfterSubmit),
    );

    const proposalTitle = "UAT-07：重建始源区驿道";
    log("Injecting council-deliberation-sync while speak busy…");
    await pushCouncilSync({
      active: true,
      voteKind: "regular",
      phase: "proposal",
      round: 0,
      roundTotal: 2,
      proposalTitle,
    });
    await page.waitForTimeout(400);

    await waitFor(
      async () => (await readCouncilUiState(page)).chipVisible,
      15_000,
      "chip after deliberation sync inject",
    );
    await openShellDrawerCouncil(page);
    const afterStartSync = await readCouncilUiState(page);
    const feedCountBeforeDefer = afterStartSync.feedRowCount;
    await screenshot(page, "03-chip-progress-during-speak");

    recordAssertion("chip-visible-during-speak", afterStartSync.chipVisible, afterStartSync.chipTitle);
    recordAssertion("banner-visible-during-speak", afterStartSync.bannerVisible, afterStartSync.bannerText);
    recordAssertion(
      "progress-visible-during-speak",
      afterStartSync.progressText.length > 0,
      afterStartSync.progressText,
    );

    await pushCouncilSync({
      active: true,
      voteKind: "regular",
      phase: "debate",
      round: 1,
      roundTotal: 2,
      proposalTitle,
      feedDelta: [
        {
          kind: "quote",
          npcId: "npc-2",
          displayName: "苏映棠",
          text: "据近期旅者言行，驿道确需优先修缮。",
          travelerRef: true,
        },
      ],
    });
    await page.waitForTimeout(300);

    await pushCouncilSync({
      active: true,
      voteKind: "regular",
      phase: "debate",
      round: 2,
      roundTotal: 2,
      proposalTitle,
      feedDelta: [
        {
          kind: "quote",
          npcId: "npc-3",
          displayName: "顾长策",
          text: "预算应留作万界崩裂纪后的应急储备。",
        },
      ],
    });
    await page.waitForTimeout(300);

    const duringSpeak = await readCouncilUiState(page);
    await screenshot(page, "04-feed-toast-deferred-during-speak");

    recordAssertion(
      "feed-deltas-deferred-during-speak",
      duringSpeak.feedRowCount === feedCountBeforeDefer,
      `feed before=${feedCountBeforeDefer} during=${duringSpeak.feedRowCount}`,
    );
    recordAssertion(
      "toast-deferred-during-speak",
      duringSpeak.toastCount === 0,
      `toasts=${duringSpeak.toastCount}`,
    );
    recordAssertion(
      "progress-advanced-during-speak",
      duringSpeak.progressText.includes("2"),
      duringSpeak.progressText,
    );
    recordAssertion(
      "still-speak-busy",
      duringSpeak.speakBusy || duringSpeak.composerBusy,
      JSON.stringify({ speakBusy: duringSpeak.speakBusy, composerBusy: duringSpeak.composerBusy }),
    );

    await pushCouncilSync({
      active: true,
      voteKind: "regular",
      phase: "sealed",
      round: 2,
      roundTotal: 2,
      proposalTitle,
      resultEntryId: `uat-07-${Date.now()}`,
      yesCount: 7,
      noCount: 4,
      status: "accepted",
    });
    await page.waitForTimeout(300);
    const duringSealed = await readCouncilUiState(page);
    recordAssertion(
      "result-toast-deferred-during-speak",
      duringSealed.toastCount === 0,
      `toasts=${duringSealed.toastCount}`,
    );
    await screenshot(page, "05-sealed-toast-deferred-during-speak");

    log("Waiting for speak to complete…");
    await waitSpeakIdle(page, speakTimeoutMs);
    await page.waitForTimeout(1000);

    const afterSpeak = await readCouncilUiState(page);

    await waitFor(
      async () => (await readCouncilUiState(page)).toastCount > 0,
      20_000,
      "deferred toast flush after speak",
    );
    const afterToast = await readCouncilUiState(page);
    recordAssertion(
      "toast-flushed-after-speak",
      afterToast.toastCount > 0,
      `toasts=${afterToast.toastCount}`,
    );
    await screenshot(page, "06-toast-after-speak-flush");

    // Re-activate deliberation panel so flushed feed rows render in drawer (active=false on sealed).
    await pushCouncilSync({
      active: true,
      voteKind: "regular",
      phase: "debate",
      round: 2,
      roundTotal: 2,
      proposalTitle,
    });
    await openShellDrawerCouncil(page);
    const afterFeedReveal = await readCouncilUiState(page);
    await screenshot(page, "07-feed-rows-after-flush");
    recordAssertion(
      "feed-flushed-after-speak",
      afterFeedReveal.feedRowCount >= 2,
      `feedRows=${afterFeedReveal.feedRowCount}`,
    );

    report.pass = true;
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Date.now() - t0;
    await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
    log(`\n✅ UAT Test 7 PASS (${Math.round(report.elapsedMs / 1000)}s)`);
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
  console.error(`\n❌ uat:phase25:speak-defer failed: ${err.message}`);
  process.exit(1);
});
