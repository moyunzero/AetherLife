/**
 * Debug lore discover toast — Playwright smoke (dev:stack required).
 * Usage: node scripts/debug-lore-toast.mjs
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = process.env.WEB_URL || "http://localhost:5173";
const ROOM = process.env.DEBUG_ROOM_ID || `toast-debug-${Date.now()}`;
const URL = `${WEB}${WEB.includes("?") ? "&" : "?"}room=${encodeURIComponent(ROOM)}`;
const outDir = path.join(ROOT, ".planning/phases/11-llm-world-lore/uat-screenshots/toast-debug");
const E2E_LORE_TIMEOUT_MS = Number.parseInt(process.env.E2E_LORE_TIMEOUT_MS || "", 10) || 120_000;

async function loadPlaywright() {
  const pwEntry = path.join(ROOT, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  return pw.chromium ?? pw.default?.chromium;
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) throw new Error("playwright missing in scripts/.pw-deps");

  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log(`→ ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector('[data-testid="room-scene"]', { timeout: 60_000 });

  const phaserParent = await page.locator('[data-testid="phaser-parent"]').count();
  const fallback = await page.locator('[data-testid="phaser-fallback-banner"]').count();
  console.log(`render path: phaser-parent=${phaserParent} fallback-banner=${fallback}`);

  await page.waitForSelector('[data-testid="explore-place-name"]', { timeout: 30_000 });
  const homeName = await page.locator('[data-testid="explore-place-name"]').innerText();
  console.log(`home place: ${homeName.trim()}`);

  await page.locator('[data-testid="phaser-parent"]').click({ position: { x: 120, y: 120 } });
  await page.waitForTimeout(300);

  // North into fresh negative-Y chunks (new room → no DB cache).
  for (let i = 0; i < 28; i += 1) {
    await page.keyboard.press("w");
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1000);

  const pending = await page.locator('[data-testid="lore-pending-hint"]').isVisible().catch(() => false);
  const meta = await page.locator(".explore-coords-strip__meta").innerText().catch(() => "");
  console.log(`after move: pending=${pending} meta=${meta.trim()}`);
  await page.screenshot({ path: path.join(outDir, "01-after-move.png"), fullPage: true });

  const started = Date.now();
  let sawPending = pending;
  let ready = false;
  while (Date.now() - started < E2E_LORE_TIMEOUT_MS) {
    const p = await page.locator('[data-testid="lore-pending-hint"]').isVisible().catch(() => false);
    if (p) sawPending = true;
    const name = (await page.locator('[data-testid="explore-place-name"]').innerText()).trim();
    const hasFlavor = name.includes("·");
    if (!p && hasFlavor && !name.includes("晨曦村")) {
      ready = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  const placeName = (await page.locator('[data-testid="explore-place-name"]').innerText()).trim();
  console.log(`sawPending=${sawPending} ready=${ready} place=${placeName} elapsed=${Date.now() - started}ms`);

  const toastVisible = await page
    .locator('[data-testid="lore-discover-toast"]')
    .isVisible()
    .catch(() => false);
  console.log(`toast visible at ready: ${toastVisible}`);
  await page.screenshot({ path: path.join(outDir, "02-at-ready.png"), fullPage: true });

  if (!toastVisible) {
    await page.waitForTimeout(2000);
    const toastLater = await page
      .locator('[data-testid="lore-discover-toast"]')
      .isVisible()
      .catch(() => false);
    console.log(`toast visible +2s: ${toastLater}`);
    await page.screenshot({ path: path.join(outDir, "03-after-wait.png"), fullPage: true });
    if (!toastLater) {
      const queueProbe = await page.evaluate(() => {
        const canvas = document.querySelector('[data-testid="phaser-parent"] canvas');
        return {
          hasCanvas: Boolean(canvas),
          canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
        };
      });
      console.log("dom:", JSON.stringify(queueProbe));
      throw new Error("lore-discover-toast never became visible");
    }
  }

  const hook = await page.locator('[data-testid="lore-discover-toast"] .lore-discover-toast__body').innerText();
  console.log(`toast storyHook: ${hook.slice(0, 80)}...`);
  await browser.close();
  console.log("OK — toast debug passed");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
