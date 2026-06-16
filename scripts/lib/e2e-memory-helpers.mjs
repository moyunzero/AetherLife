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
 */
export async function waitForMemoryContext({
  httpBase,
  roomId,
  playerId,
  playerMessage,
  needle,
  pollMs = 90_000,
  internalHeaders,
}) {
  const memUrl =
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/memory-context` +
    `?playerMessage=${encodeURIComponent(playerMessage)}` +
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
    pollMs,
    `memory-context containing ${needle}`,
  );
}

const THINKING_LOCATOR =
  '[data-testid="dialogue-overlay"] .dialogue-overlay__thinking, ' +
  '.dialogue-bar__summary-text--thinking, ' +
  '[data-testid="composer-speak-status"]';

const OVERLAY_NPC_REPLY =
  '[data-testid="dialogue-overlay"] .dialogue-overlay__last-line, ' +
  '[data-testid="dialogue-overlay"] .dialogue-overlay__npc-text, ' +
  '[data-testid="dialogue-overlay"] .dialogue-overlay__line--npc';

/**
 * Shell drawer hosts MessageList + npc-memory-callback; overlay speak keeps drawer closed by default.
 * @param {import('playwright').Page} page
 */
export async function openShellDrawerHistory(page) {
  const drawer = page.locator('[data-testid="shell-drawer"]');
  if (await drawer.isVisible().catch(() => false)) {
    return;
  }
  await page.locator('[aria-label="对话历史"]').click();
  await drawer.waitFor({ state: "visible", timeout: 10_000 });
}

/**
 * @param {import('playwright').Page} page
 */
export async function closeShellDrawer(page) {
  const drawer = page.locator('[data-testid="shell-drawer"]');
  if (!(await drawer.isVisible().catch(() => false))) {
    return;
  }
  await page.locator('[aria-label="关闭抽屉"]').click();
  await drawer.waitFor({ state: "hidden", timeout: 10_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs
 */
async function waitForFirstNpcReply(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const summary = page.locator(".dialogue-bar__summary-text");
    if ((await summary.count()) > 0) {
      const text = (await summary.first().textContent().catch(() => "")) ?? "";
      if (text.trim() && !/^思考/.test(text.trim())) {
        return Date.now();
      }
    }

    const overlayNpc = page.locator(OVERLAY_NPC_REPLY).last();
    if (await overlayNpc.isVisible().catch(() => false)) {
      const text = (await overlayNpc.textContent().catch(() => "")) ?? "";
      if (text.trim()) return Date.now();
    }

    await new Promise((r) => setTimeout(r, 100));
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
 * @returns {Promise<{ reply: string; speakMs: number; thinkingMs: number | null; firstTextMs: number | null }>}
 */
export async function sendSpeakOverlay(page, text, { speakTimeoutMs = 180_000 } = {}) {
  await engageDialogue(page);

  const t0 = Date.now();
  const composer = page.locator("textarea.composer__input");
  await composer.fill(text);
  await page.locator("button.composer__submit").click();

  let thinkingMs = null;
  try {
    await page.locator(THINKING_LOCATOR).first().waitFor({ state: "visible", timeout: 15_000 });
    thinkingMs = Date.now() - t0;
  } catch {
    // thinking may be too fast to observe
  }

  const firstAt = await waitForFirstNpcReply(page, speakTimeoutMs);
  const firstTextMs = firstAt - t0;

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

  return { reply, speakMs, thinkingMs, firstTextMs };
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
