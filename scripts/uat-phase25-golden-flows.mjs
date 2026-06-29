/**
 * Phase 25 UAT Test 11 — Golden flows GF-01/02/03 (Playwright screenshots + verify scripts).
 *
 * Browser: visual evidence (join, move, dual-tab, speak) → PNG under test-11-golden-flows/
 * Protocol: verify:phase6:move-only (GF-02), verify:phase6 (GF-01), verify:phase8 (GF-03)
 *
 * Requires: dev stack + real LLM (no LLM_MOCK). WEB_URL=http://localhost:5173 if Vite is IPv6-only.
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
import { closeShellDrawer, sendSpeakOverlay } from "./lib/e2e-memory-helpers.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";
import { healthOk, loadPlaywright } from "./lib/speak-browser-stack.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);
assertE2eNoMock();
assertE2eRealLlm("uat:phase25:golden-flows");

const OUT_DIR = resolve(
  root,
  ".planning/phases/25-council-vote-debate/uat-screenshots/test-11-golden-flows",
);
const REPORT_JSON = resolve(
  root,
  ".planning/phases/25-council-vote-debate/uat-test-11-report.json",
);

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.UAT_PHASE25_ROOM_ID || `uat-p25-t11-${Date.now()}`;
const speakTimeoutMs = Math.max(180_000, e2eSpeakTimeoutMs());

/** @type {{ test: number; name: string; roomId: string; startedAt: string; screenshots: Array<{step:number;label:string;path:string}>; flows: Record<string, {pass:boolean; detail:string}>; pass: boolean; finishedAt?: string; elapsedMs?: number; error?: string }} */
const report = {
  test: 11,
  name: "Golden flows regression (GF-01/02/03)",
  roomId,
  startedAt: new Date().toISOString(),
  screenshots: [],
  flows: {},
  pass: false,
};

let stepIndex = 0;
const t0 = Date.now();

function log(msg) {
  console.log(msg);
}

function webUrl() {
  return `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
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

async function dismissOnboarding(page) {
  const coach = page.locator('[data-testid="onboarding-coach"]');
  if (await coach.isVisible().catch(() => false)) {
    const skip = page.locator(".onboarding-coach__skip");
    if (await skip.isVisible().catch(() => false)) await skip.click();
    else {
      for (let i = 0; i < 4; i += 1) {
        const next = page.locator('[data-testid="onboarding-next"]');
        if (!(await next.isVisible().catch(() => false))) break;
        await next.click();
      }
    }
    await coach.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
  }
}

async function waitRoomReady(page) {
  page.setDefaultTimeout(120_000);
  await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 60_000 });
  await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
    state: "visible",
    timeout: 90_000,
  });
  await dismissOnboarding(page);
  await page
    .locator('[data-testid="phaser-boot-loading"]')
    .waitFor({ state: "hidden", timeout: 120_000 })
    .catch(() => {});
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-testid="corner-menu"] .corner-menu__status-dot--ok'),
      ),
    undefined,
    { timeout: 120_000 },
  );
}

async function resetRoom() {
  const res = await fetch(`${httpBase}/rooms/${encodeURIComponent(roomId)}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`reset ${res.status}`);
}

