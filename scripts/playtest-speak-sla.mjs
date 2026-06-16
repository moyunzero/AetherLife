#!/usr/bin/env node
/**
 * Phase 20 SPEAK-SLA automated playtest — ≥3 solo sessions, Playwright + screenshots + scorecard.
 *
 * Requires: `pnpm dev:stack` with real LLM (no LLM_MOCK). See docs/E2E-POLICY.md.
 *
 * Env:
 *   PLAYTEST_SESSIONS=3          — number of solo sessions (default 3)
 *   PLAYTEST_TURN_GAP_MS=45000   — pause between turns (~solo pacing)
 *   PLAYTEST_MIN_SESSION_MS=900000 — pad idle to ~15 min per session (default 15 min)
 *   PLAYTEST_SKIP_VERIFY=1       — skip chained `pnpm verify:phase20`
 *   PLAYTEST_SCREENSHOTS=0       — disable PNG captures
 *   PLAYTEST_UPDATE_FINDINGS=0   — skip patching 20-01-SPEAK-SLA-FINDINGS.md
 *   PLAYTEST_SPEAK_ATTEMPTS=2    — speak turns per message (default 2 = 1 retry)
 *   PLAYTEST_RETRY_BACKOFF_MS=60000 — backoff before speak retry (D-13, glm concurrency=1)
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertE2eRealLlm, e2eSpeakTimeoutMs } from "./lib/e2e-policy.mjs";
import { engageDialogue } from "./lib/dialogue-engage.mjs";
import {
  closeShellDrawer,
  sendSpeakOverlay,
} from "./lib/e2e-memory-helpers.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";
import { patchPlaytestFindings } from "./lib/playtest-findings-patch.mjs";
import { subjectiveBand } from "./lib/speak-browser-round.mjs";

const SCRIPT = "playtest:speak-sla";
assertE2eRealLlm(SCRIPT);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const gwBase = process.env.AI_GATEWAY_URL || "http://127.0.0.1:8000";
const webBase = process.env.WEB_URL || "http://localhost:5173";
const webUi = `${webBase}${webBase.includes("?") ? "&" : "?"}phaserFallback=1&speakLatencyTrace=1`;
const roomId = "default";
const speakTimeoutMs = Math.max(90_000, e2eSpeakTimeoutMs());
const speakAttempts = Math.max(1, Number.parseInt(process.env.PLAYTEST_SPEAK_ATTEMPTS || "2", 10));
const retryBackoffMs = Number.parseInt(process.env.PLAYTEST_RETRY_BACKOFF_MS || "60000", 10);
const roomReadyTimeoutMs = Math.max(60_000, speakTimeoutMs / 3);
const sessionCount = Math.max(1, Number.parseInt(process.env.PLAYTEST_SESSIONS || "3", 10));
const turnGapMs = Number.parseInt(process.env.PLAYTEST_TURN_GAP_MS || "45000", 10);
const minSessionMs = Number.parseInt(process.env.PLAYTEST_MIN_SESSION_MS || "900000", 10);
const withVerify = process.env.PLAYTEST_SKIP_VERIFY !== "1";
const screenshotsEnabled = process.env.PLAYTEST_SCREENSHOTS !== "0";
const updateFindings = process.env.PLAYTEST_UPDATE_FINDINGS !== "0";

const runId = Date.now();
const outDir = resolve(
  root,
  process.env.PLAYTEST_OUT_DIR || `.planning/benchmarks/playtest-sla-${runId}`,
);
const findingsPath = resolve(root, ".planning/phases/20-memory-speak-trust/20-01-SPEAK-SLA-FINDINGS.md");

/** @type {Array<{ caseId: string; text: string; seedText?: string }>} */
const SESSION_TURNS = [
  { caseId: "B1", text: "你好，最近怎么样？" },
  { caseId: "B1", text: "今天天气适合出门吗？" },
  {
    caseId: "B_recall",
    text: "我之前说的门禁密码是多少？",
    seedText: "请记住我的门禁密码是 phase20-playtest-gate",
  },
  { caseId: "B2", text: "帮我看看周围有什么有趣的东西" },
  { caseId: "B3", text: "告诉我你最近在忙什么" },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

async function healthOk() {
  for (const [label, base] of [
    ["game-server", httpBase],
    ["ai-gateway", gwBase],
  ]) {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`${label} health ${res.status}`);
    const body = await res.json().catch(() => ({}));
    if (body.status !== "ok") throw new Error(`${label} unexpected health body`);
  }
  const webRes = await fetch(webBase, { signal: AbortSignal.timeout(8000) });
  if (!webRes.ok) throw new Error(`web ${webBase} ${webRes.status}`);
}

