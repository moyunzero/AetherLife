/**
 * Phase 6 UAT 1–8 — Playwright automation with per-step screenshots.
 * Requires pnpm dev:stack (real LLM). See docs/E2E-POLICY.md
 */
import { spawn } from "node:child_process";
import { assertE2eRealLlm } from "./lib/e2e-policy.mjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, ".planning/phases/06-colyseus-movement/uat-screenshots");

const WEB = process.env.WEB_URL || "http://localhost:5173";
/** Phase 7+ defaults to Phaser; grid UAT needs MovementPanel fallback. */
const WEB_UI = `${WEB}${WEB.includes("?") ? "&" : "?"}phaserFallback=1`;
const GS = process.env.GAME_SERVER_URL || "http://127.0.0.1:2567";
const GW = process.env.AI_GATEWAY_URL || "http://127.0.0.1:8000";
const SPEAK_TIMEOUT_MS = Number(process.env.UAT_SPEAK_TIMEOUT_MS || 120_000);

let stepIndex = 0;
let currentTest = 0;

function log(msg) {
  console.log(msg);
}

async function stop(msg) {
  console.error(`\n❌ UAT 在 Test ${currentTest} 失败（step ${stepIndex}）: ${msg}`);
  process.exit(1);
}

async function screenshot(page, label) {
  stepIndex += 1;
  await mkdir(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${String(stepIndex).padStart(2, "0")}-t${currentTest}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  log(`  📸 ${path.relative(ROOT, file)}`);
  return file;
}

async function health(url, name) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) await stop(`${name} /health → ${res.status}`);
    const body = await res.json();
    if (body.status !== "ok") await stop(`${name} /health body invalid`);
    return body;
  } catch (err) {
    await stop(`${name} 不可达 (${url}): ${err.message}`);
  }
}

async function waitPlayerSynced(page, timeoutMs = 20_000) {
  await page.waitForFunction(
    () => {
      if (document.querySelector(".movement-cell--self")) return true;
      const self = document.querySelector(".movement-cell--self");
      return Boolean(self);
    },
    { timeout: timeoutMs },
  );
}

