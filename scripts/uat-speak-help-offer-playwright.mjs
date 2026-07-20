/**
 * Speak coherence UAT (targeted): ensure help offers are not treated as help requests.
 *
 * Flow: engage NPC → 「干嘛呢？」→ 「我可以帮你！」
 * Assert second reply does NOT contain deterministic help-request stub:
 *   「好的，我会尽力帮忙。」
 *
 * Requires: pnpm dev:stack (real LLM). See docs/E2E-POLICY.md
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertE2eRealLlm } from "./lib/e2e-policy.mjs";
import { engageNpcDialogue } from "./lib/dialogue-engage.mjs";
import { sendSpeakOverlay } from "./lib/e2e-memory-helpers.mjs";
import { loadRootEnv } from "./lib/env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, ".planning/phases/08-multiplayer-room/uat-screenshots");

loadRootEnv(ROOT);

const WEB_BASE = process.env.WEB_URL || "http://localhost:5173";
const GS = process.env.GAME_SERVER_URL || "http://127.0.0.1:2567";
const UAT_NPC_ID = process.env.UAT_SPEAK_HELP_OFFER_NPC_ID || "npc-5";
const UAT_ROOM_ID = process.env.UAT_SPEAK_HELP_OFFER_ROOM_ID || `uat-help-offer-${Date.now()}`;
const WEB = `${WEB_BASE}${WEB_BASE.includes("?") ? "&" : "?"}room=${encodeURIComponent(UAT_ROOM_ID)}`;

const SPEAK_WAIT_TIMEOUT_MS = Number(process.env.UAT_SPEAK_WAIT_TIMEOUT_MS || 180_000);
const ENGAGE_TIMEOUT_MS = Number(process.env.UAT_SPEAK_ENGAGE_TIMEOUT_MS || 90_000);

const FORBIDDEN_STUB_RE = /好的，我会尽力帮忙。/;
const HELP_REQUEST_REPLY_PATTERNS = [
  FORBIDDEN_STUB_RE,
  /有什么我能帮你的/,
  /需要我做什么/,
  /我会尽力帮忙/,
];
const HELP_OFFER_ACCEPTANCE_RE = /感谢|谢谢|好意|感动|愿意|陪|太好了/;

function assertHelpOfferReply(firstReply, secondReply) {
  const second = (secondReply || "").trim();
  if (second.length < 10) {
    throw new Error(`Help-offer reply too short: ${JSON.stringify(second)}`);
  }
  for (const pattern of HELP_REQUEST_REPLY_PATTERNS) {
    if (pattern.test(second)) {
      throw new Error(
        `Regression: NPC reply sounds like help-request stub: ${JSON.stringify(second)}`,
      );
    }
  }
  if (!HELP_OFFER_ACCEPTANCE_RE.test(second)) {
    throw new Error(
      `Help-offer reply lacks acceptance/gratitude cue: ${JSON.stringify(second)}`,
    );
  }
  if (firstReply.trim() && second === firstReply.trim()) {
    throw new Error("Help-offer reply duplicated first NPC line");
  }
}

async function screenshot(page, label) {
  await mkdir(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `help-offer-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  📸 ${path.relative(ROOT, file)}`);
}

async function health(url, name) {
  const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${name} /health → ${res.status}`);
  const body = await res.json();
  if (body.status !== "ok") throw new Error(`${name} /health body invalid`);
}

async function main() {
  assertE2eRealLlm("uat:speak-help-offer:playwright");

  console.log("Speak help-offer UAT (Playwright)");
  console.log(`WEB=${WEB} GS=${GS} npc=${UAT_NPC_ID} room=${UAT_ROOM_ID}`);

  await health(GS, "game-server");
  try {
    const webRes = await fetch(WEB, { signal: AbortSignal.timeout(15_000) });
    if (!webRes.ok) throw new Error(`Web ${WEB} → ${webRes.status}`);
  } catch (err) {
    throw new Error(
      `Web 不可达 — 请先 pnpm dev:stack（真实 LLM，见 docs/E2E-POLICY.md）: ${err.message}`,
    );
  }

  const pwEntry = path.join(ROOT, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) throw new Error("playwright 未安装：cd scripts/.pw-deps && npm install");

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(SPEAK_WAIT_TIMEOUT_MS);

  await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator('[data-testid="room-scene"]').waitFor({ state: "visible", timeout: 45_000 });
  await engageNpcDialogue(page, UAT_NPC_ID, { timeoutMs: ENGAGE_TIMEOUT_MS });
  await screenshot(page, "00-engaged");

  const speakOpts = {
    speakTimeoutMs: SPEAK_WAIT_TIMEOUT_MS,
    engageTimeoutMs: ENGAGE_TIMEOUT_MS,
    skipEngage: true,
  };

  const first = await sendSpeakOverlay(page, "干嘛呢？", speakOpts);
  console.log(`  NPC after 「干嘛呢？」: ${first.reply.slice(0, 80)}…`);
  await screenshot(page, "01-npc-after-first-message");
  if (!first.reply.trim()) throw new Error("First NPC reply empty");

  const second = await sendSpeakOverlay(page, "我可以帮你！", speakOpts);
  await screenshot(page, "02-npc-after-help-offer");

  assertHelpOfferReply(first.reply, second.reply);

  console.log(`✅ Passed: NPC reply after help offer: ${second.reply}`);

  await browser.close();
}

main().catch((err) => {
  console.error(`❌ UAT failed: ${err?.message || err}`);
  process.exit(1);
});
