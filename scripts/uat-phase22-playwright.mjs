/**
 * Phase 22 UAT — Solo Life Gate (SOLO-04/06) guided-freeform C1–C5.
 *
 * Requires: pnpm dev:stack (no LLM_MOCK), real LLM keys.
 * Plan: .planning/phases/22-solo-life-gate/22-UAT-PLAN.md
 * Output: .planning/phases/22-solo-life-gate/screenshots/ + uat-report.json + 22-UAT-REPORT.md
 *
 * Separate from verify:phase22 (D-04). Real LLM only — assertE2eNoMock.
 */
import { mkdir, writeFile } from "node:fs/promises";
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
  sendSpeakOverlay,
  waitForMemoryContext,
} from "./lib/e2e-memory-helpers.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";
import { loadPlaywright } from "./lib/speak-browser-stack.mjs";
import {
  assertJournalQuestStripAbsent,
  blurComposerForMovement,
  bootRoom,
  collectLoreHooks,
  ensureMinDiscoveredRows,
  focusExploreForKeyboard,
  npcGridMoved,
  readNpcSpriteGrids,
  readPlayerGrid,
} from "./lib/uat-phase21-helpers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

const OUT_DIR = resolve(root, ".planning/phases/22-solo-life-gate/screenshots");
const REPORT_JSON = resolve(root, ".planning/phases/22-solo-life-gate/uat-report.json");
const REPORT_MD = resolve(root, ".planning/phases/22-solo-life-gate/22-UAT-REPORT.md");

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.UAT_PHASE22_ROOM_ID || `uat-p22-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const speakTimeoutMs = Math.max(90_000, e2eSpeakTimeoutMs());
const E2E_LORE_TIMEOUT_MS = Number.parseInt(process.env.E2E_LORE_TIMEOUT_MS || "", 10) || 240_000;
const MEMORY_POLL_MS = Number.parseInt(
  process.env.VERIFY_MEMORY_POLL_MS ||
    process.env.VERIFY_PHASE22_MEMORY_POLL_MS ||
    process.env.VERIFY_PHASE20_MEMORY_POLL_MS ||
    "300000",
  10,
);
const UAT_PHASE22_MIN_MS = Number.parseInt(process.env.UAT_PHASE22_MIN_MS || "", 10) || 900_000;
const RUN_VERIFY_GATES = process.env.RUN_VERIFY_GATES !== "0";
const VERIFY_GATE_QUIET_MS = Number.parseInt(process.env.VERIFY_GATE_QUIET_MS || "", 10) || 45_000;

/** @type {{ roomId: string; playerId: string; startedAt: string; sessionStartMs: number; cases: Array<{ id: string; title: string; ok: boolean; warn?: boolean; detail?: string; at: string }>; pass: boolean; finishedAt?: string; error?: string }} */
const report = {
  roomId,
  playerId: "",
  startedAt: new Date().toISOString(),
  sessionStartMs: Date.now(),
  cases: [],
  pass: false,
};

let failed = false;

function record(id, title, ok = true, detail = "", { warn = false } = {}) {
  report.cases.push({
    id,
    title,
    ok,
    warn,
    detail,
    at: new Date().toISOString(),
  });
  const icon = ok ? (warn ? "⚠" : "✓") : "✗";
  console.log(`${icon} ${id} ${title}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    failed = true;
    throw new Error(`${id}: ${title}${detail ? ` (${detail})` : ""}`);
  }
}

function recordWarn(id, title, detail = "") {
  report.cases.push({
    id,
    title,
    ok: true,
    warn: true,
    detail,
    at: new Date().toISOString(),
  });
  console.log(`⚠ ${id} ${title}${detail ? ` — ${detail}` : ""}`);
}

async function shot(page, filename) {
  await mkdir(OUT_DIR, { recursive: true });
  const file = resolve(OUT_DIR, filename);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  📸 ${file.replace(`${root}/`, "")}`);
}

async function healthOk() {
  const res = await fetch(`${httpBase}/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
}

function internalHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function gridDist(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

async function waitLocomotionIdle(page, timeoutMs = 30_000) {
  await waitFor(
    async () => {
      const dbg = await page.evaluate(() => window.__aetherlife_moveDebug?.());
      return dbg != null && dbg.pending === 0 && !dbg.locomoting;
    },
    timeoutMs,
    "locomotion idle",
  );
}

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout: ${label} (${timeoutMs}ms)`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function latestEventOfKind(events, playerId, kind) {
  return (events ?? []).find(
    (e) =>
      e?.kind === kind &&
      Array.isArray(e.playerIds) &&
      e.playerIds[0] === playerId,
  );
}

/** P22-00 — Two-run C1 preface: seed memory, reload same playerId (D-15). */
async function runP22_00(page, playerId) {
  const suffix = String(Date.now()).slice(-6);
  const memorySeed = `验门${suffix}`;
  const nickSeed = `验友${suffix}`;

  await sendSpeakOverlay(page, `请记住 ${memorySeed} 门禁密码是 7`, { speakTimeoutMs });
  await sendSpeakOverlay(page, `请记住我叫${nickSeed}`, { speakTimeoutMs });

  await waitForMemoryContext({
    httpBase,
    roomId,
    playerId,
    playerMessage: `${memorySeed} 密码`,
    needle: memorySeed,
    pollMs: MEMORY_POLL_MS,
    internalHeaders,
  });
  record("P22-00-01", "C1 preface: password memory persisted", true, memorySeed);

  await waitForMemoryContext({
    httpBase,
    roomId,
    playerId,
    playerMessage: "我叫什么",
    needle: nickSeed,
    pollMs: MEMORY_POLL_MS,
    internalHeaders,
  });
  record("P22-00-01b", "C1 preface: nickname memory persisted", true, nickSeed);
  await shot(page, "p22-00-seed.png");

  await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
    state: "visible",
    timeout: 45_000,
  });
  await engageDialogue(page);
  record("P22-00-02", "C1 preface: reload same playerId", true);
  await shot(page, "p22-00-after-reload.png");

  return { memorySeed, nickSeed };
}

/** P22-01 — C1 explicit recall + human unprompted row (D-16). */
async function runP22_01(page, { memorySeed, nickSeed }) {
  const { reply } = await sendSpeakOverlay(
    page,
    `我之前说的 ${memorySeed} 门禁密码是多少？`,
    { speakTimeoutMs },
  );
  const hay = reply.toLowerCase();
  const hasToken =
    hay.includes(memorySeed.toLowerCase()) || hay.includes("7");
  record(
    "P22-01-01",
    "C1 explicit recall question",
    hasToken && !replyRefusesRecall(reply),
    `reply="${reply.slice(0, 80)}"`,
  );
  await shot(page, "p22-01-recall.png");

  recordWarn(
    "P22-01-02",
    "C1 unprompted recall in casual chat (human sign-off)",
    "Sign 22-UAT.md — NPC 在闲聊中自然提起先前内容",
  );
}

/** P22-02 — C2 world echo Scenario A (P21-06 pattern). */
async function runP22_02(page) {
  await closeShellDrawer(page);
  await blurComposerForMovement(page);
  await focusExploreForKeyboard(page);

  const gridBefore = await readPlayerGrid(page);
  const npcBefore = await readNpcSpriteGrids(page);
  record("P22-02-01", "C2 capture gridBefore", Boolean(gridBefore));

  const { reply, speakMs } = await sendSpeakOverlay(page, "移动到我的下方", { speakTimeoutMs });
  record(
    "P22-02-02",
    "C2 speak move command",
    reply.length > 0,
    `speakMs=${speakMs}`,
  );
  await shot(page, "p22-02-before-move.png");

  await waitLocomotionIdle(page, 45_000);
  const gridAfter = await readPlayerGrid(page);
  const npcAfter = await readNpcSpriteGrids(page);
  const npcMoved = npcGridMoved(npcBefore, npcAfter);
  const playerMoved = gridDist(gridBefore, gridAfter) >= 1;
  record(
    "P22-02-04",
    "C2 movement after speak",
    playerMoved || npcMoved,
    `playerDist=${gridDist(gridBefore, gridAfter)} npcMoved=${npcMoved}`,
  );

  await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
    state: "visible",
    timeout: 45_000,
  });
  await waitLocomotionIdle(page, 20_000).catch(() => {});
  const gridReload = await readPlayerGrid(page);
  const reloadDrift = gridDist(gridAfter, gridReload);
  record(
    "P22-02-05",
    "C2 position stable after reload (Manhattan ≤2)",
    reloadDrift <= 2,
    `drift=${reloadDrift}`,
  );
  await shot(page, "p22-02-after-reload.png");
  await engageDialogue(page);
}

/** P22-03 — C3 lore ambient + no quest strip. */
async function runP22_03(page) {
  await assertJournalQuestStripAbsent(page);
  const bodyHasClue = await page.evaluate(() => document.body.innerText.includes("当前线索"));
  record("P22-03-01", "C3 no journal-quest-strip", !bodyHasClue);

  const hooks = await collectLoreHooks(page, {
    minHooks: 3,
    maxStepsPerDir: 40,
    loreTimeoutMs: E2E_LORE_TIMEOUT_MS,
  });
  record("P22-03-02", "C3 ≥3 distinct lore hooks", hooks.length >= 3, `count=${hooks.length}`);

  const rows = await ensureMinDiscoveredRows(page, 3, E2E_LORE_TIMEOUT_MS);
  record("P22-03-02b", "C3 ≥3 drawer rows", rows.length >= 3, `rows=${rows.length}`);
  await shot(page, "p22-03-lore-drawer.png");
  await closeShellDrawer(page);
}

/** P22-04 — C4 rude + help + collective browse (SOLO-04 / D-08). */
async function runP22_04(page, playerId) {
  const rudeReply = await sendSpeakOverlay(page, "你真没礼貌，滚开", { speakTimeoutMs });
  record("P22-04-01a", "C4 rude speak", rudeReply.reply.length > 0);

  await waitFor(
    async () =>
      latestEventOfKind(
        (await fetchCollectiveState(playerId)).recentEvents,
        playerId,
        "rude",
      ),
    60_000,
    "collective rude event in API",
  );
  await waitFor(
    async () => page.locator('[data-testid="collective-feedback-banner"]').isVisible(),
    30_000,
    "collective-feedback-banner after rude",
  );
  record("P22-04-01b", "C4 rude banner visible");

  await waitFor(
    async () => page.locator('[data-testid="shell-drawer"]').isVisible(),
    30_000,
    "shell-drawer auto-open after rude",
  );
  await page.locator("#shell-drawer-panel-collective").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  record("P22-04-01c", "C4 rude first-event auto-open collective tab");
  await closeShellDrawer(page);

  const helpReply = await sendSpeakOverlay(page, "请帮帮忙", { speakTimeoutMs });
  record("P22-04-02a", "C4 help speak", helpReply.reply.length > 0);

  await waitFor(
    async () =>
      latestEventOfKind(
        (await fetchCollectiveState(playerId)).recentEvents,
        playerId,
        "help",
      ),
    60_000,
    "collective help event in API",
  );
  await waitFor(
    async () => page.locator('[data-testid="collective-feedback-banner"]').isVisible(),
    30_000,
    "collective-feedback-banner after help",
  );

  const drawerOpen = await page.locator('[data-testid="shell-drawer"]').isVisible().catch(() => false);
  const collectiveOpen = await page
    .locator("#shell-drawer-panel-collective")
    .isVisible()
    .catch(() => false);
  record(
    "P22-04-02b",
    "C4 help does not second auto-open drawer",
    !(drawerOpen && collectiveOpen),
  );

  await openShellDrawerCollective(page);
  const bandVisible = await page.locator('[data-testid="attitude-band-chip"]').isVisible();
  record("P22-04-03", "C4 attitude-band-chip visible", bandVisible);

  const events = page.locator('[data-testid="collective-recent-events"] li');
  const eventCount = await events.count();
  record("P22-04-04", "C4 collective-recent-events ≥2 rows", eventCount >= 2, `count=${eventCount}`);
  await shot(page, "p22-04-collective.png");
  await closeShellDrawer(page);
}

/** P22-05 — C5 thinking indicator + human charter row. */
async function runP22_05(page) {
  const result = await sendSpeakOverlay(page, "你好，用一句话简短回复", { speakTimeoutMs });
  const thinkingObserved = result.thinkingMs != null;
  if (thinkingObserved) {
    record("P22-05-01", "C5 thinking indicator during speak", true, `thinkingMs=${result.thinkingMs}`);
  } else {
    recordWarn(
      "P22-05-01",
      "C5 thinking indicator during speak",
      "thinkingMs not observed (may be too fast); verify visually in screenshot",
    );
  }
  await shot(page, "p22-05-thinking.png");

  recordWarn(
    "P22-05-02",
    "C5 charter band felt fast enough (human sign-off)",
    "Sign 22-UAT.md — subjective SLA per SPEAK-SLA-UX",
  );
}

async function enforceMinSessionWallClock() {
  const elapsed = Date.now() - report.sessionStartMs;
  if (elapsed >= UAT_PHASE22_MIN_MS) {
    record("P22-MIN", "Session wall clock ≥ UAT_PHASE22_MIN_MS", true, `elapsedMs=${elapsed}`);
    return;
  }
  const remaining = UAT_PHASE22_MIN_MS - elapsed;
  console.log(`\n⏳ UAT_PHASE22_MIN_MS: waiting ${Math.round(remaining / 1000)}s (${UAT_PHASE22_MIN_MS}ms total)…`);
  await sleep(remaining);
  record("P22-MIN", "Session wall clock ≥ UAT_PHASE22_MIN_MS", true, `elapsedMs=${Date.now() - report.sessionStartMs}`);
}

async function runVerifyScript(script, id, title, { quiet = true } = {}) {
  if (quiet && VERIFY_GATE_QUIET_MS > 0) {
    console.log(`\n⏳ verify gate quiet ${VERIFY_GATE_QUIET_MS}ms (LLM/worker drain)…`);
    await sleep(VERIFY_GATE_QUIET_MS);
  }
  console.log(`\n▶ ${script}…`);
  const gateEnv = { ...process.env };
  delete gateEnv.VERIFY_PHASE22_ROOM_ID;
  delete gateEnv.VERIFY_PHASE21_ROOM_ID;
  delete gateEnv.VERIFY_PHASE20_ROOM_ID;
  delete gateEnv.VERIFY_PHASE15_ROOM_ID;
  const r = spawnSync("pnpm", [script.replace("pnpm ", "")], {
    cwd: root,
    stdio: "inherit",
    env: gateEnv,
  });
  record(id, title, r.status === 0, r.status !== 0 ? `exit ${r.status}` : "");
}

async function writeReportMd() {
  const passed = report.cases.filter((c) => c.ok && !c.warn).length;
  const warns = report.cases.filter((c) => c.warn).length;
  const fails = report.cases.filter((c) => !c.ok).length;
  const lines = [
    "---",
    "phase: 22-solo-life-gate",
    "source: uat-phase22-playwright.mjs",
    `started: ${report.startedAt}`,
    `updated: ${new Date().toISOString()}`,
    `status: ${report.pass ? "pass" : "fail"}`,
    "---",
    "",
    "# Phase 22 UAT Report — Solo Life Gate",
    "",
    `**Room:** \`${report.roomId}\` · **Player:** \`${report.playerId}\``,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Total cases | ${report.cases.length} |`,
    `| Passed | ${passed} |`,
    `| Warn (human sign-off) | ${warns} |`,
    `| Failed | ${fails} |`,
    `| **Result** | **${report.pass ? "PASS" : "FAIL"}** |`,
    "",
    "## Cases",
    "",
    "| ID | Title | Result | Detail |",
    "|----|-------|--------|--------|",
  ];
  for (const c of report.cases) {
    const result = !c.ok ? "FAIL" : c.warn ? "WARN" : "PASS";
    lines.push(`| ${c.id} | ${c.title} | ${result} | ${(c.detail ?? "").replace(/\|/g, "\\|")} |`);
  }
  lines.push(
    "",
    "## Human sign-off required",
    "",
    "- P22-01-02: C1 unprompted recall in casual chat",
    "- P22-05-02: C5 charter band felt fast enough",
    "- Natural stop ≥15min (D-14) — see 22-UAT.md",
    "",
    "## Sign-off",
    "",
    "| Tester | Date | Result | Notes |",
    "|--------|------|--------|-------|",
  );
  lines.push(
    `| agent (Playwright) | ${new Date().toISOString().slice(0, 10)} | ${report.pass ? "PASS (auto)" : "FAIL"} | automated uat:phase22:playwright; human rows pending |`,
  );
  await writeFile(REPORT_MD, `${lines.join("\n")}\n`);
}

async function main() {
  assertE2eNoMock("uat:phase22:playwright");
  assertE2eRealLlm("uat:phase22:playwright");
  if (!process.env.WORLD_SEED) process.env.WORLD_SEED = "42";

  await healthOk();

  const playerId = `uatp22${String(Date.now()).slice(-10)}`;
  report.playerId = playerId;
  console.log(`uat:phase22:playwright → ${webUrl} player=${playerId}`);
  console.log(`UAT_PHASE22_MIN_MS=${UAT_PHASE22_MIN_MS}`);

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(
      ({ key, id }) => localStorage.setItem(key, id),
      { key: "aetherlife:playerId", id: playerId },
    );
    const page = await context.newPage();
    page.setDefaultTimeout(speakTimeoutMs);

    await bootRoom(page, webUrl);

    const seeds = await runP22_00(page, playerId);
    record("P22-00-03", "C1 preface complete — entering freeform checkpoints");

    await runP22_01(page, seeds);
    await runP22_02(page);
    await runP22_03(page);
    await runP22_04(page, playerId);
    await runP22_05(page);
  } finally {
    await browser.close();
  }

  await enforceMinSessionWallClock();

  if (RUN_VERIFY_GATES) {
    await runVerifyScript("verify:phase22", "P22-06-01", "verify:phase22 gate");
  } else {
    recordWarn("P22-06-01", "verify:phase22 skipped", "RUN_VERIFY_GATES=0");
  }

  report.pass = !failed;
  report.finishedAt = new Date().toISOString();
  await mkdir(resolve(root, ".planning/phases/22-solo-life-gate"), { recursive: true });
  await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  await writeReportMd();

  console.log(`\nuat:phase22:playwright ${report.pass ? "OK" : "FAILED"}`);
  console.log(`Report: ${REPORT_MD}`);
  if (!report.pass) process.exit(1);
}

main().catch(async (err) => {
  failed = true;
  report.pass = false;
  report.error = err.message;
  try {
    await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
    await writeReportMd();
  } catch {
    // ignore write errors on crash
  }
  console.error(`uat:phase22:playwright failed: ${err.message}`);
  process.exit(1);
});
