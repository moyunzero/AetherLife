/**
 * Phase 11 E2E — LLM world lore (WORLD-02).
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real LLM keys + worker in .env.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";

export const VERIFY_PHASE11_TARGET_X = 8;
export const VERIFY_PHASE11_TARGET_Y = 4;
/** seed=42: chunk (2,0) east edge walkable at y=7 (y=4 discover row cannot step onto gx=16). */
export const VERIFY_PHASE11_DEDUP_GY = 7;
export const E2E_LORE_TIMEOUT_MS = 120_000;

const CHUNK_SIZE = 8;
const PUBLIC_LORE_KEYS = new Set([
  "nameZh",
  "flavorOneLine",
  "storyHook",
  "proceduralBiome",
  "moodTag",
]);
const FORBIDDEN_LORE_KEYS = ["npcRumor", "hiddenQuestSeed"];

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

assertE2eNoMock("verify:phase11");

const httpBase =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE11_ROOM_ID || `verify-p11-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const loreTimeoutMs = Number.parseInt(process.env.E2E_LORE_TIMEOUT_MS || "", 10) || E2E_LORE_TIMEOUT_MS;
const workerToken = process.env.INTERNAL_WORKER_TOKEN || "";

function chunkOf(gx, gy) {
  return {
    cx: Math.floor(gx / CHUNK_SIZE),
    cy: Math.floor(gy / CHUNK_SIZE),
  };
}

async function request(path, options = {}) {
  const res = await fetch(`${httpBase}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${options.method || "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function fetchLoreMetrics() {
  const headers = workerToken ? { Authorization: `Bearer ${workerToken}` } : {};
  const body = await request("/internal/metrics/lore", { headers });
  return { enqueues: body.enqueues ?? 0, posts: body.posts ?? 0 };
}

function assertPublicLoreSubset(lore) {
  for (const key of FORBIDDEN_LORE_KEYS) {
    if (key in lore) throw new Error(`GET lore leaked secret field: ${key}`);
  }
  for (const key of Object.keys(lore)) {
    if (!PUBLIC_LORE_KEYS.has(key)) {
      throw new Error(`unexpected lore field: ${key}`);
    }
  }
}

async function healthOk() {
  const res = await fetch(`${httpBase}/health`);
  if (!res.ok) return false;
  const body = await res.json().catch(() => ({}));
  return body?.status === "ok" || body?.ok === true;
}