async function getSelfGridPos(page) {
  await waitPlayerSynced(page);
  const self = page.locator(".movement-cell--self").first();
  if (await self.count()) {
    const testId = await self.getAttribute("data-testid");
    const m = testId?.match(/cell-(\d+)-(\d+)/);
    if (m) return { x: Number(m[1]), y: Number(m[2]) };
  }
  const youCell = page.locator(".movement-grid button", { hasText: "你" }).first();
  await youCell.waitFor({ state: "visible", timeout: 5000 });
  const testId = await youCell.getAttribute("data-testid");
  const m = testId?.match(/cell-(\d+)-(\d+)/);
  if (!m) await stop(`无法解析自身格子 data-testid=${testId}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

async function waitSelfAt(page, x, y, timeoutMs = 5000) {
  await page.waitForFunction(
    ({ tx, ty }) => {
      const el = document.querySelector(".movement-cell--self");
      if (!el) return false;
      const id = el.getAttribute("data-testid") || "";
      const m = id.match(/cell-(\d+)-(\d+)/);
      return m && Number(m[1]) === tx && Number(m[2]) === ty;
    },
    { tx: x, ty: y },
    { timeout: timeoutMs },
  );
}

/** MovementPanel disables all cells while animating — wait before click-to-move. */
async function waitMovementGridReady(page, timeoutMs = 10_000) {
  await page.waitForFunction(
    () => {
      const cells = document.querySelectorAll('[data-testid^="cell-"]');
      if (!cells.length) return false;
      return [...cells].some((el) => !el.disabled);
    },
    { timeout: timeoutMs },
  );
}

async function runVerifyPhase6() {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["verify:phase6"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
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
      else reject(new Error(`verify:phase6 exit ${code}\n${out}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  assertE2eRealLlm("uat:phase6:playwright");
  log("Phase 6 Playwright UAT → screenshots: .planning/phases/06-colyseus-movement/uat-screenshots/");
  log(`WEB=${WEB} GS=${GS} GW=${GW}\n`);

  const pwEntry = path.join(ROOT, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) {
    await stop("playwright 未安装：cd scripts/.pw-deps && npm install");
  }

  // —— Test 1: Cold start / health ——
  currentTest = 1;
  log("Test 1/8: Cold Start Smoke Test");
  const gsBody = await health(GS, "game-server");
  const gwBody = await health(GW, "ai-gateway");
  if (gsBody.service !== "game-server") await stop("game-server service name mismatch");
  if (gwBody.service !== "ai-gateway") await stop("ai-gateway service name mismatch");

  let webRes;
  try {
    webRes = await fetch(WEB_UI, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    await stop(`Web 不可达 (${WEB}): ${err.message} — 请先 pnpm dev:stack（真实 LLM）`);
  }
  if (!webRes.ok) await stop(`Web ${WEB} → ${webRes.status}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto(WEB_UI, { waitUntil: "networkidle", timeout: 30_000 });
  const title = await page.locator("h1.chat-header__title").textContent();
  if (!title?.includes("以太人生")) await stop(`页面标题异常: ${title}`);
  await screenshot(page, "01-home-health-ok");
  log("  ✓ Test 1 pass\n");

  // —— Test 2: Auto join ——
  currentTest = 2;
  log("Test 2/8: Colyseus 自动加入房间");
  const panel = page.locator('[data-testid="movement-panel"]');
  await panel.waitFor({ state: "visible", timeout: 20_000 });
  const errBanner = page.locator(".error-banner", { hasText: "未连接游戏房间" });
  if (await errBanner.isVisible().catch(() => false)) {
    await stop("显示「未连接游戏房间」");
  }
  await page.waitForFunction(
    () => {
      const cells = document.querySelectorAll('[data-testid^="cell-"]');
      if (cells.length < 64) return false;
      for (const c of cells) {
        if (c.disabled) return false;
      }
      return true;
    },
    { timeout: 20_000 },
  );
  await waitPlayerSynced(page);
  await screenshot(page, "02-colyseus-connected");
  log("  ✓ Test 2 pass\n");

  // —— Test 3: WASD ——
  currentTest = 3;
  log("Test 3/8: WASD 网格移动");
  await page.locator('[data-testid="movement-panel"]').click();
  await page.locator("textarea.composer__input").blur();
  const start = await getSelfGridPos(page);
  const wasdKey =
    start.x < 7 ? "d" : start.x > 0 ? "a" : start.y < 7 ? "s" : "w";
  const expectX =
    wasdKey === "d" ? start.x + 1 : wasdKey === "a" ? start.x - 1 : start.x;
  const expectY =
    wasdKey === "s" ? start.y + 1 : wasdKey === "w" ? start.y - 1 : start.y;
  await page.keyboard.press(wasdKey);
  await waitSelfAt(page, expectX, expectY, 5000);
  await screenshot(page, "03-wasd-move");
  const afterWasd = await getSelfGridPos(page);
  if (afterWasd.x !== expectX || afterWasd.y !== expectY) {
    await stop(`WASD 后期望 (${expectX},${expectY}) 实际 (${afterWasd.x},${afterWasd.y})`);
  }
  await page.locator("details.state-panel summary").click();
  const stateText = await page.locator(".state-panel__json").textContent();
  if (!stateText?.includes(`"x": ${afterWasd.x}`) && !stateText?.includes(`"x":${afterWasd.x}`)) {
    log("  WARN: 房间状态 JSON 未明显包含新 x（可能仅同步 Colyseus 玩家坐标）");
  }
  log("  ✓ Test 3 pass\n");

  // —— Test 4: Click cell ——
  currentTest = 4;
  log("Test 4/8: 点击目标格移动");
  await waitMovementGridReady(page);
  const cur = await getSelfGridPos(page);
  const clickCandidates = [
    [start.x, start.y],
    [cur.x + 1, cur.y],
    [cur.x - 1, cur.y],
    [cur.x, cur.y + 1],
    [cur.x, cur.y - 1],
  ].filter(([x, y]) => x >= 0 && y >= 0 && x < 8 && y < 8);
  let clickTarget = null;
  for (const [tx, ty] of clickCandidates) {
    const cell = page.locator(`[data-testid="cell-${tx}-${ty}"]`);
    if (!(await cell.isEnabled().catch(() => false))) continue;
    await cell.click();
    try {
      await waitSelfAt(page, tx, ty, 5000);
      clickTarget = { x: tx, y: ty };
      break;
    } catch {
      /* blocked — try next neighbor */
    }
  }
  if (!clickTarget) await stop("点击移动：相邻格均不可达");
  await screenshot(page, "04-click-cell-move");
  const afterClick = await getSelfGridPos(page);
  if (afterClick.x !== clickTarget.x || afterClick.y !== clickTarget.y) {
    await stop(
      `点击移动后期望 (${clickTarget.x},${clickTarget.y}) 实际 (${afterClick.x},${afterClick.y})`,
    );
  }
  log("  ✓ Test 4 pass\n");

  // —— Test 5: Dual tab sync ——
  currentTest = 5;
  log("Test 5/8: 双标签页位置同步");
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageB = await ctxB.newPage();
  await pageB.goto(WEB_UI, { waitUntil: "networkidle", timeout: 30_000 });
  await pageB.locator('[data-testid="movement-panel"]').waitFor({ timeout: 20_000 });
  await pageB.waitForSelector(".movement-cell--self", { timeout: 20_000 });
  await screenshot(page, "05a-tab-a-before-sync");
  await screenshot(pageB, "05b-tab-b-before-sync");

  const posA = await getSelfGridPos(page);
  await page.locator("textarea.composer__input").blur();
  await waitMovementGridReady(page);
  await page.locator('[data-testid="movement-panel"]').click();
  const syncKey =
    posA.x < 7 ? "d" : posA.x > 0 ? "a" : posA.y < 7 ? "s" : "w";
  const syncExpectX =
    syncKey === "d" ? posA.x + 1 : syncKey === "a" ? posA.x - 1 : posA.x;
  const syncExpectY =
    syncKey === "s" ? posA.y + 1 : syncKey === "w" ? posA.y - 1 : posA.y;
  await page.keyboard.press(syncKey);
  await waitSelfAt(page, syncExpectX, syncExpectY, 10_000);

  await pageB.waitForFunction(
    ({ tx, ty }) => {
      const cell = document.querySelector(`[data-testid="cell-${tx}-${ty}"]`);
      if (!cell) return false;
      return (
        cell.classList.contains("movement-cell--occupied") ||
        cell.textContent?.trim() === "客"
      );
    },
    { tx: syncExpectX, ty: syncExpectY },
    { timeout: 10_000 },
  );
  await screenshot(page, "05c-tab-a-after-move");
  await screenshot(pageB, "05d-tab-b-sees-peer");
  log("  ✓ Test 5 pass\n");

  // —— Test 6: Speak Colyseus ——
  currentTest = 6;
  log("Test 6/8: Speak → thinking → done");
  const sseRequests = [];
  page.on("request", (req) => {
    if (req.url().includes("/events?jobId=")) sseRequests.push(req.url());
  });

  await page.locator("textarea.composer__input").fill("你好，请用一句话简短回复");
  await screenshot(page, "06a-before-send");
  await page.locator("button.btn--primary").click();

  const thinking = page.locator(".message--thinking");
  await thinking.waitFor({ state: "visible", timeout: 30_000 });
  await screenshot(page, "06b-thinking");

  const pageB2 = await context.newPage();
  await pageB2.goto(WEB_UI, { waitUntil: "networkidle", timeout: 30_000 });
  await pageB2.locator('[data-testid="movement-panel"]').waitFor({ timeout: 20_000 });
  const composerB = pageB2.locator("textarea.composer__input");
  await composerB.waitFor({ state: "visible", timeout: 10_000 });
  if (await composerB.isDisabled()) {
    await stop("标签 B 在标签 A thinking 时被禁用");
  }
  await composerB.fill("标签 B 可并行输入");
  await screenshot(pageB2, "06b-tab-b-composer-free");
  await pageB2.close();

  const npcReply = page.locator(".message--npc").last();
  await npcReply.waitFor({ state: "visible", timeout: SPEAK_TIMEOUT_MS });
  const replyText = await npcReply.locator(".message__text").textContent();
  if (!replyText?.trim()) await stop("NPC 回复为空");
  await screenshot(page, "06c-npc-reply");

  if (sseRequests.length > 0) {
    log(`  WARN: 仍观察到 SSE 请求 ${sseRequests.length} 条（主路径应为 Colyseus broadcast）`);
  }
  log(`  ✓ Test 6 pass — 回复: ${replyText.slice(0, 60)}…\n`);

  // —— Test 7: Reload reconnect ——
  currentTest = 7;
  log("Test 7/8: 刷新后重连");
  const beforeReload = await getSelfGridPos(page);
  await screenshot(page, "07a-before-reload");
  await page.reload({ waitUntil: "networkidle", timeout: 30_000 });
  await page.locator('[data-testid="movement-panel"]').waitFor({ timeout: 20_000 });
  await page.waitForSelector(".movement-cell--self:not([disabled])", { timeout: 20_000 });
  await waitPlayerSynced(page);
  await waitSelfAt(page, beforeReload.x, beforeReload.y, 15_000);
  const afterReload = await getSelfGridPos(page);
  await screenshot(page, "07b-after-reload");
  if (afterReload.x !== beforeReload.x || afterReload.y !== beforeReload.y) {
    await stop(
      `刷新后坐标 (${afterReload.x},${afterReload.y}) ≠ 刷新前 (${beforeReload.x},${beforeReload.y})`,
    );
  }
  await page.keyboard.press("s");
  await page.waitForTimeout(300);
  log("  ✓ Test 7 pass\n");

  await ctxB.close();
  await context.close();
  await browser.close();

  // —— Test 8: verify:phase6 ——
  currentTest = 8;
  log("Test 8/8: verify:phase6 脚本");
  try {
    await runVerifyPhase6();
  } catch (err) {
    await stop(err.message);
  }
  log("  ✓ Test 8 pass\n");

  log("✅ Phase 6 UAT 1–8 全部通过");
  log(`截图目录: ${path.relative(ROOT, OUT_DIR)}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
