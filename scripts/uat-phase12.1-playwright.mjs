/**
 * Phase 12.1 UAT #5 — insult → worker social perception + attitude delta.
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real LLM keys.
 * Output: .planning/phases/12.1-llm-social-perception/uat-screenshots/ + uat-report.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertE2eNoMock, assertE2eRealLlm, e2eSpeakTimeoutMs } from "./lib/e2e-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_BASE =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const WEB_BASE = process.env.WEB_URL || "http://localhost:5173";
const UAT_ROOM_ID = process.env.UAT_PHASE121_ROOM_ID || `uat-p121-${Date.now()}`;
const NPC_ID = "npc-1";
const INSULT = "你好丑啊，活该被打";
const GENERIC_POLITE = ["随时听候差遣", "乐意效劳", "有什么可以帮"];
const outDir = path.join(ROOT, ".planning/phases/12.1-llm-social-perception/uat-screenshots");

const WEB = `${WEB_BASE}?room=${encodeURIComponent(UAT_ROOM_ID)}&collectiveDebug=1`;

const report = {
  roomId: UAT_ROOM_ID,
  phase: "12.1",
  startedAt: new Date().toISOString(),
  cases: [],
  pass: false,
};

let step = 0;

function record(id, title, ok, detail = "") {
  report.cases.push({ id, title, ok, detail, at: new Date().toISOString() });
  console.log(`${ok ? "✓" : "✗"} ${id} ${title}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`${id}: ${title}${detail ? ` (${detail})` : ""}`);
}

async function shot(page, label) {
  step += 1;
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${String(step).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  📸 ${path.relative(ROOT, file)}`);
  return file;
}

async function loadPlaywright() {
  const pwEntry = path.join(ROOT, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) throw new Error("playwright 未安装：cd scripts/.pw-deps && npm install");
  return chromium;
}

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout: ${label} (${timeoutMs}ms)`);
}

async function resetRoom(playerId) {
  const res = await fetch(`${HTTP_BASE}/rooms/${encodeURIComponent(UAT_ROOM_ID)}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Player-Id": playerId },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`reset failed: ${res.status} ${JSON.stringify(body)}`);
}

async function getCollectiveState(playerId, npcId = NPC_ID) {
  const qs = new URLSearchParams({ npcId });
  const res = await fetch(
    `${HTTP_BASE}/rooms/${encodeURIComponent(UAT_ROOM_ID)}/collective-state?${qs}`,
    { headers: { "X-Player-Id": playerId } },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`collective-state → ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function attitudeFor(body, npcId = NPC_ID) {
  const row = body.attitudes?.find((a) => a.npcId === npcId);
  if (!row) throw new Error(`missing attitude for ${npcId}`);
  return row;
}

async function main() {
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

  assertE2eNoMock("uat:phase12.1:playwright");
  assertE2eRealLlm("uat:phase12.1:playwright");

  const health = await fetch(`${HTTP_BASE}/health`).then((r) => r.json()).catch(() => null);
  if (health?.status !== "ok") {
    throw new Error(`game-server not reachable at ${HTTP_BASE} — run pnpm dev:stack`);
  }

  const playerId = `uatp121test${String(Date.now()).slice(-8)}`;
  await resetRoom(playerId);
  const baseline = attitudeFor(await getCollectiveState(playerId));
  console.log(
    `uat:phase12.1 → ${WEB} playerId=${playerId.slice(-8)} baseline eff=${baseline.effectiveScore} band=${baseline.band}`,
  );

  const speakTimeoutMs = e2eSpeakTimeoutMs();
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

  let collectiveStateCalls = 0;
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/collective-state")) collectiveStateCalls += 1;
  });

  await page.goto(WEB, { waitUntil: "networkidle", timeout: 45_000 });
  await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
  record("P121-UAT-01", "进房 + collectiveDebug", true, "room-scene visible");
  await shot(page, "01-joined");

  const callsAfterLoad = collectiveStateCalls;

  await page.getByRole("tab", { name: /路昂/ }).click();
  record("P121-UAT-02", "选中路昂 tab", true);
  await shot(page, "02-luan-tab");

  const composer = page.locator(".composer__input");
  await composer.fill(INSULT);
  const callsBeforeSpeak = collectiveStateCalls;
  await page.getByRole("button", { name: "发送指令" }).click();

  await waitFor(
    async () => {
      const thinking = await page.locator(".message--thinking").isVisible().catch(() => false);
      return thinking;
    },
    15_000,
    "thinking indicator",
  ).catch(() => {
    /* some paths skip visible thinking */
  });

  await waitFor(
    async () => {
      const thinking = await page.locator(".message--thinking").isVisible().catch(() => false);
      const latestNpc = page.locator(".message--npc.message--latest .message__text");
      const visible = await latestNpc.isVisible().catch(() => false);
      if (!visible) return false;
      const text = await latestNpc.innerText();
      return !thinking && text.length > 0;
    },
    speakTimeoutMs,
    "NPC reply after insult",
  );

  const replyText = await page.locator(".message--npc.message--latest .message__text").innerText();
  record("P121-UAT-03", "NPC 回复到达", replyText.length > 0, replyText.slice(0, 80));

  const genericHit = GENERIC_POLITE.find((p) => replyText.includes(p));
  record(
    "P121-UAT-04",
    "回复非 generic polite",
    !genericHit,
    genericHit ? `matched ${genericHit}` : "no banned phrase",
  );

  let afterAtt = baseline;
  await waitFor(
    async () => {
      const st = await getCollectiveState(playerId);
      afterAtt = attitudeFor(st);
      const rude = (st.recentEvents ?? []).find(
        (e) => e.kind === "rude" && (e.source === "worker" || e.source === "llm"),
      );
      return (
        rude != null &&
        (afterAtt.effectiveScore !== baseline.effectiveScore ||
          afterAtt.reputation !== baseline.reputation)
      );
    },
    20_000,
    "collective rude event + score delta",
  );

  const stFinal = await getCollectiveState(playerId);
  const rudeEvent = (stFinal.recentEvents ?? []).find((e) => e.kind === "rude");
  record(
    "P121-UAT-05",
    "recentEvents rude + source worker",
    rudeEvent?.source === "worker",
    rudeEvent ? `source=${rudeEvent.source} Δ${rudeEvent.deltaScore}` : "no rude event",
  );
  record(
    "P121-UAT-06",
    "effectiveScore 变化",
    afterAtt.effectiveScore !== baseline.effectiveScore,
    `${baseline.effectiveScore} → ${afterAtt.effectiveScore}`,
  );

  const callsDuringSpeak = collectiveStateCalls - callsBeforeSpeak;
  record(
    "P121-UAT-07",
    "speak 期间 collective-state 请求 ≤2",
    callsDuringSpeak <= 2,
    `during speak=${callsDuringSpeak}, after load=${callsAfterLoad}`,
  );

  await page.locator('[data-testid="collective-debug-panel"]').click();
  await shot(page, "03-after-insult");

  await browser.close();

  report.pass = report.cases.every((c) => c.ok);
  report.finishedAt = new Date().toISOString();
  report.baseline = { effectiveScore: baseline.effectiveScore, band: baseline.band };
  report.after = { effectiveScore: afterAtt.effectiveScore, band: afterAtt.band };
  report.replySnippet = replyText.slice(0, 200);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "uat-report.json"), `${JSON.stringify(report, null, 2)}\n`);

  if (!report.pass) {
    throw new Error("uat:phase12.1 failed — see uat-report.json");
  }
  console.log("uat:phase12.1 OK");
}

main().catch((err) => {
  console.error(`uat:phase12.1 failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