async function waitRoomReady(page) {
  await page.locator('[data-testid="movement-panel"]').waitFor({
    state: "visible",
    timeout: roomReadyTimeoutMs,
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="cell-"]').length >= 64,
    { timeout: roomReadyTimeoutMs },
  );
}

/**
 * @param {unknown} err
 */
function isRetryableSpeakError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|timeout|5\d{2}|ECONNRESET|fetch failed|waitForFunction|engageDialogue|empty NPC reply|T_first timeout/i.test(
    msg,
  );
}

/**
 * @param {import('playwright').Page} page
 * @param {string} text
 * @param {string} label
 */
async function sendSpeakWithRetry(page, text, label) {
  let lastErr;
  for (let attempt = 1; attempt <= speakAttempts; attempt++) {
    try {
      await closeShellDrawer(page).catch(() => {});
      return await sendSpeakOverlay(page, text, { speakTimeoutMs });
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= speakAttempts || !isRetryableSpeakError(err)) {
        throw err;
      }
      console.warn(
        `[${label}] retry ${attempt}/${speakAttempts - 1} (${msg.slice(0, 100)}) — backoff ${retryBackoffMs}ms`,
      );
      await closeShellDrawer(page).catch(() => {});
      await engageDialogue(page, { timeoutMs: speakTimeoutMs }).catch(() => {});
      await sleep(retryBackoffMs);
    }
  }
  throw lastErr;
}

async function resetRoom(playerId) {
  const headers = { "Content-Type": "application/json" };
  if (playerId) headers["X-Player-Id"] = playerId;
  const res = await fetch(`${httpBase}/rooms/${roomId}/reset`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`reset-room ${res.status}`);
}

async function bootPage(page, { reload = false } = {}) {
  if (!reload) {
    await page.goto(webUi, { waitUntil: "networkidle", timeout: 60_000 });
  } else {
    await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
  }
  await waitRoomReady(page);
  await engageDialogue(page);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} dir
 * @param {string} name
 */
async function shot(page, dir, name) {
  if (!screenshotsEnabled) return;
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: false });
}

/**
 * @param {import('playwright').Page} page
 * @param {number} sessionIdx
 */
