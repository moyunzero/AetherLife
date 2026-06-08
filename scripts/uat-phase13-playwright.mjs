/**
 * Phase 13 UAT — Phaser world visuals (VIS-01–04).
 * Requires: pnpm dev:stack (no LLM_MOCK=1).
 * Output: .planning/phases/13-phaser-world-visuals/screenshots/ + uat-report.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_BASE = process.env.WEB_URL || "http://localhost:5173";
const HTTP_BASE =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const UAT_ROOM_ID = process.env.UAT_PHASE13_ROOM_ID || `uat-p13-${Date.now()}`;
const WEB = `${WEB_BASE}${WEB_BASE.includes("?") ? "&" : "?"}room=${encodeURIComponent(UAT_ROOM_ID)}`;
const outDir = path.join(ROOT, ".planning/phases/13-phaser-world-visuals/screenshots");

const report = {
  roomId: UAT_ROOM_ID,
  startedAt: new Date().toISOString(),
  cases: [],
  pass: false,
};

function record(id, title, ok, detail = "") {
  report.cases.push({ id, title, ok, detail, at: new Date().toISOString() });
  console.log(`${ok ? "✓" : "✗"} ${id} ${title}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`${id}: ${title}${detail ? ` (${detail})` : ""}`);
}

async function shot(page, filename) {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, filename);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  📸 ${path.relative(ROOT, file)}`);
  return file;
}

async function shotCanvas(page, filename, options = {}) {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, filename);
  const canvas = page.locator('[data-testid="phaser-parent"] canvas').first();
  await canvas.screenshot({ path: file, ...options });
  console.log(`  📸 ${path.relative(ROOT, file)}`);
  return file;
}

/** AE-08: export gameplay bbox from canvas (strips Phaser FIT letterbox / bgDeep). */
async function shotHomesteadCanvas(page, filename) {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, filename);
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="phaser-parent"] canvas');
    if (!canvas) return null;

    const isBg = (r, g, b) => r < 48 && g < 40 && b < 28;
    const w = canvas.width;
    const h = canvas.height;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;

    const ctx2d = canvas.getContext("2d");
    const read = (x, y) => {
      if (ctx2d) {
        const [r, g, b] = ctx2d.getImageData(x, y, 1, 1).data;
        return [r, g, b];
      }
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl) return null;
      const px = new Uint8Array(4);
      gl.readPixels(x, h - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2]];
    };

    const step = 2;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const rgb = read(x, y);
        if (!rgb || isBg(rgb[0], rgb[1], rgb[2])) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX <= minX || maxY <= minY) return null;

    minX = Math.max(0, minX - 2);
    minY = Math.max(0, minY - 2);
    maxX = Math.min(w - 1, maxX + 2);
    maxY = Math.min(h - 1, maxY + 2);
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;

    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    const octx = out.getContext("2d");
    if (!octx) return null;
    octx.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
    return out.toDataURL("image/png");
  });
  if (!dataUrl) throw new Error("homestead crop failed — no gameplay pixels");
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  await writeFile(file, Buffer.from(b64, "base64"));
  console.log(`  📸 ${path.relative(ROOT, file)}`);
  return file;
}

async function homesteadShotQuality(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="phaser-parent"] canvas');
    if (!canvas) return { ok: false, reason: "canvas missing" };

    const isBg = (r, g, b) => r < 48 && g < 40 && b < 28;
    const w = canvas.width;
    const h = canvas.height;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;

    const ctx2d = canvas.getContext("2d");
    const read = (x, y) => {
      if (ctx2d) {
        const [r, g, b] = ctx2d.getImageData(x, y, 1, 1).data;
        return [r, g, b];
      }
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl) return null;
      const px = new Uint8Array(4);
      gl.readPixels(x, h - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2]];
    };

    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const rgb = read(x, y);
        if (!rgb || isBg(rgb[0], rgb[1], rgb[2])) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX <= minX) return { ok: false, reason: "no gameplay bbox" };

    let black = 0;
    let samples = 0;
    const step = 4;
    for (let y = minY; y <= maxY; y += step) {
      for (let x = minX; x <= maxX; x += step) {
        const rgb = read(x, y);
        if (!rgb) return { ok: false, reason: "no context" };
        samples += 1;
        if (rgb[0] < 8 && rgb[1] < 8 && rgb[2] < 8) black += 1;
      }
    }
    const blackRatio = black / samples;
    const fillRatio = ((maxX - minX) * (maxY - minY)) / (w * h);
    return {
      ok: blackRatio < 0.05 && fillRatio > 0.35,
      blackRatio,
      fillRatio,
      samples,
    };
  });
}

async function loadPlaywright() {
  const pwEntry = path.join(ROOT, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) throw new Error("playwright 未安装：cd scripts/.pw-deps && npm install");
  return chromium;
}

async function canvasPixelVariance(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const canvas = document.querySelector('[data-testid="phaser-parent"] canvas');
            if (!canvas) {
              resolve({ ok: false, reason: "canvas missing" });
              return;
            }
            const w = canvas.width;
            const h = canvas.height;
            const samples = [
              [Math.floor(w * 0.25), Math.floor(h * 0.25)],
              [Math.floor(w * 0.5), Math.floor(h * 0.5)],
              [Math.floor(w * 0.75), Math.floor(h * 0.35)],
              [Math.floor(w * 0.4), Math.floor(h * 0.7)],
            ];
            const colors = new Set();
            const ctx2d = canvas.getContext("2d");
            if (ctx2d) {
              for (const [x, y] of samples) {
                const [r, g, b] = ctx2d.getImageData(x, y, 1, 1).data;
                colors.add(`${r},${g},${b}`);
              }
              resolve({ ok: colors.size >= 2, unique: colors.size, mode: "2d" });
              return;
            }
            const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
            if (!gl) {
              resolve({ ok: false, reason: "no context" });
              return;
            }
            const px = new Uint8Array(4);
            for (const [x, y] of samples) {
              gl.readPixels(x, h - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
              colors.add(`${px[0]},${px[1]},${px[2]}`);
            }
            resolve({ ok: colors.size >= 2, unique: colors.size, mode: "webgl" });
          });
        });
      }),
  );
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

