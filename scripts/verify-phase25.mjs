/**
 * Phase 25 E2E — Council vote & debate loop (SOCIETY-02, VOTE-06…09, REL-05).
 *
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real API keys in .env.
 * Never run with LLM_MOCK=1 or dev:stack:mock — see docs/E2E-POLICY.md.
 *
 * Flow: health → dedicated room → collective+speak seed → force world-vote trigger →
 * council UI testids → traveler semantics → vote toast → chronicle minutes →
 * relationship delta → canon speak heuristic.
 *
 * Timeout: VERIFY_PHASE25_TIMEOUT_MS (default 900000 — 5–15 min real LLM).
 */
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE25_ROOM_ID || `verify-p25-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const speakTimeoutMs = Math.max(90_000, e2eSpeakTimeoutMs());
const engageTimeoutMs = Math.max(90_000, speakTimeoutMs / 2);
const phaseTimeoutMs =
  Number.parseInt(process.env.VERIFY_PHASE25_TIMEOUT_MS || "900000", 10) || 900_000;
const BANNER_WAIT_MS = Number.parseInt(process.env.E2E_BANNER_WAIT_MS || "", 10) || 60_000;

/** Genesis / chronicle canon substring heuristic (SOCIETY-02). */
const CANON_HEURISTIC =
  /万界崩裂|始源区|十二议会|太乙万界|崩裂纪|位面|Beginning Fields|诸界/i;

/** Traveler semantic markers (D-VOTE-PLAY-06). */
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
    if (await fn()) return;
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
  const res = await fetch(
    `${httpBase}/rooms/${encodeURIComponent(roomId)}/collective-state?${qs}`,
    { headers: { "X-Player-Id": playerId, "Cache-Control": "no-cache" } },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`collective-state → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function fetchNpcRelationships() {
  const res = await fetch(
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/npc-relationships`,
    { headers: internalHeaders() },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`npc-relationships → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body.edges ?? [];
}

async function fetchWorldVoteContext() {
  const res = await fetch(
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/world-vote/context`,
    { headers: internalHeaders() },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`world-vote/context → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function affectionMap(edges) {
  const map = new Map();
  for (const edge of edges) {
    map.set(`${edge.npcAId}:${edge.npcBId}`, edge.affection);
  }
  return map;
}

function findAffectionDelta(before, after) {
  for (const [key, affBefore] of before) {
    const affAfter = after.get(key);
    if (affAfter !== undefined && affAfter !== affBefore) {
      return { key, affBefore, affAfter };
    }
  }
  return null;
}

async function triggerWorldVote() {
  const res = await fetch(
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
  console.log(`verify:phase25: vote triggered jobId=${body.jobId ?? "?"}`);
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

async function openShellDrawerOnTab(page, tabId) {
  const drawer = page.locator('[data-testid="shell-drawer"]');
  if (!(await drawer.isVisible().catch(() => false))) {
    const chip = page.locator('[data-testid="council-deliberation-chip"]');
    if (tabId === "council" && (await chip.isVisible().catch(() => false))) {
      await chip.click();
    } else {
      await engageDialogue(page, { timeoutMs: 45_000 });
      await page.locator('[aria-label="对话历史"]').click();
    }
  }
  await drawer.waitFor({ state: "visible", timeout: 10_000 });
  await page.locator(`#shell-drawer-tab-${tabId}`).click();
  await page.locator(`#shell-drawer-panel-${tabId}`).waitFor({
    state: "visible",
    timeout: 10_000,
  });
}

function assertTravelerSemantics({ chipTitle, feedText, contextBody }) {
  const hay = [chipTitle, feedText, JSON.stringify(contextBody ?? {})].join("\n");
  if (!TRAVELER_MARKERS.test(hay)) {
    throw new Error(`traveler semantic marker missing (hay="${hay.slice(0, 200)}")`);
  }
}

async function main() {
  const t0 = Date.now();
  assertE2eNoMock("verify:phase25");
  assertE2eRealLlm("verify:phase25");
  console.log(
    `verify:phase25 → ${webUrl} timeoutMs=${phaseTimeoutMs} WORLD_SEED=${process.env.WORLD_SEED}`,
  );
  await healthOk();

  const playerId = `verifyp25${String(Date.now()).slice(-10)}`;
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

    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
      state: "visible",
      timeout: 45_000,
    });
    await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
    await waitCornerMenuConnected(page);
    await engageDialogue(page, { timeoutMs: engageTimeoutMs });
    console.log("verify:phase25: room boot OK");

    await waitFor(
      async () => (await fetchNpcRelationships()).length >= 1,
      120_000,
      "npc_relationships seeded for room",
    );

    const edgesBefore = await fetchNpcRelationships();
    const affBefore = affectionMap(edgesBefore);
    console.log(`verify:phase25: relationship snapshot before vote (${edgesBefore.length} edges)`);

    const rudeReply = await sendSpeakOverlay(page, "你真没礼貌，滚开", {
      speakTimeoutMs,
      engageTimeoutMs,
    });
    console.log(
      `verify:phase25: rudeSpeakMs=${rudeReply.speakMs} reply="${rudeReply.reply.slice(0, 60)}"`,
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
    );

    const seedReply = await sendSpeakOverlay(
      page,
      "请记住议会应关注旅者诉求与始源区秩序",
      { speakTimeoutMs, engageTimeoutMs },
    );
    console.log(
      `verify:phase25: seedSpeakMs=${seedReply.speakMs} reply="${seedReply.reply.slice(0, 60)}"`,
    );

    const voteCtxBefore = await fetchWorldVoteContext();
    console.log(
      `verify:phase25: vote context summaries=${(voteCtxBefore.collectiveSummaries ?? []).length}`,
    );

    await triggerWorldVote();

    const remainingMs = () => Math.max(30_000, phaseTimeoutMs - (Date.now() - t0));

    await waitFor(
      async () => page.locator('[data-testid="council-deliberation-chip"]').isVisible(),
      remainingMs(),
      "council-deliberation-chip",
    );
    console.log("verify:phase25: deliberation chip visible");

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

    const chipTitle =
      (await page.locator('[data-testid="council-deliberation-chip"] .council-deliberation-chip__title').textContent().catch(() => "")) ??
      "";
    const feedText =
      (await page.locator('[data-testid="council-deliberation-feed"]').textContent().catch(() => "")) ??
      "";
    const voteCtxDuring = await fetchWorldVoteContext();
    assertTravelerSemantics({
      chipTitle: chipTitle.trim(),
      feedText: feedText.trim(),
      contextBody: voteCtxDuring,
    });
    console.log("verify:phase25: traveler semantics OK");

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
    console.log("verify:phase25: vote result toast visible");

    await openShellDrawerOnTab(page, "council");
    await waitFor(
      async () =>
        page.locator('[data-testid="shell-drawer-tab-chronicle-unread"]').isVisible(),
      30_000,
      "shell-drawer-tab-chronicle-unread before chronicle open",
    );
    console.log("verify:phase25: chronicle unread badge OK");

    await closeShellDrawer(page);
    await page.locator('[data-testid="council-vote-toast"]').click();
    await page.locator('[data-testid="world-history-minutes-modal"]').waitFor({
      state: "visible",
      timeout: 30_000,
    });
    const ballotCards = page.locator(
      '[data-testid="world-history-minutes-ballots"] .world-history-minutes-modal__card',
    );
    const ballotCount = await ballotCards.count();
    if (ballotCount !== 11) {
      throw new Error(`world-history-minutes-ballots expected 11 cards, got ${ballotCount}`);
    }
    const debateExcerpts = page.locator(
      '[data-testid="world-history-minutes-debate-excerpts"] li',
    );
    const excerptCount = await debateExcerpts.count();
    console.log(`verify:phase25: minutes modal 11 ballots OK; debate excerpts=${excerptCount}`);

    await page.keyboard.press("Escape");
    const minutesModal = page.locator('[data-testid="world-history-minutes-modal"]');
    await minutesModal.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    const minutesBackdrop = page.locator('[data-testid="world-history-minutes-backdrop"]');
    if (await minutesBackdrop.isVisible().catch(() => false)) {
      await minutesBackdrop.click({ position: { x: 8, y: 8 } });
      await minutesModal.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    }

    await openShellDrawerOnTab(page, "chronicle");
    await closeShellDrawer(page);

    const unreadAfter = await page
      .locator('[data-testid="shell-drawer-tab-chronicle-unread"]')
      .isVisible()
      .catch(() => false);
    if (unreadAfter) {
      throw new Error("chronicle unread badge should clear after opening chronicle tab");
    }
    console.log("verify:phase25: chronicle unread cleared after open");

    const chip = page.locator('[data-testid="council-deliberation-chip"]');
    if (await chip.isVisible().catch(() => false)) {
      await chip.click();
    } else {
      await engageDialogue(page, { timeoutMs: engageTimeoutMs });
      await page.locator('[aria-label="对话历史"]').click();
    }
    const drawer = page.locator('[data-testid="shell-drawer"]');
    await drawer.waitFor({ state: "visible", timeout: 10_000 });
    await page.locator("#shell-drawer-tab-council").click();
    await page.locator("#shell-drawer-panel-council").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    const rosterDetails = page.locator('[data-testid="council-roster-row"] details');
    await rosterDetails.first().waitFor({ state: "attached", timeout: 10_000 });
    const detailCount = await rosterDetails.count();
    for (let i = 0; i < detailCount; i++) {
      await rosterDetails.nth(i).evaluate((el) => {
        el.open = true;
      });
    }
    try {
      await waitFor(
        async () =>
          page.locator('[data-testid="council-roster-relationship-hint"]').first().isVisible(),
        10_000,
        "council-roster-relationship-hint after vote",
      );
      console.log("verify:phase25: roster relationship hint OK");
    } catch {
      console.log("verify:phase25: roster hint absent (REL-05 uses API delta)");
    }

    await closeShellDrawer(page);

    const edgesAfter = await fetchNpcRelationships();
    const affAfter = affectionMap(edgesAfter);
    const delta = findAffectionDelta(affBefore, affAfter);
    if (!delta) {
      throw new Error("REL-05: no npc_relationships affection delta after vote");
    }
    console.log(
      `verify:phase25: affection delta ${delta.key} ${delta.affBefore}→${delta.affAfter}`,
    );

    await engageDialogue(page, { timeoutMs: engageTimeoutMs });
    const { reply: canonReply } = await sendSpeakOverlay(
      page,
      "议会记载的万界崩裂纪和始源区是怎么来的？",
      { speakTimeoutMs, engageTimeoutMs },
    );
    console.log(`verify:phase25: canonSpeak reply="${canonReply.slice(0, 100)}"`);
    if (!CANON_HEURISTIC.test(canonReply)) {
      throw new Error(
        `canon reply missing heuristic match: "${canonReply.slice(0, 160)}"`,
      );
    }
    console.log("verify:phase25: canon speak heuristic OK");

    await openShellDrawerCollective(page);
    await waitFor(
      async () => {
        const events = page.locator('[data-testid="collective-recent-events"] li');
        return (await events.count()) > 0;
      },
      30_000,
      "collective-recent-events still visible after vote",
    );
    await closeShellDrawer(page);
  } finally {
    await browser.close();
  }

  const wallMs = Date.now() - t0;
  console.log(`verify:phase25 OK (${Math.round(wallMs / 1000)}s)`);
}

main().catch((err) => {
  console.error(`verify:phase25 failed: ${err.message}`);
  console.error("Ensure full stack: pnpm dev:stack (no LLM_MOCK). Game-server :2567, web :5173.");
  process.exit(1);
});
