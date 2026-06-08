/**
 * Phase 14 E2E — Living NPCs (LIFE-01…03 smoke).
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real API keys in .env.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";

const BOOT_WARN_MS = 5000;
const BOOT_FAIL_MS = 8000;
const AMBIENT_WAIT_MS = 7000;

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
const roomId = process.env.VERIFY_PHASE14_ROOM_ID || `verify-p14-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;

const CLOCK_RE = /\d{1,2}:\d{2}/;

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

async function readGameClockText(page) {
  const el = page.locator('[data-testid="explore-game-clock"]');
  await el.waitFor({ state: "visible", timeout: 30_000 });
  const text = (await el.textContent())?.trim() ?? "";
  if (!CLOCK_RE.test(text)) {
    throw new Error(`explore-game-clock text invalid: "${text}"`);
  }
  return text;
}

async function readAmbientProbe(page) {
  return page.evaluate(() => {
    const fn = window.__aetherlife_ambientDebug;
    if (typeof fn !== "function") {
      return { ok: false, reason: "__aetherlife_ambientDebug missing (dev stack required)" };
    }
    const probe = fn();
    if (!probe) {
      return { ok: false, reason: "ambient debug returned null" };
    }
    return {
      ok: probe.minute != null && probe.minute !== 360,
      minute: probe.minute,
      label: probe.label,
      activityById: probe.npcActivityById ?? {},
      visibleNpcIds: probe.visibleNpcIds ?? [],
    };
  });
}

async function main() {
  assertE2eNoMock("verify:phase14");
  console.log(`verify:phase14 → ${webUrl} WORLD_SEED=${process.env.WORLD_SEED}`);
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
    console.log(`verify:phase14: bootMs=${bootMs}`);
    if (bootMs > BOOT_WARN_MS) {
      console.warn(`verify:phase14: WARN bootMs=${bootMs} exceeds ${BOOT_WARN_MS}ms budget`);
    }
    if (bootMs > BOOT_FAIL_MS) {
      throw new Error(`bootMs=${bootMs} exceeds fail threshold ${BOOT_FAIL_MS}ms`);
    }

    await page.locator('[data-testid="explore-coords-strip"]').waitFor({ timeout: 30_000 });

    const clockBefore = await readGameClockText(page);
    console.log(`verify:phase14: clockBefore=${clockBefore}`);

    await page.waitForTimeout(AMBIENT_WAIT_MS);

    const clockAfter = await readGameClockText(page);
    console.log(`verify:phase14: clockAfter=${clockAfter} (waited ${AMBIENT_WAIT_MS}ms)`);

    if (clockBefore === clockAfter) {
      const probe = await readAmbientProbe(page);
      if (!probe.ok) {
        throw new Error(
          `game clock unchanged after ambient wait (${clockBefore} → ${clockAfter}); probe=${JSON.stringify(probe)}`,
        );
      }
      console.log(
        `verify:phase14: HUD text unchanged but registry minute=${probe.minute} (ambient tick OK)`,
      );
    }

    const probe = await readAmbientProbe(page);
    if (probe.minute == null) {
      throw new Error(`ambient probe missing gameClock.minute: ${JSON.stringify(probe)}`);
    }
    if (probe.minute === 360) {
      throw new Error(`gameMinute still 360 after ${AMBIENT_WAIT_MS}ms ambient wait`);
    }
    console.log(
      `verify:phase14: gameMinute=${probe.minute} activityKeys=${JSON.stringify(probe.activityById)}`,
    );

    if (probe.visibleNpcIds?.length) {
      console.log(`verify:phase14: proximity activity visible for ${probe.visibleNpcIds.join(", ")}`);
    } else {
      console.log(
        "verify:phase14: no proximity activity labels visible (optional — schedule/spawn dependent)",
      );
    }

    const fallback = await page.locator('[data-testid="phaser-fallback-banner"]').count();
    if (fallback > 0) {
      throw new Error("phaser-fallback-banner visible — expected Phaser canvas path");
    }
  } finally {
    await browser.close();
  }

  console.log("verify:phase14 OK");
}

main().catch((err) => {
  console.error(`verify:phase14 failed: ${err.message}`);
  console.error("Ensure full stack: pnpm dev:stack (no LLM_MOCK). Game-server :2567, web :5173.");
  process.exit(1);
});
