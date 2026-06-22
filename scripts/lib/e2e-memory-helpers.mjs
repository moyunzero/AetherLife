/**
 * Phase 20 E2E memory helpers — overlay speak, memory-context poll, refusal guard.
 *
 * Canonical REFUSAL_MARKERS source: workers/agent-worker/src/graph/recall_merge.py
 * Drift guard: node scripts/assert-refusal-markers-parity.mjs
 */
import { engageDialogue } from "./dialogue-engage.mjs";

/** @type {readonly string[]} */
export const REFUSAL_MARKERS = Object.freeze([
  "自重",
  "不信任",
  "不便透露",
  "无可奉告",
  "不能告诉",
  "不会告诉",
]);

/**
 * @param {string | null | undefined} text
 * @returns {boolean}
 */
export function replyRefusesRecall(text) {
  const hay = String(text ?? "");
  return REFUSAL_MARKERS.some((marker) => hay.includes(marker));
}

/**
 * @param {object} opts
 * @param {string} opts.httpBase
 * @param {string} opts.roomId
 * @param {string} opts.playerId
 * @param {string} opts.playerMessage
 * @param {string} opts.needle
 * @param {number} [opts.pollMs]
 * @param {() => Record<string, string>} opts.internalHeaders
 * @param {(snapshot: {
 *   elapsedMs: number;
 *   ok: boolean;
 *   needleFound: boolean;
 *   memoryCount: number | null;
 *   retrievedCount: number;
 *   recentHasNeedle: boolean | null;
 * }) => void | Promise<void>} [opts.onPoll]
 */
function pollHeaders(internalHeaders) {
  return {
    ...internalHeaders(),
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
}

function bodyContainsNeedle(body, needle) {
  const hay = JSON.stringify(body ?? {}).toLowerCase();
  return hay.includes(String(needle).toLowerCase());
}

export async function waitForMemoryContext({
  httpBase,
  roomId,
  playerId,
  playerMessage,
  needle,
  pollMs = 90_000,
  internalHeaders,
  onPoll,
}) {
  const memUrlBase =
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/memory-context` +
    `?playerMessage=${encodeURIComponent(playerMessage)}` +
    `&npcId=npc-1` +
    `&playerId=${encodeURIComponent(playerId)}`;
  const recentUrlBase =
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/recent-memories` +
    `?npcId=npc-1&playerId=${encodeURIComponent(playerId)}&limit=10`;
  const started = Date.now();
  let lastOnPollMs = 0;

  await waitFor(
    async () => {
      const bust = `_=${Date.now()}`;
      const headers = pollHeaders(internalHeaders);

      let recentHasNeedle = false;
      let recentMemoryCount = null;
      try {
        const recentRes = await fetch(`${recentUrlBase}&${bust}`, { headers });
        const recentBody = (await recentRes.json().catch(() => ({}))) ?? {};
        recentHasNeedle = recentRes.ok && bodyContainsNeedle(recentBody, needle);
        if (Array.isArray(recentBody.memories)) {
          recentMemoryCount = recentBody.memories.length;
        } else if (typeof recentBody.count === "number") {
          recentMemoryCount = recentBody.count;
        }
      } catch {
        recentHasNeedle = false;
      }

      const memRes = await fetch(`${memUrlBase}&${bust}`, { headers });
      const memCtx = (await memRes.json().catch(() => ({}))) ?? {};
      const needleInContext = memRes.ok && bodyContainsNeedle(memCtx, needle);
      const needleFound = recentHasNeedle || needleInContext;
      const elapsedMs = Date.now() - started;

      if (onPoll && elapsedMs - lastOnPollMs >= 15_000) {
        lastOnPollMs = elapsedMs;
        await onPoll({
          elapsedMs,
          ok: memRes.ok,
          needleFound,
          memoryCount:
            typeof memCtx.memoryCount === "number" ? memCtx.memoryCount : null,
          retrievedCount: Array.isArray(memCtx.retrieved) ? memCtx.retrieved.length : 0,
          recentHasNeedle,
          recentMemoryCount,
        });
      }

      return needleFound;
    },
    pollMs,
    `memory persisted containing ${needle}`,
  );
}

const THINKING_LOCATOR =
  '[data-testid="dialogue-overlay"] .dialogue-overlay__thinking, ' +
  '.dialogue-bar__summary-text--thinking, ' +
  '[data-testid="composer-speak-status"]';

const OVERLAY_STREAMING = '[data-testid="dialogue-overlay-streaming"]';

const OVERLAY_NPC_REPLY =
  `${OVERLAY_STREAMING}, ` + '[data-testid="dialogue-overlay"] .dialogue-overlay__last-line';

/**
 * Shell drawer hosts MessageList + npc-memory-callback; overlay speak keeps drawer closed by default.
 * @param {import('playwright').Page} page
 */
export async function openShellDrawerHistory(page) {
  const drawer = page.locator('[data-testid="shell-drawer"]');
  if (!(await drawer.isVisible().catch(() => false))) {
    await page.locator('[aria-label="对话历史"]').click();
  } else {
    await page.locator("#shell-drawer-tab-history").click();
  }
  await drawer.waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#shell-drawer-panel-history").waitFor({
    state: "visible",
    timeout: 10_000,
  });
}

