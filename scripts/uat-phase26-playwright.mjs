/**
 * Phase 26 UAT — Playwright automation + screenshots.
 *
 * Tests:
 *   1. verify:phase26 ship gate (MAP-05)
 *   2. verify:phase13 nameplate regression (VIS-04)
 *   3. Golden flows GF-01/02/03 (via verify scripts)
 *   4. Proximity speak UX (npc-4 / npc-12)
 *
 * Requires: pnpm dev:stack (no LLM_MOCK). WEB_URL=http://localhost:5173 if Vite IPv6-only.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertE2eNoMock,
  assertE2eRealLlm,
  e2eSpeakTimeoutMs,
} from "./lib/e2e-policy.mjs";
import { engageDialogue } from "./lib/dialogue-engage.mjs";
import { closeShellDrawer, sendSpeakOverlay } from "./lib/e2e-memory-helpers.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";
import { healthOk, loadPlaywright } from "./lib/speak-browser-stack.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);
assertE2eNoMock();
assertE2eRealLlm("uat:phase26");

const PHASE_DIR = resolve(root, ".planning/phases/26-council-map-presence");
const OUT_BASE = resolve(PHASE_DIR, "uat-screenshots");
const REPORT_JSON = resolve(PHASE_DIR, "uat-report.json");

const webBase = process.env.WEB_URL || "http://localhost:5173";
const httpBase = gameServerHttpBase();
const speakTimeoutMs = Math.max(120_000, e2eSpeakTimeoutMs());
const engageTimeoutMs = Math.max(90_000, speakTimeoutMs / 2);

/** @type {{ startedAt: string; tests: Array<{id:number;name:string;pass:boolean;detail:string;screenshots:string[]}>; pass: boolean; finishedAt?: string }} */
const report = {
  startedAt: new Date().toISOString(),
  tests: [],
  pass: false,
};

function log(msg) {
  console.log(`[uat:phase26] ${msg}`);
}

function runCmd(label, cmd, args, env = {}) {
  return new Promise((resolvePromise, reject) => {
    log(`→ ${label}: ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("close", (code) => {
      if (code === 0) resolvePromise(undefined);
      else reject(new Error(`${label} exit ${code}`));
    });
  });
}

async function record(id, name, pass, detail, screenshots = []) {
  report.tests.push({ id, name, pass, detail, screenshots });
  log(`${pass ? "✓" : "✗"} Test ${id}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function shot(page, subdir, filename) {
  const dir = resolve(OUT_BASE, subdir);
  await mkdir(dir, { recursive: true });
  const file = resolve(dir, filename);
  await page.screenshot({ path: file, fullPage: true });
  const rel = file.replace(`${root}/`, "");
  log(`  📸 ${rel}`);
  return rel;
}

async function waitMoveIdle(page, timeoutMs = 60_000) {
  await page
    .waitForFunction(
      () => {
        const d = window.__aetherlife_moveDebug?.();
        return d != null && d.pending === 0 && !d.locomoting;
      },
      { timeout: timeoutMs },
    )
    .catch(() => undefined);
}

async function moveNearNpc(page, npcId) {
  await page.evaluate((id) => {
    const dbg = window.__aetherlife_npcDebug?.();
    const npc = dbg?.npcs?.find((n) => n.id === id);
    if (!npc) throw new Error(`npc ${id} not found`);
    const fn = window.__aetherlife_sendMoveTo;
    if (typeof fn !== "function") throw new Error("__aetherlife_sendMoveTo missing");
    fn(npc.x, npc.y + 1);
  }, npcId);
  await waitMoveIdle(page);
  await page.waitForTimeout(400);
}

async function testProximitySpeak() {
  const subdir = "test-04-proximity-speak";
  const shots = [];
  const roomId = process.env.UAT_PHASE26_ROOM_ID || `uat-p26-prox-${Date.now()}`;
  const playerId = `uatp26${String(Date.now()).slice(-10)}`;
  const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    await ctx.addInitScript(
      ({ key, id }) => {
        localStorage.setItem(key, id);
      },
      { key: "aetherlife:playerId", id: playerId },
    );
    const page = await ctx.newPage();
    page.setDefaultTimeout(speakTimeoutMs);

    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
      state: "visible",
      timeout: 45_000,
    });
    await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () =>
        Boolean(
          document.querySelector('[data-testid="corner-menu"] .corner-menu__status-dot--ok'),
        ),
      { timeout: 60_000 },
    );
    shots.push(await shot(page, subdir, "01-room-boot.png"));

    const snap = await page.evaluate(() => {
      const fn = window.__aetherlife_npcDebug;
      if (typeof fn !== "function") return { ok: false, count: 0 };
      const npcs = fn()?.npcs ?? [];
      return { ok: npcs.length >= 12, count: npcs.length };
    });
    if (!snap.ok) throw new Error(`expected ≥12 NPCs, got ${snap.count}`);

    for (const npcId of ["npc-4", "npc-12"]) {
      await moveNearNpc(page, npcId);
      shots.push(await shot(page, subdir, `02-near-${npcId}.png`));

      const activeId = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="npc-composer"]');
        return el?.getAttribute("data-active-npc-id") ?? null;
      });
      // Fallback: read from React debug hook if present
      const activeFromDebug =
        activeId ??
        (await page.evaluate(() => window.__aetherlife_activeNpcDebug?.() ?? null));

      await closeShellDrawer(page);
      await engageDialogue(page, { timeoutMs: engageTimeoutMs });
      const reply = await sendSpeakOverlay(page, `你好 ${npcId}，UAT 测试。`, {
        speakTimeoutMs,
        engageTimeoutMs,
        skipEngage: true,
      });
      log(`  speak ${npcId}: ${reply.reply.slice(0, 40)}…`);
      shots.push(await shot(page, subdir, `03-speak-${npcId}.png`));
    }

    await record(4, "Proximity speak UX (npc-4 / npc-12)", true, "speak + screenshots OK", shots);
  } finally {
    await browser.close();
  }
}

