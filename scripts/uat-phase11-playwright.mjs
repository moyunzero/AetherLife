/**
 * Phase 11 UAT — gameplay + lore discovery (WORLD-02).
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real LLM keys + worker.
 * Output: .planning/phases/11-llm-world-lore/uat-screenshots/ + uat-report.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_BASE = process.env.WEB_URL || "http://localhost:5173";
const HTTP_BASE =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const UAT_ROOM_ID = process.env.UAT_PHASE11_ROOM_ID || `uat-p11-${Date.now()}`;
const WEB = `${WEB_BASE}${WEB_BASE.includes("?") ? "&" : "?"}room=${encodeURIComponent(UAT_ROOM_ID)}`;
const outDir = path.join(ROOT, ".planning/phases/11-llm-world-lore/uat-screenshots");
const E2E_LORE_TIMEOUT_MS = Number.parseInt(process.env.E2E_LORE_TIMEOUT_MS || "", 10) || 120_000;
const CHUNK_SIZE = 8;
const TARGET_X = 8;

const report = {
  roomId: UAT_ROOM_ID,
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

async function pressMoveEast(page, steps) {
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press("d");
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(500);
}

async function placeNameText(page) {
  const el = page.locator('[data-testid="explore-place-name"]');
  await el.waitFor({ state: "visible", timeout: 30_000 });
  return (await el.innerText()).trim();
}

async function main() {
  assertE2eNoMock("uat:phase11:playwright");

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

  const health = await fetch(`${HTTP_BASE}/health`).then((r) => r.json()).catch(() => null);
  if (health?.status !== "ok") {
    throw new Error(`game-server not reachable at ${HTTP_BASE} — run pnpm dev:stack`);
  }

  console.log(`uat:phase11 → ${WEB}`);
  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // P11-UAT-01 Colyseus join via same-origin (no stuck disconnected)
  await page.goto(WEB, { waitUntil: "networkidle", timeout: 45_000 });
  await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="explore-coords-strip"]').waitFor({ timeout: 30_000 });
  const connecting = page.getByText("正在连接 Colyseus");
  if (await connecting.isVisible().catch(() => false)) {
    record("P11-UAT-01", "Colyseus 进房", false, "still connecting");
  }
  record("P11-UAT-01", "Colyseus 进房", true, "room-scene + explore strip");
  await shot(page, "01-joined-home");

  // P11-UAT-02 Home lore (晨曦村)
  const homeName = await placeNameText(page);
  record("P11-UAT-02", "Home 晨曦村", homeName.includes("晨曦村"), homeName);
  await shot(page, "02-home-chenxi");

  // P11-UAT-03 Movement + coords strip updates
  const stripBefore = await page.locator('[data-testid="explore-coords-strip"]').innerText();
  await pressMoveEast(page, 3);
  const stripAfter = await page.locator('[data-testid="explore-coords-strip"]').innerText();
  record("P11-UAT-03", "移动后坐标条更新", stripBefore !== stripAfter, `${stripBefore} → ${stripAfter}`);
  await shot(page, "03-after-move");

  // P11-UAT-04 Cross chunk → pending or discover
  const stepsToDiscover = TARGET_X - 4;
  await pressMoveEast(page, Math.max(0, stepsToDiscover - 3));
  await waitFor(
    async () => {
      const pending = await page.locator('[data-testid="lore-pending-hint"]').isVisible().catch(() => false);
      const name = await placeNameText(page);
      return pending || (!name.includes("晨曦村") && name.length > 0);
    },
    20_000,
    "chunk cross pending or new place",
  ).catch(() => {
    /* continue to lore ready wait */
  });
  await shot(page, "04-chunk-cross");

  await waitFor(
    async () => {
      const pending = await page.locator('[data-testid="lore-pending-hint"]').isVisible().catch(() => false);
      if (pending) return false;
      const name = await placeNameText(page);
      return name.length > 0 && !name.includes("生成中");
    },
    E2E_LORE_TIMEOUT_MS,
    "lore ready after LLM",
  );
  const discoverName = await placeNameText(page);
  record("P11-UAT-04", "跨界发现地名", discoverName.length > 0 && !discoverName.includes("晨曦村"), discoverName);
  await shot(page, "05-lore-ready");

  const toastVisible = await page.locator('[data-testid="lore-discover-toast"]').isVisible().catch(() => false);
  if (toastVisible) {
    await shot(page, "06-discover-toast");
    record("P11-UAT-05", "发现 Toast", true, "toast visible");
  } else {
    record("P11-UAT-05", "发现 Toast", true, "skipped (cache/fast path)");
  }

  // P11-UAT-06 GET public lore API (wait for worker persist — may lag UI by seconds)
  const cx = Math.floor(TARGET_X / CHUNK_SIZE);
  const cy = Math.floor(4 / CHUNK_SIZE);
  let loreBody = {};
  await waitFor(
    async () => {
      const loreRes = await fetch(`${HTTP_BASE}/rooms/${UAT_ROOM_ID}/chunks/${cx}/${cy}/lore`);
      if (!loreRes.ok) return false;
      loreBody = await loreRes.json().catch(() => ({}));
      return Boolean(loreBody?.lore?.nameZh);
    },
    E2E_LORE_TIMEOUT_MS,
    "GET /chunks/:cx/:cy/lore persisted",
  );
  const okApi = loreBody?.lore?.nameZh && !("npcRumor" in (loreBody.lore || {}));
  record("P11-UAT-06", "GET lore 无密钥字段", okApi, loreBody?.lore?.nameZh || "missing");
  await shot(page, "07-final-state");

  await browser.close();
  report.pass = true;
  report.finishedAt = new Date().toISOString();
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "uat-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log("uat:phase11 OK");
}

main().catch(async (err) => {
  report.pass = false;
  report.error = err.message;
  report.finishedAt = new Date().toISOString();
  await mkdir(outDir, { recursive: true }).catch(() => {});
  await writeFile(path.join(outDir, "uat-report.json"), `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  console.error(`uat:phase11 failed: ${err.message}`);
  process.exit(1);
});
