import { mkdir } from "node:fs/promises";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webUrl = process.env.WEB_URL || "http://localhost:5173";
const outDir = path.join(ROOT, ".planning/phases/07-2-5d-renderer/uat-screenshots");

async function main() {
  assertE2eNoMock("uat:phase7:playwright");
  const pwEntry = path.join(ROOT, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) throw new Error("playwright 未安装：cd scripts/.pw-deps && npm install");

  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(webUrl, { waitUntil: "networkidle", timeout: 30_000 });

  const roomScene = page.locator('[data-testid="room-scene"]');
  const movementPanel = page.locator('[data-testid="movement-panel"]');

  await roomScene.or(movementPanel).first().waitFor({ timeout: 15_000 });

  if ((await roomScene.count()) > 0) {
    const canvas = page.locator('[data-testid="phaser-parent"]');
    await canvas.click({ position: { x: 80, y: 80 } });
    await page.screenshot({ path: path.join(outDir, "phaser-room.png"), fullPage: true });
    console.log("uat:phase7: phaser room screenshot saved");
  } else {
    await page.locator('[data-testid="cell-4-4"]').click();
    await page.screenshot({ path: path.join(outDir, "fallback-grid.png"), fullPage: true });
    console.log("uat:phase7: fallback grid screenshot saved");
  }

  await browser.close();
  console.log("uat:phase7 OK");
}

main().catch((err) => {
  console.error(`uat:phase7 failed: ${err.message}`);
  process.exit(1);
});
