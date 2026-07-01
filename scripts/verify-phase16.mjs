/**
 * Phase 16 E2E — Wave 1–2: WorldRegion + zone wander + ambient intent smoke.
 * Requires: pnpm dev:stack (no LLM_MOCK=1), real API keys in .env.
 * P16-07a: reasonZh data strict (registry). P16-07b UI intent subline — not a ship gate (session 5).
 * Phase 26+: 12 council NPCs on map; bg-villager tier removed — P16-10/11 assert council presence + invalid speak 400.
 * Output: .planning/phases/16-intelligent-ambient-npcs/verify-screenshots/ + verify-report.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";
import { gameServerHttpBase, loadRootEnv } from "./lib/env.mjs";
import { assertCanonicalCouncilRoster, COUNCIL_NPC_IDS } from "./lib/council-spawn.mjs";

const BOOT_WARN_MS = 5000;
const BOOT_FAIL_MS = 8000;
const AMBIENT_WAIT_MS = 7000;
const INTENT_WAIT_MS = 45000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(
  root,
  ".planning/phases/16-intelligent-ambient-npcs/verify-screenshots",
);

loadRootEnv(root);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const webBase = process.env.WEB_URL || "http://localhost:5173";
const roomId = process.env.VERIFY_PHASE16_ROOM_ID || `verify-p16-${Date.now()}`;
const webUrl = `${webBase}${webBase.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;

const CLOCK_RE = /\d{1,2}:\d{2}/;
const COUNCIL_NPC_COUNT = COUNCIL_NPC_IDS.length;
const COUNCIL_NAMEPLATE_FONT = "10";

const report = {
  roomId,
  webUrl,
  worldSeed: process.env.WORLD_SEED,
  startedAt: new Date().toISOString(),
  screenshots: [],
  cases: [],
  pass: false,
};

function record(id, title, ok, detail = "") {
  report.cases.push({ id, title, ok, detail, at: new Date().toISOString() });
  console.log(`${ok ? "✓" : "✗"} ${id} ${title}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`${id}: ${title}${detail ? ` (${detail})` : ""}`);
}

async function shot(page, filename) {
  await mkdir(outDir, { recursive: true });
  const file = resolve(outDir, filename);
  await page.screenshot({ path: file, fullPage: true });
  const rel = relative(root, file);
  report.screenshots.push(rel);
  console.log(`  📸 ${rel}`);
  return file;
}

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

async function healthOk() {
  const res = await fetch(`${httpBase}/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
  const body = await res.json().catch(() => ({}));
  if (body.service !== "game-server" && body.status !== "ok" && body.ok !== true) {
    throw new Error("unexpected health body");
  }
}

async function loadPlaywright() {
  const pwEntry = resolve(root, "scripts", ".pw-deps", "node_modules", "playwright", "index.mjs");
  const pw = await import(pathToFileURL(pwEntry).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) {
    throw new Error("playwright not installed — cd scripts/.pw-deps && npm install");
  }
  return chromium;
}

async function readGameClockText(page) {
  const el = page.locator('[data-testid="explore-game-clock"]');
  await el.waitFor({ state: "visible", timeout: 30_000 });
  const text = (await el.textContent())?.trim() ?? "";
  if (!CLOCK_RE.test(text)) {
    throw new Error(`explore-game-clock text invalid: "${text}"`);
  }
  return text;
}

async function readRegionLabel(page) {
  const el = page.locator('[data-testid="explore-region-label"]');
  await el.waitFor({ state: "visible", timeout: 30_000 });
  const text = (await el.textContent())?.trim() ?? "";
  if (!text) {
    throw new Error("explore-region-label empty — expected registry-driven regionLabelZh");
  }
  return text;
}

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

async function countIntentDomNodes(page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-testid^="npc-intent-"]');
    return Array.from(nodes).map((el) => ({
      testId: el.getAttribute("data-testid"),
      text: (el.textContent ?? "").trim(),
    }));
  });
}

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

async function nudgePlayerForProximity(page) {
  const canvas = page.locator('[data-testid="phaser-parent"] canvas').first();
  await canvas.click({ force: true });
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

function activityChanged(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const id of keys) {
    if ((before?.[id] ?? "") !== (after?.[id] ?? "")) return true;
  }
  return false;
}

async function writeReport() {
  report.finishedAt = new Date().toISOString();
  await mkdir(outDir, { recursive: true });
  const reportPath = resolve(outDir, "verify-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`verify:phase16: report → ${relative(root, reportPath)}`);
}

async function assertCouncilRoomAndSpeakGuards() {
  const stateRes = await fetch(`${httpBase}/rooms/${roomId}/state`);
  if (!stateRes.ok) {
    throw new Error(`GET state ${stateRes.status}`);
  }
  const stateBody = await stateRes.json();
  const npcs = stateBody.state?.npcs ?? [];
  const councilNpcs = npcs.filter((n) => COUNCIL_NPC_IDS.includes(String(n.id)));
  const bgNpcs = npcs.filter((n) => String(n.id).startsWith("bg-villager-"));
  if (councilNpcs.length !== COUNCIL_NPC_COUNT) {
    throw new Error(
      `expected ${COUNCIL_NPC_COUNT} council npcs, got ${councilNpcs.length}`,
    );
  }
  assertCanonicalCouncilRoster(councilNpcs.map((n) => n.id));
  if (bgNpcs.length > 0) {
    throw new Error(`expected 0 bg npcs after Phase 26, got ${bgNpcs.length}`);
  }
  for (const badId of ["bg-villager-1", "not-a-council-npc"]) {
    const chatRes = await fetch(`${httpBase}/rooms/${roomId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "你好", npcId: badId }),
    });
    if (chatRes.status !== 400) {
      const body = await chatRes.text();
      throw new Error(`speak to ${badId} expected 400, got ${chatRes.status}: ${body}`);
    }
  }
  return {
    councilCount: councilNpcs.length,
    councilIds: councilNpcs.map((n) => n.id),
  };
}

async function fetchRoomCouncilNpcs() {
  const stateRes = await fetch(`${httpBase}/rooms/${roomId}/state`);
  if (!stateRes.ok) {
    throw new Error(`GET state ${stateRes.status}`);
  }
  const stateBody = await stateRes.json();
  return (stateBody.state?.npcs ?? []).filter((n) => COUNCIL_NPC_IDS.includes(String(n.id)));
}

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

async function waitForCouncilNameplate(page, expectedNpcId, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = await readCouncilNameplateProbe(page, expectedNpcId);
  while (Date.now() < deadline && !last.ok) {
    await page.waitForTimeout(400);
    last = await readCouncilNameplateProbe(page, expectedNpcId);
  }
  return last;
}

function cellsNearNpc(npcX, npcY) {
  const out = [];
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      const x = npcX + dx;
      const y = npcY + dy;
      if (x < 0 || y < 0) continue;
      if (chebyshevDistance(x, y, npcX, npcY) > 2) continue;
      out.push({ x, y });
    }
  }
  return out.sort(
    (a, b) =>
      chebyshevDistance(a.x, a.y, npcX, npcY) -
      chebyshevDistance(b.x, b.y, npcX, npcY),
  );
}

function chebyshevDistance(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

async function readMoveDebug(page) {
  return page.evaluate(() => window.__aetherlife_moveDebug?.() ?? null);
}

async function movePlayerNearCouncilNpc(page, npcId, npcX, npcY) {
  for (const cell of cellsNearNpc(npcX, npcY)) {
    await movePlayerToGrid(page, cell.x, cell.y);
    await page.waitForTimeout(400);
    const move = await readMoveDebug(page);
    if (!move) continue;
    const dist = chebyshevDistance(move.gridX, move.gridY, npcX, npcY);
    if (dist > 2) continue;
    const probe = await waitForCouncilNameplate(page, npcId, 2500);
    if (probe.ok) {
      return { probe, playerCell: { x: move.gridX, y: move.gridY }, dist, targetCell: cell };
    }
  }
  const move = await readMoveDebug(page);
  return {
    probe: await readCouncilNameplateProbe(page, npcId),
    playerCell: move ? { x: move.gridX, y: move.gridY } : null,
    dist: move ? chebyshevDistance(move.gridX, move.gridY, npcX, npcY) : null,
    targetCell: null,
  };
}

async function readCouncilNameplateProbe(page, expectedNpcId) {
  return page.evaluate(({ fontPrefix, expectedNpcId: npcId }) => {
    const fn = window.__aetherlife_councilNameplateDebug;
    if (typeof fn !== "function") {
      return {
        ok: false,
        reason: "__aetherlife_councilNameplateDebug missing (dev stack required)",
      };
    }
    const probe = fn();
    const plates = probe?.visibleCouncilNameplates ?? [];
    const fontOk = (p) => String(p.fontSize).includes(fontPrefix) && p.alpha > 0.05;
    return {
      ok: plates.some((p) => p.id === npcId && fontOk(p)),
      expectedNpcId: npcId,
      visibleCouncilNameplates: plates,
    };
  }, { fontPrefix: COUNCIL_NAMEPLATE_FONT, expectedNpcId });
}

async function main() {
  assertE2eNoMock("verify:phase16");
  console.log(`verify:phase16 → ${webUrl} WORLD_SEED=${process.env.WORLD_SEED}`);
  await healthOk();
  record("P16-00", "game-server health", true);

  const councilState = await assertCouncilRoomAndSpeakGuards();
  report.councilNpcState = councilState;
  record(
    "P16-11",
    "12 council NPCs + invalid speak blocked (HTTP chat 400)",
    true,
    `${councilState.councilCount} council ids (0 bg-villager)`,
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

    const councilNpcsLive = await fetchRoomCouncilNpcs();
    if (councilNpcsLive.length < COUNCIL_NPC_COUNT) {
      throw new Error(`P16-10: expected ${COUNCIL_NPC_COUNT} council npcs in room state`);
    }
    const npcSnap = await readNpcSnapshot(page);
    if ((npcSnap.npcs?.length ?? 0) < COUNCIL_NPC_COUNT) {
      record(
        "P16-10a",
        "council map presence (≥12 sprites)",
        false,
        `npcDebug count=${npcSnap.npcs?.length ?? 0}`,
      );
    } else {
      record(
        "P16-10a",
        "council map presence (≥12 sprites)",
        true,
        `count=${npcSnap.npcs?.length}`,
      );
    }
    const targetCouncil = councilNpcsLive.find((n) => n.id === "npc-1") ?? councilNpcsLive[0];
    report.councilNpcProximityTarget = {
      npcId: targetCouncil.id,
      x: targetCouncil.x,
      y: targetCouncil.y,
    };
    console.log(
      `verify:phase16: P16-10 seek proximity to ${targetCouncil.id}@(${targetCouncil.x},${targetCouncil.y})`,
    );
    const near = await movePlayerNearCouncilNpc(page, targetCouncil.id, targetCouncil.x, targetCouncil.y);
    report.councilNpcProximityResult = near;
    const councilProbe = near.probe;
    report.councilNameplateProbe = councilProbe;
    console.log(`verify:phase16: councilNameplateProbe=${JSON.stringify(councilProbe)}`);
    record(
      "P16-10",
      "council proximity nameplate (VIS-04 scaled)",
      councilProbe.ok,
      JSON.stringify(councilProbe.visibleCouncilNameplates),
    );
    await shot(page, "08-council-nameplate.png");
    await shotCanvas(page, "08-council-nameplate-canvas.png");

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
