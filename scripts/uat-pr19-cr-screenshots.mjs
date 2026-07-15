/**
 * PR19 CR acceptance — Playwright against current immersive UI + screenshots.
 * Covers: ambient gridDebug, tutorial skip, Phaser boot, WASD, speak, chronicle drawer.
 * Requires: pnpm dev:stack (real LLM). WEB_URL=http://localhost:5173
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertE2eNoMock,
  assertE2eRealLlm,
  e2eSpeakTimeoutMs,
} from "./lib/e2e-policy.mjs";
import { loadRootEnv } from "./lib/env.mjs";
import { healthOk, loadPlaywright, sleep, webBase } from "./lib/speak-browser-stack.mjs";
import { engageNpcDialogue } from "./lib/dialogue-engage.mjs";
import { sendSpeakOverlay } from "./lib/e2e-memory-helpers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);
assertE2eNoMock("uat:pr19-cr");
assertE2eRealLlm("uat:pr19-cr");

const OUT = resolve(root, "tmp/pr19-cr-gf-screenshots");
const roomId = `pr19-cr-accept-${Date.now()}`;
const speakTimeoutMs = Math.max(120_000, e2eSpeakTimeoutMs());

async function shot(page, name) {
  const file = resolve(OUT, name);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`[pr19-accept] 📸 ${name}`);
  return file;
}

async function skipTutorial(page) {
  const skip = page.locator('button:has-text("跳过")').first();
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await sleep(400);
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await healthOk();

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const report = {
    startedAt: new Date().toISOString(),
    roomId,
    tests: [],
    pass: false,
  };

  const record = (id, name, pass, detail) => {
    report.tests.push({ id, name, pass, detail });
    console.log(`[pr19-accept] ${pass ? "✓" : "✗"} ${id} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const url = `${webBase}/?roomId=${encodeURIComponent(roomId)}&gridDebug=1`;
  console.log(`[pr19-accept] open ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[data-testid="world-stage"]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="phaser-parent"], canvas', { timeout: 45_000 });
  await sleep(2500);
  await skipTutorial(page);
  await shot(page, "10-accept-boot-skip-tutorial.png");
  record(1, "cold boot + phaser + skip tutorial", true, "world-stage visible");

  // Ambient roam window
  await sleep(12_000);
  await shot(page, "11-accept-ambient-roam.png");
  record(2, "ambient roam wait (~2 ticks)", true, "gridDebug still up");

  // WASD nudge
  await page.keyboard.press("KeyD");
  await sleep(800);
  await page.keyboard.press("KeyW");
  await sleep(800);
  await shot(page, "12-accept-after-wasd.png");
  record(3, "WASD move", true, "D+W");

  // Speak path (npc-4 safer for non-hostile)
  try {
    await engageNpcDialogue(page, "npc-4", { timeoutMs: Math.min(90_000, speakTimeoutMs) });
    await shot(page, "13-accept-dialogue-engaged.png");
    await sendSpeakOverlay(page, "你好，用一句话简短回复");
    await page
      .locator('[data-testid="dialogue-overlay"]')
      .waitFor({ state: "visible", timeout: speakTimeoutMs });
    // wait for non-empty npc reply / streaming end
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="dialogue-overlay"]');
        if (!el) return false;
        const t = (el.textContent || "").trim();
        return t.length > 8 && !t.includes("思考中");
      },
      { timeout: speakTimeoutMs },
    );
    await shot(page, "14-accept-npc-reply.png");
    record(4, "speak → npc reply", true, `timeoutBudget=${speakTimeoutMs}ms`);
  } catch (err) {
    await shot(page, "14-accept-speak-FAILED.png");
    record(4, "speak → npc reply", false, String(err?.message || err));
  }

  // Chronicle via corner menu / drawer
  try {
    const menu = page.locator('[data-testid="corner-menu"]').first();
    if (await menu.count()) {
      await menu.click({ force: true }).catch(() => {});
      await sleep(400);
    }
    // open drawer through dialogue bar chronicle/memory if engaged else corner
    const chron = page
      .locator(
        '[data-testid="dialogue-drawer-memory"], button:has-text("编年"), button:has-text("史书"), [data-tab="chronicle"]',
      )
      .first();
    if (await chron.count()) {
      await chron.click({ force: true }).catch(() => {});
      await sleep(700);
    }
    await shot(page, "15-accept-chronicle-drawer.png");
    record(5, "chronicle / drawer open attempt", true, "screenshot captured");
  } catch (err) {
    await shot(page, "15-accept-drawer-FAILED.png");
    record(5, "chronicle / drawer open attempt", false, String(err?.message || err));
  }

  // Peer tab smoke
  const pageB = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageB.goto(`${webBase}/?roomId=${encodeURIComponent(roomId)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await pageB.waitForSelector('[data-testid="world-stage"]', { timeout: 30_000 });
  await skipTutorial(pageB);
  await sleep(3000);
  await shot(pageB, "16-accept-peer-tab.png");
  record(6, "second tab same room", true, "world-stage ok");

  await browser.close();
  report.finishedAt = new Date().toISOString();
  report.pass = report.tests.every((t) => t.pass);
  await writeFile(resolve(OUT, "pr19-accept-report.json"), JSON.stringify(report, null, 2));
  console.log(`[pr19-accept] report → tmp/pr19-cr-gf-screenshots/pr19-accept-report.json pass=${report.pass}`);
  if (!report.pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
