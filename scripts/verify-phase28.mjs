/**
 * Phase 28 E2E — Council relationship advanced ship gate (D-VERIFY-01).
 *
 * Flow: assertE2eRealLlm → health → dedicated room → wait band-mapped GET →
 * force mutual-chat present (activity + bubble) → Playwright「关系网」band chips
 * (no raw affection/trust integers).
 *
 * Speak RAG: covered by worker unit tests (LLM_MOCK OK) — not required live here.
 * Decay + player caps: unit-only (D-VERIFY-02).
 *
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real API keys in .env.
 * Never run with LLM_MOCK=1 or dev:stack:mock — see docs/E2E-POLICY.md.
 *
 * Timeout: VERIFY_PHASE28_TIMEOUT_MS (default 900000).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertE2eRealLlm } from "./lib/e2e-policy.mjs";
import { engageDialogue } from "./lib/dialogue-engage.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";
import { loadPlaywright } from "./lib/speak-browser-stack.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE28_ROOM_ID || `verify-p28-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const phaseTimeoutMs =
  Number.parseInt(process.env.VERIFY_PHASE28_TIMEOUT_MS || "900000", 10) || 900_000;

const BAND_LABELS = new Set(["敌对", "冷淡", "平常", "亲近", "亲密"]);
const MUTUAL_REASON_RE = /交谈/;

/** @returns {Record<string, string>} */
function internalHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function publicHeaders(playerId = "verify-p28-player") {
  return { "X-Player-Id": playerId };
}

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await fn()) return;
    } catch {
      // Transient fetch/UI errors — keep polling.
    }
    await new Promise((r) => setTimeout(r, 1500));
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

