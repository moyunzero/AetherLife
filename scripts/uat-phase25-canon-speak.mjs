/**
 * Phase 25 UAT Test 9 — Canon RAG in speak after vote (D-VOTE-RAG-01…04).
 *
 * Flow: seed collective/speak → force world-vote → wait accepted toast →
 * speak canon question → reply matches CANON_HEURISTIC (verify:phase25 slice).
 *
 * Requires: pnpm dev:stack + VOTE_FORCE_TRIGGER=1, real LLM keys.
 * Output: .planning/phases/25-council-vote-debate/uat-screenshots/test-09-canon-speak/
 *         + uat-test-09-report.json
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
  ".planning/phases/25-council-vote-debate/uat-screenshots/test-09-canon-speak",
);
const REPORT_JSON = resolve(
  root,
  ".planning/phases/25-council-vote-debate/uat-test-09-report.json",
);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.UAT_PHASE25_ROOM_ID || `uat-p25-t9-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const speakTimeoutMs = Math.max(120_000, e2eSpeakTimeoutMs());
const engageTimeoutMs = Math.max(90_000, speakTimeoutMs / 2);
const phaseTimeoutMs =
  Number.parseInt(process.env.UAT_PHASE25_CANON_TIMEOUT_MS || "900000", 10) || 900_000;
const BANNER_WAIT_MS = Number.parseInt(process.env.E2E_BANNER_WAIT_MS || "", 10) || 90_000;

const CANON_HEURISTIC =
  /万界崩裂|始源区|十二议会|太乙万界|崩裂纪|位面|Beginning Fields|诸界/i;

const CANON_QUESTION = "议会记载的万界崩裂纪和始源区是怎么来的？";

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
  test: 9,
  name: "Canon RAG in speak after vote",
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
  await page
    .locator('[data-testid="explore-coords-strip"]')
    .waitFor({ state: "visible", timeout: 90_000 })
    .catch(() => {});
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-testid="corner-menu"] .corner-menu__status-dot--ok'),
      ),
    { timeout: 90_000 },
  );
  await page.waitForTimeout(4000);
  const coach = page.locator('[data-testid="onboarding-coach"]');
  if (await coach.isVisible().catch(() => false)) {
    await page.locator(".onboarding-coach__skip").click().catch(() => {});
  }
}

async function bootRoomWithRetry(page, maxAttempts = 3) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt > 1) {
        log(`  boot retry ${attempt}/${maxAttempts}…`);
        await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
      } else {
        await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      }
      await waitRoomReady(page);
      await engageDialogueRobust(page, 90_000);
      return;
    } catch (err) {
      lastErr = err;
      await screenshot(page, `boot-retry-${attempt}-fail`).catch(() => {});
    }
  }
  throw lastErr ?? new Error("bootRoomWithRetry failed");
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
        for (const fx of [0.5, 0.35, 0.65, 0.25, 0.75]) {
          for (const fy of [0.5, 0.35, 0.65, 0.25, 0.75]) {
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

async function main() {
  const t0 = Date.now();
  assertE2eNoMock("uat:phase25:canon-speak");
  assertE2eRealLlm("uat:phase25:canon-speak");

  log(`uat:phase25:canon-speak → ${webUrl}`);
  log(`screenshots → ${OUT_DIR.replace(`${root}/`, "")}`);
  log(`timeoutMs=${phaseTimeoutMs}\n`);

  await healthOk();

  const playerId = `uatp25t9${String(Date.now()).slice(-8)}`;
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

    await bootRoomWithRetry(page);
    await screenshot(page, "01-room-ready");

    await waitFor(
      async () => (await fetchNpcRelationships()).length >= 1,
      120_000,
      "npc_relationships seeded",
    );

    log("Seed collective + speak context…");
    await sendSpeakOverlay(page, "你真没礼貌，滚开", {
      speakTimeoutMs,
      engageTimeoutMs,
      skipEngage: true,
    });
    await waitFor(
      async () => {
        const rude = latestEventOfKind(
          (await fetchCollectiveState(playerId)).recentEvents,
          playerId,
          "rude",
        );
        return Boolean(rude);
      },
      BANNER_WAIT_MS,
      "collective rude event",
    ).catch(() => log("  WARN: rude event optional — continuing"));

    await sendSpeakOverlay(page, "请记住议会应关注旅者诉求与始源区秩序", {
      speakTimeoutMs,
      engageTimeoutMs,
      skipEngage: true,
    });

    await waitFor(
      async () => {
        const ctx = await fetchWorldVoteContext();
        return (
          (ctx.collectiveSummaries ?? []).length + (ctx.speakSummaries ?? []).length >=
          1
        );
      },
      120_000,
      "vote-context summaries",
    );
    recordAssertion("vote-context-ready", true, "summaries present before vote");

    log("Triggering world vote…");
    await triggerWorldVote();
    const remainingMs = () => Math.max(30_000, phaseTimeoutMs - (Date.now() - t0));

    await waitFor(
      async () => page.locator('[data-testid="council-deliberation-chip"]').isVisible(),
      remainingMs(),
      "council-deliberation-chip",
    );

    await waitFor(
      async () => {
        const toast = page.locator('[data-testid="council-vote-toast"]');
        if (!(await toast.isVisible().catch(() => false))) return false;
        const title =
          (await toast.locator(".council-vote-toast__title").textContent().catch(() => "")) ??
          "";
        return /廷议通过|提案未采纳|纪元大议落槌/.test(title);
      },
      remainingMs(),
      "vote result toast",
    );
    await screenshot(page, "02-vote-result-toast");

    const toastTitle =
      (await page
        .locator('[data-testid="council-vote-toast"] .council-vote-toast__title')
        .textContent()
        .catch(() => "")) ?? "";
    recordAssertion(
      "vote-completed",
      /廷议通过|提案未采纳|纪元大议落槌/.test(toastTitle),
      toastTitle.trim(),
    );

    await closeShellDrawer(page);
    await engageDialogueRobust(page, 60_000);

    log(`Canon speak: "${CANON_QUESTION}"`);
    const { reply: canonReply, speakMs } = await sendSpeakOverlay(page, CANON_QUESTION, {
      speakTimeoutMs,
      engageTimeoutMs,
      skipEngage: true,
    });
    await screenshot(page, "03-canon-speak-reply");

    recordAssertion(
      "canon-reply-nonempty",
      canonReply.length > 0,
      `speakMs=${speakMs} len=${canonReply.length}`,
    );
    recordAssertion(
      "canon-heuristic-match",
      CANON_HEURISTIC.test(canonReply),
      canonReply.slice(0, 200),
    );

    report.pass = true;
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Date.now() - t0;
    await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
    log(`\n✅ UAT Test 9 PASS (${Math.round(report.elapsedMs / 1000)}s)`);
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
  console.error(`\n❌ uat:phase25:canon-speak failed: ${err.message}`);
  process.exit(1);
});
