/**
 * Browser Speak latency benchmark — Playwright + Performance API marks.
 * Requires: pnpm dev:stack (real LLM, no LLM_MOCK). See docs/E2E-POLICY.md
 *
 * Usage:
 *   VITE_SPEAK_LATENCY_TRACE=1 pnpm dev:stack  (or ?speakLatencyTrace=1 on WEB_URL)
 *   node scripts/benchmark-speak-browser.mjs
 *
 * Env: BENCHMARK_ROUNDS (default 15), BENCHMARK_SKIP_WARMUP=1, WEB_URL, GAME_SERVER_URL
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertE2eRealLlm, e2eSpeakTimeoutMs } from "./lib/e2e-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

const WEB_BASE = process.env.WEB_URL || "http://localhost:5173";
const WEB_UI = `${WEB_BASE}${WEB_BASE.includes("?") ? "&" : "?"}phaserFallback=1&speakLatencyTrace=1`;
const GS = process.env.GAME_SERVER_URL || "http://127.0.0.1:2567";
const GW = process.env.AI_GATEWAY_URL || "http://127.0.0.1:8000";
const ROOM_ID = "default";
const NPC_ID = "npc-1";
const ROUNDS = Number(process.env.BENCHMARK_ROUNDS || 15);
const SKIP_WARMUP = process.env.BENCHMARK_SKIP_WARMUP !== "0";
const SPEAK_TIMEOUT_MS = e2eSpeakTimeoutMs();
const SPRITE_ARRIVE_TIMEOUT_MS = Number(process.env.BENCHMARK_SPRITE_TIMEOUT_MS || 30_000);
const OUT_DIR = path.join(ROOT, ".planning/benchmarks");

const CASES = [
  { id: "B1", label: "闲聊", message: "你好，用一句话简短回复", expectMove: false },
  { id: "B2", label: "物理慢/快", message: "请向右走一步", expectMove: true },
  { id: "B3", label: "物理快路径", message: "去费雪旁边", expectMove: true },
];

/**
 * Selects the element at the p-th percentile from a sorted numeric array.
 * @param {number[]} sorted - Array of numbers sorted in ascending order.
 * @param {number} p - Percentile between 0 and 100 inclusive.
 * @returns {number|null} The array element at the p-th percentile using the "ceiling" index method, or `null` if the array is empty.
 */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Produce basic statistics (count, min, median, 95th percentile, max) from an array of values.
 * 
 * Filters the input to finite numbers, then computes the number of samples, minimum, 50th
 * percentile (median), 95th percentile, and maximum.
 * @param {Array<any>} values - Array containing numeric values (others are ignored).
 * @returns {{n: number, min: number|null, p50: number|null, p95: number|null, max: number|null}}
 *          An object where `n` is the count of finite numbers; `min`, `p50`, `p95`, and `max`
 *          are `null` when no finite numbers are present, otherwise contain the corresponding values.
 */
function summarize(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return { n: 0, min: null, p50: null, p95: null, max: null };
  const sorted = [...nums].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
  };
}

/**
 * Import Playwright's Chromium launcher from the repository's local scripts/.pw-deps installation.
 *
 * @returns {object} The Playwright Chromium launcher (the `chromium` export from the Playwright package).
 * @throws {Error} If Playwright (and its `chromium` export) cannot be found at scripts/.pw-deps/node_modules/playwright.
 */
async function loadPlaywright() {
  const pwEntry = path.join(ROOT, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) {
    throw new Error("playwright 未安装：cd scripts/.pw-deps && npm install");
  }
  return chromium;
}

/**
 * Verifies a service health endpoint and throws if the service is unhealthy or unreachable.
 *
 * Sends an HTTP GET to `{url}/health` with a 5000ms timeout and expects a JSON body whose
 * `status` property equals `"ok"`.
 *
 * @param {string} url - Base URL of the service (protocol + host[:port]).
 * @param {string} name - Human-readable service name used in error messages.
 * @throws {Error} If the HTTP status is not OK or if the returned JSON `status` is not `"ok"`.
 */
