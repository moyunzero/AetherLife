/**
 * Phase 21 E2E — World Echo town loop (SOLO-02/03 smoke).
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real API keys in .env.
 *
 * Replaces Phase 15 journal-quest-strip gate with lore-discover-toast + drawer「已发现」.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertE2eNoMock,
  assertE2eRealLlm,
  e2eSpeakTimeoutMs,
} from "./lib/e2e-policy.mjs";
import { engageDialogue } from "./lib/dialogue-engage.mjs";
import {
  closeShellDrawer,
  openShellDrawerHistory,
  openShellDrawerCollective,
  sendSpeakOverlay,
  waitForMemoryContext,
} from "./lib/e2e-memory-helpers.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";

const BOOT_WARN_MS = 5000;
const BOOT_FAIL_MS = 8000;
const BANNER_WAIT_MS = 30_000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE21_ROOM_ID || process.env.VERIFY_PHASE15_ROOM_ID || `verify-p21-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const speakTimeoutMs = Math.max(90_000, e2eSpeakTimeoutMs());
const MEMORY_SEED = `FACT-P21-${Date.now()}`;
const MEMORY_POLL_MS = Number.parseInt(
  process.env.VERIFY_MEMORY_POLL_MS ||
    process.env.VERIFY_PHASE21_MEMORY_POLL_MS ||
    process.env.VERIFY_PHASE20_MEMORY_POLL_MS ||
    "300000",
  10,
);
const E2E_LORE_TIMEOUT_MS = Number.parseInt(process.env.E2E_LORE_TIMEOUT_MS || "", 10) || 180_000;

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

function chunkManhattanDist(a, b) {
  return Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
}

/** Composer textarea focus blocks WASD via gridMovement blocksMovementKeys. */
async function blurComposerForMovement(page) {
  await page.evaluate(() => {
    document.querySelector("textarea.composer__input")?.blur();
    document.querySelector("input.composer__input")?.blur();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
}

async function readMovementProbe(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    const placeName = document.querySelector('[data-testid="explore-place-name"]')?.textContent?.trim() ?? "";
    return {
      activeTag: active?.tagName ?? null,
      activeClass: active instanceof HTMLElement ? active.className : null,
      composerFocused: Boolean(
        active instanceof HTMLTextAreaElement && active.classList.contains("composer__input"),
      ),
      placeName,
      lorePending: Boolean(document.querySelector('[data-testid="lore-pending-hint"]')),
      moveDebug: typeof window.__aetherlife_moveDebug === "function" ? window.__aetherlife_moveDebug() : null,
    };
  });
}

/** Immersive shell visually hides explore-coords-strip; focus canvas for WASD. */
async function focusExploreForKeyboard(page) {
  await closeShellDrawer(page);
  const stageCanvas = page.locator('[data-testid="phaser-stage-fill"] canvas').first();
  const parentCanvas = page.locator('[data-testid="phaser-parent"] canvas').first();
  const target = (await stageCanvas.count()) > 0 ? stageCanvas : parentCanvas;
  await target.waitFor({ state: "visible", timeout: 30_000 });
  const box = await target.boundingBox();
  if (!box) {
    throw new Error("explore focus: canvas missing boundingBox");
  }
  await blurComposerForMovement(page);
  await target.click({
    position: { x: Math.max(1, Math.floor(box.width / 2)), y: Math.max(1, Math.floor(box.height / 2)) },
  });
  await blurComposerForMovement(page);
}

function internalHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
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

async function assertJournalQuestStripAbsent(page) {
  const strip = page.locator('[data-testid="journal-quest-strip"]');
  if (await strip.isVisible().catch(() => false)) {
    throw new Error("journal-quest-strip must not be visible (Phase 21 SOLO-03)");
  }
}

async function readLoreToastBody(page) {
  const toast = page.locator('[data-testid="lore-discover-toast"]');
  if (!(await toast.isVisible().catch(() => false))) return "";
  return (await page.locator(".lore-discover-toast__body").innerText().catch(() => "")).trim();
}

async function drainMovementPending(page) {
  await page.waitForFunction(
    () => {
      const d = window.__aetherlife_moveDebug?.();
      return d != null && d.pending === 0 && !d.locomoting;
    },
    { timeout: 15_000 },
  );
  await page.waitForTimeout(400);
}

/** @returns {Promise<string | null>} story hook when toast visible */
async function pressMoveKey(page, key) {
  await assertJournalQuestStripAbsent(page);
  await page.keyboard.press(key);
  await page.waitForTimeout(180);
  const body = await readLoreToastBody(page);
  if (body.length > 0) {
    return body;
  }
  return null;
}

