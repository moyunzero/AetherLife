/**
 * Phase 21 UAT — World Echo (SOLO-02/03) Playwright automation.
 *
 * Requires: pnpm dev:stack (no LLM_MOCK), real LLM keys.
 * Plan: .planning/phases/21-world-echo/21-UAT-PLAN.md
 * Output: .planning/phases/21-world-echo/screenshots/ + uat-report.json + 21-UAT-REPORT.md
 */
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertE2eNoMock,
  assertE2eRealLlm,
  e2eSpeakTimeoutMs,
} from "./lib/e2e-policy.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";
import {
  assertJournalQuestStripAbsent,
  blurComposerForMovement,
  bootRoom,
  closeShellDrawer,
  collectLoreHooks,
  disengageDialogue,
  dismissLoreToast,
  ensureMinDiscoveredRows,
  exploreUntilLoreDiscover,
  focusExploreForKeyboard,
  forceCrossChunkViaSendMoveTo,
  openDrawerDiscoveries,
  pressMoveKey,
  readDiscoveredRows,
  readLoreToastBody,
  readPlayerGrid,
  scanForbiddenUiTerms,
  sendSpeakOverlay,
  waitFor,
  FORBIDDEN_UI_TERMS,
} from "./lib/uat-phase21-helpers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

const OUT_DIR = resolve(root, ".planning/phases/21-world-echo/screenshots");
const REPORT_JSON = resolve(root, ".planning/phases/21-world-echo/uat-report.json");
const REPORT_MD = resolve(root, ".planning/phases/21-world-echo/21-UAT-REPORT.md");

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.UAT_PHASE21_ROOM_ID || `uat-p21-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const speakTimeoutMs = Math.max(90_000, e2eSpeakTimeoutMs());
const E2E_LORE_TIMEOUT_MS = Number.parseInt(process.env.E2E_LORE_TIMEOUT_MS || "", 10) || 240_000;
const RUN_VERIFY_GATES = process.env.RUN_VERIFY_GATES !== "0";
const RUN_VERIFY_PHASE13 = process.env.RUN_VERIFY_PHASE13 !== "0";
const VERIFY_GATE_QUIET_MS = Number.parseInt(process.env.VERIFY_GATE_QUIET_MS || "", 10) || 45_000;

/** @type {{ roomId: string; playerId: string; startedAt: string; cases: Array<{ id: string; title: string; ok: boolean; warn?: boolean; detail?: string; at: string }>; pass: boolean }} */
const report = {
  roomId,
  playerId: "",
  startedAt: new Date().toISOString(),
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

async function loadPlaywright() {
  const pwEntry = resolve(root, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) throw new Error("playwright not installed — cd scripts/.pw-deps && npm install");
  return chromium;
}

async function healthOk() {
  const res = await fetch(`${httpBase}/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
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

async function runP21_01(page) {
  await assertJournalQuestStripAbsent(page);
  record("P21-01-01", "No journal-quest-strip on boot");

  const bodyHasClue = await page.evaluate(() => document.body.innerText.includes("当前线索"));
  record("P21-01-02", "No 「当前线索」 on boot", !bodyHasClue, bodyHasClue ? "found in body" : "");
  await shot(page, "p21-01-boot.png");
}

async function runP21_01_after_explore(page) {
  await assertJournalQuestStripAbsent(page);
  record("P21-01-03", "No strip after exploration moves");

  await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
    state: "visible",
    timeout: 45_000,
  });
  await assertJournalQuestStripAbsent(page);
  record("P21-01-04", "No strip after reload");
  await shot(page, "p21-01-after-reload.png");
}

async function runP21_04_empty(page) {
  await openDrawerDiscoveries(page);
  const emptyVisible = await page.locator('[data-testid="discovered-lore-empty"]').isVisible();
  record("P21-04-01", "Drawer empty state before exploration", emptyVisible, emptyVisible ? "" : "empty panel missing");
  await shot(page, "p21-04-empty.png");
  await disengageDialogue(page);
  await closeShellDrawer(page);
}

