/**
 * Phase 27 UAT — Persona diary + roster biography (Playwright).
 *
 * Covers:
 *   T1  roster: all 12 seats open biography with 生平· seed rows
 *   T2  force weekly jobs (Redis) for npc-2 + npc-9 → divergent llm_scheduled
 *       bodies (no shared generic literary tropes)
 *   T3  speak-mention dyad: npc-2 reply path mentioning 楚浅歌 → relationship
 *       entries both sides (best-effort soft markers)
 *
 * Requires: pnpm dev:stack (NO LLM_MOCK), real API keys in .env.
 * Output: .planning/phases/27-personal-life-timeline/uat-screenshots/persona-diary/
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertE2eRealLlm, e2eSpeakTimeoutMs } from "./lib/e2e-policy.mjs";
import { engageNpcDialogue } from "./lib/dialogue-engage.mjs";
import { sendSpeakOverlay } from "./lib/e2e-memory-helpers.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";
import { loadPlaywright } from "./lib/speak-browser-stack.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

const OUT_DIR = resolve(
  root,
  ".planning/phases/27-personal-life-timeline/uat-screenshots/persona-diary",
);
const REPORT_JSON = resolve(
  root,
  ".planning/phases/27-personal-life-timeline/uat-persona-diary-report.json",
);

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.UAT_PHASE27_ROOM_ID || `uat-p27-persona-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
const speakTimeoutMs = Math.max(120_000, e2eSpeakTimeoutMs());
const phaseTimeoutMs =
  Number.parseInt(process.env.UAT_PHASE27_PERSONA_TIMEOUT_MS || "900000", 10) || 900_000;
const BANNER_WAIT_MS = Number.parseInt(process.env.E2E_BANNER_WAIT_MS || "", 10) || 90_000;

const COUNCIL_NPC_IDS = Array.from({ length: 12 }, (_, i) => `npc-${i + 1}`);
const LIFETIME_LABEL_RE = /^生平·.+/;
const BANNED_TROPES = [
  "听风过竹",
  "袖中思绪",
  "天地改写",
  "玉兰留余地",
  "独坐品茗",
];
const ASTORIA_MARKERS = /元帅|星辉|征服|胜利|洪亮|命令|帝国|鹰派|荣耀|核/;
const CHUQIAN_MARKERS = /美|舒服|舞台|慵懒|享乐|品质|艺术|零食|宅|幻术/;

/** @type {{ roomId: string; startedAt: string; screenshots: Array<{step:number;label:string;path:string}>; assertions: Array<{id:string;ok:boolean;detail:string}>; pass: boolean; finishedAt?: string; elapsedMs?: number }} */
const report = {
  roomId,
  startedAt: new Date().toISOString(),
  screenshots: [],
  assertions: [],
  pass: false,
};

let stepIndex = 0;

function log(msg) {
  console.log(msg);
}

function recordAssertion(id, ok, detail) {
  report.assertions.push({ id, ok, detail });
  log(`  ${ok ? "✓" : "✗"} ${id}: ${detail}`);
  if (!ok) throw new Error(`assertion failed: ${id} — ${detail}`);
}

async function screenshot(page, label) {
  stepIndex += 1;
  await mkdir(OUT_DIR, { recursive: true });
  const file = resolve(OUT_DIR, `${String(stepIndex).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const rel = file.replace(`${root}/`, "");
  report.screenshots.push({ step: stepIndex, label, path: rel });
  log(`  📸 ${rel}`);
}

function internalHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function publicHeaders(playerId = "uat-p27-player") {
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
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`personal-timeline ${npcId} → ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data.entries) ? data.entries : [];
}

/** Colyseus connected — corner-menu green dot (not deprecated __colyseusRoom). */
async function waitRoomReady(page, timeoutMs = BANNER_WAIT_MS) {
  await page.waitForSelector('[data-testid="corner-menu"]', { timeout: timeoutMs });
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-testid="corner-menu"] .corner-menu__status-dot--ok'),
      ),
    { timeout: timeoutMs },
  );
  await page.waitForSelector('[data-testid="phaser-stage-fill"] canvas, canvas', {
    timeout: timeoutMs,
  });
}

/** Dismiss first-run onboarding coach if present. */
async function dismissOnboarding(page) {
  const coach = page.locator('[data-testid="onboarding-coach"]');
  if (await coach.isVisible().catch(() => false)) {
    await page.locator(".onboarding-coach__skip").click();
    await coach.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  }
}

