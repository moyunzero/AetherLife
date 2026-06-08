/**
 * Phase 13 E2E — Phaser world visuals (VIS-01–04 smoke).
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real API keys in .env.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";

const BOOT_WARN_MS = 5000;
const BOOT_FAIL_MS = 8000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!(key in process.env)) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE13_ROOM_ID || `verify-p13-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;

async function healthOk() {
  const res = await fetch(`${httpBase}/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
  const body = await res.json().catch(() => ({}));
  if (body.service !== "game-server" && body.status !== "ok" && body.ok !== true) {
    throw new Error("unexpected health body");
  }
}

async function loadPlaywright() {
  const pwEntry = resolve(root, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) {
    throw new Error("playwright not installed — cd scripts/.pw-deps && npm install");
  }
  return chromium;
}

async function readAestheticProbe(page) {
  return page.evaluate(() => {
    const fn = window.__aetherlife_visualDebug;
    if (typeof fn !== "function") {
      return { ok: false, reason: "__aetherlife_visualDebug missing (dev stack required)" };
    }
    const v = fn();
    if (!v) return { ok: false, reason: "visual debug returned null (player/canvas/stage not ready)" };
    if (v.visualFallback) {
      return { ok: false, reason: "visualFallback active — Kenney/LPC assets not in use", ...v };
    }
    if (v.panelFillRatio < 0.85) {
      return { ok: false, reason: `AE-06 panel fill ${v.panelFillRatio.toFixed(3)} < 0.85`, ...v };
    }
    if (v.playerDisplayHeightPx < 32) {
      return {
        ok: false,
        reason: `AE-02 sprite height ${v.playerDisplayHeightPx.toFixed(1)}px < 32px (13.3)`,
        ...v,
      };
    }
    if (v.canvasUniqueColors < 4) {
      return {
        ok: false,
        reason: `AE-05 biomes atlas sample colors ${v.canvasUniqueColors} < 4`,
        ...v,
      };
    }
    return { ok: true, ...v };
  });
}

async function readExploreChunk(page) {
  return page.evaluate(() => {
    const strip = document.querySelector('[data-testid="explore-coords-strip"]');
    if (!strip) return null;
    const text = strip.textContent ?? "";
    const m = text.match(/chunk\s*\((-?\d+),\s*(-?\d+)\)/);
    if (!m) return null;
    return { cx: Number.parseInt(m[1], 10), cy: Number.parseInt(m[2], 10) };
  });
}

async function main() {
  assertE2eNoMock("verify:phase13");
  console.log(`verify:phase13 → ${webUrl} WORLD_SEED=${process.env.WORLD_SEED}`);
  await healthOk();

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const bootStart = Date.now();
    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const canvas = page.locator('[data-testid="phaser-parent"] canvas').first();
    await canvas.waitFor({ state: "visible", timeout: 45_000 });
    const bootMs = Date.now() - bootStart;
    console.log(`verify:phase13: bootMs=${bootMs}`);
    if (bootMs > BOOT_WARN_MS) {
      console.warn(`verify:phase13: WARN bootMs=${bootMs} exceeds ${BOOT_WARN_MS}ms budget`);
    }
    if (bootMs > BOOT_FAIL_MS) {
      throw new Error(`bootMs=${bootMs} exceeds fail threshold ${BOOT_FAIL_MS}ms`);
    }

    await page.locator('[data-testid="explore-coords-strip"]').waitFor({ timeout: 30_000 });

    let aesthetic = await readAestheticProbe(page);
    for (let attempt = 0; !aesthetic.ok && attempt < 20; attempt += 1) {
      await page.waitForTimeout(250);
      aesthetic = await readAestheticProbe(page);
    }
    if (!aesthetic.ok) {
      throw new Error(`aesthetic verify failed: ${JSON.stringify(aesthetic)}`);
    }
    console.log(
      `verify:phase13: biomes atlas uniqueColors=${aesthetic.canvasUniqueColors} visualFallback=${aesthetic.visualFallback}`,
    );
    console.log(
      `verify:phase13: aesthetic OK fill=${aesthetic.panelFillRatio?.toFixed(3)} spriteH=${aesthetic.playerDisplayHeightPx?.toFixed(1)}px`,
    );

    await page.locator('[data-testid="explore-coords-strip"]').click();
    await page.waitForTimeout(200);
    const startChunk = (await readExploreChunk(page)) ?? { cx: 0, cy: 0 };

    // South from home: seed-42 highland blocks pure east at spawn row (gx=16 walkable=false).
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

    const endChunk = await readExploreChunk(page);
    if (!endChunk) {
      throw new Error("explore-coords-strip missing chunk coords after move");
    }
    const chunkDist =
      Math.abs(endChunk.cx - startChunk.cx) + Math.abs(endChunk.cy - startChunk.cy);
    if (chunkDist < 2) {
      throw new Error(
        `expected ≥2 chunk travel (start=${JSON.stringify(startChunk)} end=${JSON.stringify(endChunk)} dist=${chunkDist})`,
      );
    }
    console.log(
      `verify:phase13: chunk cross OK start=${JSON.stringify(startChunk)} end=${JSON.stringify(endChunk)} dist=${chunkDist}`,
    );

    const fallback = await page.locator('[data-testid="phaser-fallback-banner"]').count();
    if (fallback > 0) {
      throw new Error("phaser-fallback-banner visible — expected Phaser canvas path");
    }
  } finally {
    await browser.close();
  }

  console.log("verify:phase13 OK");
}

main().catch((err) => {
  console.error(`verify:phase13 failed: ${err.message}`);
  console.error("Ensure full stack: pnpm dev:stack (no LLM_MOCK). Game-server :2567, web :5173.");
  process.exit(1);
});
