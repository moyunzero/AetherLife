/**
 * Phase 16 E2E — Wave 1–2: WorldRegion + zone wander + ambient intent smoke.
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real API keys in .env.
 * P16-07a: reasonZh data strict (registry). P16-07b UI intent subline — not a ship gate (session 5).
 * Output: .planning/phases/16-intelligent-ambient-npcs/verify-screenshots/ + verify-report.json
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";

const BOOT_WARN_MS = 5000;
const BOOT_FAIL_MS = 8000;
const AMBIENT_WAIT_MS = 7000;
const INTENT_WAIT_MS = 45000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(
  root,
  ".planning/phases/16-intelligent-ambient-npcs/verify-screenshots",
);

const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!(key in process.env)) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE16_ROOM_ID || `verify-p16-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;

const CLOCK_RE = /\d{1,2}:\d{2}/;

const report = {
  roomId,
  webUrl,
  worldSeed: process.env.WORLD_SEED,
  startedAt: new Date().toISOString(),
  screenshots: [],
  cases: [],
  pass: false,
};

/**
 * Append a test case result to the run report and fail the run on a failing case.
 *
 * Adds an entry to `report.cases` with the provided `id`, `title`, `ok` flag, optional `detail`, and an ISO timestamp; logs the result. If `ok` is `false`, throws an Error to stop execution.
 *
 * @param {string} id - Short identifier for the check (e.g., "P16-01").
 * @param {string} title - Human-readable title describing the check.
 * @param {boolean} ok - Pass status for the check; `true` for pass, `false` for fail.
 * @param {string} [detail=""] - Optional additional information to record with the case.
 * @throws {Error} When `ok` is `false`.
 */