async function loadPlaywright() {
  const pwEntry = resolve(root, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) {
    throw new Error("playwright 未安装：cd scripts/.pw-deps && npm install");
  }
  return chromium;
}

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout: ${label} (${timeoutMs}ms)`);
}

async function focusScene(page) {
  await page.locator('[data-testid="explore-coords-strip"]').click();
  await page.waitForTimeout(120);
}

async function readGridCoords(page) {
  const meta = await page.locator(".explore-coords-strip__meta").innerText();
  const m = meta.match(/格 \((-?\d+), (-?\d+)\)/);
  if (!m) throw new Error(`coords parse failed: ${meta}`);
  return { gx: Number(m[1]), gy: Number(m[2]) };
}

async function assertGridCoords(page, expectedGx, expectedGy, label) {
  await waitFor(
    async () => {
      const { gx, gy } = await readGridCoords(page);
      return gx === expectedGx && gy === expectedGy;
    },
    20_000,
    label,
  );
}

async function dispatchMoveKey(page, key) {
  await page.evaluate((k) => {
    const opts = { key: k, code: `Key${k.toUpperCase()}`, bubbles: true, cancelable: true };
    window.dispatchEvent(new KeyboardEvent("keydown", opts));
    window.dispatchEvent(new KeyboardEvent("keyup", opts));
  }, key);
}

async function pressMoveEast(page, steps) {
  await page.bringToFront();
  await focusScene(page);
  for (let i = 0; i < steps; i += 1) {
    await dispatchMoveKey(page, "d");
    await page.waitForTimeout(280);
  }
  await page.waitForTimeout(400);
}

async function pressMoveWest(page, steps) {
  await page.bringToFront();
  await focusScene(page);
  for (let i = 0; i < steps; i += 1) {
    await dispatchMoveKey(page, "a");
    await page.waitForTimeout(280);
  }
  await page.waitForTimeout(400);
}

async function waitCoordsStable(page, stableMs = 1500) {
  let last = await readGridCoords(page);
  let elapsed = 0;
  while (elapsed < stableMs) {
    await page.waitForTimeout(150);
    elapsed += 150;
    const next = await readGridCoords(page);
    if (next.gx !== last.gx || next.gy !== last.gy) {
      last = next;
      elapsed = 0;
    }
  }
}

async function stepOnce(page, key) {
  const before = await readGridCoords(page);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await waitCoordsStable(page, 500);
    await page.bringToFront();
    await focusScene(page);
    await dispatchMoveKey(page, key);
    try {
      await waitFor(
        async () => {
          const after = await readGridCoords(page);
          return after.gx !== before.gx || after.gy !== before.gy;
        },
        20_000,
        `move key ${key} from (${before.gx},${before.gy})`,
      );
      await page.waitForTimeout(350);
      return;
    } catch (err) {
      if (attempt === 3) throw err;
    }
  }
}

async function waitMoveIdle(page, timeoutMs = 30_000, label = "move idle") {
  await waitFor(
    async () => {
      const d = await page.evaluate(() => window.__aetherlife_moveDebug?.() ?? null);
      return Boolean(d && d.pending === 0 && !d.locomoting);
    },
    timeoutMs,
    label,
  );
}

async function sendMoveToGrid(page, targetGx, targetGy, label) {
  await page.bringToFront();
  await focusScene(page);
  await waitMoveIdle(page, 30_000, `${label} before sendMoveTo`);
  await page.evaluate(({ x, y }) => {
    const fn = window.__aetherlife_sendMoveTo;
    if (typeof fn !== "function") {
      throw new Error("__aetherlife_sendMoveTo missing — use pnpm dev:stack (DEV build)");
    }
    fn(x, y);
  }, { x: targetGx, y: targetGy });
  await waitMoveIdle(page, 45_000, `${label} after sendMoveTo`);
  await waitCoordsStable(page, 2500);
  await assertGridCoords(page, targetGx, targetGy, label);
}

async function stepTowardCoords(page, targetGx, targetGy, maxSteps, label) {
  for (let i = 0; i < maxSteps; i += 1) {
    const { gx, gy } = await readGridCoords(page);
    if (gx === targetGx && gy === targetGy) {
      await waitCoordsStable(page, 1500);
      return;
    }
    if (gx < targetGx) await stepOnce(page, "d");
    else if (gx > targetGx) await stepOnce(page, "a");
    else if (gy < targetGy) await stepOnce(page, "s");
    else if (gy > targetGy) await stepOnce(page, "w");
  }
  await waitCoordsStable(page, 2000);
  await assertGridCoords(page, targetGx, targetGy, label);
}

async function movePageADedupStaging(page, stagingEastX, pageACoordsGy, stagingWestX, dedupGy) {
  await stepTowardCoords(page, stagingEastX, pageACoordsGy, 24, "pageA east along discover row");
  // seed=42: (15,5) blocked — detour west before going south to y=7.
  await stepTowardCoords(page, stagingWestX, pageACoordsGy, 8, "pageA west to bypass (15,5) wall");
  await stepTowardCoords(page, stagingWestX, dedupGy, 24, "pageA south on staging column");
  await waitCoordsStable(page, 3000);
}

async function movePageBDedupStaging(pageB, stagingWestX, pageBTargetGy, dedupGy) {
  await stepTowardCoords(pageB, stagingWestX, pageBTargetGy, 24, "pageB to dedup staging column");
  await waitCoordsStable(pageB, 3000);
}

async function placeNameText(page) {
  const el = page.locator('[data-testid="explore-place-name"]');
  await el.waitFor({ state: "visible", timeout: 30_000 });
  return (await el.innerText()).trim();
}

async function waitLorePostsStable(timeoutMs = 30_000) {
  let last = (await fetchLoreMetrics()).posts;
  let stableSince = Date.now();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 500));
    const cur = (await fetchLoreMetrics()).posts;
    if (cur !== last) {
      last = cur;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 2000) {
      return last;
    }
  }
  return last;
}

async function main() {
  const seed = Number.parseInt(process.env.WORLD_SEED, 10);
  if (seed !== 42) {
    throw new Error(`verify:phase11 requires WORLD_SEED=42 (got ${process.env.WORLD_SEED})`);
  }

  if (!(await healthOk())) {
    throw new Error(`game-server not reachable at ${httpBase} — run pnpm dev:stack`);
  }

  console.log(`verify:phase11 → room=${roomId} WORLD_SEED=${seed}`);

  const metrics0 = await fetchLoreMetrics();
  console.log(`  lore metrics baseline: enqueues=${metrics0.enqueues} posts=${metrics0.posts}`);

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(webUrl, { waitUntil: "networkidle", timeout: 45_000 });
  await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="explore-coords-strip"]').waitFor({ timeout: 30_000 });

  const homeName = await placeNameText(page);
  if (!homeName.includes("晨曦村")) {
    throw new Error(`home expected 晨曦村, got: ${homeName}`);
  }
  if (await page.locator('[data-testid="lore-pending-hint"]').isVisible().catch(() => false)) {
    throw new Error("home chunk should not show lore pending");
  }
  console.log("  ✓ home chunk shows 晨曦村");

  const homeLore = await request(`/rooms/${roomId}/chunks/0/0/lore`);
  assertPublicLoreSubset(homeLore.lore);
  if (homeLore.lore.proceduralBiome !== "home") {
    throw new Error(`home proceduralBiome expected home, got ${homeLore.lore.proceduralBiome}`);
  }

  const { cx: discoverCx, cy: discoverCy } = chunkOf(
    VERIFY_PHASE11_TARGET_X,
    VERIFY_PHASE11_TARGET_Y,
  );
  await stepTowardCoords(
    page,
    VERIFY_PHASE11_TARGET_X,
    VERIFY_PHASE11_TARGET_Y,
    16,
    "first discover at chunk boundary",
  );

  await waitFor(
    async () => page.locator('[data-testid="lore-pending-hint"]').isVisible().catch(() => false),
    15_000,
    "lore-pending-hint after chunk cross",
  ).catch(() => {
    /* pending may be very brief if cache/warm — continue to ready wait */
  });

  await waitFor(
    async () => {
      try {
        const body = await request(`/rooms/${roomId}/chunks/${discoverCx}/${discoverCy}/lore`);
        return Boolean(body?.lore?.nameZh);
      } catch {
        return false;
      }
    },
    loreTimeoutMs,
    "lore ready (GET /chunks/:cx/:cy/lore)",
  );

  const chunkLoreReady = await request(`/rooms/${roomId}/chunks/${discoverCx}/${discoverCy}/lore`);
  assertPublicLoreSubset(chunkLoreReady.lore);
  const discoverName = `${chunkLoreReady.lore.nameZh}${chunkLoreReady.lore.flavorOneLine ? ` · ${chunkLoreReady.lore.flavorOneLine}` : ""}`;
  console.log(`  ✓ first discover place: ${discoverName}`);

  await waitFor(
    async () => {
      const pending = await page
        .locator('[data-testid="lore-pending-hint"]')
        .isVisible()
        .catch(() => false);
      if (pending) return false;
      const name = await placeNameText(page);
      return name.length > 0 && !name.includes("生成中");
    },
    20_000,
    "explore strip synced after lore ready",
  );

  await waitFor(
    async () =>
      !(await page.locator('[data-testid="lore-discover-toast"]').isVisible().catch(() => false)),
    12_000,
    "discover toast dismissed before cache re-enter",
  );

  const { cx, cy } = chunkOf(VERIFY_PHASE11_TARGET_X, VERIFY_PHASE11_TARGET_Y);
  const chunkLore = chunkLoreReady;
  if (!chunkLore.lore.proceduralBiome) {
    throw new Error("missing proceduralBiome on GET lore");
  }

  const neighbor = chunkOf(VERIFY_PHASE11_TARGET_X, VERIFY_PHASE11_TARGET_Y + CHUNK_SIZE);
  try {
    const neighborLore = await request(`/rooms/${roomId}/chunks/${neighbor.cx}/${neighbor.cy}/lore`);
    assertPublicLoreSubset(neighborLore.lore);
  } catch {
    console.log(`  · neighbor chunk (${neighbor.cx},${neighbor.cy}) lore not ready — skip biome spot-check`);
  }

  const metricsAfterReady = await fetchLoreMetrics();
  if (metricsAfterReady.posts <= metrics0.posts) {
    throw new Error(
      `expected lore posts to increase after discover (before=${metrics0.posts} after=${metricsAfterReady.posts})`,
    );
  }

  await page.waitForTimeout(600);
  const homeGx = 4;
  const homeGy = (await readGridCoords(page)).gy;
  await waitLorePostsStable(90_000);
  const metricsBeforeCacheNav = await fetchLoreMetrics();
  const enqueuesBeforeCacheNav = metricsBeforeCacheNav.enqueues;
  await stepTowardCoords(page, homeGx, homeGy, 12, "cache leave to home column");
  await stepTowardCoords(
    page,
    VERIFY_PHASE11_TARGET_X,
    homeGy,
    12,
    "cache return to discover column",
  );

  await waitFor(
    async () => {
      const name = await placeNameText(page);
      return name.includes(discoverName.split("·")[0].trim());
    },
    20_000,
    "cache hit same nameZh",
  );

  const metricsReenter = await fetchLoreMetrics();
  if (metricsReenter.enqueues !== enqueuesBeforeCacheNav) {
    throw new Error(
      `cache re-enter must not enqueue again (enqueues ${enqueuesBeforeCacheNav} → ${metricsReenter.enqueues})`,
    );
  }
  if (await page.locator('[data-testid="lore-discover-toast"]').isVisible().catch(() => false)) {
    throw new Error("lore-discover-toast should not show on cache re-enter");
  }
  console.log("  ✓ cache hit — enqueue counter unchanged, no re-toast");

  const dedupX = 16;
  const dedupCx = Math.floor(dedupX / CHUNK_SIZE);
  const dedupGy = VERIFY_PHASE11_DEDUP_GY;
  const dedupCy = Math.floor(dedupGy / CHUNK_SIZE);
  const stagingX = dedupX - 2;
  const pageACoords = await readGridCoords(page);
  const pageBTargetGy = dedupGy;
  const pageBStartX = pageACoords.gx - 1;

  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageB = await ctxB.newPage();
  await pageB.goto(webUrl, { waitUntil: "networkidle", timeout: 45_000 });
  await pageB.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
  await pageB.locator('[data-testid="explore-coords-strip"]').waitFor({ timeout: 30_000 });
  await pageB.locator('[data-testid="phaser-parent"] canvas').waitFor({ timeout: 45_000 });
  await pageB.waitForTimeout(800);

  await waitFor(
    async () => (await placeNameText(pageB)).includes("晨曦村") || (await readGridCoords(pageB)).gx > 4,
    30_000,
    "pageB connected",
  );
  await stepTowardCoords(pageB, pageBStartX, pageBTargetGy, 20, "pageB beside pageA (offset row)");
  await assertGridCoords(page, pageACoords.gx, pageACoords.gy, "pageA before dedup staging");

  await movePageADedupStaging(page, stagingX + 1, pageACoords.gy, stagingX, dedupGy);
  await movePageBDedupStaging(pageB, stagingX - 1, pageBTargetGy, dedupGy);

  const metricsBeforeDedup = await fetchLoreMetrics();

  await sendMoveToGrid(page, dedupX, dedupGy, "pageA into dedup chunk");
  await sendMoveToGrid(pageB, dedupX + 1, dedupGy, "pageB into dedup chunk");

  await waitCoordsStable(page, 2500);
  await waitCoordsStable(pageB, 2500);

  await waitFor(
    async () => {
      const m = await fetchLoreMetrics();
      return m.enqueues >= metricsBeforeDedup.enqueues + 1;
    },
    60_000,
    "dedup chunk lore enqueue +1",
  );

  await waitFor(
    async () => {
      try {
        const body = await request(`/rooms/${roomId}/chunks/${dedupCx}/${dedupCy}/lore`);
        return Boolean(body?.lore?.nameZh);
      } catch {
        return false;
      }
    },
    loreTimeoutMs,
    "dedup chunk lore persisted (GET)",
  );

  await waitFor(
    async () => {
      const m = await fetchLoreMetrics();
      return m.posts >= metricsBeforeDedup.posts + 1;
    },
    loreTimeoutMs,
    "dedup chunk lore post +1",
  );

  const metricsDedup = await fetchLoreMetrics();
  if (metricsDedup.enqueues !== metricsBeforeDedup.enqueues + 1) {
    throw new Error(
      `dual-tab dedup: enqueues expected +1 (before=${metricsBeforeDedup.enqueues} after=${metricsDedup.enqueues})`,
    );
  }
  if (metricsDedup.posts !== metricsBeforeDedup.posts + 1) {
    throw new Error(
      `dual-tab dedup: posts expected +1 (before=${metricsBeforeDedup.posts} after=${metricsDedup.posts})`,
    );
  }

  await waitFor(
    async () => {
      const a = await placeNameText(page);
      const b = await placeNameText(pageB);
      return a === b && a.length > 0;
    },
    loreTimeoutMs,
    "both tabs same explore-place-name",
  );
  console.log("  ✓ dual-tab dedup — metrics +1, both clients synced");

  await ctxB.close();
  await browser.close();
  console.log("verify:phase11 OK");
}

main().catch((err) => {
  console.error(`verify:phase11 failed: ${err.message}`);
  process.exit(1);
});
