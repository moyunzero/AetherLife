/**
 * Phase 26 E2E — Council map presence ship gate (MAP-05, REL-08 drift optional).
 *
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real API keys in .env.
 * Never run with LLM_MOCK=1 or dev:stack:mock — see docs/E2E-POLICY.md.
 *
 * Flow: health → dedicated room → assert ≥12 NPC entities (registry + sprites) →
 * dual-client npc position sync → speak npc-1 / npc-7 / npc-12 → world-vote debate+ballot →
 * optional pytest leaning_drift (mock, non-LLM).
 *
 * Timeout: VERIFY_PHASE26_TIMEOUT_MS (default 900000 — real LLM latency).
 */
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertE2eNoMock,
  assertE2eRealLlm,
  e2eSpeakTimeoutMs,
} from "./lib/e2e-policy.mjs";
import { engageDialogue } from "./lib/dialogue-engage.mjs";
import {
  closeShellDrawer,
  openShellDrawerCollective,
  sendSpeakOverlay,
} from "./lib/e2e-memory-helpers.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";
import { loadPlaywright } from "./lib/speak-browser-stack.mjs";
import { assertCanonicalCouncilRoster, COUNCIL_NPC_IDS } from "./lib/council-spawn.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE26_ROOM_ID || `verify-p26-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const speakTimeoutMs = Math.max(90_000, e2eSpeakTimeoutMs());
const engageTimeoutMs = Math.max(90_000, speakTimeoutMs / 2);
const phaseTimeoutMs =
  Number.parseInt(process.env.VERIFY_PHASE26_TIMEOUT_MS || "900000", 10) || 900_000;
const BANNER_WAIT_MS = Number.parseInt(process.env.E2E_BANNER_WAIT_MS || "", 10) || 60_000;
const screenshotDir = process.env.VERIFY_PHASE26_SCREENSHOT_DIR || "";
const HTTP_TIMEOUT_MS =
  Number.parseInt(process.env.VERIFY_PHASE26_HTTP_TIMEOUT_MS || "60000", 10) || 60_000;

function fetchWithTimeout(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS;
  const { timeoutMs: _drop, ...rest } = options;
  return fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
}

async function maybeShot(page, name) {
  if (!screenshotDir || !page) return;
  await mkdir(screenshotDir, { recursive: true });
  const file = join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`verify:phase26: 📸 ${file}`);
}

const SPEAK_NPC_IDS = ["npc-1", "npc-7", "npc-12"];
const MIN_COUNCIL_NPCS = 12;

/** Traveler semantic markers (reuse phase25 D-VOTE-PLAY-06). */
const TRAVELER_MARKERS = /旅者|据近期旅者言行/;

function internalHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await fn()) return;
    } catch {
      // Transient fetch/UI errors — keep polling until timeoutMs.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout: ${label} (${timeoutMs}ms)`);
}

async function healthOk() {
  const gsRes = await fetch(`${httpBase}/health`, { signal: AbortSignal.timeout(8000) });
  if (!gsRes.ok) throw new Error(`game-server health ${gsRes.status}`);
  const gsBody = await gsRes.json().catch(() => ({}));
  if (gsBody.service !== "game-server" && gsBody.status !== "ok" && gsBody.ok !== true) {
    throw new Error("game-server unexpected health body");
  }

  const webRes = await fetch(webBase, { signal: AbortSignal.timeout(8000) });
  if (!webRes.ok) throw new Error(`web ${webBase} → ${webRes.status}`);
}