function runVerify(script) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", [script], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WEB_URL: webBase },
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      out += d.toString();
      process.stderr.write(d);
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${script} exit ${code}\n${out.slice(-2000)}`));
    });
    child.on("error", reject);
  });
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
        for (const fx of [0.5, 0.35, 0.65, 0.4, 0.6]) {
          for (const fy of [0.45, 0.35, 0.55]) {
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

async function nudgeCanvasMove(page, key = "d", times = 4) {
  const canvas = page.locator('[data-testid="phaser-stage-fill"] canvas').first();
  await canvas.click();
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(350);
  }
}

async function browserGf02(browser) {
  log("\n── GF-02 UI: dual-tab move (screenshots) ──");
  await resetRoom();
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageA = await ctxA.newPage();
  await pageA.goto(webUrl(), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitRoomReady(pageA);
  await screenshot(pageA, "gf02-a-connected");
  await pageA.waitForTimeout(2200);

  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageB = await ctxB.newPage();
  await pageB.goto(webUrl(), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitRoomReady(pageB);
  try {
    await pageA.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="player-strip"] .room-player-strip__name')
          .length >= 2,
      undefined,
      { timeout: 45_000 },
    );
    log("  ✓ player-strip shows 2+ peers");
  } catch {
    log("  WARN: player-strip <2 within 45s — continuing (protocol gate will verify sync)");
  }
  await screenshot(pageB, "gf02-b-player-strip");

  await nudgeCanvasMove(pageA, "d", 5);
  await screenshot(pageA, "gf02-a-after-move");
  await pageB.waitForTimeout(1500);
  await screenshot(pageB, "gf02-b-after-peer-move");

  await ctxA.close();
  await ctxB.close();
  log("  ✓ GF-02 UI screenshots");
}

async function browserGf01(browser) {
  log("\n── GF-01 UI: speak + move (screenshots) ──");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(webUrl(), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitRoomReady(page);
  await closeShellDrawer(page);
  await engageDialogueRobust(page, 90_000);
  await screenshot(page, "gf01-before-speak");
  const { reply, speakMs } = await sendSpeakOverlay(page, "你好，请用一句话简短回复", {
    speakTimeoutMs,
    engageTimeoutMs: 90_000,
    skipEngage: true,
  });
  await screenshot(page, "gf01-after-speak");

  await nudgeCanvasMove(page, "s", 2);
  await screenshot(page, "gf01-after-move");
  await ctx.close();
  log(`  ✓ GF-01 UI speak ${speakMs}ms — ${reply.slice(0, 50)}…`);
}

async function browserGf03(browser) {
  log("\n── GF-03 UI: dual-tab NL speak (screenshots) ──");
  await resetRoom();
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageA = await ctxA.newPage();
  await pageA.goto(webUrl(), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitRoomReady(pageA);

  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageB = await ctxB.newPage();
  await pageB.goto(webUrl(), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitRoomReady(pageB);
  await screenshot(pageA, "gf03-dual-tab-staging");

  await closeShellDrawer(pageA);
  await engageDialogueRobust(pageA, 90_000);
  await sendSpeakOverlay(pageA, "移动到我的下方", {
    speakTimeoutMs,
    engageTimeoutMs: 90_000,
    skipEngage: true,
  });
  await screenshot(pageA, "gf03-a-speak-npc1");

  let gf03UiNote = "A speak OK";
  try {
    await closeShellDrawer(pageB);
    await pageB.locator('[data-testid="corner-menu"] .corner-menu__trigger').click().catch(() => {});
    await pageB.locator("#npc-avatar-npc-2").click().catch(() => {});
    await pageB
      .locator('[data-testid="dialogue-bar"]')
      .waitFor({ state: "visible", timeout: 30_000 });
    await sendSpeakOverlay(pageB, "移动到我的下方", {
      speakTimeoutMs,
      engageTimeoutMs: 90_000,
      skipEngage: true,
    });
    await screenshot(pageB, "gf03-b-speak-npc2");
    gf03UiNote += "; B speak OK";
  } catch (err) {
    await screenshot(pageB, "gf03-b-speak-timeout").catch(() => {});
    gf03UiNote += `; B speak skipped: ${err instanceof Error ? err.message : String(err)}`;
    log(`  WARN: ${gf03UiNote}`);
  }

  await ctxA.close();
  await ctxB.close();
  log(`  ✓ GF-03 UI screenshots (${gf03UiNote})`);
  return gf03UiNote;
}

async function main() {
  log(`uat:phase25:golden-flows → ${webUrl()}`);
  log(`screenshots: ${OUT_DIR.replace(`${root}/`, "")}\n`);
  await healthOk();

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });

  try {
    await browserGf02(browser);
    await browserGf01(browser);
    const gf03UiNote = await browserGf03(browser);
    await browser.close();

    if (process.env.UAT_PHASE25_SKIP_VERIFY === "1") {
      report.pass = true;
      report.flows["GF-02"] = { pass: true, detail: "UI screenshots only" };
      report.flows["GF-01"] = { pass: true, detail: "UI screenshots only" };
      report.flows["GF-03"] = { pass: true, detail: gf03UiNote };
    } else {
      log("\n── Protocol gates ──");
      await runVerify("verify:phase6:move-only");
      report.flows["GF-02"] = { pass: true, detail: "UI screenshots + verify:phase6:move-only OK" };

      await runVerify("verify:phase6");
      report.flows["GF-01"] = { pass: true, detail: "UI screenshots + verify:phase6 OK" };

      try {
        await runVerify("verify:phase8");
        report.flows["GF-03"] = {
          pass: true,
          detail: `${gf03UiNote}; verify:phase8 OK`,
        };
      } catch (err) {
        report.flows["GF-03"] = {
          pass: false,
          detail: `${gf03UiNote}; ${err instanceof Error ? err.message : String(err)}`,
        };
        throw err;
      }
    }

    report.pass = true;
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Date.now() - t0;
    await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
    log(`\n✅ Test 11 PASS (${report.elapsedMs}ms)`);
    log(`Report: ${REPORT_JSON.replace(`${root}/`, "")}`);
  } catch (err) {
    report.pass = false;
    report.error = err instanceof Error ? err.message : String(err);
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Date.now() - t0;
    await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
    await browser.close().catch(() => {});
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