function record(id, title, ok, detail = "") {
  report.cases.push({ id, title, ok, detail, at: new Date().toISOString() });
  console.log(`${ok ? "✓" : "✗"} ${id} ${title}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`${id}: ${title}${detail ? ` (${detail})` : ""}`);
}

/**
 * Take a full-page screenshot of the given Playwright page, save it under the phase output directory, record the screenshot path in the report, and log the relative path.
 *
 * @param {import('playwright').Page} page - Playwright page to capture.
 * @param {string} filename - Filename (relative to the phase output directory) to write the screenshot to.
 * @returns {string} The absolute path to the written screenshot file.
 */
async function shot(page, filename) {
  await mkdir(outDir, { recursive: true });
  const file = resolve(outDir, filename);
  await page.screenshot({ path: file, fullPage: true });
  const rel = relative(root, file);
  report.screenshots.push(rel);
  console.log(`  📸 ${rel}`);
  return file;
}

/**
 * Capture a screenshot of the Phaser canvas element and save it to the output directory.
 * Also records the screenshot path in the report and logs the saved file.
 * @param {import('playwright').Page} page - Playwright page containing the Phaser canvas.
 * @param {string} filename - Filename to use within the output directory.
 * @returns {string} The absolute path to the saved screenshot file.
 */
async function shotCanvas(page, filename) {
  await mkdir(outDir, { recursive: true });
  const file = resolve(outDir, filename);
  const canvas = page.locator('[data-testid="phaser-parent"] canvas').first();
  await canvas.screenshot({ path: file });
  const rel = relative(root, file);
  report.screenshots.push(rel);
  console.log(`  📸 ${rel}`);
  return file;
}

/**
 * Checks the game-server health endpoint and throws if the service is unavailable or the response is not a recognized healthy body.
 *
 * @throws {Error} If the HTTP response status is not OK (error message includes the status code) or if the parsed JSON does not indicate a healthy game-server (expects `service === "game-server"` or `status === "ok"` or `ok === true`).
 */
async function healthOk() {
  const res = await fetch(`${httpBase}/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
  const body = await res.json().catch(() => ({}));
  if (body.service !== "game-server" && body.status !== "ok" && body.ok !== true) {
    throw new Error("unexpected health body");
  }
}

/**
 * Load Playwright's Chromium launcher from the pinned scripts/.pw-deps dependency.
 *
 * @returns {object} The Playwright `chromium` export used to launch browsers.
 * @throws {Error} If the Playwright Chromium export cannot be found in the bundled dependency.
 */
async function loadPlaywright() {
  const pwEntry = resolve(root, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) {
    throw new Error("playwright not installed — cd scripts/.pw-deps && npm install");
  }
  return chromium;
}

/**
 * Read and validate the on-screen game clock HUD text.
 *
 * Waits for the element with `data-testid="explore-game-clock"` to become visible,
 * extracts and trims its text content, and verifies it matches the expected clock pattern.
 *
 * @param {import('playwright').Page} page - Playwright page containing the HUD.
 * @returns {string} The trimmed clock text (e.g., "9:05" or "12:34").
 * @throws {Error} If the clock element's text does not match the expected `CLOCK_RE` pattern or the element does not become visible within the timeout.
 */
async function readGameClockText(page) {
  const el = page.locator('[data-testid="explore-game-clock"]');
  await el.waitFor({ state: "visible", timeout: 30_000 });
  const text = (await el.textContent())?.trim() ?? "";
  if (!CLOCK_RE.test(text)) {
    throw new Error(`explore-game-clock text invalid: "${text}"`);
  }
  return text;
}

/**
 * Read the visible region HUD label from the page.
 *
 * Waits up to 30 seconds for the element with `data-testid="explore-region-label"` to become visible, then returns its trimmed text.
 * @returns {string} The trimmed region label text.
 * @throws {Error} If the label is empty or the element does not become visible within 30 seconds.
 */
async function readRegionLabel(page) {
  const el = page.locator('[data-testid="explore-region-label"]');
  await el.waitFor({ state: "visible", timeout: 30_000 });
  const text = (await el.textContent())?.trim() ?? "";
  if (!text) {
    throw new Error("explore-region-label empty — expected registry-driven regionLabelZh");
  }
  return text;
}

/**
 * Reads the page's ambient debug probe and returns a normalized snapshot of ambient state.
 *
 * @returns {{ok: boolean, minute: number|null, label: string|undefined, activityById: Object, visibleNpcIds: string[], reasonZhById: Object, visibleIntentNpcIds: string[], reason?: string}} 
 * An object where:
 *  - `ok` is `true` if a valid minute is present and not `360`, `false` otherwise.
 *  - `minute` is the current ambient minute or `null`/`undefined` if unavailable.
 *  - `label` is the ambient label reported by the probe.
 *  - `activityById` maps NPC ids to their activity data (empty object if absent).
 *  - `visibleNpcIds` is an array of NPC ids currently visible (empty array if absent).
 *  - `reasonZhById` maps NPC ids to localized reason strings (empty object if absent).
 *  - `visibleIntentNpcIds` is an array of NPC ids with visible intents (empty array if absent).
 *  - `reason` is provided when the probe function is missing or returns null to explain the failure.
 */
async function readAmbientProbe(page) {
  return page.evaluate(() => {
    const fn = window.__aetherlife_ambientDebug;
    if (typeof fn !== "function") {
      return { ok: false, reason: "__aetherlife_ambientDebug missing (dev stack required)" };
    }
    const probe = fn();
    if (!probe) {
      return { ok: false, reason: "ambient debug returned null" };
    }
    return {
      ok: probe.minute != null && probe.minute !== 360,
      minute: probe.minute,
      label: probe.label,
      activityById: probe.npcActivityById ?? {},
      visibleNpcIds: probe.visibleNpcIds ?? [],
      reasonZhById: probe.reasonZhById ?? {},
      visibleIntentNpcIds: probe.visibleIntentNpcIds ?? [],
    };
  });
}

/**
 * Read a snapshot of NPC positions from the page's NPC debug hook.
 * @param {import('playwright').Page} page - Playwright page to evaluate the debug function in.
 * @returns {{ok: boolean, npcs: {id: string, x: number, y: number}[], reason?: string}} Object with `ok` indicating whether a non-empty NPC array was returned and `npcs` as an array of `{id, x, y}` position entries; when the debug hook is missing `ok` is `false` and `reason` is provided.
 */
async function readNpcSnapshot(page) {
  return page.evaluate(() => {
    const fn = window.__aetherlife_npcDebug;
    if (typeof fn !== "function") {
      return { ok: false, reason: "__aetherlife_npcDebug missing" };
    }
    const snap = fn();
    const npcs = snap?.npcs ?? [];
    return {
      ok: Array.isArray(npcs) && npcs.length > 0,
      npcs: npcs.map((n) => ({ id: n.id, x: n.x, y: n.y })),
    };
  });
}

/**
 * Collects NPC-intent DOM nodes from the page and returns their test IDs and trimmed text content.
 * @param {import('playwright').Page} page - Playwright page to query.
 * @returns {{testId: string|null, text: string}[]} An array of objects where `testId` is the element's `data-testid` attribute and `text` is the element's trimmed text content.
 */
async function countIntentDomNodes(page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-testid^="npc-intent-"]');
    return Array.from(nodes).map((el) => ({
      testId: el.getAttribute("data-testid"),
      text: (el.textContent ?? "").trim(),
    }));
  });
}

