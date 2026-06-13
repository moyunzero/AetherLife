/**
 * Phase 19 E2E — Immersive UI Shell layout smoke (UI-SHELL-01…06).
 * Layout only — no speak / no LLM inference.
 *
 * Requires: pnpm dev:stack (no LLM_MOCK=1, no dev:stack:mock).
 *
 * Testids covered (UI-SPEC):
 *   immersive-shell, phaser-stage-fill, dialogue-bar, composer-speak-status,
 *   corner-menu, reset-game-open, npc-avatar-strip, shell-drawer,
 *   shell-drawer-backdrop, message-list (class)
 * Absent: npc-tab-bar / .npc-tab-bar (UI-SHELL-04)
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";

const BOOT_WARN_MS = 5000;
const BOOT_FAIL_MS = 12_000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE19_ROOM_ID || `verify-p19-${Date.now()}`;
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

async function readPanelFillRatioWarn(page) {
  const result = await page.evaluate(() => {
    const fn = window.__aetherlife_visualDebug;
    if (typeof fn !== "function") {
      return { available: false };
    }
    const v = fn();
    if (!v) return { available: false };
    return { available: true, panelFillRatio: v.panelFillRatio };
  });
  if (result.available && typeof result.panelFillRatio === "number" && result.panelFillRatio < 0.85) {
    console.warn(
      `verify:phase19: WARN panelFillRatio=${result.panelFillRatio.toFixed(3)} < 0.85 (non-fatal)`,
    );
  }
}

async function main() {
  assertE2eNoMock("verify:phase19");
  console.log(`verify:phase19 → ${webUrl} WORLD_SEED=${process.env.WORLD_SEED}`);
  await healthOk();

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const bootStart = Date.now();
    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const shell = page.locator('[data-testid="immersive-shell"]');
    await shell.waitFor({ state: "visible", timeout: 45_000 });

    const maxWidth = await shell.evaluate((el) => getComputedStyle(el).maxWidth);
    if (maxWidth === "720px") {
      throw new Error("immersive-shell still capped at max-width: 720px");
    }
    console.log(`verify:phase19: immersive-shell maxWidth=${maxWidth}`);

    const stageFill = page.locator('[data-testid="phaser-stage-fill"]');
    await stageFill.waitFor({ state: "visible", timeout: 30_000 });
    const canvas = stageFill.locator("canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 45_000 });

    const bootMs = Date.now() - bootStart;
    console.log(`verify:phase19: bootMs=${bootMs}`);
    if (bootMs > BOOT_WARN_MS) {
      console.warn(`verify:phase19: WARN bootMs=${bootMs} exceeds ${BOOT_WARN_MS}ms budget`);
    }
    if (bootMs > BOOT_FAIL_MS) {
      throw new Error(`bootMs=${bootMs} exceeds fail threshold ${BOOT_FAIL_MS}ms`);
    }

    const box = await canvas.boundingBox();
    if (!box || box.height <= box.width * 0.5) {
      throw new Error(`expected tall stage fill, got ${box?.width ?? 0}x${box?.height ?? 0}`);
    }
    console.log(`verify:phase19: canvas ${box.width.toFixed(0)}x${box.height.toFixed(0)}`);

    const dialogueBar = page.locator('[data-testid="dialogue-bar"]');
    await dialogueBar.waitFor({ state: "visible", timeout: 15_000 });
    const composer = dialogueBar.locator("textarea.composer__input, textarea.dialogue-bar__input").first();
    await composer.waitFor({ state: "visible", timeout: 10_000 });

    const cornerMenu = page.locator('[data-testid="corner-menu"]');
    await cornerMenu.waitFor({ state: "visible", timeout: 10_000 });
    await cornerMenu.locator(".corner-menu__trigger").click();
    await page.locator('[data-testid="reset-game-open"]').waitFor({ state: "visible", timeout: 5_000 });
    await cornerMenu.locator(".corner-menu__trigger").click();

    const avatarStrip = page.locator('[data-testid="npc-avatar-strip"]');
    await avatarStrip.waitFor({ state: "attached", timeout: 10_000 });

    const tabBarCount = await page.locator('[data-testid="npc-tab-bar"], .npc-tab-bar').count();
    if (tabBarCount > 0) {
      throw new Error(`NpcTabBar must be absent from DOM, found ${tabBarCount} node(s)`);
    }

    await dialogueBar.getByRole("button", { name: "对话历史" }).click();
    const drawer = page.locator('[data-testid="shell-drawer"]');
    await drawer.waitFor({ state: "visible", timeout: 10_000 });
    const messageList = drawer.locator(".message-list");
    await messageList.waitFor({ state: "visible", timeout: 10_000 });

    await page.locator('[data-testid="shell-drawer-backdrop"]').click();
    await drawer.waitFor({ state: "detached", timeout: 5_000 });

    await readPanelFillRatioWarn(page);

    console.log("verify:phase19: PASS");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