async function health(url, name) {
  const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${name} /health → ${res.status}`);
  const body = await res.json();
  if (body.status !== "ok") throw new Error(`${name} /health invalid`);
}

/**
 * Reset the benchmark room on the game server, optionally scoping the request to a specific player.
 * Sends a POST to the game server reset endpoint and includes `X-Player-Id` when `playerId` is provided.
 * @param {string} [playerId] - Optional player ID to include in the `X-Player-Id` header.
 * @throws {Error} If the HTTP response status is not OK.
 */
async function resetRoom(playerId) {
  const headers = { "Content-Type": "application/json" };
  if (playerId) headers["X-Player-Id"] = playerId;
  const res = await fetch(`${GS}/rooms/${ROOM_ID}/reset`, { method: "POST", headers });
  if (!res.ok) throw new Error(`reset → ${res.status}`);
}

/**
 * Fetches an NPC's numeric (x, y) position for the current room from the game server.
 *
 * @param {string} [playerId] - Optional player identifier to send in the `X-Player-Id` request header.
 * @param {string} [npcId=NPC_ID] - The NPC identifier to look up.
 * @returns {{x: number, y: number} | null} The NPC's coordinates when available and both are finite numbers; `null` if the server response is not OK, the NPC is not found, or coordinates are invalid.
 */
async function fetchNpcPos(playerId, npcId = NPC_ID) {
  const headers = {};
  if (playerId) headers["X-Player-Id"] = playerId;
  const res = await fetch(`${GS}/rooms/${ROOM_ID}/state`, { headers });
  if (!res.ok) return null;
  const body = await res.json();
  const npcs = body?.state?.npcs ?? [];
  const npc = npcs.find((n) => n.id === npcId);
  if (!npc || !Number.isFinite(npc.x) || !Number.isFinite(npc.y)) return null;
  return { x: npc.x, y: npc.y };
}

/**
 * Waits until the NPC for the given player is observed at the specified target position or the timeout elapses.
 *
 * @param {string|undefined} playerId - Optional player identifier used when querying NPC state.
 * @param {{x:number,y:number}} target - Target grid coordinates to wait for.
 * @param {number} timeoutMs - Maximum wait time in milliseconds.
 * @returns {{x:number,y:number}|null} `{x,y}` when the NPC reaches the target before the timeout, `null` if the timeout is reached without a match.
 */
async function waitNpcAt(playerId, target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pos = await fetchNpcPos(playerId);
    if (pos && pos.x === target.x && pos.y === target.y) return pos;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/**
 * Waits until the room UI is ready for interaction.
 *
 * Ensures the movement panel is visible and that at least 64 grid cells are rendered in the DOM; each check times out after 30 seconds.
 *
 * @param {import('playwright').Page} page - Playwright page instance pointed at the room UI.
 */
async function waitRoomReady(page) {
  await page.locator('[data-testid="movement-panel"]').waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const cells = document.querySelectorAll('[data-testid^="cell-"]');
      return cells.length >= 64;
    },
    { timeout: 30_000 },
  );
}

/**
 * Runs a single speak interaction on the page, collects browser timing marks, network timing for `/nl/parse`, and optional NPC sprite arrival timing.
 * @param {import('playwright').Page} page - Playwright page used to drive the UI and read timing marks.
 * @param {string} message - Text submitted to the composer for this round.
 * @param {{ expectMove: boolean }} options - Round options.
 * @param {boolean} options.expectMove - If true, wait for the NPC sprite to reach the position reported by the page and include arrival timings.
 * @returns {object} An object with the following properties:
 *  - message: the submitted message.
 *  - segmentsMs: timing deltas in milliseconds (total, ttft_partial, nl_parse_network, nl_parse_client, speak_sent, speak_ack, thinking_visible, npc_bubble, composer_idle, sprite_arrived, bubble_to_sprite).
 *  - llmCallSummary: metadata from the page's `done` mark or `null`.
 *  - speakIntent: detected speak intent from the `done` mark or `null`.
 *  - phaseTimingMs: per-phase timings from the `done` mark or `null`.
 *  - toolNames: tool names reported in the `done` mark or `null`.
 *  - npcPos: NPC position reported in the `done` mark or `null`.
 *  - marks: array of raw timing marks read from the page.
 */
async function runSpeakRound(page, message, { expectMove }) {
  const nlParseTimes = { start: null, end: null };
  const onResponse = (res) => {
    const url = res.url();
    if (!url.includes("/nl/parse")) return;
    const req = res.request();
    if (nlParseTimes.start === null) nlParseTimes.start = Date.now();
    res.finished().then(() => {
      if (nlParseTimes.end === null) nlParseTimes.end = Date.now();
    }).catch(() => {});
  };
  page.on("response", onResponse);

  await page.evaluate(() => {
    window.__speakLatencyMarks = [];
    window.__speakLatencyT0 = undefined;
  });

  const t0 = Date.now();
  const composer = page.locator("textarea.composer__input");
  await composer.fill(message);
  await page.locator("button.composer__submit").click();

  await page.locator(".message--thinking").waitFor({ state: "visible", timeout: 15_000 });
  const tThinkingVisible = Date.now();

  const npcReply = page.locator(".message--npc").last();
  await npcReply.waitFor({ state: "visible", timeout: SPEAK_TIMEOUT_MS });
  const tNpcBubble = Date.now();

  await page.waitForFunction(
    () => {
      const input = document.querySelector("textarea.composer__input");
      return input && !input.disabled && input.getAttribute("aria-busy") !== "true";
    },
    { timeout: SPEAK_TIMEOUT_MS },
  );
  const tComposerIdle = Date.now();

  const marks = await page.evaluate(() => window.__speakLatencyMarks ?? []);
  const t0Perf = await page.evaluate(() => window.__speakLatencyT0 ?? null);
  const doneMark = marks.find((m) => m.event === "done");
  const partialMark = marks.find((m) => m.event === "speak_partial");
  const speakAckMark = marks.find((m) => m.event === "speak_ack");
  const speakSentMark = marks.find((m) => m.event === "speak_sent");
  const nlParseMark = marks.find((m) => m.event === "nl_parse_end");

  let tFirstPartial = null;
  if (partialMark && typeof t0Perf === "number") {
    tFirstPartial = Math.round(partialMark.t - t0Perf);
  }

  let tSpriteArrived = null;
  if (expectMove && doneMark?.data?.npcPos) {
    const playerId = await page.evaluate(() =>
      localStorage.getItem("aetherlife:playerId"),
    );
    const target = doneMark.data.npcPos;
    const arrived = await waitNpcAt(playerId, target, SPRITE_ARRIVE_TIMEOUT_MS);
    if (arrived) tSpriteArrived = Date.now();
  }

  page.off("response", onResponse);

  const markDelta = (mark) =>
    mark && typeof t0Perf === "number" ? Math.round(mark.t - t0Perf) : null;

  return {
    message,
    segmentsMs: {
      total: tComposerIdle - t0,
      ttft_partial: tFirstPartial,
      nl_parse_network:
        nlParseTimes.start !== null && nlParseTimes.end !== null
          ? nlParseTimes.end - nlParseTimes.start
          : null,
      nl_parse_client: markDelta(nlParseMark),
      speak_sent: markDelta(speakSentMark),
      speak_ack: markDelta(speakAckMark),
      thinking_visible: tThinkingVisible - t0,
      npc_bubble: tNpcBubble - t0,
      composer_idle: tComposerIdle - t0,
      sprite_arrived: tSpriteArrived !== null ? tSpriteArrived - t0 : null,
      bubble_to_sprite:
        tSpriteArrived !== null && tNpcBubble ? tSpriteArrived - tNpcBubble : null,
    },
    llmCallSummary: doneMark?.data?.llmCallSummary ?? null,
    speakIntent: doneMark?.data?.speakIntent ?? null,
    phaseTimingMs: doneMark?.data?.phaseTimingMs ?? null,
    toolNames: doneMark?.data?.toolNames ?? null,
    npcPos: doneMark?.data?.npcPos ?? null,
    marks,
  };
}

/**
 * Execute the B4 sequence: run the B1 speak round (no movement) then, after a 2 second pause, run the B3 speak round (movement expected).
 *
 * @returns {{id: string, label: string, rounds: Array<Object>}} An object with `id` "B4", `label` "连续 B1→B3", and `rounds` containing the two round results [B1_result, B3_result].
 */
async function runCaseB4(page) {
  const r1 = await runSpeakRound(page, CASES[0].message, { expectMove: false });
  await new Promise((r) => setTimeout(r, 2000));
  const r2 = await runSpeakRound(page, CASES[2].message, { expectMove: true });
  return { id: "B4", label: "连续 B1→B3", rounds: [r1, r2] };
}

/**
 * Run the browser-based "speak" latency benchmark end-to-end and write a JSON report.
 *
 * Launches Chromium via Playwright, navigates the web UI, validates backend health, and for each configured
 * benchmark case executes the configured number of rounds (optionally skipping the first warmup round).
 * For each round it resets the game room, reloads and waits for the UI to be ready, submits the test message,
 * collects timing marks and network metrics, optionally waits for NPC movement, and aggregates per-round results.
 * Also runs the B4 two-round sequence multiple times. Closes the browser, writes a timestamped report file
 * into OUT_DIR, and prints a p50/p95 summary and the JSON output path.
 */
async function main() {
  assertE2eRealLlm("benchmark-speak-browser");
  console.log(`Speak browser benchmark — WEB=${WEB_UI} GS=${GS} rounds=${ROUNDS}\n`);
  await health(GS, "game-server");
  await health(GW, "ai-gateway");

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(WEB_UI, { waitUntil: "networkidle", timeout: 60_000 });
  await waitRoomReady(page);

  const playerId = await page.evaluate(() => localStorage.getItem("aetherlife:playerId"));
  const report = {
    startedAt: new Date().toISOString(),
    webUrl: WEB_UI,
    gameServer: GS,
    roundsConfigured: ROUNDS,
    skipWarmup: SKIP_WARMUP,
    llmEnv: {
      LLM_PROVIDER: process.env.LLM_PROVIDER,
      LLM_MODEL_NPC: process.env.LLM_MODEL_NPC,
    },
    cases: [],
  };

  for (const caseDef of CASES) {
    const caseResults = [];
    for (let round = 1; round <= ROUNDS; round++) {
      if (SKIP_WARMUP && round === 1) {
        console.log(`[${caseDef.id}] warmup (skipped in stats)`);
      }
      await resetRoom(playerId);
      await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
      await waitRoomReady(page);
      console.log(`[${caseDef.id}] round ${round}/${ROUNDS} …`);
      const result = await runSpeakRound(page, caseDef.message, {
        expectMove: caseDef.expectMove,
      });
      if (!SKIP_WARMUP || round > 1) caseResults.push(result);
      console.log(
        `  total=${result.segmentsMs.total}ms ttft=${result.segmentsMs.ttft_partial ?? "n/a"}ms bubble=${result.segmentsMs.npc_bubble}ms intent=${result.speakIntent ?? "n/a"}`,
      );
    }
    const segments = {};
    for (const key of Object.keys(caseResults[0]?.segmentsMs ?? {})) {
      segments[key] = summarize(caseResults.map((r) => r.segmentsMs[key]));
    }
    report.cases.push({
      id: caseDef.id,
      label: caseDef.label,
      message: caseDef.message,
      results: caseResults,
      summary: segments,
    });
  }

  // B4 — single sequence (not repeated 15x in plan; one run + optional rounds)
  const b4Rounds = Math.min(3, ROUNDS);
  const b4Results = [];
  for (let i = 0; i < b4Rounds; i++) {
    await resetRoom(playerId);
    await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
    await waitRoomReady(page);
    console.log(`[B4] sequence ${i + 1}/${b4Rounds}`);
    b4Results.push(await runCaseB4(page));
  }
  report.cases.push({ id: "B4", label: "连续 B1→B3", sequences: b4Results });

  await context.close();
  await browser.close();

  await mkdir(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `speak-browser-${Date.now()}.json`);
  await writeFile(outFile, JSON.stringify(report, null, 2));

  console.log("\n=== Summary (p50 ms) ===");
  for (const c of report.cases) {
    if (!c.summary) continue;
    console.log(
      `${c.id}: total p50=${c.summary.total?.p50} p95=${c.summary.total?.p95} | ttft p50=${c.summary.ttft_partial?.p50 ?? "n/a"} | bubble p50=${c.summary.npc_bubble?.p50}`,
    );
  }
  console.log(`\nJSON: ${path.relative(ROOT, outFile)}`);
  console.log("Run SDK对照: node scripts/benchmark-llm-e2e-latency.mjs");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