async function fetchCollectiveState(playerId, npcId = "npc-1") {
  const qs = new URLSearchParams({ npcId });
  const res = await fetchWithTimeout(
    `${httpBase}/rooms/${encodeURIComponent(roomId)}/collective-state?${qs}`,
    { headers: { "X-Player-Id": playerId, "Cache-Control": "no-cache" } },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`collective-state → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function fetchWorldVoteContext() {
  const res = await fetchWithTimeout(
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/world-vote/context`,
    { headers: internalHeaders() },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`world-vote/context → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function triggerWorldVote() {
  const res = await fetchWithTimeout(
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/world-vote/trigger`,
    {
      method: "POST",
      headers: internalHeaders(),
      body: JSON.stringify({ force: true, voteKind: "regular", debateRoundsMax: 1 }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`world-vote/trigger → ${res.status}: ${JSON.stringify(body)}`);
  }
  console.log(`verify:phase26: vote triggered jobId=${body.jobId ?? "?"}`);
  return body;
}

function latestEventOfKind(events, playerId, kind) {
  return (events ?? []).find(
    (e) =>
      e?.kind === kind &&
      Array.isArray(e.playerIds) &&
      e.playerIds[0] === playerId,
  );
}

async function waitCornerMenuConnected(page, timeoutMs = 60_000) {
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-testid="corner-menu"] .corner-menu__status-dot--ok'),
      ),
    { timeout: timeoutMs },
  );
}

async function openShellDrawerCouncil(page) {
  const drawer = page.locator('[data-testid="shell-drawer"]');
  const chip = page.locator('[data-testid="council-deliberation-chip"]');
  if (!(await drawer.isVisible().catch(() => false))) {
    if (await chip.isVisible().catch(() => false)) {
      await chip.click();
    } else {
      await page.locator('[aria-label="对话历史"]').click();
      await drawer.waitFor({ state: "visible", timeout: 10_000 });
      await page.locator("#shell-drawer-tab-council").click();
    }
  } else {
    await page.locator("#shell-drawer-tab-council").click();
  }
  await drawer.waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#shell-drawer-panel-council").waitFor({
    state: "visible",
    timeout: 10_000,
  });
}

function assertTravelerSemantics({ chipAriaLabel, chipTitle, bannerTitle, feedText, contextBody }) {
  const hay = [
    chipAriaLabel,
    chipTitle,
    bannerTitle,
    feedText,
    JSON.stringify(contextBody ?? {}),
  ].join("\n");
  if (!TRAVELER_MARKERS.test(hay)) {
    throw new Error(`traveler semantic marker missing (hay="${hay.slice(0, 200)}")`);
  }
}

async function readCouncilTravelerHaystack(page, contextBody) {
  const chip = page.locator('[data-testid="council-deliberation-chip"]');
  const chipAriaLabel = (await chip.getAttribute("aria-label").catch(() => "")) ?? "";
  const chipTitle =
    (await chip.locator(".council-deliberation-chip__title").textContent().catch(() => "")) ?? "";
  const bannerTitle =
    (await page.locator(".council-deliberation-banner__title").textContent().catch(() => "")) ??
    "";
  const feedText =
    (await page.locator('[data-testid="council-deliberation-feed"]').textContent().catch(() => "")) ??
    "";
  return { chipAriaLabel, chipTitle, bannerTitle, feedText, contextBody };
}

async function readNpcSnapshot(page) {
  return page.evaluate((canonicalIds) => {
    const fn = window.__aetherlife_npcDebug;
    if (typeof fn !== "function") {
      return { ok: false, reason: "__aetherlife_npcDebug missing (dev stack required)" };
    }
    const snap = fn();
    const npcs = snap?.npcs ?? [];
    const sprites = snap?.sprites ?? [];
    const councilIds = npcs.map((n) => n.id).filter((id) => canonicalIds.includes(id));
    const missing = canonicalIds.filter((id) => !councilIds.includes(id));
    const extra = councilIds.filter((id) => !canonicalIds.includes(id));
    const rosterOk = missing.length === 0 && extra.length === 0;
    return {
      ok: rosterOk && sprites.length >= canonicalIds.length,
      count: councilIds.length,
      spriteCount: sprites.length,
      missing,
      extra,
      npcs: npcs.map((n) => ({ id: n.id, x: n.x, y: n.y })),
    };
  }, [...COUNCIL_NPC_IDS]);
}

