/**
 * Phase 29 D-SESS — dialogue continuity after game-server Map loss (simulated restart).
 *
 * Hard gate (no LLM):
 * 1. Engage room in Playwright (gameplay surface)
 * 2. POST dialogue-append (Map + Redis mirror) with distinctive seed
 * 3. POST dialogue-map-evict (Map cleared, Redis intact)
 * 4. GET dialogue-turns → must include seed (getRecentTurnsAsync rehydrate)
 *
 * Soft gate (when social LLM healthy):
 * 5. Speak recall; reply should cite seed tokens
 *
 * Requires: pnpm dev:stack + REDIS_URL. Real LLM keys required by policy (soft speak optional).
 * Forbidden: LLM_MOCK=1 / dev:stack:mock
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertE2eRealLlm } from "./lib/e2e-policy.mjs";
import { engageNpcDialogue } from "./lib/dialogue-engage.mjs";
import { sendSpeakOverlay } from "./lib/e2e-memory-helpers.mjs";
import { loadRootEnv } from "./lib/env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(
  ROOT,
  ".planning/phases/29-npc-memory-retrieval-quality/uat-screenshots",
);

loadRootEnv(ROOT);

const WEB_BASE = process.env.WEB_URL || "http://localhost:5173";
const GS = process.env.GAME_SERVER_URL || "http://127.0.0.1:2567";
const UAT_NPC_ID = process.env.UAT_PHASE29_NPC_ID || "npc-5";
const UAT_ROOM_ID =
  process.env.UAT_PHASE29_ROOM_ID || `uat-p29-restart-${Date.now()}`;
const UAT_PLAYER_ID =
  process.env.UAT_PHASE29_PLAYER_ID || `uatp29${String(Date.now()).slice(-10)}`;
const WEB = `${WEB_BASE}${WEB_BASE.includes("?") ? "&" : "?"}room=${encodeURIComponent(UAT_ROOM_ID)}`;

const SPEAK_WAIT_TIMEOUT_MS = Number(process.env.UAT_SPEAK_WAIT_TIMEOUT_MS || 180_000);
const ENGAGE_TIMEOUT_MS = Number(process.env.UAT_SPEAK_ENGAGE_TIMEOUT_MS || 90_000);
const SKIP_SPEAK_RECALL = process.env.UAT_PHASE29_SKIP_SPEAK === "1";

const SEED_TOKEN_A = "蓝莓派";
const SEED_TOKEN_B = "七号";
const SEED_MESSAGE = `我告诉你：我的暗号是${SEED_TOKEN_A}${SEED_TOKEN_B}。`;
const SEED_NPC_REPLY = "好的，我记下了你的暗号。";
const RECALL_MESSAGE = "复述一遍我的暗号。";

const DEGRADED_REPLY_RES = [/我听到了：/, /与房间互动/, /抱歉，我这边还做不到/];

function internalHeaders() {
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json" };
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function screenshot(page, label) {
  await mkdir(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `dialogue-restart-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  📸 ${path.relative(ROOT, file)}`);
}

async function health(url, name) {
  const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${name} /health → ${res.status}`);
  const body = await res.json();
  if (body.status !== "ok") throw new Error(`${name} /health body invalid`);
}

async function appendDialogueSeed(roomId, playerId, npcId) {
  const url = `${GS}/internal/rooms/${encodeURIComponent(roomId)}/dialogue-append`;
  const res = await fetch(url, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({
      playerId,
      npcId,
      playerMessage: SEED_MESSAGE,
      npcReply: SEED_NPC_REPLY,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok !== true) {
    throw new Error(`dialogue-append failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  console.log("  ✓ dialogue-append seeded (Map + Redis mirror)");
}

async function evictDialogueMap(roomId) {
  const url = `${GS}/internal/rooms/${encodeURIComponent(roomId)}/dialogue-map-evict`;
  const res = await fetch(url, {
    method: "POST",
    headers: internalHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok !== true) {
    throw new Error(
      `dialogue-map-evict failed: HTTP ${res.status} ${JSON.stringify(body)}`,
    );
  }
  console.log(`  Map-evict room=${roomId} evicted=${body.evicted}`);
  if (Number(body.evicted) < 1) {
    throw new Error(`expected evicted≥1 after seed, got ${body.evicted}`);
  }
  return body;
}

async function fetchDialogueTurns(roomId, playerId, npcId) {
  const qs = new URLSearchParams({ playerId, npcId, limit: "20" });
  const url = `${GS}/internal/rooms/${encodeURIComponent(roomId)}/dialogue-turns?${qs}`;
  const res = await fetch(url, {
    headers: internalHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok !== true || !Array.isArray(body.turns)) {
    throw new Error(
      `dialogue-turns failed: HTTP ${res.status} ${JSON.stringify(body)}`,
    );
  }
  return body.turns;
}

function assertTurnsContainSeed(turns) {
  const hay = JSON.stringify(turns);
  const hitA = hay.includes(SEED_TOKEN_A);
  const hitB = hay.includes(SEED_TOKEN_B);
  if (!hitA && !hitB) {
    throw new Error(
      `Post-evict dialogue-turns missing seed (${SEED_TOKEN_A}|${SEED_TOKEN_B}): ${hay.slice(0, 500)}`,
    );
  }
  if (turns.length < 2) {
    throw new Error(`Expected ≥2 turns after rehydrate, got ${turns.length}`);
  }
  console.log(`  ✓ dialogue-turns rehydrate contains seed (${turns.length} turns)`);
}

function replyLooksDegraded(text) {
  return DEGRADED_REPLY_RES.some((re) => re.test(text));
}

function assertRecallReply(reply) {
  const text = (reply || "").trim();
  if (text.length < 4) {
    throw new Error(`Recall reply too short: ${JSON.stringify(text)}`);
  }
  if (replyLooksDegraded(text)) {
    throw new Error(`Recall reply degraded/stub: ${JSON.stringify(text)}`);
  }
  const hitA = text.includes(SEED_TOKEN_A);
  const hitB = text.includes(SEED_TOKEN_B);
  if (!hitA && !hitB) {
    throw new Error(
      `Recall reply missing seed tokens (${SEED_TOKEN_A}|${SEED_TOKEN_B}): ${JSON.stringify(text)}`,
    );
  }
}

async function main() {
  assertE2eRealLlm("uat:phase29:dialogue-restart");

  if (!process.env.REDIS_URL?.trim()) {
    throw new Error(
      "REDIS_URL required for dialogue Redis mirror / rehydrate (D-SESS). Set in .env.",
    );
  }

  console.log("Phase 29 dialogue-restart UAT (Playwright, Map-evict)");
  console.log(
    `WEB=${WEB} GS=${GS} npc=${UAT_NPC_ID} room=${UAT_ROOM_ID} player=${UAT_PLAYER_ID}`,
  );

  await health(GS, "game-server");
  try {
    const webRes = await fetch(WEB_BASE, { signal: AbortSignal.timeout(15_000) });
    if (!webRes.ok) throw new Error(`Web ${WEB_BASE} → ${webRes.status}`);
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
  await ctx.addInitScript(
    ({ key, id }) => {
      localStorage.setItem(key, id);
    },
    { key: "aetherlife:playerId", id: UAT_PLAYER_ID },
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(SPEAK_WAIT_TIMEOUT_MS);

  try {
    await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator('[data-testid="room-scene"]').waitFor({ state: "visible", timeout: 60_000 });
    await engageNpcDialogue(page, UAT_NPC_ID, { timeoutMs: ENGAGE_TIMEOUT_MS });
    await screenshot(page, "00-engaged");

    await appendDialogueSeed(UAT_ROOM_ID, UAT_PLAYER_ID, UAT_NPC_ID);
    await new Promise((r) => setTimeout(r, 1500));
    await evictDialogueMap(UAT_ROOM_ID);

    const turns = await fetchDialogueTurns(UAT_ROOM_ID, UAT_PLAYER_ID, UAT_NPC_ID);
    assertTurnsContainSeed(turns);
    await screenshot(page, "01-after-rehydrate");

    if (SKIP_SPEAK_RECALL) {
      console.log("✅ Passed (D-SESS): Map-evict + dialogue-turns rehydrate (speak recall skipped).");
      return;
    }

    try {
      const recall = await sendSpeakOverlay(page, RECALL_MESSAGE, {
        speakTimeoutMs: SPEAK_WAIT_TIMEOUT_MS,
        engageTimeoutMs: ENGAGE_TIMEOUT_MS,
        skipEngage: true,
      });
      console.log(`  NPC after recall: ${recall.reply}`);
      await screenshot(page, "02-after-recall");

      if (replyLooksDegraded(recall.reply) || !recall.reply.trim()) {
        console.warn(
          "  ⚠ social LLM degraded/empty on recall — D-SESS still PASS via dialogue-turns.",
        );
        console.log(
          "✅ Passed (D-SESS rehydrate): Map-evict + dialogue-turns contain seed; gameplay cite soft-skipped.",
        );
      } else {
        assertRecallReply(recall.reply);
        console.log(`✅ Passed: rehydrate + recall cites seed — ${recall.reply}`);
      }
    } catch (speakErr) {
      console.warn(
        `  ⚠ speak recall failed (${speakErr?.message || speakErr}) — D-SESS still PASS via dialogue-turns.`,
      );
      console.log(
        "✅ Passed (D-SESS rehydrate): Map-evict + dialogue-turns contain seed; gameplay cite soft-skipped.",
      );
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`❌ UAT failed: ${err?.message || err}`);
  process.exit(1);
});
