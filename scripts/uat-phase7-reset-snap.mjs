/**
 * Phase 7 UAT Test 5 — 新游戏后 NPC 必须 snap 到默认格，不得走回动画。
 * Requires: web (5173) + game-server (2567). Phaser room (not ?phaserFallback=1).
 */
import { mkdir } from "node:fs/promises";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = process.env.WEB_URL || "http://127.0.0.1:5173";
const GS = process.env.GAME_SERVER_URL || "http://127.0.0.1:2567";
const ROOM = "default";
const NPC_ID = "npc-1";
const DEFAULT = { x: 2, y: 2 };
const FAR = { x: 6, y: 6 };
const outDir = resolve(root, ".planning/phases/07-2-5d-renderer/uat-screenshots");

async function loadPlaywright() {
  const entry = resolve(root, "scripts/.pw-deps/node_modules/playwright/index.js");
  return import(pathToFileURL(entry).href);
}

function fail(msg) {
  console.error(`\n❌ uat:phase7:reset-snap: ${msg}`);
  process.exit(1);
}

async function gs(path, options = {}) {
  const res = await fetch(`${GS}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    fail(`${options.method || "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function health(url, name) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) fail(`${name} /health → ${res.status}`);
    const body = await res.json();
    if (body.status !== "ok") fail(`${name} /health invalid`);
  } catch (err) {
    fail(`${name} 不可达 (${url}): ${err.message}`);
  }
}

async function waitPhaserDebug(page, timeoutMs = 20_000) {
  await page.waitForFunction(
    () => typeof window.__aetherlife_npcDebug === "function",
    { timeout: timeoutMs },
  );
}

async function waitNpcAt(page, x, y, timeoutMs = 15_000) {
  await page.waitForFunction(
    ({ tx, ty, id }) => {
      const d = window.__aetherlife_npcDebug?.();
      const s = d?.sprites?.find((n) => n.id === id);
      return Boolean(s && s.gridX === tx && s.gridY === ty && !s.tweening);
    },
    { tx: x, ty: y, id: NPC_ID },
    { timeout: timeoutMs },
  );
}

/** After reset, NPC must not step-tween from far cell back to default (Stardew snap). */
async function assertNoResetWalkBack(page) {
  let walkBackSamples = 0;
  for (let i = 0; i < 30; i++) {
    const bad = await page.evaluate(
      ({ dx, dy, id }) => {
        const d = window.__aetherlife_npcDebug?.();
        if (!d?.animateNpcMoves) return false;
        const target = d.npcs?.find((n) => n.id === id);
        const sprite = d.sprites?.find((n) => n.id === id);
        if (!target || !sprite?.tweening) return false;
        const atDefault = target.x === dx && target.y === dy;
        const spriteFar =
          Math.abs(sprite.gridX - dx) + Math.abs(sprite.gridY - dy) > 1;
        return atDefault && spriteFar;
      },
      { dx: DEFAULT.x, dy: DEFAULT.y, id: NPC_ID },
    );
    if (bad) walkBackSamples += 1;
    await page.waitForTimeout(50);
  }
  if (walkBackSamples > 0) {
    fail(
      `NPC「走回」动画检测到 ${walkBackSamples}/30 帧（目标默认格但 sprite 仍在远处 tween）`,
    );
  }
}

async function main() {
  assertE2eNoMock("uat:phase7:reset-snap");
  await health(GS, "game-server");
  await mkdir(outDir, { recursive: true });

  const initial = await gs(`/rooms/${ROOM}/state`);
  const npc = initial.state?.npcs?.find((n) => n.id === NPC_ID);
  if (npc?.x !== DEFAULT.x || npc?.y !== DEFAULT.y) {
    await gs(`/rooms/${ROOM}/reset`, { method: "POST" });
  }

  await gs(`/rooms/${ROOM}/apply-actions`, {
    method: "POST",
    body: JSON.stringify({
      actingNpcId: NPC_ID,
      actions: [{ type: "move", x: FAR.x, y: FAR.y }],
    }),
  });

  const pw = await loadPlaywright();
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) fail("playwright chromium 未加载（检查 scripts/.pw-deps）");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(WEB, { waitUntil: "load", timeout: 30_000 });

  await page
    .locator('[data-testid="room-scene"], [data-testid="phaser-parent"]')
    .first()
    .waitFor({ state: "visible", timeout: 45_000 });
  const fallback = await page.locator('[data-testid="phaser-fallback-banner"]').count();
  if (fallback > 0) {
    fail("Phaser 未启用（fallback 网格），无法检测 NPC tween；去掉 VITE_PHASER_FORCE_FALLBACK 后重试");
  }

  await waitPhaserDebug(page);
  await waitNpcAt(page, FAR.x, FAR.y);
  await page.screenshot({
    path: resolve(outDir, "reset-snap-before.png"),
    fullPage: true,
  });

  await page.getByTestId("reset-game-open").click();
  await page.getByTestId("reset-confirm-start").click();

  await page.waitForFunction(
    () => {
      const d = window.__aetherlife_npcDebug?.();
      const s = d?.sprites?.find((n) => n.id === "npc-1");
      return Boolean(s && s.gridX === 2 && s.gridY === 2);
    },
    { timeout: 10_000 },
  );

  await assertNoResetWalkBack(page);

  await page.screenshot({
    path: resolve(outDir, "reset-snap-after.png"),
    fullPage: true,
  });

  const state = await gs(`/rooms/${ROOM}/state`);
  const after = state.state?.npcs?.find((n) => n.id === NPC_ID);
  if (after?.x !== DEFAULT.x || after?.y !== DEFAULT.y) {
    fail(`服务端 npc-1 未回到默认格: (${after?.x}, ${after?.y})`);
  }

  await browser.close();
  console.log("uat:phase7:reset-snap OK — 新游戏后 NPC snap，无走回 tween");
}

main().catch((err) => {
  fail(err.message);
});