async function assertCouncilMapPresence(page) {
  let snap = await readNpcSnapshot(page);
  for (let attempt = 0; !snap.ok && attempt < 40; attempt += 1) {
    await page.waitForTimeout(500);
    snap = await readNpcSnapshot(page);
  }
  if (!snap.ok) {
    throw new Error(
      `MAP-05: expected canonical ${COUNCIL_NPC_IDS.length} council NPCs + sprites, got npcs=${snap.count} sprites=${snap.spriteCount} missing=${JSON.stringify(snap.missing ?? [])} extra=${JSON.stringify(snap.extra ?? [])} (${snap.reason ?? ""})`,
    );
  }
  console.log(
    `verify:phase26: map presence OK — ${snap.count} registry npcs, ${snap.spriteCount} sprites`,
  );
  return snap;
}

async function assertDualClientNpcSync(pageA, pageB) {
  const [a, b] = await Promise.all([readNpcSnapshot(pageA), readNpcSnapshot(pageB)]);
  if (!a.ok || !b.ok) {
    throw new Error(
      `dual-client npc debug failed: A=${a.reason ?? a.count} B=${b.reason ?? b.count}`,
    );
  }
  const bMap = new Map(b.npcs.map((n) => [n.id, n]));
  for (const id of COUNCIL_NPC_IDS) {
    const na = a.npcs.find((n) => n.id === id);
    const nb = bMap.get(id);
    if (!na || !nb || nb.x !== na.x || nb.y !== na.y) {
      throw new Error(
        `MP-11 sync mismatch ${id}: clientA(${na?.x ?? "?"},${na?.y ?? "?"}) vs clientB(${nb?.x ?? "?"},${nb?.y ?? "?"})`,
      );
    }
  }
  console.log(`verify:phase26: dual-client ${a.count} NPC positions synced (MP-11)`);
}

async function waitMoveIdle(page, timeoutMs = 60_000) {
  await page.waitForFunction(
    () => {
      const d = window.__aetherlife_moveDebug?.();
      return d != null && d.pending === 0 && !d.locomoting;
    },
    { timeout: timeoutMs },
  ).catch(() => undefined);
}

async function moveNearNpc(page, npcId) {
  await page.evaluate((id) => {
    const dbg = window.__aetherlife_npcDebug?.();
    const npc = dbg?.npcs?.find((n) => n.id === id);
    if (!npc) throw new Error(`npc ${id} not found in __aetherlife_npcDebug`);
    const fn = window.__aetherlife_sendMoveTo;
    if (typeof fn !== "function") {
      throw new Error("__aetherlife_sendMoveTo missing — use pnpm dev:stack (DEV build)");
    }
    fn(npc.x, npc.y + 1);
  }, npcId);
  await waitMoveIdle(page);
  await page.waitForTimeout(400);
}

async function engageCouncilNpc(page, npcId, timeoutMs) {
  const dialogueBar = page.locator('[data-testid="dialogue-bar"]');
  if (await dialogueBar.isVisible().catch(() => false)) return;

  const cornerMenu = page.locator('[data-testid="corner-menu"]');
  await cornerMenu.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-testid="corner-menu"] .corner-menu__status-dot--ok'),
      ),
    { timeout: 45_000 },
  );

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await dialogueBar.isVisible().catch(() => false)) return;
    await cornerMenu.locator(".corner-menu__trigger").click();
    const chip = page.locator(`#npc-avatar-${npcId}`);
    try {
      await chip.waitFor({ state: "visible", timeout: 12_000 });
      await chip.click();
      await dialogueBar.waitFor({ state: "visible", timeout: 8_000 });
      return;
    } catch {
      await page.waitForTimeout(400);
    }
  }
  throw new Error(`engageCouncilNpc: dialogue-bar not visible for ${npcId} within ${timeoutMs}ms`);
}

async function speakToCouncilNpc(page, npcId, text) {
  await moveNearNpc(page, npcId);
  await page.waitForTimeout(600);
  await closeShellDrawer(page);
  await engageCouncilNpc(page, npcId, engageTimeoutMs);
  const reply = await sendSpeakOverlay(page, text, {
    speakTimeoutMs,
    engageTimeoutMs,
    skipEngage: true,
  });
  console.log(
    `verify:phase26: speak ${npcId} speakMs=${reply.speakMs} reply="${reply.reply.slice(0, 60)}"`,
  );
  return reply;
}

