#!/usr/bin/env node
/**
 * Step 1 UX gate — DialogueOverlay shows speakPartial before done.
 *
 * Requires: `pnpm dev:stack` + real LLM (no LLM_MOCK). See docs/E2E-POLICY.md.
 *
 * Env:
 *   OVERLAY_STREAMING_T_PARTIAL_MS=15000 — warn if no streaming partial by then (default 15s)
 *   OVERLAY_STREAMING_REQUIRE=1          — fail when overlayPartialMs is null
 *   OVERLAY_STREAMING_ROOM_ID            — isolated room (default overlay-stream-{ts})
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertE2eRealLlm, e2eSpeakTimeoutMs } from "./lib/e2e-policy.mjs";
import { sendSpeakOverlay } from "./lib/e2e-memory-helpers.mjs";
import {
  healthOk,
  loadPlaywright,
  resetRoom,
  webBase,
} from "./lib/speak-browser-stack.mjs";

const SCRIPT = "verify:overlay-streaming";
assertE2eRealLlm(SCRIPT);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runId = Date.now();
const roomId = process.env.OVERLAY_STREAMING_ROOM_ID || `overlay-stream-${runId}`;
const speakTimeoutMs = Math.max(90_000, e2eSpeakTimeoutMs());
const tPartialWarnMs = Number.parseInt(process.env.OVERLAY_STREAMING_T_PARTIAL_MS || "15000", 10);
const requireStreaming = process.env.OVERLAY_STREAMING_REQUIRE === "1";

const webUrl =
  `${webBase}${webBase.includes("?") ? "&" : "?"}` +
  `room=${encodeURIComponent(roomId)}`;

const outDir = resolve(root, ".planning/benchmarks");
const outPath = resolve(outDir, `overlay-streaming-${runId}.json`);

/** @param {number | null} a @param {number | null} b */
function deltaMs(a, b) {
  if (a == null || b == null) return null;
  return b - a;
}

async function main() {
  await healthOk();
  await resetRoom(roomId);

  const playerId = `overlay${String(runId).slice(-10)}`;
  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(
    ({ key, id }) => {
      localStorage.setItem(key, id);
    },
    { key: "aetherlife:playerId", id: playerId },
  );
  const page = await context.newPage();

  try {
    await page.goto(webUrl, { waitUntil: "networkidle", timeout: 120_000 });
    await page.locator('[data-testid="phaser-stage-fill"] canvas').first().waitFor({
      state: "visible",
      timeout: 90_000,
    });
    await page.locator('[data-testid="dialogue-overlay"]').waitFor({
      state: "attached",
      timeout: 30_000,
    });

    const message = "你好，最近怎么样？";
    const result = await sendSpeakOverlay(page, message, { speakTimeoutMs });

    const perceivedGainMs =
      result.overlayPartialMs != null && result.firstTextMs != null
        ? result.firstTextMs - result.overlayPartialMs
        : null;
    const doneAfterPartialMs = deltaMs(result.overlayPartialMs, result.speakMs);

    const record = {
      script: SCRIPT,
      runId,
      roomId,
      message,
      at: new Date().toISOString(),
      metrics: {
        thinkingMs: result.thinkingMs,
        overlayPartialMs: result.overlayPartialMs,
        firstTextMs: result.firstTextMs,
        speakMs: result.speakMs,
        overlayStreamingBeforeDone: result.overlayStreamingBeforeDone,
        perceivedGainMs,
        doneAfterPartialMs,
      },
      replyPreview: result.reply.slice(0, 120),
      verdict: {
        streamingSeen: result.overlayPartialMs !== null,
        partialWithinWarn: result.overlayPartialMs == null || result.overlayPartialMs <= tPartialWarnMs,
      },
    };

    await mkdir(outDir, { recursive: true });
    await writeFile(outPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

    console.log(`[${SCRIPT}] wrote ${outPath}`);
    console.log(JSON.stringify(record.metrics, null, 2));

    if (requireStreaming && result.overlayPartialMs === null) {
      throw new Error("overlayPartialMs=null — DialogueOverlay did not show speakPartial");
    }
    if (result.overlayPartialMs != null && result.overlayPartialMs > tPartialWarnMs) {
      console.warn(
        `[${SCRIPT}] WARN overlayPartialMs=${result.overlayPartialMs} > ${tPartialWarnMs} (no hard fail)`,
      );
    }
    if (result.overlayStreamingBeforeDone) {
      console.log(
        `[${SCRIPT}] OK streaming partial ${result.overlayPartialMs}ms before done ${result.speakMs}ms (Δ ${doneAfterPartialMs}ms)`,
      );
    } else if (result.overlayPartialMs != null) {
      console.log(`[${SCRIPT}] partial seen at ${result.overlayPartialMs}ms (same moment as first text)`);
    }

    console.log(`[${SCRIPT}] PASS`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`[${SCRIPT}] FAIL`, err);
  process.exit(1);
});
