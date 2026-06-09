/**
 * Phase 15 UAT — dual-player rude: initiator-only CollectiveFeedbackBanner.
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real LLM keys.
 * Output: .planning/phases/15-town-play-loop/screenshots/
 */
import { mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertE2eNoMock,
  assertE2eRealLlm,
  e2eSpeakTimeoutMs,
} from "./lib/e2e-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, ".planning/phases/15-town-play-loop/screenshots");
const HTTP_BASE =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const WEB_BASE = process.env.WEB_URL || "http://localhost:5173";
const UAT_ROOM_ID = process.env.UAT_PHASE15_ROOM_ID || `uat-p15-${Date.now()}`;
const WEB = `${WEB_BASE}?room=${encodeURIComponent(UAT_ROOM_ID)}`;
const speakTimeoutMs = Math.max(90_000, e2eSpeakTimeoutMs());
const RUDE = "你真没礼貌，滚开";

async function loadPlaywright() {
  const pwEntry = path.join(ROOT, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) throw new Error("playwright 未安装：cd scripts/.pw-deps && npm install");
  return chromium;
}

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout: ${label} (${timeoutMs}ms)`);
}

async function shot(page, label) {
  await mkdir(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  📸 ${path.relative(ROOT, file)}`);
}

async function sendRudeSpeak(page) {
  await page.locator("textarea.composer__input").fill(RUDE);
  await page.getByRole("button", { name: "发送指令" }).click();
  await waitFor(
    async () => {
      const thinking = await page.locator(".message--thinking").isVisible().catch(() => false);
      const latestNpc = page.locator(".message--npc.message--latest .message__text");
      const visible = await latestNpc.isVisible().catch(() => false);
      if (!visible) return false;
      const text = await latestNpc.innerText();
      return !thinking && text.length > 0;
    },
    speakTimeoutMs,
    "NPC reply after rude speak",
  );
}

async function main() {
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

  assertE2eNoMock("uat:phase15:playwright");
  assertE2eRealLlm("uat:phase15:playwright");

  const health = await fetch(`${HTTP_BASE}/health`).then((r) => r.json()).catch(() => null);
  if (health?.status !== "ok" && health?.service !== "game-server") {
    throw new Error(`game-server not reachable — run pnpm dev:stack`);
  }

  const playerA = `uatp15a${String(Date.now()).slice(-8)}`;
  const playerB = `uatp15b${String(Date.now()).slice(-8)}`;
  console.log(`uat:phase15:playwright → ${WEB} A=${playerA.slice(-6)} B=${playerB.slice(-6)}`);

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });

  const ctxA = await browser.newContext();
  await ctxA.addInitScript(
    ({ key, id }) => localStorage.setItem(key, id),
    { key: "aetherlife:playerId", id: playerA },
  );
  const pageA = await ctxA.newPage();

  const ctxB = await browser.newContext();
  await ctxB.addInitScript(
    ({ key, id }) => localStorage.setItem(key, id),
    { key: "aetherlife:playerId", id: playerB },
  );
  const pageB = await ctxB.newPage();

  try {
    await pageA.goto(WEB, { waitUntil: "networkidle", timeout: 45_000 });
    await pageB.goto(WEB, { waitUntil: "networkidle", timeout: 45_000 });
    await pageA.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
    await pageB.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });

    await pageA.getByRole("tab", { name: /路昂|NPC/ }).first().click().catch(() => {});
    await sendRudeSpeak(pageA);

    await waitFor(
      async () => pageA.locator('[data-testid="collective-feedback-banner"]').isVisible(),
      30_000,
      "initiator banner on player A",
    );
    await shot(pageA, "collective-feedback-banner-initiator");

    const bannerOnB = await pageB.locator('[data-testid="collective-feedback-banner"]').isVisible().catch(() => false);
    if (bannerOnB) {
      throw new Error("non-initiator player B saw collective-feedback-banner");
    }
    console.log("uat:phase15:playwright OK — banner initiator-only");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`uat:phase15:playwright failed: ${err.message}`);
  process.exit(1);
});