async function ensureRoom() {
  const res = await fetch(`${httpBase}/rooms/${encodeURIComponent(roomId)}/state`, {
    headers: publicHeaders("__legacy__"),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`room state ${res.status}`);
}

async function fetchNpcRelationships() {
  const res = await fetch(
    `${httpBase}/rooms/${encodeURIComponent(roomId)}/npc-relationships`,
    {
      headers: publicHeaders("__legacy__"),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`npc-relationships → ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return Array.isArray(body.edges) ? body.edges : [];
}

async function fetchRoomState() {
  const res = await fetch(`${httpBase}/rooms/${encodeURIComponent(roomId)}/state`, {
    headers: publicHeaders("__legacy__"),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`room state ${res.status}`);
  return res.json();
}

/** D-GRAPH-02 / C-09b: band-mapped edges only — no affection/trust ints in payload. */
function assertBandMappedEdges(edges) {
  if (edges.length < 1) {
    throw new Error("npc-relationships returned 0 edges (seed incomplete?)");
  }
  for (const edge of edges.slice(0, 20)) {
    if ("affection" in edge || "trust" in edge) {
      throw new Error(
        `public GET leaked raw affection/trust: ${JSON.stringify(edge).slice(0, 200)}`,
      );
    }
    if (!edge.band || !BAND_LABELS.has(String(edge.bandLabelZh || ""))) {
      throw new Error(
        `edge missing band/bandLabelZh: ${JSON.stringify(edge).slice(0, 200)}`,
      );
    }
  }
  console.log(
    `[verify:phase28] npc-relationships band-mapped OK edges=${edges.length} sample=${edges[0].bandLabelZh}`,
  );
}

/**
 * Force mutual-chat presentation (hammer path) — activity + bubble smoke (D-MUTUAL-02).
 * Live ambient enqueue may be slow; internal present is the deterministic E2E force.
 */
async function forceMutualChatPresent() {
  const res = await fetch(
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/npc-mutual-chat/present`,
    {
      method: "POST",
      headers: internalHeaders(),
      body: JSON.stringify({
        npcAId: "npc-1",
        npcBId: "npc-2",
        npcAReasonZh: "与琳交谈中",
        npcBReasonZh: "与艾交谈中",
        bubbleText: "今日议事如何？",
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `npc-mutual-chat/present → ${res.status}: ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  if (!body.ok || !body.bubble?.text) {
    throw new Error(`present missing bubble: ${JSON.stringify(body).slice(0, 300)}`);
  }
  console.log(
    `[verify:phase28] mutual-chat present OK bubble="${body.bubble.text}" expiresAt=${body.bubble.expiresAt}`,
  );
  return body.bubble;
}

async function assertMutualChatActivitySmoke(remainingMs) {
  await forceMutualChatPresent();

  await waitFor(
    async () => {
      const data = await fetchRoomState();
      const npcs = data?.state?.npcs;
      if (!Array.isArray(npcs)) return false;
      const a = npcs.find((n) => n.id === "npc-1");
      const b = npcs.find((n) => n.id === "npc-2");
      if (!a || !b) return false;
      return (
        MUTUAL_REASON_RE.test(String(a.intentReasonZh || "")) &&
        MUTUAL_REASON_RE.test(String(b.intentReasonZh || ""))
      );
    },
    Math.min(30_000, Math.max(8_000, remainingMs())),
    "npc-1/npc-2 intentReasonZh mutual-chat activity",
  );

  console.log(
    "[verify:phase28] mutual-chat activity smoke OK (intentReasonZh 交谈中 on npc-1 + npc-2)",
  );
  console.log(
    "[verify:phase28] note: speak RAG covered by workers/agent-worker/tests/test_relationship_rag.py (LLM_MOCK OK); optional live natural reference skipped",
  );
}

/**
 * Playwright: Drawer「关系网」tab + band chips; no raw integers in panel DOM (D-GRAPH-01/02).
 */
async function assertRelationshipGraphUi(remainingMs) {
  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    await page.locator('[data-testid="immersive-shell"]').waitFor({
      state: "visible",
      timeout: Math.min(60_000, remainingMs()),
    });
    await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
      state: "visible",
      timeout: Math.min(60_000, remainingMs()),
    });

    const drawer = page.locator('[data-testid="shell-drawer"]');
    if (!(await drawer.isVisible().catch(() => false))) {
      // DialogueBar (关系网 entry) is only visible when dialogue-overlay is engaged.
      await engageDialogue(page, { timeoutMs: Math.min(90_000, remainingMs()) });
      await page.locator('[aria-label="关系网"]').click();
    } else {
      await page.locator('[data-testid="shell-drawer-tab-relationships"]').click();
    }

    await drawer.waitFor({ state: "visible", timeout: 15_000 });
    await page.locator('[data-testid="shell-drawer-tab-relationships"]').waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await page.locator('[data-testid="relationship-graph-panel"]').waitFor({
      state: "visible",
      timeout: Math.min(45_000, remainingMs()),
    });

    // Wait until edges render (seed + GET) — loading → chips or empty.
    await waitFor(
      async () => {
        const chips = page.locator('[data-testid="relationship-graph-band-chip"]');
        return (await chips.count()) >= 1;
      },
      Math.min(90_000, remainingMs()),
      "relationship-graph-band-chip visible",
    );

    const chips = page.locator('[data-testid="relationship-graph-band-chip"]');
    const chipCount = await chips.count();
    const labels = [];
    for (let i = 0; i < Math.min(chipCount, 12); i++) {
      const text = ((await chips.nth(i).textContent()) || "").trim();
      labels.push(text);
      if (!BAND_LABELS.has(text)) {
        throw new Error(`band chip unexpected label="${text}" (expected 敌对|冷淡|平常|亲近|亲密)`);
      }
    }

    const panelText =
      (await page.locator('[data-testid="relationship-graph-panel"]').innerText()) || "";
    // D-GRAPH-02: no raw affection/trust scores in panel copy (band chips are ZH labels only).
    const rawScoreHits = panelText.match(
      /(?:affection|trust|好感度?|信任度?)\s*[=:：]?\s*-?\d+/gi,
    );
    if (rawScoreHits?.length) {
      throw new Error(`关系网 panel leaked raw score text: ${rawScoreHits.join(", ")}`);
    }
    for (const label of labels) {
      if (/\d/.test(label)) {
        throw new Error(`band chip must be ZH label only, got "${label}"`);
      }
    }

    const toggle = page.locator('[data-testid="relationship-graph-mode-toggle"]');
    if ((await toggle.count()) > 0) {
      await toggle.first().click();
      console.log("[verify:phase28] relationship-graph-mode-toggle clicked");
    }

    console.log(
      `[verify:phase28] 关系网 UI OK chips=${chipCount} labels=${labels.slice(0, 5).join(",")}`,
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  const t0 = Date.now();
  assertE2eRealLlm("verify:phase28");
  const remainingMs = () => Math.max(10_000, phaseTimeoutMs - (Date.now() - t0));

  console.log(
    `[verify:phase28] room=${roomId} http=${httpBase} web=${webUrl} timeoutMs=${phaseTimeoutMs}`,
  );

  await healthOk();
  console.log("[verify:phase28] health ok");

  await ensureRoom();
  console.log("[verify:phase28] room ready");

  // Seeds land async after getOrCreate (66 council edges).
  await waitFor(
    async () => {
      const edges = await fetchNpcRelationships();
      return edges.length >= 12;
    },
    Math.min(180_000, remainingMs()),
    "npc-relationships ≥12 band edges seeded",
  );
  const edges = await fetchNpcRelationships();
  assertBandMappedEdges(edges);

  await assertMutualChatActivitySmoke(remainingMs);
  await assertRelationshipGraphUi(remainingMs);

  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[verify:phase28] PASS in ${elapsedSec}s`);
}

main().catch((err) => {
  console.error("[verify:phase28] FAIL:", err instanceof Error ? err.message : err);
  console.error("Ensure full stack: pnpm dev:stack (no LLM_MOCK). Game-server :2567, web :5173.");
  process.exit(1);
});