async function waitSettled(page) {
  await page.waitForFunction(
    () => {
      const d = window.__aetherlife_moveDebug?.();
      return d != null && d.pending === 0 && !d.locomoting;
    },
    { timeout: 15_000 },
  );
  await page.waitForTimeout(300);
}

/** AE-08: pin camera on homestead, hide NPC/player clutter before canvas shot. */
async function prepareHomeFarmScreenshot(page) {
  const framed = await page.evaluate(() => {
    const fn = window.__aetherlife_uatFrameHomestead;
    return typeof fn === "function" ? fn() : false;
  });
  if (!framed) {
    throw new Error("__aetherlife_uatFrameHomestead unavailable — run against dev:stack (Vite DEV)");
  }
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      }),
  );
  await page.waitForTimeout(150);
}

async function main() {
  assertE2eNoMock("uat:phase13:playwright");

  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
  if (!process.env.WORLD_SEED) process.env.WORLD_SEED = "42";

  const health = await fetch(`${HTTP_BASE}/health`).then((r) => r.json()).catch(() => null);
  if (health?.status !== "ok") {
    throw new Error(`game-server not reachable at ${HTTP_BASE} — run pnpm dev:stack`);
  }

  console.log(`uat:phase13 → ${WEB}`);
  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const bootStart = Date.now();
  await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({ timeout: 45_000 });
  const bootMs = Date.now() - bootStart;
  await page.locator('[data-testid="explore-coords-strip"]').waitFor({ timeout: 30_000 });

  const fallbackCount = await page.locator('[data-testid="phaser-fallback-banner"]').count();
  record("P13-UAT-01", "Phaser canvas 启动", fallbackCount === 0, `bootMs=${bootMs}`);

  const variance = await canvasPixelVariance(page);
  record("P13-UAT-02", "Tile 层非单色", variance.ok, `unique=${variance.unique} mode=${variance.mode ?? "?"}`);

  await prepareHomeFarmScreenshot(page);
  await shotHomesteadCanvas(page, "home-farm.png");
  const homesteadQ = await homesteadShotQuality(page);
  record(
    "P13-UAT-03",
    "家园截图 home-farm (AE-08 frame)",
    homesteadQ.ok,
    homesteadQ.ok
      ? `blackRatio=${homesteadQ.blackRatio?.toFixed(3)} fill=${homesteadQ.fillRatio?.toFixed(2)}`
      : `FAIL blackRatio=${homesteadQ.blackRatio?.toFixed(3)} fill=${homesteadQ.fillRatio?.toFixed(2)} ${homesteadQ.reason ?? ""}`,
  );

  await page.locator('[data-testid="explore-coords-strip"]').click();
  await page.waitForTimeout(200);

  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("d");
    await page.waitForTimeout(160);
  }
  await waitSettled(page);
  await shotCanvas(page, "walk-east.png");
  record("P13-UAT-04", "行走截图 walk-east", true);

  const startChunk = (await readExploreChunk(page)) ?? { cx: 0, cy: 0 };
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("s");
    await page.waitForTimeout(160);
  }
  await waitSettled(page);
  const endChunk = await readExploreChunk(page);
  const chunkDist =
    endChunk != null
      ? Math.abs(endChunk.cx - startChunk.cx) + Math.abs(endChunk.cy - startChunk.cy)
      : 0;
  await shotCanvas(page, "biome-strip.png");
  record(
    "P13-UAT-05",
    "Biome 跨界 biome-strip",
    chunkDist >= 1,
    `chunk ${JSON.stringify(startChunk)} → ${JSON.stringify(endChunk)} dist=${chunkDist}`,
  );

  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("a");
    await page.waitForTimeout(160);
  }
  await waitSettled(page);
  await shotCanvas(page, "depth-overlap.png");
  record("P13-UAT-06", "Decor/Y-sort 截图 depth-overlap", true);

  const tabB = await browser.newPage();
  await tabB.goto(WEB, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await tabB.locator('[data-testid="phaser-parent"] canvas').first().waitFor({ timeout: 45_000 });
  await tabB.waitForTimeout(800);
  await shotCanvas(tabB, "multiplayer-palette.png");
  record("P13-UAT-07", "多人 palette 截图 multiplayer-palette", true);
  await tabB.close();

  await browser.close();

  report.pass = true;
  report.finishedAt = new Date().toISOString();
  report.bootMs = bootMs;
  await writeFile(path.join(outDir, "uat-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log("uat:phase13 OK");
}

main().catch(async (err) => {
  report.pass = false;
  report.error = err.message;
  report.finishedAt = new Date().toISOString();
  await mkdir(outDir, { recursive: true }).catch(() => {});
  await writeFile(path.join(outDir, "uat-report.json"), `${JSON.stringify(report, null, 2)}\n`).catch(
    () => {},
  );
  console.error(`uat:phase13 failed: ${err.message}`);
  process.exit(1);
});
