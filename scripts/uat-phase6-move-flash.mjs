/**
 * Detect local player "flash back" during Phaser WASD movement (MP-MOV-02 regression).
 * Requires pnpm dev:stack. Uses window.__aetherlife_moveDebug (DEV).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  blurComposerForMovement,
  disengageDialogue,
  focusExploreForKeyboard,
} from "./lib/uat-phase21-helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = process.env.WEB_URL || "http://localhost:5173";
const GS = process.env.GAME_SERVER_URL || "http://127.0.0.1:2567";

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

async function health(url, name) {
  const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${name} /health → ${res.status}`);
}

async function sampleMove(page) {
  return page.evaluate(() => {
    const fn = window.__aetherlife_moveDebug;
    return typeof fn === "function" ? fn() : null;
  });
}

async function waitConnected(page, timeoutMs = 20_000) {
  await page.waitForFunction(
    () => {
      const d = window.__aetherlife_moveDebug?.();
      return d != null;
    },
    { timeout: timeoutMs },
  );
}

/** Seed-42 homestead spawn row blocks pure east — walk south first (verify:phase13). */
async function repositionForEastProbe(page) {
  const engaged = await page
    .locator('[data-testid="dialogue-overlay"]')
    .getAttribute("data-engaged")
    .catch(() => "false");
  if (engaged === "true") {
    await disengageDialogue(page);
  } else {
    await focusExploreForKeyboard(page);
  }
  for (let i = 0; i < 48; i += 1) {
    await page.keyboard.press("s");
    await page.waitForTimeout(180);
  }
  await page.waitForFunction(
    () => {
      const d = window.__aetherlife_moveDebug?.();
      return d != null && d.pending === 0 && !d.locomoting;
    },
    { timeout: 15_000 },
  );
  await page.waitForTimeout(400);
}

/** Blur composer — WASD is on window; avoid scene clicks intercepted by corner menu. */
async function focusMovementKeys(page) {
  await blurComposerForMovement(page);
  await page.evaluate(() => {
    document.body.focus();
  });
}

/**
 * Discrete east steps — hold-repeat ArrowRight can desync in headless; seed-42 needs south first.
 */
async function assertNoFlashBack(page, steps = 8) {
  await focusMovementKeys(page);
  const start = await sampleMove(page);
  if (!start) throw new Error("moveDebug unavailable — open dev build with Phaser room");

  let maxX = start.gridX;
  const schemaSnaps = [];

  for (let i = 0; i < steps * 12; i++) {
    await page.keyboard.press("d");
    await page.waitForTimeout(80);
    const s = await sampleMove(page);
    if (!s) continue;
    if (s.gridX > maxX) maxX = s.gridX;
    const authAhead =
      s.authX != null && (s.authX > s.gridX || (s.authX === maxX && s.gridX < maxX));
    if (
      s.gridX < maxX
      && s.pending === 0
      && !s.locomoting
      && s.gridX === s.schemaX
      && authAhead
    ) {
      schemaSnaps.push({
        at: i,
        maxX,
        gridX: s.gridX,
        schemaX: s.schemaX,
        authX: s.authX,
        kind: "schema-snap",
      });
    }
    if (
      s.gridX < maxX
      && !s.locomoting
      && s.authX != null
      && s.authX < s.gridX
      && s.schemaX >= s.gridX
    ) {
      schemaSnaps.push({
        at: i,
        maxX,
        gridX: s.gridX,
        schemaX: s.schemaX,
        authX: s.authX,
        pending: s.pending,
        kind: "stale-auth-snap",
      });
    }
  }

  if (schemaSnaps.length > 0) {
    throw new Error(
      `schema snap-back detected (${schemaSnaps.length}): ${JSON.stringify(schemaSnaps.slice(0, 5))}`,
    );
  }

  await page.waitForFunction(
    () => {
      const d = window.__aetherlife_moveDebug?.();
      return d != null && d.pending === 0 && !d.locomoting;
    },
    { timeout: 10_000 },
  ).catch(() => {});

  const end = await sampleMove(page);
  if (!end || end.gridX <= start.gridX) {
    throw new Error(`movement did not advance: start=${start.gridX} end=${end?.gridX} max=${maxX}`);
  }
  console.log(`OK: gridX ${start.gridX} → ${end.gridX} (max ${maxX}), no regression`);
}

async function main() {
  await health(GS, "game-server");

  const pwEntry = path.join(ROOT, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) {
    throw new Error("playwright missing: cd scripts/.pw-deps && npm install");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const canvas = page.locator('[data-testid="phaser-parent"] canvas').first();
    await canvas.waitFor({ state: "visible", timeout: 45_000 });
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);
    await waitConnected(page);
    await repositionForEastProbe(page);
    await assertNoFlashBack(page);
    await mkdir(path.join(ROOT, ".planning/phases/10.5-phaser-movement-sync"), { recursive: true });
    console.log("uat-phase6-move-flash: PASS");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("uat-phase6-move-flash: FAIL", err.message || err);
  process.exit(1);
});
