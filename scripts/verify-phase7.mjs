import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@colyseus/sdk";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";
import { gameServerHttpBase, gameServerWsUrl, loadRootEnv } from "./lib/env.mjs";
import { HOME_MAP_TILE_H, HOME_MAP_TILE_W } from "./lib/home-spawn.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

const httpBase = gameServerHttpBase();
const wsUrl = gameServerWsUrl();
const webUrl = process.env.WEB_URL || "http://127.0.0.1:5173";
const roomId = process.env.VERIFY_PHASE7_ROOM_ID || `verify-p7-${Date.now()}`;
const forceFallback = process.env.PHASER_FORCE_FALLBACK === "1";

const STEP_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

async function healthOk() {
  const res = await fetch(`${httpBase}/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
  const body = await res.json();
  if (body.service !== "game-server") throw new Error("unexpected health body");
}

function waitFor(condition, timeoutMs = 3000, intervalMs = 50) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("timeout waiting for condition"));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

async function waitForPlayersMap(room, timeoutMs = 5000) {
  await waitFor(() => room.state?.players?.get, timeoutMs);
}

async function moveOneStep(roomA, roomB, sessionA) {
  const start = roomA.state.players.get(sessionA);
  if (!start) throw new Error("player missing before step move");

  for (const [dx, dy] of STEP_DIRS) {
    const nx = start.x + dx;
    const ny = start.y + dy;
    if (nx < 0 || ny < 0 || nx >= HOME_MAP_TILE_W || ny >= HOME_MAP_TILE_H) continue;

    roomA.send("move", { dx, dy });
    try {
      await waitFor(() => {
        const peer = roomB.state.players.get(sessionA);
        return peer?.x === nx && peer?.y === ny;
      }, 2000);
      return { x: nx, y: ny };
    } catch {
      /* blocked — try next */
    }
  }
  throw new Error(
    `no valid step from (${start.x},${start.y}); room may be crowded or grid blocked`,
  );
}

async function verifyFallbackUi() {
  const res = await fetch(webUrl, { redirect: "follow" });
  if (!res.ok) throw new Error(`web ${res.status} at ${webUrl}`);

  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    console.warn(
      "verify:phase7: PHASER_FORCE_FALLBACK=1 but playwright not installed — skipping UI fallback assert",
    );
    return;
  }

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${webUrl}/?phaserFallback=1`, {
      waitUntil: "networkidle",
      timeout: 20_000,
    });

    const banner = page.locator('[data-testid="phaser-fallback-banner"]');
    const panel = page.locator('[data-testid="movement-panel"]');
    const phaserParent = page.locator('[data-testid="phaser-parent"]');

    await waitFor(async () => (await banner.count()) > 0, 8000);
    if ((await panel.count()) === 0) {
      throw new Error("movement-panel missing in fallback mode");
    }
    if ((await phaserParent.count()) > 0) {
      throw new Error("phaser-parent should not render in fallback mode");
    }
    console.log("verify:phase7: fallback UI OK");
  } finally {
    await browser.close();
  }
}

async function main() {
  assertE2eNoMock("verify:phase7");
  console.log(`verify:phase7 → ${wsUrl} roomId=${roomId}`);
  await healthOk();

  const clientA = new Client(wsUrl);
  const clientB = new Client(wsUrl);

  const roomA = await clientA.joinOrCreate("game_room", { mapRoomId: roomId });
  const roomB = await clientB.joinOrCreate("game_room", { mapRoomId: roomId });

  await waitForPlayersMap(roomA);
  await waitForPlayersMap(roomB);

  await waitFor(
    () => roomA.state.players.size >= 2 && roomB.state.players.size >= 2,
    5000,
  );

  const sessionA = roomA.sessionId;
  if (roomB.state.players.get(sessionA) === undefined) {
    throw new Error("peer player missing from replicated state");
  }

  const afterStep = await moveOneStep(roomA, roomB, sessionA);
  console.log(`verify:phase7: step sync OK → (${afterStep.x},${afterStep.y})`);

  const stateRes = await fetch(`${httpBase}/rooms/${roomId}/state`);
  if (!stateRes.ok) {
    throw new Error(`room state GET ${stateRes.status}`);
  }

  await roomA.leave();
  await roomB.leave();

  if (forceFallback) {
    await verifyFallbackUi();
  }

  console.log("verify:phase7 OK");
}

main().catch((err) => {
  console.error(`verify:phase7 failed: ${err.message}`);
  console.error(
    "Ensure full stack: pnpm dev:stack. Game-server on :2567. For fallback UI: PHASER_FORCE_FALLBACK=1 and playwright.",
  );
  process.exit(1);
});
