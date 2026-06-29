/**
 * Browser Speak latency benchmark — Playwright + Performance API marks.
 * Requires: pnpm dev:stack (real LLM, no LLM_MOCK). See docs/E2E-POLICY.md
 *
 * Usage:
 *   VITE_SPEAK_LATENCY_TRACE=1 pnpm dev:stack  (or ?speakLatencyTrace=1 on WEB_URL)
 *   node scripts/benchmark-speak-browser.mjs
 *
 * Env: BENCHMARK_ROUNDS (default 15), BENCHMARK_SKIP_WARMUP=1, BENCHMARK_SKIP_B4=1,
 *      BENCHMARK_B4_STRICT=1 (fail run on first B4 error), WEB_URL, GAME_SERVER_URL
 *      BENCHMARK_HEADED=1 (visible browser for player-experience UAT)
 *      BENCHMARK_SLOW_MO=200 (ms per Playwright action when headed)
 *      BENCHMARK_ROOM_ID / BENCHMARK_PLAYER_ID (isolated room; default speak-bench-{ts})
 *      PROFILE_CASES=B1,B2 (subset by id or profileTag)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertE2eRealLlm, e2eSpeakTimeoutMs } from "./lib/e2e-policy.mjs";
import { closeShellDrawer } from "./lib/e2e-memory-helpers.mjs";
import { engageDialogue } from "./lib/dialogue-engage.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ID = Date.now();
const ROOM_ID = process.env.BENCHMARK_ROOM_ID || `speak-bench-${RUN_ID}`;
const BENCH_PLAYER_ID =
  process.env.BENCHMARK_PLAYER_ID || `bench${String(RUN_ID).slice(-12)}`;
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
const WEB_UI =
  `${WEB_BASE}${WEB_BASE.includes("?") ? "&" : "?"}` +
  `phaserFallback=1&speakLatencyTrace=1&room=${encodeURIComponent(ROOM_ID)}`;
const GS = process.env.GAME_SERVER_URL || "http://127.0.0.1:2567";
const GW = process.env.AI_GATEWAY_URL || "http://127.0.0.1:8000";
const NPC_ID = "npc-1";
const ROUNDS = Number(process.env.BENCHMARK_ROUNDS || 15);
const SKIP_WARMUP = process.env.BENCHMARK_SKIP_WARMUP !== "0";
const SKIP_B4 = process.env.BENCHMARK_SKIP_B4 === "1";
const B4_STRICT = process.env.BENCHMARK_B4_STRICT === "1";
const HEADED = process.env.BENCHMARK_HEADED === "1";
const SLOW_MO = Number(process.env.BENCHMARK_SLOW_MO || 0);
// Formal benchmark: move/recall may exceed 6 min under LLM concurrency=1.
const SPEAK_TIMEOUT_MS = Math.max(480_000, e2eSpeakTimeoutMs());
const SPRITE_ARRIVE_TIMEOUT_MS = Number(process.env.BENCHMARK_SPRITE_TIMEOUT_MS || 30_000);
const OUT_DIR = path.join(ROOT, ".planning/benchmarks");

const CASES = [
  {
    id: "B1",
    label: "闲聊",
    message: "你好",
    expectMove: false,
    expectIntent: "casual",
    profileTag: "casual",
  },
  {
    id: "B2",
    label: "物理慢/快",
    message: "请向右走一步",
    expectMove: true,
    expectIntent: "physical",
    profileTag: "move",
  },
  {
    id: "B3",
    label: "物理快路径",
    message: "去阿斯托利亚旁边",
    expectMove: true,
    expectIntent: "physical",
    profileTag: "move",
  },
  {
    id: "B_recall",
    label: "跨session回忆",
    message: "我之前说的门禁密码是多少？",
    expectMove: false,
    expectIntent: "recall",
    optionalSeed: "记住：门禁密码是 8848",
    profileTag: "recall",
  },
];

const PROFILE_FILTER = process.env.PROFILE_CASES
  ? new Set(
      process.env.PROFILE_CASES.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : null;

function casesToRun() {
  if (!PROFILE_FILTER) return CASES;
  return CASES.filter((c) => PROFILE_FILTER.has(c.id) || PROFILE_FILTER.has(c.profileTag));
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

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

async function loadPlaywright() {
  const pwEntry = path.join(ROOT, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) {
    throw new Error("playwright 未安装：cd scripts/.pw-deps && pnpm install");
  }
  return chromium;
}

async function health(url, name) {
  const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${name} /health → ${res.status}`);
  const body = await res.json();
  if (body.status !== "ok") throw new Error(`${name} /health invalid`);
}

async function resetRoom(playerId, { attempts = 3 } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (playerId) headers["X-Player-Id"] = playerId;
  let lastStatus = 0;
  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(`${GS}/rooms/${ROOM_ID}/reset`, { method: "POST", headers });
    lastStatus = res.status;
    if (res.ok) return;
    if (i < attempts) await new Promise((r) => setTimeout(r, 1000 * i));
  }
  throw new Error(`reset → ${lastStatus}`);
}

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

async function waitNpcAt(playerId, target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pos = await fetchNpcPos(playerId);
    if (pos && pos.x === target.x && pos.y === target.y) return pos;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

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

/** Initial boot: corner-menu green dot = Colyseus joined (playtest-speak-sla keeps one session). */
async function waitColyseusConnected(page, timeoutMs = 90_000) {
  await page.locator('[data-testid="corner-menu"]').waitFor({ state: "visible", timeout: 30_000 });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await page.evaluate(() => {
      const ok = Boolean(
        document.querySelector('[data-testid="corner-menu"] .corner-menu__status-dot--ok'),
      );
      const err = document.querySelector(".corner-menu__meta-value--err");
      const warn = document.querySelector(".corner-menu__meta-value--warn");
      return {
        ok,
        label: (err ?? warn)?.textContent?.trim() ?? "",
      };
    });
    if (status.ok) return;
    if (status.label.includes("已满")) {
      throw new Error(
        `Colyseus room full (${ROOM_ID}): ${status.label} — use BENCHMARK_ROOM_ID or restart dev:stack`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Colyseus connect timeout: status dot never turned ok");
}

/** HTTP reset only — do not reload; resetColyseusFromMap keeps the WS session alive. */
async function prepareBenchmarkRound(playerId) {
  await resetRoom(playerId);
  await new Promise((r) => setTimeout(r, 400));
}

/** Phase 19 overlay-first T_think: NOT legacy drawer `.message--thinking`.
 *  Canonical selectors for verify:phase20 live in scripts/lib/speak-browser-round.mjs
 *  and scripts/lib/e2e-memory-helpers.mjs — keep benchmark locators aligned manually. */
const THINKING_LOCATOR =
  '[data-testid="dialogue-overlay"] .dialogue-overlay__thinking, ' +
  '.dialogue-bar__summary-text--thinking, ' +
  '[data-testid="composer-speak-status"]';

const OVERLAY_STREAMING = '[data-testid="dialogue-overlay-streaming"]';

const OVERLAY_NPC_REPLY =
  `${OVERLAY_STREAMING}, ` + '[data-testid="dialogue-overlay"] .dialogue-overlay__last-line';

/** Snapshot visible reply text before send — B4 consecutive turns need "new" reply detection. */
async function captureReplyBaseline(page) {
  return page.evaluate(() => {
    const summary = document.querySelector(".dialogue-bar__summary-text");
    const overlayNodes = document.querySelectorAll(
      '[data-testid="dialogue-overlay"] .dialogue-overlay__last-line',
    );
    const overlay =
      overlayNodes.length > 0
        ? (overlayNodes[overlayNodes.length - 1].textContent ?? "").trim()
        : "";
    const marks = window.__speakLatencyMarks ?? [];
    return {
      summary: (summary?.textContent ?? "").trim(),
      overlay,
      partialCount: marks.filter((m) => m.event === "speak_partial").length,
    };
  });
}

/**
 * T_first fallback chain (user-perceived first NPC text):
 * 1) `.dialogue-bar__summary-text` not matching /^思考/ and changed vs baseline
 * 2) last visible NPC line in dialogue-overlay changed vs baseline
 * 3) new `speak_partial` performance mark after baseline.partialCount
 */
async function waitForFirstNpcReply(page, timeoutMs, baseline) {
  const deadline = Date.now() + timeoutMs;
  const baseSummary = baseline?.summary ?? "";
  const baseOverlay = baseline?.overlay ?? "";
  const basePartialCount = baseline?.partialCount ?? 0;

  while (Date.now() < deadline) {
    const streaming = page.locator(OVERLAY_STREAMING);
    if (await streaming.isVisible().catch(() => false)) {
      const text = (await streaming.textContent().catch(() => "")) ?? "";
      const trimmed = text.trim();
      if (trimmed && trimmed !== baseOverlay) {
        return Date.now();
      }
    }

    const summary = page.locator(".dialogue-bar__summary-text");
    if ((await summary.count()) > 0) {
      const text = (await summary.first().textContent().catch(() => "")) ?? "";
      const trimmed = text.trim();
      if (trimmed && !/^思考/.test(trimmed) && trimmed !== baseSummary) {
        return Date.now();
      }
    }

    const overlayNpc = page.locator(OVERLAY_NPC_REPLY).last();
    if (await overlayNpc.isVisible().catch(() => false)) {
      const text = (await overlayNpc.textContent().catch(() => "")) ?? "";
      const trimmed = text.trim();
      if (trimmed && trimmed !== baseOverlay) {
        return Date.now();
      }
    }

    const hasNewPartial = await page.evaluate(
      (count) =>
        (window.__speakLatencyMarks ?? []).filter((m) => m.event === "speak_partial")
          .length > count,
      basePartialCount,
    );
    if (hasNewPartial) return Date.now();

    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("T_first timeout: no overlay/dialogue-bar NPC reply visible");
}

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

  await closeShellDrawer(page);
  await engageDialogue(page);

  await page.evaluate(() => {
    window.__speakLatencyMarks = [];
    window.__speakLatencyT0 = undefined;
  });

  const replyBaseline = await captureReplyBaseline(page);
  const t0 = Date.now();
  await closeShellDrawer(page);
  const composer = page.locator("textarea.composer__input");
  await composer.fill(message);
  await page.locator("button.composer__submit").click();

  await page.locator(THINKING_LOCATOR).first().waitFor({ state: "visible", timeout: 15_000 });
  const tThinkingVisible = Date.now();

  const tNpcBubble = await waitForFirstNpcReply(page, SPEAK_TIMEOUT_MS, replyBaseline);

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

async function runCaseB4(page) {
  const r1 = await runSpeakRound(page, CASES[0].message, { expectMove: false });
  await page.waitForFunction(
    () => {
      const input = document.querySelector("textarea.composer__input");
      return input && !input.disabled && input.getAttribute("aria-busy") !== "true";
    },
    { timeout: SPEAK_TIMEOUT_MS },
  );
  await closeShellDrawer(page);
  await new Promise((r) => setTimeout(r, 3000));
  await engageDialogue(page);
  const r2 = await runSpeakRound(page, CASES[2].message, { expectMove: true });
  return { id: "B4", label: "连续 B1→B3", rounds: [r1, r2] };
}

async function writeReport(report, { partial = false, error = null } = {}) {
  report.completedAt = new Date().toISOString();
  if (partial) {
    report.partial = true;
    if (error) {
      report.error = error instanceof Error ? error.message : String(error);
    }
  }
  await mkdir(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `speak-browser-${Date.now()}.json`);
  await writeFile(outFile, JSON.stringify(report, null, 2));
  const latestFile = path.join(OUT_DIR, "speak-browser-latest.json");
  await writeFile(latestFile, JSON.stringify(report, null, 2));
  console.log(`\nJSON${partial ? " (partial)" : ""}: ${path.relative(ROOT, outFile)}`);
  console.log(`Latest: ${path.relative(ROOT, latestFile)}`);
  return outFile;
}

function printSummary(report) {
  console.log("\n=== Summary (p50 ms) ===");
  for (const c of report.cases) {
    if (!c.summary) continue;
    console.log(
      `${c.id}: total p50=${c.summary.total?.p50} p95=${c.summary.total?.p95} | ttft p50=${c.summary.ttft_partial?.p50 ?? "n/a"} | bubble p50=${c.summary.npc_bubble?.p50}`,
    );
  }
}

async function main() {
  assertE2eRealLlm("benchmark-speak-browser");
  console.log(
    `Speak browser benchmark — room=${ROOM_ID} player=${BENCH_PLAYER_ID} WEB=${WEB_UI} GS=${GS} rounds=${ROUNDS}\n`,
  );
  await health(GS, "game-server");
  await health(GW, "ai-gateway");
  await resetRoom(BENCH_PLAYER_ID);

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({
    headless: !HEADED,
    slowMo: SLOW_MO > 0 ? SLOW_MO : undefined,
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(
    ({ key, id }) => {
      localStorage.setItem(key, id);
    },
    { key: "aetherlife:playerId", id: BENCH_PLAYER_ID },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(SPEAK_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(60_000);

  const report = {
    startedAt: new Date().toISOString(),
    roomId: ROOM_ID,
    playerId: BENCH_PLAYER_ID,
    webUrl: WEB_UI,
    gameServer: GS,
    roundsConfigured: ROUNDS,
    skipWarmup: SKIP_WARMUP,
    skipB4: SKIP_B4,
    speakTimeoutMs: SPEAK_TIMEOUT_MS,
    llmEnv: {
      LLM_PROVIDER: process.env.LLM_PROVIDER,
      LLM_MODEL_NPC: process.env.LLM_MODEL_NPC,
    },
    cases: [],
  };

  let runError = null;
  const playerId = BENCH_PLAYER_ID;
  try {
    await page.goto(WEB_UI, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitRoomReady(page);
    await waitColyseusConnected(page);
    await engageDialogue(page);

  for (const caseDef of casesToRun()) {
    const caseResults = [];
    for (let round = 1; round <= ROUNDS; round++) {
      if (SKIP_WARMUP && round === 1) {
        console.log(`[${caseDef.id}] warmup (skipped in stats)`);
      }
      await prepareBenchmarkRound(playerId);
      await closeShellDrawer(page);
      await engageDialogue(page);
      if (caseDef.optionalSeed && round === 1 && !SKIP_WARMUP) {
        console.log(`[${caseDef.id}] optional seed turn (not in stats)`);
        await runSpeakRound(page, caseDef.optionalSeed, { expectMove: false });
        await new Promise((r) => setTimeout(r, 2000));
      } else if (caseDef.optionalSeed && round === 1 && SKIP_WARMUP) {
        console.warn(
          `[${caseDef.id}] WARN: recall seed skipped on warmup round — B_recall may lack prior context`,
        );
      }
      console.log(`[${caseDef.id}] round ${round}/${ROUNDS} …`);
      let result;
      try {
        result = await runSpeakRound(page, caseDef.message, {
          expectMove: caseDef.expectMove,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  FAIL round ${round}: ${msg.slice(0, 160)}`);
        if (!SKIP_WARMUP || round > 1) {
          caseResults.push({ message: caseDef.message, error: msg, round });
        }
        continue;
      }
      if (!SKIP_WARMUP || round > 1) caseResults.push(result);
      if (
        caseDef.expectIntent &&
        result.speakIntent &&
        result.speakIntent !== caseDef.expectIntent
      ) {
        console.warn(
          `  WARN intent mismatch expect=${caseDef.expectIntent} got=${result.speakIntent}`,
        );
      }
      console.log(
        `  total=${result.segmentsMs.total}ms think=${result.segmentsMs.thinking_visible}ms ttft=${result.segmentsMs.ttft_partial ?? "n/a"}ms bubble=${result.segmentsMs.npc_bubble}ms intent=${result.speakIntent ?? "n/a"}`,
      );
    }
    const segments = {};
    const okResults = caseResults.filter((r) => r.segmentsMs);
    for (const key of Object.keys(okResults[0]?.segmentsMs ?? {})) {
      segments[key] = summarize(okResults.map((r) => r.segmentsMs[key]));
    }
    const failed = caseResults.filter((r) => r.error);
    report.cases.push({
      id: caseDef.id,
      label: caseDef.label,
      message: caseDef.message,
      results: caseResults,
      summary: okResults.length ? segments : null,
      ...(failed.length ? { failedRounds: failed.length } : {}),
    });
  }

  if (!SKIP_B4) {
    const b4Rounds = Math.min(3, ROUNDS);
    const b4Results = [];
    const b4Errors = [];
    for (let i = 0; i < b4Rounds; i++) {
      await prepareBenchmarkRound(playerId);
      await closeShellDrawer(page);
      await engageDialogue(page);
      console.log(`[B4] sequence ${i + 1}/${b4Rounds}`);
      try {
        b4Results.push(await runCaseB4(page));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[B4] sequence ${i + 1} failed: ${msg}`);
        b4Errors.push({ sequence: i + 1, error: msg });
        if (B4_STRICT) throw err;
      }
    }
    report.cases.push({
      id: "B4",
      label: "连续 B1→B3",
      sequences: b4Results,
      ...(b4Errors.length ? { errors: b4Errors } : {}),
    });
  } else {
    console.log("[B4] skipped (BENCHMARK_SKIP_B4=1)");
  }

  printSummary(report);
  console.log("Run SDK对照: node scripts/benchmark-llm-e2e-latency.mjs");
  const failedCount = report.cases.reduce(
    (n, c) => n + (c.failedRounds ?? 0) + (c.errors?.length ?? 0),
    0,
  );
  if (failedCount > 0) {
    report.failedRoundCount = failedCount;
    runError = runError ?? new Error(`${failedCount} benchmark round(s) failed`);
  }
  } catch (err) {
    runError = err;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    if (report.cases.length > 0) {
      await writeReport(report, { partial: Boolean(runError), error: runError });
    }
  }
  if (runError) {
    throw runError;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