async function exploreUntilLoreDiscover(page) {
  await assertJournalQuestStripAbsent(page);
  await closeShellDrawer(page);
  await page.locator('[data-testid="explore-coords-strip"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="explore-place-name"]').waitFor({ timeout: 30_000 });

  await blurComposerForMovement(page);
  await focusExploreForKeyboard(page);

  const startChunk = (await readExploreChunk(page)) ?? { cx: 0, cy: 0 };
  await readMovementProbe(page);

  // South from home (seed-42 highland blocks east at spawn); north fallback matches debug-lore-toast.mjs.
  for (let i = 0; i < 48; i += 1) {
    const hook = await pressMoveKey(page, "s");
    if (hook) {
      console.log(`verify:phase21: lore toast hook="${hook.slice(0, 80)}"`);
      return hook;
    }
  }

  await drainMovementPending(page);
  let endChunk = await readExploreChunk(page);
  let chunkDist = endChunk ? chunkManhattanDist(startChunk, endChunk) : 0;

  if (chunkDist < 2) {
    console.warn(
      `verify:phase21: south travel dist=${chunkDist} start=${JSON.stringify(startChunk)} end=${JSON.stringify(endChunk)} — retry north`,
    );
    await blurComposerForMovement(page);
    await focusExploreForKeyboard(page);
    for (let i = 0; i < 28; i += 1) {
      const hook = await pressMoveKey(page, "w");
      if (hook) {
        console.log(`verify:phase21: lore toast hook="${hook.slice(0, 80)}"`);
        return hook;
      }
    }
    await drainMovementPending(page);
    endChunk = await readExploreChunk(page);
    chunkDist = endChunk ? chunkManhattanDist(startChunk, endChunk) : 0;
  }

  const postMove = await readMovementProbe(page);

  if (chunkDist < 2) {
    throw new Error(
      `WASD did not cross chunks (composer focus or movement blocked?) start=${JSON.stringify(startChunk)} end=${JSON.stringify(endChunk)} dist=${chunkDist} probe=${JSON.stringify(postMove)}`,
    );
  }

  console.log(
    `verify:phase21: chunk cross OK start=${JSON.stringify(startChunk)} end=${JSON.stringify(endChunk)} dist=${chunkDist}`,
  );

  let sawPending = postMove.lorePending;
  let loreReadyViaPlace = false;
  await waitFor(
    async () => {
      await assertJournalQuestStripAbsent(page);
      const body = await readLoreToastBody(page);
      if (body.length > 0) return true;

      const snap = await readMovementProbe(page);
      if (snap.lorePending) sawPending = true;
      const hasFlavor = snap.placeName.includes("·");
      if (!snap.lorePending && hasFlavor && !snap.placeName.includes("晨曦村")) {
        loreReadyViaPlace = true;
        return true;
      }
      return false;
    },
    E2E_LORE_TIMEOUT_MS,
    "lore-discover-toast with non-empty body",
  );

  let hookText = await readLoreToastBody(page);
  if (!hookText && loreReadyViaPlace) {
    const placeName = (await readMovementProbe(page)).placeName;
    const flavor = placeName.split("·")[1]?.trim();
    hookText = flavor || placeName;
    console.warn(`verify:phase21: lore toast missed; using place flavor="${hookText.slice(0, 80)}"`);
  }
  if (!hookText) {
    throw new Error(
      `lore not ready after ${E2E_LORE_TIMEOUT_MS}ms sawPending=${sawPending}`,
    );
  }
  console.log(`verify:phase21: lore toast hook="${hookText.slice(0, 80)}"`);
  return hookText;
}

async function openDrawerDiscoveries(page) {
  await closeShellDrawer(page);
  const dialogueBar = page.locator('[data-testid="dialogue-bar"]');
  if (!(await dialogueBar.isVisible().catch(() => false))) {
    await engageDialogue(page);
  }

  await page.locator('[aria-label="已发现"]').click();
  const drawer = page.locator('[data-testid="shell-drawer"]');
  await drawer.waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#shell-drawer-tab-discoveries").click();
  await page.locator("#shell-drawer-panel-discoveries").waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await waitFor(
    async () => (await page.locator('[data-testid="discovered-lore-row"]').count()) > 0,
    15_000,
    "discovered-lore-row in drawer",
  );
  console.log("verify:phase21: drawer discoveries OK");
  await closeShellDrawer(page);
}