/**
 * Determine whether any NPC's grid position changed between two snapshots.
 *
 * Compares NPCs by `id` and reports whether any matching NPC has a different `x` or `y` value.
 *
 * @param {Array<{id: string, x: number, y: number}>} before - Snapshot of NPCs before the interval.
 * @param {Array<{id: string, x: number, y: number}>} after - Snapshot of NPCs after the interval.
 * @returns {boolean} `true` if at least one NPC present in both snapshots has a different `x` or `y`, `false` otherwise.
 */
function npcPositionsChanged(before, after) {
  if (!before?.length || !after?.length) return false;
  const afterById = new Map(after.map((n) => [n.id, n]));
  for (const b of before) {
    const a = afterById.get(b.id);
    if (!a) continue;
    if (a.x !== b.x || a.y !== b.y) return true;
  }
  return false;
}

/**
 * Nudges the player with a short movement pattern to provoke proximity-based game logic and waits for movement to finish.
 *
 * Waits up to 15 seconds for the page's move debug to report `pending === 0` and `!locomoting`. Timeouts are swallowed (the function does not throw on wait timeout).
 * @param {import('playwright').Page} page - Playwright page used to simulate the input and observe move debug.
 */
async function nudgePlayerForProximity(page) {
  await page.locator('[data-testid="explore-coords-strip"]').click();
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press(["w", "d", "s", "a"][i % 4]);
    await page.waitForTimeout(200);
  }
  await page.waitForFunction(
    () => {
      const d = window.__aetherlife_moveDebug?.();
      return d != null && d.pending === 0 && !d.locomoting;
    },
    { timeout: 15_000 },
  ).catch(() => undefined);
}

/**
 * Detects whether any activity values differ between two activity maps.
 * @param {Record<string, unknown>} before - Mapping of activity values keyed by ID from the earlier snapshot.
 * @param {Record<string, unknown>} after - Mapping of activity values keyed by ID from the later snapshot.
 * @returns {boolean} `true` if any ID's activity value differs between `before` and `after`, `false` otherwise.
 */
function activityChanged(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const id of keys) {
    if ((before?.[id] ?? "") !== (after?.[id] ?? "")) return true;
  }
  return false;
}

/**
 * Write the verification report to disk and log its relative path.
 *
 * Sets report.finishedAt to the current ISO timestamp, ensures the output
 * directory exists, writes a pretty-printed `verify-report.json` into the
 * output directory, and logs the report file path relative to the repository root.
 */