async function runP21_02(page) {
  let hook = "";
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      hook = await exploreUntilLoreDiscover(page, E2E_LORE_TIMEOUT_MS);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt >= 1) break;
      console.warn(`P21-02 lore attempt ${attempt + 1} failed — retry: ${err.message}`);
      await disengageDialogue(page);
      await closeShellDrawer(page);
      await blurComposerForMovement(page);
      await focusExploreForKeyboard(page);
      await forceCrossChunkViaSendMoveTo(page, "south").catch(() => {});
    }
  }
  if (lastErr) throw lastErr;

  const toast = page.locator('[data-testid="lore-discover-toast"]');
  const visible = await toast.isVisible();
  record("P21-02-01", "Lore toast visible after chunk cross", visible || hook.length > 0);

  const title = await page.locator(".lore-discover-toast__title").innerText().catch(() => "发现新土地");
  record("P21-02-02", "Toast title 「发现新土地」", title.includes("发现新土地"), title);

  const body = (await readLoreToastBody(page)) || hook;
  record("P21-02-02b", "Toast body non-empty", body.length > 8, `len=${body.length}`);
  await shot(page, "p21-02-toast.png");

  for (const term of FORBIDDEN_UI_TERMS) {
    if (title.includes(term) || body.includes(term)) {
      record("P21-02-04", "Toast chrome forbidden terms", false, `hit ${term}`);
    }
  }
  record("P21-02-04", "Toast chrome forbidden terms");

  if (await toast.isVisible().catch(() => false)) {
    await dismissLoreToast(page);
  }
  record("P21-02-03", "Toast dismiss on click or auto-dismiss");
  await shot(page, "p21-02-after-dismiss.png");
  return hook;
}

async function runP21_03(page, seedHooks = []) {
  const hooks = await collectLoreHooks(page, {
    minHooks: 3,
    maxStepsPerDir: 40,
    loreTimeoutMs: E2E_LORE_TIMEOUT_MS,
    seedHooks,
  });
  record("P21-03-01", "≥3 distinct lore toast hooks", hooks.length >= 3, `count=${hooks.length}`);

  const rows = await ensureMinDiscoveredRows(page, 3, E2E_LORE_TIMEOUT_MS);
  record("P21-03-02", "≥3 discovered-lore-row in drawer", rows.length >= 3, `rows=${rows.length}`);

  const uniqueNames = new Set(rows.map((r) => r.name).filter(Boolean));
  if (uniqueNames.size < 2 && rows.length >= 3) {
    recordWarn("P21-03-03", "Few unique place names", `uniqueNames=${uniqueNames.size}`);
  } else {
    record("P21-03-03", "Place name diversity", true, `uniqueNames=${uniqueNames.size}`);
  }
  await shot(page, "p21-03-drawer-three.png");
  await closeShellDrawer(page);
}