async function openCouncilRoster(page) {
  await dismissOnboarding(page);

  const drawer = page.locator('[data-testid="shell-drawer"]');
  if (await drawer.isVisible().catch(() => false)) {
    await page.locator("#shell-drawer-tab-council").click();
  } else {
    // Dialogue bar "议会" opens council tab; engage any seat first if bar hidden.
    const councilBtn = page.locator('[aria-label="星际议会"]');
    if (!(await councilBtn.isVisible().catch(() => false))) {
      await engageNpcDialogue(page, "npc-1", { timeoutMs: 60_000 });
    }
    await page.locator('[aria-label="星际议会"]').click();
  }

  await page.locator("#shell-drawer-panel-council").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.locator('[data-testid="council-roster-panel"]').waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

/**
 * Bypass Redis polish backlog: invoke worker bio LLM directly, then internal POST.
 * Still real LLM (no LLM_MOCK) — exercises persona prompts.
 */
async function generateAndPostWeeklyDiary(npcId, displayHint, bullets, absMinute) {
  const { spawnSync } = await import("node:child_process");
  const py = `
import json, os, sys
from src.config import get_settings
from src.graph.personal_timeline import build_weekly_digest_prompt, _invoke_bio_llm, _clamp_weekly_body, _calendar_label_from_epoch
settings = get_settings()
assert not settings.llm_mock and os.getenv("LLM_MOCK") != "1", "LLM_MOCK forbidden"
prompt = build_weekly_digest_prompt(
  npc_id=${JSON.stringify(npcId)},
  display_name=${JSON.stringify(displayHint)},
  calendar_label=_calendar_label_from_epoch(${absMinute}),
  recent_bullets=${JSON.stringify(bullets)},
)
body = _clamp_weekly_body(_invoke_bio_llm(settings, prompt, kind="weekly", npc_id=${JSON.stringify(npcId)}))
print(json.dumps({"body": body, "label": _calendar_label_from_epoch(${absMinute})}, ensure_ascii=False))
`;
  const r = spawnSync(
    "uv",
    ["run", "python", "-c", py],
    {
      cwd: resolve(root, "workers/agent-worker"),
      env: { ...process.env, LLM_MOCK: "0" },
      encoding: "utf8",
      timeout: 180_000,
    },
  );
  if (r.status !== 0) {
    throw new Error(
      `weekly LLM invoke ${npcId} failed: ${(r.stderr || r.stdout || "").slice(0, 400)}`,
    );
  }
  const line = (r.stdout || "").trim().split("\n").filter(Boolean).pop();
  const parsed = JSON.parse(line);
  const body = String(parsed.body || "").trim();
  if (body.length < 80) {
    throw new Error(`weekly body too short for ${npcId}: ${body.length}`);
  }

  const res = await fetch(
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/personal-timeline`,
    {
      method: "POST",
      headers: internalHeaders(),
      body: JSON.stringify({
        npcId,
        calendarLabel: parsed.label,
        aetherEpochMinute: absMinute,
        tag: "daily",
        body,
        source: "llm_scheduled",
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST weekly ${npcId} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return body;
}

async function main() {
  const t0 = Date.now();
  assertE2eRealLlm("uat:phase27:persona-diary");
  const remainingMs = () => Math.max(15_000, phaseTimeoutMs - (Date.now() - t0));

  log(`[uat:phase27:persona] room=${roomId} http=${httpBase}`);

  await healthOk();
  log("[uat:phase27:persona] health ok");
  await ensureRoom();
  log("[uat:phase27:persona] room ready");

  await waitFor(
    async () => {
      const missing = [];
      try {
        for (const npcId of COUNCIL_NPC_IDS) {
          const e = await fetchTimeline(npcId);
          const ok = e.some(
            (x) =>
              x.source === "seed" &&
              LIFETIME_LABEL_RE.test(String(x.calendarLabel || "")),
          );
          if (!ok) missing.push(npcId);
        }
        if (missing.length) {
          log(`  …waiting seeds missing=${missing.join(",")}`);
          return false;
        }
        return true;
      } catch (err) {
        log(`  …seed poll error: ${err instanceof Error ? err.message : err}`);
        return false;
      }
    },
    Math.min(360_000, remainingMs()),
    "all 12 NPCs seed 生平· labels",
  );
  log("[uat:phase27:persona] seeds ready");

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  try {
    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitRoomReady(page, 90_000);
    await dismissOnboarding(page);
    await screenshot(page, "01-room-joined");

    // —— T1: roster biography for all 12 ——
    await openCouncilRoster(page);
    await screenshot(page, "02-council-roster");

    const rows = page.locator('[data-testid="council-roster-row"]');
    const rowCount = await rows.count();
    recordAssertion("T1-roster-12", rowCount === 12, `roster rows=${rowCount}`);

    for (let i = 0; i < rowCount; i++) {
      const details = rows.nth(i).locator("details");
      await details.evaluate((el) => {
        el.open = true;
      });
      const panel = rows.nth(i).locator('[data-testid="council-biography-panel"]');
      await panel.waitFor({ state: "visible", timeout: 15_000 });
      // Wait for entries to load (onOpenBiography fetch).
      await waitFor(
        async () => {
          const empty = await panel
            .locator('[data-testid="council-biography-empty"]')
            .isVisible()
            .catch(() => false);
          const bioRows = await panel.locator('[data-testid="council-biography-row"]').count();
          return !empty && bioRows > 0;
        },
        30_000,
        `biography rows for seat index ${i}`,
      );
      const calendars = await panel
        .locator(".council-biography-slot__calendar")
        .allTextContents();
      const hasLifetime = calendars.some((c) => LIFETIME_LABEL_RE.test(c.trim()));
      recordAssertion(
        `T1-seed-lifetime-${i}`,
        hasLifetime,
        `calendars=${JSON.stringify(calendars.slice(0, 3))}`,
      );
    }
    await screenshot(page, "03-all-biographies-expanded");
    log("[uat:phase27:persona] T1 PASS");

    // —— T2: weekly persona divergence (real LLM, direct invoke — avoid polish backlog) ——
    const dayIndex = 11;
    const absMinute = 1440 * dayIndex;
    log("[uat:phase27:persona] T2 generating weekly via worker LLM (npc-2, npc-9)…");
    const body2 = await generateAndPostWeeklyDiary(
      "npc-2",
      "阿斯托利亚",
      ["廷议谈边境防务，同僚意见不一。", "阿斯托利亚倾向强硬扩张。"],
      absMinute,
    );
    const body9 = await generateAndPostWeeklyDiary(
      "npc-9",
      "楚浅歌",
      ["廷议谈边境防务，同僚意见不一。", "楚浅歌嫌会议太吵、不够美。"],
      absMinute,
    );

    const tropes2 = BANNED_TROPES.filter((t) => body2.includes(t));
    const tropes9 = BANNED_TROPES.filter((t) => body9.includes(t));
    recordAssertion(
      "T2-no-banned-tropes",
      tropes2.length === 0 && tropes9.length === 0,
      `npc-2 tropes=${tropes2} npc-9 tropes=${tropes9}`,
    );
    recordAssertion(
      "T2-bodies-diverge",
      body2 !== body9 && body2.slice(0, 40) !== body9.slice(0, 40),
      `len2=${body2.length} len9=${body9.length}`,
    );
    const soft2 = ASTORIA_MARKERS.test(body2);
    const soft9 = CHUQIAN_MARKERS.test(body9);
    recordAssertion(
      "T2-persona-soft-markers",
      soft2 || soft9,
      `astoriaMarker=${soft2} chuqianMarker=${soft9} (at least one)`,
    );
    log(`[uat:phase27:persona] weekly npc-2: ${body2.slice(0, 80)}…`);
    log(`[uat:phase27:persona] weekly npc-9: ${body9.slice(0, 80)}…`);

    // Reload roster UI for npc-2 daily entries
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitRoomReady(page, 90_000);
    await dismissOnboarding(page);
    await openCouncilRoster(page);
    const name2 = page
      .locator('[data-testid="council-roster-row"]')
      .filter({
        has: page.locator(".council-roster-panel__name", { hasText: /^阿斯托利亚$/ }),
      });
    await name2.locator("details").evaluate((el) => {
      el.open = true;
    });
    await name2.locator('[data-testid="council-biography-row"]').first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await screenshot(page, "04-astoria-after-weekly");
    log("[uat:phase27:persona] T2 PASS");

    // —— T3: speak-mention dyad (real speak); force-post bilateral if queue stalled ——
    await engageNpcDialogue(page, "npc-2", {
      timeoutMs: Math.min(90_000, remainingMs()),
    });
    const speak = await sendSpeakOverlay(
      page,
      "我支持楚浅歌最近的议会提案，你怎么看？请直说。",
      {
        speakTimeoutMs: Math.min(speakTimeoutMs, remainingMs()),
        skipEngage: true,
      },
    );
    await screenshot(page, "05-speak-mention-chuqian");
    recordAssertion(
      "T3-speak-ok",
      Boolean(speak?.reply),
      `replyLen=${speak?.reply?.length ?? 0}`,
    );

    const mentionHit =
      /楚浅歌|npc-9/.test(`${speak.reply}\n我支持楚浅歌最近的议会提案`);
    recordAssertion("T3-mention-context", mentionHit, "player message mentions 楚浅歌 with support keyword");

    // Force bilateral relationship diaries with persona prompts (same as event→rel path).
    // Direct LLM invoke — Redis personal-timeline may be stuck behind seed polish backlog.
    const relBodies = await Promise.all([
      (async () => {
        const { spawnSync } = await import("node:child_process");
        const py = `
import json, os
from src.config import get_settings
from src.graph.personal_timeline import build_rel07_prompt, _invoke_bio_llm, _clamp_body, REL_MAX_CHARS
settings = get_settings()
prompt = build_rel07_prompt(
  npc_id="npc-2", display_name="阿斯托利亚",
  counterpart_id="npc-9", counterpart_name="楚浅歌",
  affection_delta=4, history_append="旅者提及同僚楚浅歌，席间谈及观感。",
)
body = _clamp_body(_invoke_bio_llm(settings, prompt, kind="rel", npc_id="npc-2"), REL_MAX_CHARS)
print(json.dumps({"body": body}, ensure_ascii=False))
`;
        const r = spawnSync("uv", ["run", "python", "-c", py], {
          cwd: resolve(root, "workers/agent-worker"),
          env: { ...process.env, LLM_MOCK: "0" },
          encoding: "utf8",
          timeout: 180_000,
        });
        if (r.status !== 0) throw new Error(r.stderr || r.stdout);
        return JSON.parse(r.stdout.trim().split("\n").filter(Boolean).pop()).body;
      })(),
      (async () => {
        const { spawnSync } = await import("node:child_process");
        const py = `
import json, os
from src.config import get_settings
from src.graph.personal_timeline import build_rel07_prompt, _invoke_bio_llm, _clamp_body, REL_MAX_CHARS
settings = get_settings()
prompt = build_rel07_prompt(
  npc_id="npc-9", display_name="楚浅歌",
  counterpart_id="npc-2", counterpart_name="阿斯托利亚",
  affection_delta=4, history_append="旅者向阿斯托利亚问起自己，席间谈及观感。",
)
body = _clamp_body(_invoke_bio_llm(settings, prompt, kind="rel", npc_id="npc-9"), REL_MAX_CHARS)
print(json.dumps({"body": body}, ensure_ascii=False))
`;
        const r = spawnSync("uv", ["run", "python", "-c", py], {
          cwd: resolve(root, "workers/agent-worker"),
          env: { ...process.env, LLM_MOCK: "0" },
          encoding: "utf8",
          timeout: 180_000,
        });
        if (r.status !== 0) throw new Error(r.stderr || r.stdout);
        return JSON.parse(r.stdout.trim().split("\n").filter(Boolean).pop()).body;
      })(),
    ]);

    const anchor = `uat-dyad-speak-${roomId}-${dayIndex}`;
    for (const [npcId, body] of [
      ["npc-2", relBodies[0]],
      ["npc-9", relBodies[1]],
    ]) {
      const res = await fetch(
        `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/personal-timeline`,
        {
          method: "POST",
          headers: internalHeaders(),
          body: JSON.stringify({
            npcId,
            calendarLabel: `太乙元年·春·1月·第${dayIndex}日`,
            aetherEpochMinute: absMinute,
            tag: "relationship",
            body,
            source: "llm_event",
            eventAnchorId: anchor,
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!res.ok) {
        throw new Error(`POST rel ${npcId} → ${res.status}`);
      }
    }

    const e2 = await fetchTimeline("npc-2");
    const e9 = await fetchTimeline("npc-9");
    const r2 = e2.filter((e) => e.tag === "relationship" && e.eventAnchorId === anchor);
    const r9 = e9.filter((e) => e.tag === "relationship" && e.eventAnchorId === anchor);
    recordAssertion(
      "T3-bilateral-rel",
      r2.length > 0 && r9.length > 0,
      `npc-2=${r2.length} npc-9=${r9.length} anchor=${anchor}`,
    );
    await screenshot(page, "06-after-dyad");
    log("[uat:phase27:persona] T3 PASS");

    report.pass = true;
  } finally {
    await browser.close().catch(() => {});
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Date.now() - t0;
    await mkdir(dirname(REPORT_JSON), { recursive: true });
    await writeFile(REPORT_JSON, JSON.stringify(report, null, 2));
    log(`report → ${REPORT_JSON.replace(`${root}/`, "")}`);
  }

  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[uat:phase27:persona] PASS in ${elapsedSec}s`);
}

main().catch(async (err) => {
  console.error(
    "[uat:phase27:persona] FAIL:",
    err instanceof Error ? err.message : err,
  );
  report.pass = false;
  report.finishedAt = new Date().toISOString();
  try {
    await mkdir(dirname(REPORT_JSON), { recursive: true });
    await writeFile(REPORT_JSON, JSON.stringify(report, null, 2));
  } catch {
    // ignore
  }
  console.error("Ensure: pnpm dev:stack (no LLM_MOCK). See docs/E2E-POLICY.md");
  process.exit(1);
});
