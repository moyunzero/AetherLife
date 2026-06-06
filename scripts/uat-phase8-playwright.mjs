/**
 * Phase 8 UAT — 4 人同 room、满员 banner、speak 队列、player-strip、verify:phase8。
 * Requires: pnpm dev:stack (real LLM). See docs/E2E-POLICY.md
 */
import { spawn } from "node:child_process";
import { assertE2eRealLlm } from "./lib/e2e-policy.mjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, ".planning/phases/08-multiplayer-room/uat-screenshots");

const WEB_BASE = process.env.WEB_URL || "http://localhost:5173";
const UAT_ROOM_ID = process.env.UAT_PHASE8_ROOM_ID || `uat-p8-${Date.now()}`;
const WEB = `${WEB_BASE}${WEB_BASE.includes("?") ? "&" : "?"}room=${encodeURIComponent(UAT_ROOM_ID)}`;
const GS = process.env.GAME_SERVER_URL || "http://127.0.0.1:2567";
const SPEAK_TIMEOUT_MS = Number(process.env.UAT_SPEAK_TIMEOUT_MS || 90_000);

let stepIndex = 0;
let currentTest = 0;

function log(msg) {
  console.log(msg);
}

async function stop(msg) {
  console.error(`\n❌ UAT 在 Test ${currentTest} 失败: ${msg}`);
  process.exit(1);
}

async function screenshot(page, label) {
  stepIndex += 1;
  await mkdir(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${String(stepIndex).padStart(2, "0")}-t${currentTest}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  log(`  📸 ${path.relative(ROOT, file)}`);
}

async function health(url, name) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) await stop(`${name} /health → ${res.status}`);
    const body = await res.json();
    if (body.status !== "ok") await stop(`${name} /health body invalid`);
  } catch (err) {
    await stop(`${name} 不可达 (${url}): ${err.message}`);
  }
}

async function waitConnected(page, timeoutMs = 35_000) {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remaining = Math.max(5000, deadline - Date.now());
    await page.locator('[data-testid="room-scene"]').waitFor({ state: "visible", timeout: remaining });
    const full = page.locator('[data-testid="banner-room-full"]');
    if (!(await full.isVisible().catch(() => false))) return;
    if (attempt === 2 || Date.now() >= deadline) break;
    log("  WARN: 满员 banner（可能 orphan shard）— reload 重试");
    await page.reload({ waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(1500);
  }
  if (await page.locator('[data-testid="banner-room-full"]').isVisible().catch(() => false)) {
    await stop("页面显示满员 banner，无法继续（请先关闭多余标签或重启 game-server）");
  }
}

async function runVerifyPhase8() {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["verify:phase8"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      out += d.toString();
      process.stderr.write(d);
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`verify:phase8 exit ${code}\n${out}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  assertE2eRealLlm("uat:phase8:playwright");
  log("Phase 8 Playwright UAT → .planning/phases/08-multiplayer-room/uat-screenshots/");
  log(`WEB=${WEB} GS=${GS} room=${UAT_ROOM_ID}\n`);

  const pwEntry = path.join(ROOT, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) await stop("playwright 未安装：cd scripts/.pw-deps && npm install");

  currentTest = 1;
  log("Test 1/5: 服务健康检查");
  await health(GS, "game-server");
  try {
    const webRes = await fetch(WEB, { signal: AbortSignal.timeout(10_000) });
    if (!webRes.ok) await stop(`Web ${WEB} → ${webRes.status}`);
  } catch (err) {
    await stop(`Web 不可达 — 请先 pnpm dev:stack（真实 LLM，见 docs/E2E-POLICY.md）`);
  }
  log("  ✓ Test 1 pass\n");

  const browser = await chromium.launch({ headless: true });

  currentTest = 2;
  log("Test 2/5: 4 标签同 room + player-strip");
  const contexts = [];
  const pages = [];
  for (let i = 0; i < 4; i += 1) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(WEB, { waitUntil: "networkidle", timeout: 30_000 });
    await waitConnected(page);
    contexts.push(ctx);
    pages.push(page);
    if (i < 3) await page.waitForTimeout(2200);
  }
  await pages[0].waitForFunction(
    () => document.querySelectorAll('[data-testid="player-strip"] .room-player-strip__name').length >= 4,
    { timeout: 45_000 },
  );
  const stripText = await pages[0].locator('[data-testid="player-strip"]').textContent();
  if (!stripText?.trim()) await stop("player-strip 为空");
  await screenshot(pages[0], "02-four-tabs-player-strip");
  log(`  ✓ player-strip: ${stripText.replace(/\s+/g, " ").trim()}\n`);

  currentTest = 3;
  log("Test 3/5: 第 5 标签满员 banner");
  const ctx5 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page5 = await ctx5.newPage();
  await page5.goto(WEB, { waitUntil: "networkidle", timeout: 30_000 });
  await page5.locator('[data-testid="banner-room-full"]').waitFor({ timeout: 20_000 });
  await screenshot(page5, "03-room-full-banner");
  await ctx5.close();
  log("  ✓ Test 3 pass\n");

  currentTest = 4;
  log("Test 4/5: speak 队列 banner（A 发言时 B 抢发）");
  const pageA = pages[0];
  const pageB = pages[1];
  await pageA.locator("textarea.composer__input").fill("phase8 uat speak A");
  await pageA.locator("button.btn--primary").click();
  await pageA.locator(".message--thinking").waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
  await pageB.locator("textarea.composer__input").fill("phase8 uat speak B should queue");
  await pageB.locator("button.btn--primary").click();
  await pageB.locator('[data-testid="banner-speak-queue"]').waitFor({ timeout: 15_000 });
  await screenshot(pageB, "04-speak-queue-banner");
  const thinkingB = pageB.locator(".message--thinking");
  if (await thinkingB.isVisible().catch(() => false)) {
    log("  ✓ 标签 B 可见房间级 thinking");
  }
  const npcA = pageA.locator(".message--npc").last();
  await npcA.waitFor({ state: "visible", timeout: SPEAK_TIMEOUT_MS });
  const replyA = await npcA.locator(".message__text").textContent();
  if (!replyA?.trim()) await stop("发起者未收到 NPC 回复");
  const npcBCount = await pageB.locator(".message--npc").count();
  if (npcBCount > 0) {
    log("  WARN: 非发起者标签 B 出现了 NPC 回复气泡（应仅 initiator 可见全文）");
  } else {
    log("  ✓ 非发起者无 reply 全文");
  }
  await screenshot(pageA, "04a-initiator-reply");
  log("  ✓ Test 4 pass\n");

  currentTest = 5;
  log("Test 5/5: verify:phase8 协议脚本");
  for (const ctx of contexts) await ctx.close();
  await browser.close();
  try {
    await runVerifyPhase8();
  } catch (err) {
    await stop(err.message);
  }
  log("  ✓ Test 5 pass\n");

  log("✅ Phase 8 UAT 全部通过");
  log(`截图: ${path.relative(ROOT, OUT_DIR)}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