async function main() {
  assertE2eNoMock("verify:phase21");
  assertE2eRealLlm("verify:phase21");
  console.log(`verify:phase21 → ${webUrl} WORLD_SEED=${process.env.WORLD_SEED} seed=${MEMORY_SEED}`);
  await healthOk();

  const playerId = `verifyp21${String(Date.now()).slice(-10)}`;
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
    page.setDefaultTimeout(speakTimeoutMs);
    const bootStart = Date.now();
    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
      state: "visible",
      timeout: 45_000,
    });
    const bootMs = Date.now() - bootStart;
    console.log(`verify:phase21: bootMs=${bootMs}`);
    if (bootMs > BOOT_WARN_MS) {
      console.warn(`verify:phase21: WARN bootMs=${bootMs} exceeds ${BOOT_WARN_MS}ms`);
    }
    if (bootMs > BOOT_FAIL_MS) {
      throw new Error(`bootMs=${bootMs} exceeds fail threshold ${BOOT_FAIL_MS}ms`);
    }

    await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
    await assertJournalQuestStripAbsent(page);

    // Memory seed before explore/lore: avoids lore+ambient worker load and stacked memory tails (ISSUE-055).
    const memorySpeak = await sendSpeakOverlay(page, `请记住 ${MEMORY_SEED} 门禁密码是 7`, {
      speakTimeoutMs,
    });
    console.log(`verify:phase21: memorySpeakMs=${memorySpeak.speakMs}`);
    await waitForMemoryContext({
      httpBase,
      roomId,
      playerId,
      playerMessage: `${MEMORY_SEED} 密码`,
      needle: MEMORY_SEED,
      pollMs: MEMORY_POLL_MS,
      internalHeaders,
      onPoll: (snap) => {
        console.log(
          `verify:phase21: memory poll elapsed=${snap.elapsedMs}ms needle=${snap.needleFound} ` +
            `recent=${snap.recentMemoryCount ?? "?"} ctxCount=${snap.memoryCount ?? "?"} ` +
            `retrieved=${snap.retrievedCount}`,
        );
      },
    });
    console.log(`verify:phase21: memory seed persisted (${MEMORY_SEED})`);
    await closeShellDrawer(page);

    await exploreUntilLoreDiscover(page);
    await openDrawerDiscoveries(page);

    const moveReply = await sendSpeakOverlay(page, "移动到我的下方", { speakTimeoutMs });
    console.log(
      `verify:phase21: speakMs=${moveReply.speakMs} text="移动到我的下方" reply="${moveReply.reply.slice(0, 60)}"`,
    );

    const rudeStart = Date.now();
    await sendSpeakOverlay(page, "你真没礼貌，滚开", { speakTimeoutMs });

    await waitFor(
      async () => page.locator('[data-testid="collective-feedback-banner"]').isVisible(),
      BANNER_WAIT_MS,
      "collective-feedback-banner within 30s",
    );
    console.log(`verify:phase21: rude→bannerMs=${Date.now() - rudeStart}`);

    await openShellDrawerCollective(page);
    await waitFor(
      async () => {
        const events = page.locator('[data-testid="collective-recent-events"] li');
        return (await events.count()) > 0;
      },
      30_000,
      "collective-recent-events after rude speak",
    );
    await closeShellDrawer(page);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
      state: "visible",
      timeout: 45_000,
    });

    const { reply: recallReply } = await sendSpeakOverlay(
      page,
      `我之前说的 ${MEMORY_SEED} 门禁密码是多少？`,
      { speakTimeoutMs },
    );
    console.log(`verify:phase21: recallMs reply="${recallReply.slice(0, 80)}"`);

    const hay = recallReply.toLowerCase();
    if (!hay.includes(MEMORY_SEED.toLowerCase()) && !hay.includes("7")) {
      throw new Error(
        `recall reply missing seed token (seed=${MEMORY_SEED} reply="${recallReply.slice(0, 120)}")`,
      );
    }

    await openShellDrawerHistory(page);
    await waitFor(
      async () => page.locator('[data-testid="npc-memory-callback"]').isVisible(),
      speakTimeoutMs,
      "npc-memory-callback after reload recall",
    );
    console.log("verify:phase21: memory citation + recall OK");
  } finally {
    await browser.close();
  }

  console.log("verify:phase21 OK");
}

main().catch((err) => {
  console.error(`verify:phase21 failed: ${err.message}`);
  console.error("Ensure full stack: pnpm dev:stack (no LLM_MOCK). Game-server :2567, web :5173.");
  process.exit(1);
});