async function writeReport() {
  report.finishedAt = new Date().toISOString();
  await mkdir(outDir, { recursive: true });
  const reportPath = resolve(outDir, "verify-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`verify:phase16: report → ${relative(root, reportPath)}`);
}

/**
 * Verify that background ("bg-villager-*") NPCs exist in the room and that attempting to send chat as a background NPC is rejected.
 *
 * Fetches the room state, ensures there are between 2 and 4 NPCs whose IDs start with "bg-villager-", and posts a chat message as "bg-villager-1" expecting an HTTP 400 response.
 *
 * @returns {{ bgCount: number, bgIds: Array<string> }} An object containing the count of matched background NPCs and their IDs.
 * @throws {Error} If the room state fetch fails, if the number of background NPCs is not between 2 and 4, or if the chat POST does not return HTTP 400.
 */
async function assertBackgroundNpcSpeakBlocked() {
  const stateRes = await fetch(`${httpBase}/rooms/${roomId}/state`);
  if (!stateRes.ok) {
    throw new Error(`GET state ${stateRes.status}`);
  }
  const stateBody = await stateRes.json();
  const bgNpcs = (stateBody.state?.npcs ?? []).filter((n) =>
    String(n.id).startsWith("bg-villager-"),
  );
  if (bgNpcs.length < 2 || bgNpcs.length > 4) {
    throw new Error(`expected 2–4 bg npcs, got ${bgNpcs.length}`);
  }
  const chatRes = await fetch(`${httpBase}/rooms/${roomId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "你好", npcId: "bg-villager-1" }),
  });
  if (chatRes.status !== 400) {
    const body = await chatRes.text();
    throw new Error(`speak to bg npc expected 400, got ${chatRes.status}: ${body}`);
  }
  return { bgCount: bgNpcs.length, bgIds: bgNpcs.map((n) => n.id) };
}

/**
 * Retrieve background NPCs for the current room whose IDs start with "bg-villager-".
 *
 * @returns {Array<object>} Array of NPC objects from the room state matching the `bg-villager-` id prefix.
 * @throws {Error} If fetching the room state responds with a non-OK HTTP status.
 */
async function fetchRoomBgNpcs() {
  const stateRes = await fetch(`${httpBase}/rooms/${roomId}/state`);
  if (!stateRes.ok) {
    throw new Error(`GET state ${stateRes.status}`);
  }
  const stateBody = await stateRes.json();
  return (stateBody.state?.npcs ?? []).filter((n) =>
    String(n.id).startsWith("bg-villager-"),
  );
}

/**
 * Move the player to a target grid cell and wait until movement has settled.
 *
 * Sends a move command for the specified grid coordinates and waits (up to 30 seconds)
 * for the page's movement debug to report `pending === 0` and `locomoting === false`.
 *
 * @param {object} page - Playwright Page instance.
 * @param {number} x - Target grid X coordinate.
 * @param {number} y - Target grid Y coordinate.
 */
async function movePlayerToGrid(page, x, y) {
  await page.evaluate(({ tx, ty }) => {
    window.__aetherlife_sendMoveTo?.(tx, ty);
  }, { tx: x, ty: y });
  await page.waitForFunction(
    () => {
      const d = window.__aetherlife_moveDebug?.();
      return d != null && d.pending === 0 && !d.locomoting;
    },
    { timeout: 30_000 },
  );
}

/**
 * Polls the background-NPC debug probe until a visible bg nameplate is observed or the timeout is reached.
 *
 * @param {import('playwright').Page} page - Playwright page used to evaluate the bg NPC debug probe.
 * @param {number} [timeoutMs=8000] - Maximum time to wait in milliseconds.
 * @returns {Object} The last probe returned by `readBgNpcProbe`, typically an object with an `ok` boolean and `visibleBgNameplates` (or a `reason` when `ok` is `false`).
 */
async function waitForBgNameplate(page, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = await readBgNpcProbe(page);
  while (Date.now() < deadline && !last.ok) {
    await page.waitForTimeout(400);
    last = await readBgNpcProbe(page);
  }
  return last;
}

/**
 * Compute the Chebyshev distance between two grid coordinates.
 * @param {number} ax - X coordinate of the first point.
 * @param {number} ay - Y coordinate of the first point.
 * @param {number} bx - X coordinate of the second point.
 * @param {number} by - Y coordinate of the second point.
 * @returns {number} The Chebyshev distance (the larger of the absolute differences in X and Y).
 */
function chebyshevDistance(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * List nearby grid cells around a background NPC ordered by proximity.
 *
 * @param {number} bgX - Background NPC grid X coordinate.
 * @param {number} bgY - Background NPC grid Y coordinate.
 * @returns {{x: number, y: number}[]} An array of candidate grid cells (objects with `x` and `y`) within a Chebyshev distance of 2 from the background NPC, excluding the NPC's own cell and any cells with negative coordinates, sorted by increasing distance from `(bgX, bgY)`.
 */
function cellsNearBg(bgX, bgY) {
  const out = [];
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      const x = bgX + dx;
      const y = bgY + dy;
      if (x < 0 || y < 0) continue;
      if (chebyshevDistance(x, y, bgX, bgY) > 2) continue;
      out.push({ x, y });
    }
  }
  return out.sort(
    (a, b) =>
      chebyshevDistance(a.x, a.y, bgX, bgY) - chebyshevDistance(b.x, b.y, bgX, bgY),
  );
}

/**
 * Retrieve the in-page move debug object produced by the application, or null if unavailable.
 * @returns {Object|null} The object returned by `window.__aetherlife_moveDebug()` when present, or `null` if the function is not defined on the page.
 */
async function readMoveDebug(page) {
  return page.evaluate(() => window.__aetherlife_moveDebug?.() ?? null);
}

/**
 * Move the player to nearby cells around a background NPC and attempt to observe its nameplate.
 * @param {import('@playwright/test').Page} page - Playwright page used to move the player and read debug probes.
 * @param {number} bgX - Background NPC grid X coordinate to approach.
 * @param {number} bgY - Background NPC grid Y coordinate to approach.
 * @returns {Promise<{
 *   probe: import('./').BgNpcProbe|object,
 *   playerCell: {x: number, y: number}|null,
 *   dist: number|null,
 *   targetCell: {x: number, y: number}|null
 * }>} An object containing the latest background-NPC probe, the player's settled grid cell (or null if unavailable), the Chebyshev distance from the player to the NPC (or null), and the candidate target cell that produced a successful nameplate observation (or null if none succeeded).
 */
async function movePlayerNearBgNpc(page, bgX, bgY) {
  for (const cell of cellsNearBg(bgX, bgY)) {
    await movePlayerToGrid(page, cell.x, cell.y);
    await page.waitForTimeout(400);
    const move = await readMoveDebug(page);
    if (!move) continue;
    const dist = chebyshevDistance(move.gridX, move.gridY, bgX, bgY);
    if (dist > 2) continue;
    const probe = await waitForBgNameplate(page, 2500);
    if (probe.ok) {
      return { probe, playerCell: { x: move.gridX, y: move.gridY }, dist, targetCell: cell };
    }
  }
  const move = await readMoveDebug(page);
  return {
    probe: await readBgNpcProbe(page),
    playerCell: move ? { x: move.gridX, y: move.gridY } : null,
    dist: move ? chebyshevDistance(move.gridX, move.gridY, bgX, bgY) : null,
    targetCell: null,
  };
}

/**
 * Probe the page for background-NPC nameplate visibility and related debug data.
 *
 * @param {import('playwright').Page} page - Playwright Page to evaluate the bg-NPC debug function on.
 * @returns {{ok: boolean, visibleBgNameplates: Array<object>, reason?: string}} `ok` is `true` if at least one visible background nameplate meets the visibility criteria (its `testid` equals `"bg-npc-nameplate"`, its `fontSize` string includes `"11"`, and its `alpha` is greater than `0.05`); `visibleBgNameplates` is the array of plates returned by the page probe. If the in-page debug function is missing, `ok` is `false` and `reason` contains an explanatory message.
 */
async function readBgNpcProbe(page) {
  return page.evaluate(() => {
    const fn = window.__aetherlife_bgNpcDebug;
    if (typeof fn !== "function") {
      return { ok: false, reason: "__aetherlife_bgNpcDebug missing (dev stack required)" };
    }
    const probe = fn();
    const plates = probe?.visibleBgNameplates ?? [];
    return {
      ok: plates.some(
        (p) =>
          p.testid === "bg-npc-nameplate" &&
          String(p.fontSize).includes("11") &&
          p.alpha > 0.05,
      ),
      visibleBgNameplates: plates,
    };
  });
}

/**
 * Runs the Phase 16 end-to-end verification routine that exercises the web client and game server, records check results, captures screenshots, and writes a verification report.
 *
 * Performs health checks, validates background NPC speak-blocking, boots a headless Chromium page, verifies HUD elements (region label and game clock), captures ambient and NPC debug probes, checks ambient ticks and NPC movement/activity, probes intent-related data and DOM, ensures no Phaser fallback banner, seeks proximity to a background NPC to validate muted nameplate behaviour, verifies cross-region HUD label, takes screenshots at each step, and aggregates results into the persistent verify-report.json.
 *
 * On failure the function records the error into the report, attempts failure screenshots when possible, closes the browser, writes the report, and rethrows the error.
 */
async function main() {
  assertE2eNoMock("verify:phase16");
  console.log(`verify:phase16 → ${webUrl} WORLD_SEED=${process.env.WORLD_SEED}`);
  await healthOk();
  record("P16-00", "game-server health", true);

  const bgState = await assertBackgroundNpcSpeakBlocked();
  report.bgNpcState = bgState;
  record(
    "P16-11",
    "background NPC speak blocked (HTTP chat 400)",
    true,
    `${bgState.bgCount} bg ids: ${bgState.bgIds.join(", ")}`,
  );

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage();
    const bootStart = Date.now();
    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const canvas = page.locator('[data-testid="phaser-parent"] canvas').first();
    await canvas.waitFor({ state: "visible", timeout: 45_000 });
    const bootMs = Date.now() - bootStart;
    report.bootMs = bootMs;
    console.log(`verify:phase16: bootMs=${bootMs}`);
    if (bootMs > BOOT_WARN_MS) {
      console.warn(`verify:phase16: WARN bootMs=${bootMs} exceeds ${BOOT_WARN_MS}ms budget`);
    }
    record("P16-01", "Phaser canvas boot", bootMs <= BOOT_FAIL_MS, `bootMs=${bootMs}`);
    await shot(page, "01-boot-full.png");
    await shotCanvas(page, "01-boot-canvas.png");

    await page.locator('[data-testid="explore-coords-strip"]').waitFor({ timeout: 30_000 });

    const regionLabel = await readRegionLabel(page);
    report.regionLabel = regionLabel;
    console.log(`verify:phase16: regionLabel=${regionLabel}`);
    if (regionLabel !== "起始田野") {
      console.warn(
        `verify:phase16: WARN region label "${regionLabel}" !== expected 起始田野 (spawn-dependent)`,
      );
    }
    record("P16-02", "region HUD label", Boolean(regionLabel), regionLabel);

    const clockBefore = await readGameClockText(page);
    report.clockBefore = clockBefore;
    console.log(`verify:phase16: clockBefore=${clockBefore}`);
    record("P16-03", "game clock visible", CLOCK_RE.test(clockBefore), clockBefore);
    await shot(page, "02-region-clock-hud.png");

    const npcBefore = await readNpcSnapshot(page);
    const ambientBefore = await readAmbientProbe(page);
    report.npcBefore = npcBefore.npcs;
    report.ambientBefore = ambientBefore;
    console.log(
      `verify:phase16: npcBefore=${JSON.stringify(npcBefore.npcs?.map((n) => `${n.id}@(${n.x},${n.y})`))}`,
    );
    record("P16-04", "ambient debug probe", ambientBefore.minute != null, JSON.stringify(ambientBefore));
    await shot(page, "03-ambient-before.png");

    await page.waitForTimeout(AMBIENT_WAIT_MS);

    const clockAfter = await readGameClockText(page);
    report.clockAfter = clockAfter;
    console.log(`verify:phase16: clockAfter=${clockAfter} (waited ${AMBIENT_WAIT_MS}ms)`);

    if (clockBefore === clockAfter) {
      const probeMid = await readAmbientProbe(page);
      if (!probeMid.ok) {
        throw new Error(
          `game clock unchanged after ambient wait (${clockBefore} → ${clockAfter}); probe=${JSON.stringify(probeMid)}`,
        );
      }
      console.log(
        `verify:phase16: HUD text unchanged but registry minute=${probeMid.minute} (ambient tick OK)`,
      );
    }

    const probe = await readAmbientProbe(page);
    report.ambientAfter = probe;
    if (probe.minute == null) {
      record("P16-05", "ambient tick minute", false, JSON.stringify(probe));
    } else if (probe.minute === 360) {
      record("P16-05", "ambient tick minute", false, `still 360 after ${AMBIENT_WAIT_MS}ms`);
    } else {
      record("P16-05", "ambient tick minute", true, String(probe.minute));
    }

    const npcAfter = await readNpcSnapshot(page);
    report.npcAfter = npcAfter.npcs;
    const moved = npcPositionsChanged(npcBefore.npcs, npcAfter.npcs);
    const activityDelta = activityChanged(ambientBefore.activityById, probe.activityById);
    report.npcMoved = moved;
    report.activityChanged = activityDelta;

    if (!moved && !activityDelta) {
      record(
        "P16-06",
        "ambient movement signal",
        false,
        `no npc move or activity delta after ${AMBIENT_WAIT_MS}ms`,
      );
    } else {
      record("P16-06", "ambient movement signal", true, `moved=${moved} activity=${activityDelta}`);
    }

    console.log(
      `verify:phase16: gameMinute=${probe.minute} npcMoved=${moved} activityChanged=${activityDelta} activityKeys=${JSON.stringify(probe.activityById)}`,
    );
    await shot(page, "04-ambient-after.png");
    await shotCanvas(page, "04-ambient-after-canvas.png");

    if (probe.visibleNpcIds?.length) {
      console.log(`verify:phase16: proximity activity visible for ${probe.visibleNpcIds.join(", ")}`);
    }

    await nudgePlayerForProximity(page);
    await shot(page, "04b-after-nudge.png");

    const intentWaitMs = Math.max(0, INTENT_WAIT_MS - AMBIENT_WAIT_MS);
    if (intentWaitMs > 0) {
      await page.waitForTimeout(intentWaitMs);
    }
    const intentProbe = await readAmbientProbe(page);
    const intentDom = await countIntentDomNodes(page);
    report.intentProbe = intentProbe;
    report.intentDom = intentDom;

    const hasReasonZh = Object.values(intentProbe.reasonZhById ?? {}).some(
      (s) => typeof s === "string" && s.trim().length > 0,
    );

    console.log(
      `verify:phase16: intent wait=${INTENT_WAIT_MS}ms reasonZhById=${JSON.stringify(intentProbe.reasonZhById)} visibleIntent=${intentProbe.visibleIntentNpcIds?.join(",") ?? ""} dom=${JSON.stringify(intentDom)}`,
    );

    record(
      "P16-07a",
      "intent reasonZh data (any non-empty)",
      hasReasonZh,
      `reasonZh=${hasReasonZh} after ${INTENT_WAIT_MS}ms`,
    );

    const hasVisibleIntentDom = intentDom.some((n) => n.text.length > 0);
    const hasVisibleIntentRegistry = (intentProbe.visibleIntentNpcIds ?? []).length > 0;
    if (hasVisibleIntentDom || hasVisibleIntentRegistry) {
      console.log(
        `verify:phase16: P16-07b skip — player intent subline UI disabled (session 5); dom=${hasVisibleIntentDom} registry=${hasVisibleIntentRegistry}`,
      );
    }

    await shot(page, "05-intent-after.png");
    await shotCanvas(page, "05-intent-after-canvas.png");

    const fallback = await page.locator('[data-testid="phaser-fallback-banner"]').count();
    record("P16-08", "no Phaser fallback banner", fallback === 0, `count=${fallback}`);

    const bgNpcsLive = await fetchRoomBgNpcs();
    if (bgNpcsLive.length === 0) {
      throw new Error("P16-10: no bg npcs in room state");
    }
    const targetBg = bgNpcsLive[0];
    report.bgNpcProximityTarget = { bgId: targetBg.id, bgX: targetBg.x, bgY: targetBg.y };
    console.log(
      `verify:phase16: P16-10 seek proximity to ${targetBg.id}@(${targetBg.x},${targetBg.y})`,
    );
    const near = await movePlayerNearBgNpc(page, targetBg.x, targetBg.y);
    report.bgNpcProximityResult = near;
    const bgProbe = near.probe;
    report.bgNpcProbe = bgProbe;
    console.log(`verify:phase16: bgNpcProbe=${JSON.stringify(bgProbe)}`);
    record(
      "P16-10",
      "background NPC muted nameplate (bg-npc-nameplate 11px)",
      bgProbe.ok,
      JSON.stringify(bgProbe.visibleBgNameplates),
    );
    await shot(page, "08-bg-npc-nameplate.png");
    await shotCanvas(page, "08-bg-npc-nameplate-canvas.png");

    await page.evaluate(() => {
      window.__aetherlife_sendMoveTo?.(48, 20);
    });
    await page.waitForFunction(
      () => {
        const d = window.__aetherlife_moveDebug?.();
        return d != null && d.pending === 0 && !d.locomoting;
      },
      { timeout: 15_000 },
    );
    const plazaRegionLabel = await readRegionLabel(page);
    report.plazaRegionLabel = plazaRegionLabel;
    record(
      "P16-09",
      "cross-region HUD label (村内广场)",
      /广场/.test(plazaRegionLabel),
      plazaRegionLabel,
    );
    await shot(page, "07-plaza-region-label.png");

    await shot(page, "06-final-pass.png");

    report.pass = true;
  } catch (err) {
    report.pass = false;
    report.error = err.message;
    if (page) {
      try {
        await shot(page, "99-failure-full.png");
        await shotCanvas(page, "99-failure-canvas.png");
      } catch {
        /* ignore screenshot errors on failure path */
      }
    }
    throw err;
  } finally {
    await browser.close();
    await writeReport();
  }

  console.log("verify:phase16 OK");
}

main().catch((err) => {
  console.error(`verify:phase16 failed: ${err.message}`);
  console.error("Ensure full stack: pnpm dev:stack (no LLM_MOCK). Game-server :2567, web :5173.");
  console.error(`Screenshots: ${relative(root, outDir)}/`);
  process.exit(1);
});
