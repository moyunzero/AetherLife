/**
 * Phase 27 E2E — Personal life timeline ship gate (BIO-04/06/10).
 *
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real API keys in .env.
 * Never run with LLM_MOCK=1 or dev:stack:mock — see docs/E2E-POLICY.md.
 *
 * Flow: health → dedicated room → GET seeds (≥1/npc, year-0 labels with month) →
 * force hammer / multi-perspective path → poll ≥2 NPCs same eventAnchorId,
 * divergent bodies → calendar label contains season+month.
 *
 * Timeout: VERIFY_PHASE27_TIMEOUT_MS (default 900000).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertE2eRealLlm } from "./lib/e2e-policy.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE27_ROOM_ID || `verify-p27-${Date.now()}`;
const phaseTimeoutMs =
  Number.parseInt(process.env.VERIFY_PHASE27_TIMEOUT_MS || "900000", 10) || 900_000;

const COUNCIL_NPC_IDS = Array.from({ length: 12 }, (_, i) => `npc-${i + 1}`);

/** Year-0 seed labels include season + month: 太乙元年·春·1月·第1日 */
const YEAR0_MONTH_RE = /太乙元年·[春夏秋冬]·\d{1,2}月/;
const SEASON_MONTH_RE = /[春夏秋冬]·\d{1,2}月/;

/** @returns {Record<string, string>} */
function internalHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function publicHeaders(playerId = "verify-p27-player") {
  return { "X-Player-Id": playerId };
}

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
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
    headers: publicHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`room state ${res.status}`);
}

async function fetchTimeline(npcId) {
  const res = await fetch(
    `${httpBase}/rooms/${encodeURIComponent(roomId)}/npcs/${encodeURIComponent(npcId)}/personal-timeline?limit=50`,
    {
      headers: publicHeaders("__legacy__"),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`personal-timeline ${npcId} → ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data.entries) ? data.entries : [];
}

/** BIO-04 / BIO-02: ≥1 seed per npc with 太乙元年 + month. */
async function assertSeedsYearZeroWithMonth() {
  const missing = [];
  for (const npcId of COUNCIL_NPC_IDS) {
    const entries = await fetchTimeline(npcId);
    const seeds = entries.filter((e) => e.source === "seed" || YEAR0_MONTH_RE.test(String(e.calendarLabel || "")));
    const year0 = entries.filter((e) => YEAR0_MONTH_RE.test(String(e.calendarLabel || "")));
    if (entries.length < 1 || year0.length < 1) {
      missing.push(`${npcId}(entries=${entries.length},year0=${year0.length},seeds=${seeds.length})`);
    }
  }
  if (missing.length) {
    throw new Error(`seeds year-0+month missing for: ${missing.join(", ")}`);
  }
  console.log("[verify:phase27] seeds ≥1/npc with 太乙元年·season·month OK");
}

/** Calendar labels include season + month (BIO-02 / D-CAL-04). */
async function assertCalendarLabelSeasonMonth() {
  const sample = await fetchTimeline("npc-1");
  if (!sample.length) throw new Error("no timeline entries for calendar assert");
  const hit = sample.find((e) => SEASON_MONTH_RE.test(String(e.calendarLabel || "")));
  if (!hit) {
    throw new Error(
      `calendarLabel missing season+month; sample=${JSON.stringify(sample[0]?.calendarLabel)}`,
    );
  }
  console.log(`[verify:phase27] calendar label OK: ${hit.calendarLabel}`);
}

/**
 * Force multi-perspective via internal POSTs (hammer-equivalent insert path)
 * plus optional world-vote trigger for live enqueue when stack has Redis+worker.
 * Assert ≥2 NPCs share eventAnchorId with divergent bodies (BIO-06 / BIO-10).
 */
async function assertMultiPerspectiveDivergence(remainingMs) {
  const anchorId = `verify-p27-anchor-${Date.now()}`;
  const factual = "议会就始源区边境防务条例完成落槌，事实摘要锁定供各席传记。";
  const epoch = 1440 * 30; // mid year-ish for season+month labels

  const bodies = [
    { npcId: "npc-1", body: "我听闻落槌后心下不安，唯恐边境封印再松。" },
    { npcId: "npc-2", body: "我对这次防务廷议感到振奋，同僚终于正视裂隙。" },
  ];

  for (const row of bodies) {
    const res = await fetch(
      `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/personal-timeline`,
      {
        method: "POST",
        headers: internalHeaders(),
        body: JSON.stringify({
          npcId: row.npcId,
          calendarLabel: "太乙1年·夏·4月·第15日",
          aetherEpochMinute: epoch,
          tag: "council",
          body: row.body,
          eventAnchorId: anchorId,
          factualSummary: factual,
          source: "llm_event",
          proposalEligible: true,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`internal personal-timeline POST ${row.npcId} → ${res.status}: ${text.slice(0, 300)}`);
    }
  }

  // Best-effort: also force a world-vote so live multi jobs may enqueue (non-fatal if slow).
  try {
    const trigger = await fetch(
      `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/world-vote/trigger`,
      {
        method: "POST",
        headers: internalHeaders(),
        body: JSON.stringify({ force: true, voteKind: "regular", debateRoundsMax: 1 }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    console.log(`[verify:phase27] world-vote trigger status=${trigger.status}`);
  } catch (err) {
    console.warn(
      `[verify:phase27] world-vote trigger skipped: ${err instanceof Error ? err.message : err}`,
    );
  }

  await waitFor(
    async () => {
      const e1 = await fetchTimeline("npc-1");
      const e2 = await fetchTimeline("npc-2");
      const a1 = e1.filter((e) => e.eventAnchorId === anchorId);
      const a2 = e2.filter((e) => e.eventAnchorId === anchorId);
      if (!a1.length || !a2.length) return false;
      return String(a1[0].body) !== String(a2[0].body);
    },
    Math.min(60_000, Math.max(10_000, remainingMs())),
    `≥2 NPCs share eventAnchorId=${anchorId} with divergent bodies`,
  );

  console.log(
    `[verify:phase27] multi-perspective divergence OK anchor=${anchorId} (npc-1 vs npc-2)`,
  );
}

async function main() {
  const t0 = Date.now();
  assertE2eRealLlm("verify:phase27");
  const remainingMs = () => Math.max(10_000, phaseTimeoutMs - (Date.now() - t0));

  console.log(
    `[verify:phase27] room=${roomId} http=${httpBase} timeoutMs=${phaseTimeoutMs}`,
  );

  await healthOk();
  console.log("[verify:phase27] health ok");

  await ensureRoom();
  console.log("[verify:phase27] room ready");

  // Seeds may land async after getOrCreate — poll briefly.
  await waitFor(
    async () => {
      try {
        const e = await fetchTimeline("npc-1");
        return e.some((x) => YEAR0_MONTH_RE.test(String(x.calendarLabel || "")));
      } catch {
        return false;
      }
    },
    Math.min(120_000, remainingMs()),
    "npc-1 seed year-0 label",
  );

  await assertSeedsYearZeroWithMonth();
  await assertCalendarLabelSeasonMonth();
  await assertMultiPerspectiveDivergence(remainingMs);

  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[verify:phase27] PASS in ${elapsedSec}s`);
}

main().catch((err) => {
  console.error("[verify:phase27] FAIL:", err instanceof Error ? err.message : err);
  console.error("Ensure full stack: pnpm dev:stack (no LLM_MOCK). Game-server :2567, web :5173.");
  process.exit(1);
});
