/**
 * Shared Playwright stack helpers for speak benchmark + playtest scripts.
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gameServerHttpBase, loadRootEnv } from "./env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadRootEnv(root);

const httpBase = gameServerHttpBase();

export const webBase = process.env.WEB_URL || "http://localhost:5173";

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @returns {Promise<import('playwright').BrowserType>} */
export async function loadPlaywright() {
  const pwEntry = resolve(root, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  try {
    const pw = await import(pathToFileURL(pwEntry).href);
    const chromium = pw.chromium ?? pw.default?.chromium;
    if (chromium) return chromium;
  } catch {
    // fall through
  }
  try {
    const mod = await import("@playwright/test");
    const chromium = mod.chromium ?? mod.default?.chromium;
    if (chromium) return chromium;
  } catch {
    // fall through
  }
  try {
    const webPkg = resolve(root, "apps/web/package.json");
    const requireFromWeb = createRequire(webPkg);
    const pw = requireFromWeb("playwright");
    const chromium = pw.chromium ?? pw.default?.chromium;
    if (chromium) return chromium;
  } catch {
    // fall through
  }
  throw new Error(
    "playwright not installed — run: cd scripts/.pw-deps && pnpm install",
  );
}

export async function healthOk() {
  for (const [label, base] of [
    ["game-server", httpBase],
    ["ai-gateway", process.env.AI_GATEWAY_URL || "http://127.0.0.1:8000"],
  ]) {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`${label} health ${res.status}`);
  }
  const webRes = await fetch(webBase, { signal: AbortSignal.timeout(8000) });
  if (!webRes.ok) throw new Error(`web ${webBase} ${webRes.status}`);
}

export async function resetRoom(roomId, playerId = null) {
  const headers = { "Content-Type": "application/json" };
  if (playerId) headers["X-Player-Id"] = playerId;
  const res = await fetch(`${httpBase}/rooms/${encodeURIComponent(roomId)}/reset`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`reset-room ${res.status}`);
}

export async function waitRoomReady(page, timeoutMs = 60_000) {
  await page.waitForFunction(
    () => {
      const w = /** @type {Window & { __colyseusRoom?: { state?: unknown } }} */ (window);
      return Boolean(w.__colyseusRoom?.state);
    },
    undefined,
    { timeout: timeoutMs },
  );
  await page.waitForSelector("canvas", { timeout: timeoutMs });
}

export async function fetchNpcPos(page) {
  return page.evaluate(() => {
    const w = /** @type {Window & { __colyseusRoom?: { state?: { npcs?: Map<string, { x?: number; y?: number }> } } }} */ (
      window
    );
    const room = w.__colyseusRoom;
    if (!room?.state?.npcs) return null;
    const npcs = room.state.npcs;
    const first = npcs instanceof Map ? npcs.values().next().value : Object.values(npcs)[0];
    if (!first || typeof first.x !== "number" || typeof first.y !== "number") return null;
    return { x: first.x, y: first.y };
  });
}

export async function waitNpcAt(page, x, y, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pos = await fetchNpcPos(page);
    if (pos && Math.abs(pos.x - x) <= 1.5 && Math.abs(pos.y - y) <= 1.5) return;
    await sleep(500);
  }
  throw new Error(`NPC did not reach (${x},${y}) within ${timeoutMs}ms`);
}