async function main() {
  await healthOk();
  log(`web=${webBase} gs=${httpBase}`);

  const test1Dir = resolve(OUT_BASE, "test-01-verify-phase26");
  await mkdir(test1Dir, { recursive: true });

  // Test 1: verify:phase26
  try {
    await runCmd("verify:phase26", "pnpm", ["verify:phase26"], {
      VERIFY_PHASE26_SCREENSHOT_DIR: test1Dir,
      WEB_URL: webBase,
    });
    await record(1, "verify:phase26 ship gate", true, "exit 0", [`${test1Dir.replace(`${root}/`, "")}/`]);
  } catch (err) {
    await record(1, "verify:phase26 ship gate", false, err.message);
    throw err;
  }

  // Test 2: verify:phase13
  const test2Dir = resolve(OUT_BASE, "test-02-verify-phase13");
  await mkdir(test2Dir, { recursive: true });
  try {
    await runCmd("verify:phase13", "pnpm", ["verify:phase13"], { WEB_URL: webBase });
    await record(2, "verify:phase13 nameplate regression", true, "exit 0");
  } catch (err) {
    await record(2, "verify:phase13 nameplate regression", false, err.message);
    throw err;
  }

  // Test 3: golden flows (subset via agent verify e2e scripts if available)
  try {
    await runCmd("verify:phase6:move-only", "pnpm", ["verify:phase6:move-only"], { WEB_URL: webBase });
    await record(3, "Golden flow GF-02 (move-only)", true, "exit 0");
  } catch (err) {
    await record(3, "Golden flow GF-02 (move-only)", false, err.message);
    // non-fatal — continue to proximity test
  }

  // Test 4: proximity speak
  await testProximitySpeak();

  report.pass = report.tests.every((t) => t.pass);
  report.finishedAt = new Date().toISOString();
  await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  log(`Report → ${REPORT_JSON.replace(`${root}/`, "")}`);
  if (!report.pass) process.exit(1);
  log("UAT PASS");
}

main().catch((err) => {
  report.finishedAt = new Date().toISOString();
  writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  console.error(`[uat:phase26] FAILED: ${err.message}`);
  process.exit(1);
});
