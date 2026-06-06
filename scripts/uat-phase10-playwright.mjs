import { mkdir } from "node:fs/promises";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_BASE = process.env.WEB_URL || "http://localhost:5173";
const UAT_ROOM_ID = process.env.UAT_PHASE10_ROOM_ID || `uat-p10-${Date.now()}`;
const WEB = `${WEB_BASE}${WEB_BASE.includes("?") ? "&" : "?"}room=${encodeURIComponent(UAT_ROOM_ID)}`;
const outDir = path.join(ROOT, ".planning/phases/10-chunk-terrain/uat-screenshots");

let step = 0;

async function shot(page, label) {
  step += 1;
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${String(step).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  📸 ${path.relative(ROOT, file)}`);
}

async function main() {
  assertE2eNoMock("uat:phase10:playwright");
  const pwEntry = path.join(ROOT, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) throw new Error("playwright 未安装：cd scripts/.pw-deps && npm install");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(WEB, { waitUntil: "networkidle", timeout: 45_000 });

  await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="explore-coords-strip"]').waitFor({ timeout: 30_000 });
  await shot(page, "home-explore-strip");

  const stripBefore = await page.locator('[data-testid="explore-coords-strip"]').innerText();
  console.log(`  explore strip (home): ${stripBefore}`);

  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("d");
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1200);
  await shot(page, "after-move-east");

  const stripAfter = await page.locator('[data-testid="explore-coords-strip"]').innerText();
  console.log(`  explore strip (east): ${stripAfter}`);
  if (stripBefore === stripAfter) {
    throw new Error("explore-coords-strip did not change after moving east");
  }

  const tabB = await browser.newPage();
  await tabB.goto(WEB, { waitUntil: "networkidle", timeout: 45_000 });
  await tabB.locator('[data-testid="explore-coords-strip"]').waitFor({ timeout: 30_000 });
  await shot(tabB, "second-tab-frontier");
  await tabB.close();

  await browser.close();
  console.log("uat:phase10 OK");
}

main().catch((err) => {
  console.error(`uat:phase10 failed: ${err.message}`);
  process.exit(1);
});