function runLeaningDriftPytest() {
  if (process.env.SKIP_LEANING_DRIFT_PYTEST === "1") {
    console.log("verify:phase26: SKIP_LEANING_DRIFT_PYTEST=1 — skipping drift pytest");
    return;
  }
  const workerDir = resolve(root, "workers/agent-worker");
  const result = spawnSync("uv", ["run", "pytest", "tests/test_leaning_drift.py", "-q"], {
    cwd: workerDir,
    env: { ...process.env, LLM_MOCK: "1" },
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    console.warn(
      `verify:phase26: leaning_drift pytest failed (non-fatal for MAP-05): ${result.stderr || result.stdout}`,
    );
    return;
  }
  console.log("verify:phase26: leaning_drift pytest OK (mock, REL-08 unit guard)");
}

async function main() {
  const t0 = Date.now();
  assertE2eNoMock("verify:phase26");
  assertE2eRealLlm("verify:phase26");
  console.log(
    `verify:phase26 → ${webUrl} timeoutMs=${phaseTimeoutMs} WORLD_SEED=${process.env.WORLD_SEED}`,
  );

  runLeaningDriftPytest();
  const migrate = spawnSync("pnpm", ["--filter", "@aetherlife/npc-memory", "db:migrate"], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (migrate.status !== 0) {
    throw new Error(`db:migrate failed (npc_leaning_drift required): ${migrate.stderr || migrate.stdout}`);
  }
  console.log("verify:phase26: db:migrate OK");
  await healthOk();

  const playerId = `verifyp26${String(Date.now()).slice(-10)}`;
  const playerIdB = `verifyp26b${String(Date.now()).slice(-9)}`;
  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });

  try {
    const contextA = await browser.newContext();
    await contextA.addInitScript(
      ({ key, id }) => {
        localStorage.setItem(key, id);
      },
      { key: "aetherlife:playerId", id: playerId },
    );
    const page = await contextA.newPage();
    page.setDefaultTimeout(speakTimeoutMs);

    const contextB = await browser.newContext();
    await contextB.addInitScript(
      ({ key, id }) => {
        localStorage.setItem(key, id);
      },
      { key: "aetherlife:playerId", id: playerIdB },
    );
    const pageB = await contextB.newPage();

    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await pageB.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });

    for (const p of [page, pageB]) {
      await p.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
        state: "visible",
        timeout: 45_000,
      });
      await p.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
      await waitCornerMenuConnected(p);
    }
    await engageDialogue(page, { timeoutMs: engageTimeoutMs });
    console.log("verify:phase26: room boot OK (dual client)");

    await assertCouncilMapPresence(page);
    await assertCouncilMapPresence(pageB);
    await maybeShot(page, "01-map-12-npcs");
    await assertDualClientNpcSync(page, pageB);
    await maybeShot(page, "02-dual-client-sync");

    for (const npcId of SPEAK_NPC_IDS) {
      await speakToCouncilNpc(page, npcId, `你好，${npcId}，请简单回应我。`);
      await maybeShot(page, `03-speak-${npcId}`);
    }
    console.log(`verify:phase26: ≥3 council speak OK (${SPEAK_NPC_IDS.join(", ")})`);

    const rudeReply = await sendSpeakOverlay(page, "你真没礼貌，滚开", {
      speakTimeoutMs,
      engageTimeoutMs,
    });
    console.log(
      `verify:phase26: rudeSpeakMs=${rudeReply.speakMs} reply="${rudeReply.reply.slice(0, 60)}"`,
    );

    await waitFor(
      async () =>
        latestEventOfKind(
          (await fetchCollectiveState(playerId)).recentEvents,
          playerId,
          "rude",
        ),
      BANNER_WAIT_MS,
      "collective rude event in API",
    ).catch(() => {
      console.warn(
        "verify:phase26: WARN no rude collective event within banner wait — worker tail may lag; continuing",
      );
    });

    const seedReply = await sendSpeakOverlay(
      page,
      "请记住议会应关注旅者诉求与始源区秩序",
      { speakTimeoutMs, engageTimeoutMs },
    );
    console.log(
      `verify:phase26: seedSpeakMs=${seedReply.speakMs} reply="${seedReply.reply.slice(0, 60)}"`,
    );

    const voteCtxBefore = await fetchWorldVoteContext();
    console.log(
      `verify:phase26: vote context summaries=${(voteCtxBefore.collectiveSummaries ?? []).length}`,
    );

    const remainingMs = () => Math.max(30_000, phaseTimeoutMs - (Date.now() - t0));

    await waitFor(
      async () => {
        const ctx = await fetchWorldVoteContext();
        return (ctx.collectiveSummaries?.length ?? 0) >= 1;
      },
      Math.min(120_000, remainingMs()),
      "world-vote context collectiveSummaries ≥1",
    );

    await triggerWorldVote();

    await waitFor(
      async () => page.locator('[data-testid="council-deliberation-chip"]').isVisible(),
      remainingMs(),
      "council-deliberation-chip",
    );
    console.log("verify:phase26: deliberation chip visible");

    await openShellDrawerCouncil(page);

    await waitFor(
      async () => page.locator('[data-testid="council-deliberation-banner"]').isVisible(),
      remainingMs(),
      "council-deliberation-banner",
    );
    await waitFor(
      async () => page.locator('[data-testid="council-deliberation-progress"]').isVisible(),
      remainingMs(),
      "council-deliberation-progress",
    );
    await waitFor(
      async () => {
        const feed = page.locator('[data-testid="council-deliberation-feed"] li');
        return (await feed.count()) >= 1;
      },
      remainingMs(),
      "council-deliberation-feed ≥1 quote row",
    );

    await waitFor(
      async () => {
        const voteCtx = await fetchWorldVoteContext();
        const haystack = await readCouncilTravelerHaystack(page, voteCtx);
        const probe = [
          haystack.chipAriaLabel,
          haystack.chipTitle,
          haystack.bannerTitle,
          haystack.feedText,
          JSON.stringify(voteCtx ?? {}),
        ].join("\n");
        return TRAVELER_MARKERS.test(probe);
      },
      remainingMs(),
      "traveler semantics in council UI",
    );
    const voteCtxDuring = await fetchWorldVoteContext();
    const haystack = await readCouncilTravelerHaystack(page, voteCtxDuring);
    assertTravelerSemantics({ ...haystack, contextBody: voteCtxDuring });
    console.log("verify:phase26: traveler semantics OK");

    await waitFor(
      async () => {
        const toast = page.locator('[data-testid="council-vote-toast"]');
        if (!(await toast.isVisible().catch(() => false))) return false;
        const title =
          (await toast.locator(".council-vote-toast__title").textContent().catch(() => "")) ?? "";
        return /廷议通过|提案未采纳|纪元大议落槌/.test(title);
      },
      remainingMs(),
      "council-vote-toast result (accepted/rejected/epoch)",
    );
    console.log("verify:phase26: vote result toast visible");
    await maybeShot(page, "04-vote-result-toast");

    await openShellDrawerCollective(page);
    let collectiveOk = false;
    try {
      await waitFor(
        async () => {
          const events = page.locator('[data-testid="collective-recent-events"] li');
          return (await events.count()) > 0;
        },
        Math.min(60_000, remainingMs()),
        "collective-recent-events after vote",
      );
      collectiveOk = true;
    } catch {
      const state = await fetchCollectiveState(playerId);
      if ((state.recentEvents?.length ?? 0) > 0) {
        console.warn(
          "verify:phase26: collective drawer empty — API has recentEvents (UI lag OK)",
        );
        collectiveOk = true;
      }
    }
    if (!collectiveOk) {
      throw new Error("collective-recent-events empty in drawer and API after vote");
    }
    await closeShellDrawer(page);

    await contextB.close();
  } finally {
    await browser.close();
  }

  const wallMs = Date.now() - t0;
  console.log(`verify:phase26 OK (${Math.round(wallMs / 1000)}s)`);
}

main().catch((err) => {
  console.error(`verify:phase26 failed: ${err.message}`);
  console.error("Ensure full stack: pnpm dev:stack (no LLM_MOCK). Game-server :2567, web :5173.");
  process.exit(1);
});