async function runSession(page, sessionIdx) {
  const sessionDir = resolve(outDir, `session-${sessionIdx}`);
  await mkdir(sessionDir, { recursive: true });

  const sessionStart = Date.now();

  await shot(page, sessionDir, "00-session-start");

  /** @type {Array<{ caseId: string; phase: object; subjective: string; error?: string }>} */
  const turns = [];

  for (let t = 0; t < SESSION_TURNS.length; t++) {
    const spec = SESSION_TURNS[t];
    try {
      await closeShellDrawer(page).catch(() => {});

      if (spec.seedText) {
        const seed = await sendSpeakWithRetry(
          page,
          spec.seedText,
          `session ${sessionIdx} turn ${t + 1} seed`,
        );
        console.log(
          `[session ${sessionIdx} turn ${t + 1} seed] think=${seed.thinkingMs} first=${seed.firstTextMs} done=${seed.speakMs}`,
        );
        await shot(page, sessionDir, `turn-${t + 1}-seed-done`);
        if (turnGapMs > 0) await sleep(turnGapMs);
      }

      await closeShellDrawer(page).catch(() => {});
      const result = await sendSpeakWithRetry(
        page,
        spec.text,
        `session ${sessionIdx} turn ${t + 1} ${spec.caseId}`,
      );
      const phase = {
        t_think: result.thinkingMs,
        t_first: result.firstTextMs,
        t_done: result.speakMs,
        hadPartial: false,
      };
      const subjective = subjectiveBand(phase);
      turns.push({ caseId: spec.caseId, phase, subjective });
      console.log(
        `[session ${sessionIdx} turn ${t + 1} ${spec.caseId}] think=${phase.t_think} first=${phase.t_first} done=${phase.t_done} band=${subjective}`,
      );
      await shot(page, sessionDir, `turn-${t + 1}-done`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      turns.push({
        caseId: spec.caseId,
        phase: { t_think: null, t_first: null, t_done: null, hadPartial: false },
        subjective: "放弃",
        error: msg,
      });
      console.error(`[session ${sessionIdx} turn ${t + 1}] FAIL: ${msg}`);
      await shot(page, sessionDir, `turn-${t + 1}-error`).catch(() => {});
    }

    if (t < SESSION_TURNS.length - 1 && turnGapMs > 0) {
      await sleep(turnGapMs);
    }
  }

  const elapsed = Date.now() - sessionStart;
  if (elapsed < minSessionMs) {
    const pad = minSessionMs - elapsed;
    console.log(`[session ${sessionIdx}] padding ${Math.round(pad / 1000)}s to reach ~15min session target`);
    await sleep(pad);
  }

  await shot(page, sessionDir, "99-session-end");

  return {
    sessionIdx,
    roomId,
    durationMs: Math.max(elapsed, minSessionMs),
    turns,
    meta: {
      tester: "playwright-automation",
      date: new Date().toISOString().slice(0, 10),
      viewport: "desktop 1280×900",
    },
  };
}

function runVerifyPhase20() {
  return new Promise((resolvePromise, reject) => {
    console.log("\n▶ Chained verify:phase20 …");
    const child = spawn("pnpm", ["verify:phase20"], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(undefined);
      else reject(new Error(`verify:phase20 exit ${code}`));
    });
  });
}

async function main() {
  console.log(`▶ ${SCRIPT}: ${sessionCount} sessions × ${SESSION_TURNS.length} turns`);
  console.log(`   speakTimeoutMs=${speakTimeoutMs} attempts=${speakAttempts} backoffMs=${retryBackoffMs}`);
  console.log(`   out=${outDir}`);
  await healthOk();
  await mkdir(outDir, { recursive: true });

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  /** @type {Awaited<ReturnType<typeof runSession>>[]} */
  const sessions = [];
  try {
    await bootPage(page);
    let playerId = await page.evaluate(() => localStorage.getItem("aetherlife:playerId"));

    for (let s = 1; s <= sessionCount; s++) {
      console.log(`\n=== Session ${s}/${sessionCount} ===`);
      if (s > 1) {
        await resetRoom(playerId);
        await bootPage(page, { reload: true });
        playerId = await page.evaluate(() => localStorage.getItem("aetherlife:playerId"));
      }
      sessions.push(await runSession(page, s));
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const report = {
    runId,
    command: "pnpm playtest:speak-sla",
    startedAt: new Date(runId).toISOString(),
    finishedAt: new Date().toISOString(),
    sessionCount,
    turnGapMs,
    minSessionMs,
    artifactJson: outDir,
    screenshotDir: outDir,
    sessions,
  };

  const jsonPath = resolve(outDir, "playtest-sla-report.json");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n✓ Report: ${jsonPath}`);

  const latestPath = resolve(root, ".planning/benchmarks/playtest-sla-latest.json");
  await mkdir(dirname(latestPath), { recursive: true });
  await writeFile(latestPath, JSON.stringify(report, null, 2), "utf8");

  if (updateFindings) {
    await patchPlaytestFindings(findingsPath, {
      command: report.command,
      artifactJson: jsonPath,
      screenshotDir: outDir,
      sessions,
    });
    console.log(`✓ Patched findings: ${findingsPath}`);
  }

  const abandonCount = sessions.flatMap((s) => s.turns).filter((t) => t.subjective === "放弃").length;
  if (abandonCount > 0) {
    console.warn(`⚠ ${abandonCount} turn(s) marked 放弃 — review screenshots`);
  }

  if (withVerify) {
    await runVerifyPhase20();
  }

  console.log("\n✓ playtest:speak-sla complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
