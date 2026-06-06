/**
 * UAT: upward (W) movement — local player stays visible after removing world-space vignette.
 * Requires pnpm dev:stack (real stack, no LLM_MOCK).
 *
 * Screenshots → .planning/phases/07-2-5d-renderer/uat-screenshots/vignette-fix/
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UAT_ROOM =
  process.env.UAT_MAP_ROOM_ID || `uat-vignette-${Date.now().toString(36)}`;
const WEB_BASE = process.env.WEB_URL || "http://localhost:5173";
const WEB = `${WEB_BASE.replace(/\/$/, "")}/?room=${encodeURIComponent(UAT_ROOM)}`;
const GS = process.env.GAME_SERVER_URL || "http://127.0.0.1:2567";
const OUT_DIR = path.join(
  ROOT,
  ".planning/phases/07-2-5d-renderer/uat-screenshots/vignette-fix",
);

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

async function waitConnected(page, timeoutMs = 45_000) {
  const roomFull = page.locator('[data-testid="banner-room-full"]');
  await Promise.race([
    page.waitForFunction(
      () => window.__aetherlife_moveDebug?.() != null,
      { timeout: timeoutMs },
    ),
    roomFull.waitFor({ state: "visible", timeout: timeoutMs }).then(() => {
      throw new Error("room full — close other tabs or set UAT_MAP_ROOM_ID");
    }),
  ]);
}

/** Phaser 4 uses WebGL — assert local player state via moveDebug instead of 2d pixel read. */
async function assertLocalPlayerActive(page, label) {
  const d = await sampleMove(page);
  if (!d) {
    return { ok: false, reason: `${label}: moveDebug null` };
  }
  if (!Number.isFinite(d.gridX) || !Number.isFinite(d.gridY)) {
    return { ok: false, reason: `${label}: invalid grid`, ...d };
  }
  return {
    ok: true,
    gridX: d.gridX,
    gridY: d.gridY,
    locomoting: d.locomoting,
    pending: d.pending,
  };
}

async function screenshot(page, name) {
  await mkdir(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, name);
  await page.locator('[data-testid="room-scene"]').screenshot({ path: file });
  return file;
}

async function main() {
  assertE2eNoMock();
  await health(GS, "game-server");

  const pwEntry = path.join(ROOT, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) {
    throw new Error("playwright missing: cd scripts/.pw-deps && npm install");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const report = {
    ranAt: new Date().toISOString(),
    web: WEB,
    mapRoomId: UAT_ROOM,
    steps: [],
    pass: false,
  };

  try {
    await page.goto(WEB, { waitUntil: "networkidle", timeout: 60_000 });
    const scene = page.locator('[data-testid="room-scene"]');
    await scene.waitFor({ state: "visible", timeout: 15_000 });
    await scene.click({ position: { x: 200, y: 200 } });
    await waitConnected(page);

    const start = await sampleMove(page);
    if (!start) throw new Error("moveDebug unavailable");
    report.steps.push({ phase: "start", move: start });

    const shotBefore = await screenshot(page, "01-before-up.png");
    report.steps.push({ phase: "screenshot-before", path: shotBefore });

    const activeBefore = await assertLocalPlayerActive(page, "before-up");
    report.steps.push({ phase: "player-active-before", ...activeBefore });
    if (!activeBefore.ok) {
      throw new Error(`local player inactive before move: ${JSON.stringify(activeBefore)}`);
    }

    await page.keyboard.down("w");
    let end = start;
    let minGy = start.gridY;
    try {
      for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(100);
        const s = await sampleMove(page);
        if (!s) continue;
        end = s;
        if (s.gridY < minGy) minGy = s.gridY;
        if (start.gridY - s.gridY >= 3) break;
      }
    } finally {
      await page.keyboard.up("w");
    }

    await page.waitForTimeout(200);
    const shotAfter = await screenshot(page, "02-after-up-low-gy.png");
    report.steps.push({ phase: "screenshot-after", path: shotAfter });

    const activeAfter = await assertLocalPlayerActive(page, "after-up");
    report.steps.push({ phase: "player-active-after", ...activeAfter });

    if (end.gridY >= start.gridY) {
      throw new Error(
        `movement did not go up: start gridY=${start.gridY} end=${end.gridY}`,
      );
    }
    if (!activeAfter.ok) {
      throw new Error(
        `local player lost after moving up (low gy): ${JSON.stringify(activeAfter)}`,
      );
    }
    if (start.gridY - minGy < 3) {
      throw new Error(
        `did not move up enough for vignette regression: start gridY=${start.gridY} minGy=${minGy}`,
      );
    }

    // Lateral control — right move still works
    await page.keyboard.down("d");
    const beforeRight = end.gridX;
    try {
      for (let i = 0; i < 15; i++) {
        await page.waitForTimeout(80);
        const s = await sampleMove(page);
        if (s && s.gridX > beforeRight) {
          end = s;
          break;
        }
      }
    } finally {
      await page.keyboard.up("d");
    }
    await screenshot(page, "03-after-right.png");
    if (end.gridX <= beforeRight) {
      throw new Error(`right move failed after up: x ${beforeRight} → ${end.gridX}`);
    }

    report.pass = true;
    report.summary = {
      gridY: `${start.gridY} → ${end.gridY} (min ${minGy})`,
      gridXAfterRight: end.gridX,
      minGridY: minGy,
    };

    await writeFile(
      path.join(OUT_DIR, "uat-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log("uat-vignette-up-move: PASS", report.summary);
    console.log(`screenshots: ${OUT_DIR}`);
  } catch (err) {
    report.pass = false;
    report.error = err instanceof Error ? err.message : String(err);
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
      path.join(OUT_DIR, "uat-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    try {
      await screenshot(page, "99-failure.png");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("uat-vignette-up-move: FAIL", err.message || err);
  process.exit(1);
});
