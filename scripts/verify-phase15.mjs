/**
 * Phase 15 E2E — Town play loop (PLAY-01…04 smoke).
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real API keys in .env.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertE2eNoMock,
  assertE2eRealLlm,
  e2eSpeakTimeoutMs,
} from "./lib/e2e-policy.mjs";

const BOOT_WARN_MS = 5000;
const BOOT_FAIL_MS = 8000;
const BANNER_WAIT_MS = 30_000;

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

const httpBase =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE15_ROOM_ID || `verify-p15-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const speakTimeoutMs = Math.max(90_000, e2eSpeakTimeoutMs());
const MEMORY_SEED = `FACT-P15-${Date.now()}`;
const MEMORY_POLL_MS = Number.parseInt(process.env.VERIFY_MEMORY_POLL_MS || "90000", 10);

function internalHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function waitForMemoryContext(roomId, playerId, query, needle) {
  const memUrl =
    `${httpBase}/internal/rooms/${roomId}/memory-context` +
    `?playerMessage=${encodeURIComponent(query)}` +
    `&npcId=npc-1` +
    `&playerId=${encodeURIComponent(playerId)}`;
  await waitFor(
    async () => {
      const memRes = await fetch(memUrl, { headers: internalHeaders() });
      const memCtx = (await memRes.json().catch(() => ({}))) ?? {};
      if (!memRes.ok) return false;
      const hay = JSON.stringify(memCtx).toLowerCase();
      return hay.includes(String(needle).toLowerCase());
    },
    MEMORY_POLL_MS,
    `memory-context containing ${needle}`,
  );
}

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

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout: ${label} (${timeoutMs}ms)`);
}

async function sendSpeakAndWaitReply(page, text) {
  const started = Date.now();
  const composer = page.locator("textarea.composer__input");
  await composer.fill(text);
  await page.getByRole("button", { name: "发送指令" }).click();
  await waitFor(
    async () => {
      const thinking = await page.locator(".message--thinking").isVisible().catch(() => false);
      const latestNpc = page.locator(".message--npc.message--latest .message__text");
      const visible = await latestNpc.isVisible().catch(() => false);
      if (!visible) return false;
      const reply = await latestNpc.innerText();
      return !thinking && reply.trim().length > 0;
    },
    speakTimeoutMs,
    `NPC reply for "${text.slice(0, 40)}…"`,
  );
  const ms = Date.now() - started;
  const reply = await page.locator(".message--npc.message--latest .message__text").innerText();
  console.log(`verify:phase15: speakMs=${ms} text="${text.slice(0, 50)}" reply="${reply.slice(0, 60)}"`);
  return { reply, ms };
}

async function moveOffHomeForJournal(page) {
  await page.locator('[data-testid="explore-coords-strip"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="explore-coords-strip"]').click();
  for (let i = 0; i < 48; i += 1) {
    await page.keyboard.press("s");
    await page.waitForTimeout(180);
  }
  await page.waitForFunction(
    () => {
      const d = window.__aetherlife_moveDebug?.();
      return d != null && d.pending === 0 && !d.locomoting;
    },
    { timeout: 15_000 },
  );
  await waitFor(
    async () => {
      const strip = page.locator('[data-testid="journal-quest-strip"]');
      const hook = page.locator('[data-testid="journal-quest-hook"]');
      if (!(await strip.isVisible().catch(() => false))) return false;
      const text = (await hook.innerText().catch(() => "")).trim();
      return text.length > 0;
    },
    120_000,
    "journal-quest-strip with non-empty hook (lore ready)",
  );
  const hookText = await page.locator('[data-testid="journal-quest-hook"]').innerText();
  console.log(`verify:phase15: journal hook="${hookText.trim().slice(0, 80)}"`);
}

async function main() {
  assertE2eNoMock("verify:phase15");
  assertE2eRealLlm("verify:phase15");
  console.log(`verify:phase15 → ${webUrl} WORLD_SEED=${process.env.WORLD_SEED} seed=${MEMORY_SEED}`);
  await healthOk();

  const playerId = `verifyp15${String(Date.now()).slice(-10)}`;
  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(
      ({ key, id }) => {
        localStorage.setItem(key, id);
      },
      { key: "aetherlife:playerId", id: playerId },
    );
    const page = await context.newPage();
    const bootStart = Date.now();
    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
      state: "visible",
      timeout: 45_000,
    });
    const bootMs = Date.now() - bootStart;
    console.log(`verify:phase15: bootMs=${bootMs}`);
    if (bootMs > BOOT_WARN_MS) {
      console.warn(`verify:phase15: WARN bootMs=${bootMs} exceeds ${BOOT_WARN_MS}ms`);
    }
    if (bootMs > BOOT_FAIL_MS) {
      throw new Error(`bootMs=${bootMs} exceeds fail threshold ${BOOT_FAIL_MS}ms`);
    }

    await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
    await moveOffHomeForJournal(page);

    await sendSpeakAndWaitReply(page, "移动到我的下方");
    await sendSpeakAndWaitReply(
      page,
      `请记住 ${MEMORY_SEED} 门禁密码是 7`,
    );
    await waitForMemoryContext(roomId, playerId, `${MEMORY_SEED} 密码`, MEMORY_SEED);
    console.log(`verify:phase15: memory seed persisted (${MEMORY_SEED})`);

    const rudeStart = Date.now();
    await sendSpeakAndWaitReply(page, "你真没礼貌，滚开");

    await waitFor(
      async () => {
        const events = page.locator('[data-testid="collective-recent-events"] li');
        return (await events.count()) > 0;
      },
      20_000,
      "collective-recent-events after rude speak",
    );

    await waitFor(
      async () => page.locator('[data-testid="collective-feedback-banner"]').isVisible(),
      BANNER_WAIT_MS,
      "collective-feedback-banner within 30s",
    );
    console.log(`verify:phase15: rude→bannerMs=${Date.now() - rudeStart}`);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });

    const { reply: recallReply } = await sendSpeakAndWaitReply(
      page,
      `我之前说的 ${MEMORY_SEED} 门禁密码是多少？`,
    );

    await waitFor(
      async () => page.locator('[data-testid="npc-memory-callback"]').isVisible(),
      speakTimeoutMs,
      "npc-memory-callback after reload recall",
    );

    const hay = recallReply.toLowerCase();
    if (!hay.includes(MEMORY_SEED.toLowerCase()) && !hay.includes("7")) {
      throw new Error(
        `recall reply missing seed token (seed=${MEMORY_SEED} reply="${recallReply.slice(0, 120)}")`,
      );
    }
    console.log("verify:phase15: memory citation + recall OK");
  } finally {
    await browser.close();
  }

  console.log("verify:phase15 OK");
}

main().catch((err) => {
  console.error(`verify:phase15 failed: ${err.message}`);
  console.error("Ensure full stack: pnpm dev:stack (no LLM_MOCK). Game-server :2567, web :5173.");
  process.exit(1);
});