/** Shell drawer「集体见闻」tab — recentEvents live here (not in closed DOM). */
export async function openShellDrawerCollective(page) {
  const drawer = page.locator('[data-testid="shell-drawer"]');
  if (!(await drawer.isVisible().catch(() => false))) {
    await page.locator('[aria-label="集体见闻"]').click();
  } else {
    await page.locator("#shell-drawer-tab-collective").click();
  }
  await drawer.waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#shell-drawer-panel-collective").waitFor({
    state: "visible",
    timeout: 10_000,
  });
}

/**
 * @param {import('playwright').Page} page
 */
export async function closeShellDrawer(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const drawer = page.locator('[data-testid="shell-drawer"]');
    if (!(await drawer.isVisible().catch(() => false))) {
      return;
    }
    const closeBtn = page.locator('[aria-label="关闭抽屉"]');
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    } else {
      const backdrop = page.locator('[data-testid="shell-drawer-backdrop"]');
      await backdrop.click({ position: { x: 8, y: 8 } });
    }
    await drawer.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {number} t0
 * @param {number} timeoutMs
 * @returns {Promise<{ firstTextMs: number; overlayPartialMs: number | null }>}
 */
async function waitSpeakFirstText(page, t0, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let overlayPartialMs = null;

  while (Date.now() < deadline) {
    if (overlayPartialMs === null) {
      const streaming = page.locator(OVERLAY_STREAMING);
      if (await streaming.isVisible().catch(() => false)) {
        const st = ((await streaming.textContent().catch(() => "")) ?? "").trim();
        if (st) overlayPartialMs = Date.now() - t0;
      }
    }

    const summary = page.locator(".dialogue-bar__summary-text");
    if ((await summary.count()) > 0) {
      const text = (await summary.first().textContent().catch(() => "")) ?? "";
      if (text.trim() && !/^思考/.test(text.trim())) {
        return { firstTextMs: Date.now() - t0, overlayPartialMs };
      }
    }

    const overlayNpc = page.locator(OVERLAY_NPC_REPLY).last();
    if (await overlayNpc.isVisible().catch(() => false)) {
      const text = (await overlayNpc.textContent().catch(() => "")) ?? "";
      if (text.trim()) {
        return { firstTextMs: Date.now() - t0, overlayPartialMs };
      }
    }

    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("T_first timeout: no overlay/dialogue-bar NPC reply visible");
}

/**
 * @param {import('playwright').Page} page
 */
async function extractNpcReplyText(page) {
  const summary = page.locator(
    ".dialogue-bar__summary-text:not(.dialogue-bar__summary-text--thinking)",
  );
  if ((await summary.count()) > 0) {
    const text = (await summary.first().textContent().catch(() => "")) ?? "";
    if (text.trim() && !/^思考/.test(text.trim())) return text.trim();
  }

  const overlayNpc = page.locator(OVERLAY_NPC_REPLY).last();
  if (await overlayNpc.isVisible().catch(() => false)) {
    const text = (await overlayNpc.textContent().catch(() => "")) ?? "";
    if (text.trim()) return text.trim();
  }

  const drawerNpc = page.locator(".message--npc.message--latest .message__text");
  if (await drawerNpc.isVisible().catch(() => false)) {
    return (await drawerNpc.innerText()).trim();
  }

  return "";
}

/**
 * Overlay-first speak: engageDialogue → composer submit → wait for NPC reply.
 *
 * @param {import('playwright').Page} page
 * @param {string} text
 * @param {{ speakTimeoutMs?: number }} [opts]
 * @returns {Promise<{
 *   reply: string;
 *   speakMs: number;
 *   thinkingMs: number | null;
 *   firstTextMs: number | null;
 *   overlayPartialMs: number | null;
 *   overlayStreamingBeforeDone: boolean;
 * }>}
 */
export async function sendSpeakOverlay(page, text, { speakTimeoutMs = 180_000 } = {}) {
  page.setDefaultTimeout(speakTimeoutMs);
  await closeShellDrawer(page);
  await engageDialogue(page);

  const composer = page.locator("textarea.composer__input");
  await page.waitForFunction(
    () => {
      const input = document.querySelector("textarea.composer__input");
      return input && !input.disabled && input.getAttribute("aria-busy") !== "true";
    },
    { timeout: speakTimeoutMs },
  );

  const t0 = Date.now();
  await composer.fill(text);
  await page.locator("button.composer__submit").click();

  let thinkingMs = null;
  try {
    await page.locator(THINKING_LOCATOR).first().waitFor({ state: "visible", timeout: 15_000 });
    thinkingMs = Date.now() - t0;
  } catch {
    // thinking may be too fast to observe
  }

  const { firstTextMs, overlayPartialMs } = await waitSpeakFirstText(page, t0, speakTimeoutMs);

  await page.waitForFunction(
    () => {
      const input = document.querySelector("textarea.composer__input");
      return input && !input.disabled && input.getAttribute("aria-busy") !== "true";
    },
    { timeout: speakTimeoutMs },
  );

  const speakMs = Date.now() - t0;
  const reply = await extractNpcReplyText(page);
  if (!reply) {
    throw new Error(`empty NPC reply for "${text.slice(0, 40)}…"`);
  }

  return {
    reply,
    speakMs,
    thinkingMs,
    firstTextMs,
    overlayPartialMs,
    overlayStreamingBeforeDone: overlayPartialMs !== null && overlayPartialMs < speakMs,
  };
}

/**
 * Seed 2+ preference memories via speak + memory-context poll (Phase 22 C1 extension).
 *
 * @param {import('playwright').Page} page
 * @param {object} opts
 * @param {string} opts.httpBase
 * @param {string} opts.roomId
 * @param {string} opts.playerId
 * @param {Array<{ token: string; seedMessage: string; pollMessage: string }>} opts.preferences
 * @param {number} [opts.speakTimeoutMs]
 * @param {() => Record<string, string>} opts.internalHeaders
 * @param {number} [opts.memoryPollMs]
 */
export async function seedPreferenceMemories(
  page,
  {
    httpBase,
    roomId,
    playerId,
    preferences,
    speakTimeoutMs = 180_000,
    internalHeaders,
    memoryPollMs = 300_000,
  },
) {
  for (const pref of preferences) {
    await sendSpeakOverlay(page, pref.seedMessage, { speakTimeoutMs });
    await waitForMemoryContext({
      httpBase,
      roomId,
      playerId,
      playerMessage: pref.pollMessage,
      needle: pref.token,
      pollMs: memoryPollMs,
      internalHeaders,
    });
  }
}

/**
 * @param {() => Promise<boolean>} fn
 * @param {number} timeoutMs
 * @param {string} label
 */
async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout: ${label} (${timeoutMs}ms)`);
}