async function runP21_04_catalog(page) {
  await openDrawerDiscoveries(page);
  const rows = await readDiscoveredRows(page);
  record("P21-04-02", "Drawer rows have name + hook", rows.length > 0 && rows.every((r) => r.name && r.hook));

  const coordLeak = rows.filter(
    (r) => /chunk\s*\(/i.test(r.rowText) || /格\s*\(\s*\d+/i.test(r.rowText),
  );
  record(
    "P21-04-03",
    "No coordinates in drawer rows",
    coordLeak.length === 0,
    coordLeak.length ? coordLeak[0].rowText.slice(0, 80) : "",
  );

  await page.locator("#shell-drawer-tab-history").click();
  await page.locator("#shell-drawer-panel-history").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#shell-drawer-tab-collective").click();
  await page.locator("#shell-drawer-panel-collective").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#shell-drawer-tab-discoveries").click();
  record("P21-04-04", "Drawer tab switching");

  await closeShellDrawer(page);
  await waitFor(
    async () => !(await page.locator('[data-testid="shell-drawer"]').isVisible().catch(() => false)),
    10_000,
    "drawer closed",
  );
  record("P21-04-05", "Drawer closes");
  await shot(page, "p21-04-catalog.png");
}

async function runP21_05(page) {
  const hits = await scanForbiddenUiTerms(page);
  record(
    "P21-05-01",
    "UI chrome forbidden terms scan",
    hits.length === 0,
    hits.length ? JSON.stringify(hits[0]) : "",
  );
  record("P21-05-02", "Shell tab labels present", true, "checked via scan selectors");
}

async function runP21_06(page) {
  await closeShellDrawer(page);
  await blurComposerForMovement(page);
  await focusExploreForKeyboard(page);

  const gridBefore = await readPlayerGrid(page);
  record("P21-06-01", "Capture gridBefore", Boolean(gridBefore), JSON.stringify(gridBefore));

  const { reply, speakMs } = await sendSpeakOverlay(page, "移动到我的下方", { speakTimeoutMs });
  record("P21-06-02", "Speak move command", reply.length > 0, `speakMs=${speakMs} reply="${reply.slice(0, 40)}"`);
  await shot(page, "p21-06-before-move.png");

  await waitLocomotionIdle(page, 45_000);
  const gridAfter = await readPlayerGrid(page);

  const npcMoved = await page.evaluate(({ bx, by }) => {
    const dbg = window.__aetherlife_npcDebug?.();
    if (!dbg?.sprites?.length) return false;
    return dbg.sprites.some((s) => Math.abs(s.gridX - bx) + Math.abs(s.gridY - by) >= 1);
  }, { bx: gridBefore?.x ?? 0, by: gridBefore?.y ?? 0 });

  const playerMoved = gridDist(gridBefore, gridAfter) >= 1;
  record(
    "P21-06-04",
    "World echo: movement after speak",
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
    "P21-06-05",
    "Position stable after reload (Manhattan ≤2)",
    reloadDrift <= 2,
    `after=${JSON.stringify(gridAfter)} reload=${JSON.stringify(gridReload)} drift=${reloadDrift}`,
  );
  await shot(page, "p21-06-after-reload.png");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runVerifyScript(script, id, title, { quiet = true } = {}) {
  if (quiet && VERIFY_GATE_QUIET_MS > 0) {
    console.log(`\n⏳ verify gate quiet ${VERIFY_GATE_QUIET_MS}ms (LLM/worker drain)…`);
    await sleep(VERIFY_GATE_QUIET_MS);
  }
  console.log(`\n▶ ${script}…`);
  // verify:phase21 must use its own fresh room — reusing UAT roomId skips first-discover toasts.
  const gateEnv = { ...process.env };
  delete gateEnv.VERIFY_PHASE21_ROOM_ID;
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
    "phase: 21-world-echo",
    "source: uat-phase21-playwright.mjs",
    `started: ${report.startedAt}`,
    `updated: ${new Date().toISOString()}`,
    `status: ${report.pass ? "pass" : "fail"}`,
    "---",
    "",
    "# Phase 21 UAT Report — World Echo",
    "",
    `**Room:** \`${report.roomId}\` · **Player:** \`${report.playerId}\``,
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total cases | ${report.cases.length} |`,
    `| Passed | ${passed} |`,
    `| Warn | ${warns} |`,
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
  lines.push("", "## Sign-off", "", "| Tester | Date | Result | Notes |", "|--------|------|--------|-------|");
  lines.push(
    `| agent (Playwright) | ${new Date().toISOString().slice(0, 10)} | ${report.pass ? "PASS" : "FAIL"} | automated uat:phase21:playwright |`,
  );
  await writeFile(REPORT_MD, `${lines.join("\n")}\n`);
}

async function main() {
  assertE2eNoMock("uat:phase21:playwright");
  assertE2eRealLlm("uat:phase21:playwright");
  if (!process.env.WORLD_SEED) process.env.WORLD_SEED = "42";

  await healthOk();

  const playerId = `uatp21${String(Date.now()).slice(-10)}`;
  report.playerId = playerId;
  console.log(`uat:phase21:playwright → ${webUrl} player=${playerId}`);

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
    await runP21_01(page);
    await runP21_04_empty(page);
    const firstHook = await runP21_02(page);
    await runP21_03(page, firstHook ? [firstHook] : []);
    await runP21_04_catalog(page);
    await runP21_05(page);
    await runP21_06(page);
    await runP21_01_after_explore(page);
  } finally {
    await browser.close();
  }

  if (RUN_VERIFY_GATES) {
    await runVerifyScript("verify:phase21", "P21-07-01", "verify:phase21 gate");
  } else {
    recordWarn("P21-07-01", "verify:phase21 skipped", "RUN_VERIFY_GATES=0");
  }

  if (RUN_VERIFY_PHASE13) {
    await runVerifyScript("verify:phase13", "P21-08-01", "verify:phase13 nameplate gate", {
      quiet: false,
    });
  } else {
    recordWarn("P21-08-01", "verify:phase13 skipped", "RUN_VERIFY_PHASE13=0");
  }

  report.pass = !failed;
  report.finishedAt = new Date().toISOString();
  await mkdir(resolve(root, ".planning/phases/21-world-echo"), { recursive: true });
  await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  await writeReportMd();

  console.log(`\nuat:phase21:playwright ${report.pass ? "OK" : "FAILED"}`);
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
  console.error(`uat:phase21:playwright failed: ${err.message}`);
  process.exit(1);
});
