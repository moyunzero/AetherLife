/**
 * Single speak round timing (T_think / T_first / T_done) for benchmark + playtest.
 */
import { closeShellDrawer } from "./e2e-memory-helpers.mjs";
import { sleep } from "./speak-browser-stack.mjs";

export const THINKING_LOCATOR =
  '[data-testid="dialogue-overlay"] .message--thinking, [data-testid="dialogue-bar"] .message--thinking, .dialogue-overlay .message--thinking';
export const OVERLAY_NPC_REPLY =
  '[data-testid="dialogue-overlay"] .dialogue-overlay__last-line, ' +
  '[data-testid="dialogue-overlay"] .message--npc, [data-testid="dialogue-bar"] .message--npc, .dialogue-overlay .message--npc';

/**
 * @param {import('@playwright/test').Page} page
 */
export async function captureReplyBaseline(page) {
  return page.evaluate((sel) => {
    const nodes = document.querySelectorAll(sel);
    const texts = [];
    nodes.forEach((n) => {
      const t = (n.textContent || "").trim();
      if (t) texts.push(t);
    });
    return texts.join("\n");
  }, OVERLAY_NPC_REPLY);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} baseline
 * @param {number} timeoutMs
 */
export async function waitForFirstNpcReply(page, baseline, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await captureReplyBaseline(page);
    if (current && current !== baseline) return current.slice(0, 200);
    await sleep(200);
  }
  throw new Error("timeout waiting for first NPC reply");
}

/**
 * @typedef {object} SpeakRoundOptions
 * @property {string} text
 * @property {number} speakTimeoutMs
 * @property {(name: string) => Promise<void>} [onScreenshot]
 * @property {boolean} [skipDrawerClose]
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {SpeakRoundOptions} opts
 */
export async function runSpeakRound(page, { text, speakTimeoutMs, onScreenshot, skipDrawerClose = false }) {
  if (!skipDrawerClose) {
    await closeShellDrawer(page).catch(() => {});
  }

  const baseline = await captureReplyBaseline(page);
  const partialBaseline = await page
    .evaluate(() => performance.getEntriesByName("speak_partial").length)
    .catch(() => 0);
  const t0 = Date.now();
  let tThink = null;
  let tFirst = null;
  let tDone = null;
  let hadPartial = false;

  const composer = page.locator('[data-testid="dialogue-composer-input"]');
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await composer.fill(text);
  await composer.press("Enter");

  const thinkDeadline = t0 + Math.min(15_000, speakTimeoutMs);
  while (Date.now() < thinkDeadline) {
    const thinking = await page.locator(THINKING_LOCATOR).first().isVisible().catch(() => false);
    if (thinking) {
      tThink = Date.now() - t0;
      if (onScreenshot) await onScreenshot("thinking").catch(() => {});
      break;
    }
    await sleep(50);
  }

  try {
    await waitForFirstNpcReply(page, baseline, speakTimeoutMs);
    tFirst = Date.now() - t0;
    if (onScreenshot) await onScreenshot("first-reply").catch(() => {});
  } catch (err) {
    const partialCount = await page
      .evaluate(() => performance.getEntriesByName("speak_partial").length)
      .catch(() => 0);
    const partial = partialCount > partialBaseline;
    if (partial) {
      hadPartial = true;
      tFirst = Date.now() - t0;
    } else {
      throw err;
    }
  }

  const idleDeadline = Date.now() + speakTimeoutMs;
  while (Date.now() < idleDeadline) {
    const busy = await composer.getAttribute("aria-busy").catch(() => null);
    const disabled = await composer.isDisabled().catch(() => false);
    if (busy !== "true" && !disabled) {
      tDone = Date.now() - t0;
      break;
    }
    await sleep(200);
  }
  if (tDone == null) tDone = Date.now() - t0;

  if (onScreenshot) await onScreenshot("done").catch(() => {});

  return {
    t_think: tThink,
    t_first: tFirst,
    t_done: tDone,
    hadPartial,
  };
}

/** Map latency to subjective UX band (automated heuristic per SPEAK-SLA charter). */
export function subjectiveBand(phase) {
  if (phase?.error) return "放弃";
  const done = phase?.t_done;
  if (typeof done !== "number" || !Number.isFinite(done)) return "放弃";
  if (done <= 8000) return "流畅";
  if (done <= 12000) return "可接受";
  if (done <= 20000) return "烦躁";
  return "放弃";
}
