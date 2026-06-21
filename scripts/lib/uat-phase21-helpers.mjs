/**
 * Phase 21 UAT Playwright helpers — World Echo (SOLO-02/03).
 */
import { engageDialogue } from "./dialogue-engage.mjs";
import { closeShellDrawer, sendSpeakOverlay } from "./e2e-memory-helpers.mjs";
import { HOME_DEFAULT_PLAYER_SPAWN, HOME_NPC_SPAWNS } from "./home-spawn.mjs";

/** UI chrome only — storyHook body is out of scope (21-QUEST-LANGUAGE-AUDIT). */
export const FORBIDDEN_UI_TERMS = Object.freeze([
  "当前线索",
  "线索",
  "任务",
  "目标",
  "完成",
  "quest",
  "objective",
  "mission",
]);

export const CHROME_SELECTORS = [
  '[data-testid="dialogue-bar"]',
  '[data-testid="shell-drawer"]',
  '[data-testid="lore-discover-toast"] .lore-discover-toast__title',
  '[data-testid="discovered-lore-panel"] .discovered-lore-panel__title',
  ".shell-drawer__tab",
  '[aria-label="已发现"]',
  '[aria-label="对话历史"]',
  '[aria-label="集体见闻"]',
];

/**
 * @param {import('playwright').Page} page
 */
export async function assertJournalQuestStripAbsent(page) {
  const count = await page.locator('[data-testid="journal-quest-strip"]').count();
  if (count > 0) {
    throw new Error(`journal-quest-strip present in DOM (count=${count})`);
  }
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (bodyText.includes("当前线索")) {
    throw new Error('HUD contains forbidden label 「当前线索」');
  }
}

/**
 * @param {import('playwright').Page} page
 */
export async function readExploreChunk(page) {
  return page.evaluate(() => {
    const strip = document.querySelector('[data-testid="explore-coords-strip"]');
    if (!strip) return null;
    const text = strip.textContent ?? "";
    const m = text.match(/chunk\s*\((-?\d+),\s*(-?\d+)\)/);
    if (!m) return null;
    return { cx: Number.parseInt(m[1], 10), cy: Number.parseInt(m[2], 10) };
  });
}

/**
 * @param {import('playwright').Page} page
 */
export async function readPlayerGrid(page) {
  return page.evaluate(() => {
    const dbg = window.__aetherlife_moveDebug?.();
    if (dbg) return { x: dbg.gridX, y: dbg.gridY, source: "moveDebug" };
    const meta = document.querySelector(".explore-coords-strip__meta")?.textContent ?? "";
    const m = meta.match(/格\s*\((-?\d+),\s*(-?\d+)\)/);
    if (m) {
      return { x: Number.parseInt(m[1], 10), y: Number.parseInt(m[2], 10), source: "coordsStrip" };
    }
    return null;
  });
}

export async function blurComposerForMovement(page) {
  await page.evaluate(() => {
    document.querySelector("textarea.composer__input")?.blur();
    document.querySelector("input.composer__input")?.blur();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
}

export async function focusExploreForKeyboard(page) {
  await closeShellDrawer(page);
  const stageCanvas = page.locator('[data-testid="phaser-stage-fill"] canvas').first();
  const parentCanvas = page.locator('[data-testid="phaser-parent"] canvas').first();
  const target = (await stageCanvas.count()) > 0 ? stageCanvas : parentCanvas;
  await target.waitFor({ state: "visible", timeout: 30_000 });
  const box = await target.boundingBox();
  if (!box) throw new Error("explore focus: canvas missing boundingBox");
  await blurComposerForMovement(page);
  await target.click({
    position: { x: Math.max(1, Math.floor(box.width / 2)), y: Math.max(1, Math.floor(box.height / 2)) },
  });
  await blurComposerForMovement(page);
}

export async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout: ${label} (${timeoutMs}ms)`);
}

/**
 * @param {import('playwright').Page} page
 */
export async function dismissLoreToast(page) {
  const toast = page.locator('[data-testid="lore-discover-toast"]');
  if (!(await toast.isVisible().catch(() => false))) return;

  await closeShellDrawer(page);
  await page.keyboard.press("Escape");
  await blurComposerForMovement(page);

  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="lore-discover-toast"]');
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  if (await toast.isVisible().catch(() => false)) {
    await waitFor(async () => !(await toast.isVisible().catch(() => true)), 10_000, "lore toast auto-dismiss");
  }
}

/**
 * @param {import('playwright').Page} page
 */
export async function readLoreToastBody(page) {
  const toast = page.locator('[data-testid="lore-discover-toast"]');
  if (!(await toast.isVisible().catch(() => false))) return "";
  return (await page.locator(".lore-discover-toast__body").innerText().catch(() => "")).trim();
}

/**
 * @param {import('playwright').Page} page
 * @param {string} key
 */
export async function pressMoveKey(page, key) {
  await assertJournalQuestStripAbsent(page);
  await page.keyboard.press(key);
  await page.waitForTimeout(180);
  const body = await readLoreToastBody(page);
  return isValidLoreHook(body) ? body : "";
}

export async function readMovementProbe(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    const placeName = document.querySelector('[data-testid="explore-place-name"]')?.textContent?.trim() ?? "";
    return {
      activeTag: active?.tagName ?? null,
      composerFocused: Boolean(
        active instanceof HTMLTextAreaElement && active.classList.contains("composer__input"),
      ),
      placeName,
      lorePending: Boolean(document.querySelector('[data-testid="lore-pending-hint"]')),
      moveDebug: typeof window.__aetherlife_moveDebug === "function" ? window.__aetherlife_moveDebug() : null,
    };
  });
}

export function chunkManhattanDist(a, b) {
  return Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
}

export async function drainMovementPending(page) {
  await page.waitForFunction(
    () => {
      const d = window.__aetherlife_moveDebug?.();
      return d != null && d.pending === 0 && !d.locomoting;
    },
    { timeout: 15_000 },
  );
  await page.waitForTimeout(400);
}

const CHUNK_SIZE = 8;

/**
 * Programmatic grid move when WASD does not cross chunk boundaries (drawer/dialogue focus edge cases).
 * @param {import('playwright').Page} page
 * @param {"north"|"south"} direction
 */
export async function forceCrossChunkViaSendMoveTo(page, direction = "north") {
  await blurComposerForMovement(page);
  await focusExploreForKeyboard(page);
  await drainMovementPending(page).catch(() => {});

  const startChunk = (await readExploreChunk(page)) ?? { cx: 0, cy: 0 };
  const grid = await readPlayerGrid(page);
  if (!grid) return { startChunk, endChunk: startChunk, chunkDist: 0 };

  const deltas =
    direction === "north"
      ? [CHUNK_SIZE * 4, CHUNK_SIZE * 2, CHUNK_SIZE * 6]
      : [CHUNK_SIZE * 4, CHUNK_SIZE * 2, CHUNK_SIZE * 6];

  for (const delta of deltas) {
    const targetGy = direction === "north" ? grid.y - delta : grid.y + delta;
    await page.evaluate(({ x, y }) => {
      const fn = window.__aetherlife_sendMoveTo;
      if (typeof fn !== "function") {
        throw new Error("__aetherlife_sendMoveTo missing — use pnpm dev:stack (DEV build)");
      }
      fn(x, y);
    }, { x: grid.x, y: targetGy });

    await drainMovementPending(page).catch(() => {});
    await page.waitForTimeout(900);

    const endChunk = (await readExploreChunk(page)) ?? startChunk;
    const chunkDist = chunkManhattanDist(startChunk, endChunk);
    if (chunkDist >= 2) {
      return { startChunk, endChunk, chunkDist };
    }
  }

  // Keyboard burst fallback
  await focusExploreForKeyboard(page);
  const key = direction === "north" ? "w" : "s";
  for (let i = 0; i < 32; i += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(160);
  }
  await drainMovementPending(page).catch(() => {});

  const endChunk = (await readExploreChunk(page)) ?? startChunk;
  return { startChunk, endChunk, chunkDist: chunkManhattanDist(startChunk, endChunk) };
}

/**
 * Extract story hook from place name strip when toast is absent.
 * @param {string} placeName
 */
export function hookFromPlaceName(placeName) {
  const trimmed = placeName.trim();
  if (!trimmed.includes("·")) return "";
  const hook = trimmed.split("·")[1]?.trim() ?? "";
  if (hook.length <= 8 || trimmed.includes("晨曦村")) return "";
  return hook;
}

export function isValidLoreHook(text) {
  return typeof text === "string" && text.trim().length > 8;
}

/**
 * After speak/memory: disengage dialogue, wait composer idle, optional LLM quiet buffer.
 * @param {import('playwright').Page} page
 * @param {{ quietMs?: number }} [opts]
 */
export async function waitForExploreReadyAfterSpeak(page, { quietMs = 0 } = {}) {
  await disengageDialogue(page);

  await page
    .waitForFunction(
      () => {
        const input = document.querySelector("textarea.composer__input");
        return input && !input.disabled && input.getAttribute("aria-busy") !== "true";
      },
      { timeout: 60_000 },
    )
    .catch(() => {});

  await page
    .waitForFunction(
      () =>
        document.querySelector('[data-testid="dialogue-overlay"]')?.getAttribute("data-engaged") !==
        "true",
      { timeout: 15_000 },
    )
    .catch(() => {});

  await drainMovementPending(page).catch(() => {});

  if (quietMs > 0) {
    await page.waitForTimeout(quietMs);
  }
}

/**
 * Programmatic chunk cross before WASD — reliable when composer had focus during speak.
 * @param {import('playwright').Page} page
 * @param {"north"|"south"} direction
 * @returns {Promise<string>} hook when toast/place ready, else ""
 */
async function bootstrapLoreViaSendMoveTo(page, direction = "south") {
  const forced = await forceCrossChunkViaSendMoveTo(page, direction);
  console.log(
    `explore: sendMoveTo ${direction} dist=${forced.chunkDist} start=${JSON.stringify(forced.startChunk)} end=${JSON.stringify(forced.endChunk)}`,
  );

  const toastHook = await readLoreToastBody(page);
  if (isValidLoreHook(toastHook)) return toastHook;

  const probe = await readMovementProbe(page);
  const flavorHook = hookFromPlaceName(probe.placeName);
  if (isValidLoreHook(flavorHook) && !probe.lorePending) return flavorHook;

  return "";
}

/**
 * @param {import('playwright').Page} page
 */
export async function readExistingLoreHook(page) {
  const toast = await readLoreToastBody(page);
  if (isValidLoreHook(toast)) return toast;
  const probe = await readMovementProbe(page);
  return hookFromPlaceName(probe.placeName);
}

/**
 * Robust lore discovery — mirrors verify-phase21 exploreUntilLoreDiscover.
 * @param {import('playwright').Page} page
 * @param {number} [loreTimeoutMs]
 * @returns {Promise<string>}
 */
export async function exploreUntilLoreDiscover(page, loreTimeoutMs = 180_000) {
  await disengageDialogue(page);
  await assertJournalQuestStripAbsent(page);
  await closeShellDrawer(page);
  await page.locator('[data-testid="explore-coords-strip"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="explore-place-name"]').waitFor({ timeout: 30_000 });

  const existing = await readExistingLoreHook(page);
  if (isValidLoreHook(existing)) return existing;

  await page.waitForFunction(
    () => typeof window.__aetherlife_moveDebug === "function" && window.__aetherlife_moveDebug() != null,
    { timeout: 30_000 },
  );

  await blurComposerForMovement(page);
  await focusExploreForKeyboard(page);

  const startChunk = (await readExploreChunk(page)) ?? { cx: 0, cy: 0 };

  let bootstrapHook = await bootstrapLoreViaSendMoveTo(page, "south");
  if (isValidLoreHook(bootstrapHook)) return bootstrapHook;

  // South from home first (seed-42 highland blocks east at spawn) — matches verify-phase21.
  for (let i = 0; i < 48; i += 1) {
    const hook = await pressMoveKey(page, "s");
    if (hook) return hook;
  }

  await drainMovementPending(page);
  let endChunk = await readExploreChunk(page);
  let chunkDist = endChunk ? chunkManhattanDist(startChunk, endChunk) : 0;

  if (chunkDist < 2) {
    for (let i = 0; i < 28; i += 1) {
      const hook = await pressMoveKey(page, "w");
      if (hook) return hook;
    }
    await drainMovementPending(page);
    endChunk = await readExploreChunk(page);
    chunkDist = endChunk ? chunkManhattanDist(startChunk, endChunk) : 0;
  }

  let postMove = await readMovementProbe(page);

  if (chunkDist < 2 && !postMove.lorePending) {
    for (const dir of ["south", "north", "south"]) {
      const forced = await forceCrossChunkViaSendMoveTo(page, dir);
      endChunk = forced.endChunk;
      chunkDist = forced.chunkDist;
      if (chunkDist >= 2) break;
    }
    postMove = await readMovementProbe(page);
  }

  const toastEarly = await readLoreToastBody(page);
  const placeHook = hookFromPlaceName(postMove.placeName);
  if (chunkDist < 2 && !postMove.lorePending && !toastEarly && !placeHook) {
    throw new Error(
      `WASD did not cross chunks start=${JSON.stringify(startChunk)} end=${JSON.stringify(endChunk)} probe=${JSON.stringify(postMove)}`,
    );
  }

  if (placeHook && !toastEarly && !postMove.lorePending) {
    return placeHook;
  }

  let sawPending = postMove.lorePending || Boolean(toastEarly);
  let loreReadyViaPlace = false;
  let lastProgressAt = Date.now();
  let lastPlaceName = postMove.placeName;
  let retryCrossCount = 0;

  await waitFor(
    async () => {
      await assertJournalQuestStripAbsent(page);
      const body = await readLoreToastBody(page);
      if (isValidLoreHook(body)) return true;

      const snap = await readMovementProbe(page);
      if (snap.lorePending) sawPending = true;
      const hasFlavor = snap.placeName.includes("·");
      const flavorHook = hookFromPlaceName(snap.placeName);
      if (snap.placeName !== lastPlaceName || snap.lorePending || hasFlavor) {
        lastProgressAt = Date.now();
        lastPlaceName = snap.placeName;
      }

      const stalledMs = Date.now() - lastProgressAt;
      if (!snap.lorePending && !flavorHook && stalledMs > 75_000 && retryCrossCount < 4) {
        retryCrossCount += 1;
        lastProgressAt = Date.now();
        const dir = retryCrossCount % 2 === 0 ? "north" : "south";
        await forceCrossChunkViaSendMoveTo(page, dir);
        await dismissLoreToast(page).catch(() => {});
        const retryHook = await readLoreToastBody(page);
        if (isValidLoreHook(retryHook)) return true;
      }

      if (!snap.lorePending && flavorHook && !snap.placeName.includes("晨曦村")) {
        loreReadyViaPlace = true;
        return true;
      }
      return false;
    },
    loreTimeoutMs,
    "lore-discover-toast with non-empty body",
  );

  let hookText = await readLoreToastBody(page);
  if (!isValidLoreHook(hookText) && loreReadyViaPlace) {
    const placeName = (await readMovementProbe(page)).placeName;
    hookText = hookFromPlaceName(placeName) || placeName;
  }
  if (!isValidLoreHook(hookText)) {
    throw new Error(
      `lore hook too short or missing after ${loreTimeoutMs}ms sawPending=${sawPending} hook="${hookText.slice(0, 40)}"`,
    );
  }
  return hookText;
}

/**
 * Collect lore hooks by exploring; returns unique hook strings.
 * @param {import('playwright').Page} page
 * @param {{ minHooks?: number; maxStepsPerDir?: number; loreTimeoutMs?: number; seedHooks?: string[] }} [opts]
 */
export async function collectLoreHooks(page, opts = {}) {
  const minHooks = opts.minHooks ?? 3;
  const maxStepsPerDir = opts.maxStepsPerDir ?? 40;
  const loreTimeoutMs = opts.loreTimeoutMs ?? 180_000;
  const hooks = new Set((opts.seedHooks ?? []).filter(Boolean));

  if (hooks.size === 0) {
    hooks.add(await exploreUntilLoreDiscover(page, loreTimeoutMs));
  } else {
    await disengageDialogue(page);
    await closeShellDrawer(page);
    await dismissLoreToast(page).catch(() => {});
  }

  await assertJournalQuestStripAbsent(page);
  await blurComposerForMovement(page);
  await focusExploreForKeyboard(page);

  const directions = ["w", "s", "d", "a"];
  let stepsSinceCross = 0;
  for (const dir of directions) {
    for (let i = 0; i < maxStepsPerDir && hooks.size < minHooks; i += 1) {
      const hook = await pressMoveKey(page, dir);
      if (isValidLoreHook(hook)) hooks.add(hook);

      stepsSinceCross += 1;
      if (stepsSinceCross >= 12 && hooks.size < minHooks) {
        await forceCrossChunkViaSendMoveTo(page, dir === "s" || dir === "d" ? "south" : "north");
        stepsSinceCross = 0;
        await dismissLoreToast(page).catch(() => {});
        const afterCross = await readLoreToastBody(page);
        if (isValidLoreHook(afterCross)) hooks.add(afterCross);
      }

      if (hooks.size >= minHooks) break;
    }
    if (hooks.size >= minHooks) break;
  }

  if (hooks.size < minHooks) {
    await waitFor(
      async () => {
        const body = await readLoreToastBody(page);
        if (isValidLoreHook(body)) hooks.add(body);
        return hooks.size >= minHooks;
      },
      Math.min(loreTimeoutMs, 120_000),
      `≥${minHooks} lore toast hooks`,
    );
  }

  return [...hooks];
}

export async function reloadHomesteadSession(page) {
  await closeShellDrawer(page);
  await dismissLoreToast(page).catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
    state: "visible",
    timeout: 45_000,
  });
  await page.waitForFunction(() => window.__aetherlife_moveDebug?.() != null, {
    timeout: 30_000,
  });
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-testid="corner-menu"] .corner-menu__status-dot--ok'),
      ),
    { timeout: 60_000 },
  );
  await drainMovementPending(page).catch(() => {});
  await blurComposerForMovement(page);
  await focusExploreForKeyboard(page);
  await page.evaluate(({ x, y }) => {
    window.__aetherlife_sendMoveTo?.(x, y);
  }, HOME_DEFAULT_PLAYER_SPAWN);
  await drainMovementPending(page).catch(() => {});
  const npc = HOME_NPC_SPAWNS["npc-1"];
  await page.evaluate(({ x, y }) => {
    window.__aetherlife_sendMoveTo?.(x, y + 1);
  }, npc);
  await drainMovementPending(page).catch(() => {});
  await page.waitForTimeout(800);
}

/**
 * Poll drawer rows while discoveries panel is open.
 * @param {import('playwright').Page} page
 * @param {number} minRows
 * @param {number} timeoutMs
 */
async function waitForDiscoveredRows(page, minRows, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rows = await readDiscoveredRows(page);
    if (rows.length >= minRows) return rows;
    await page.waitForTimeout(1500);
  }
  return readDiscoveredRows(page);
}

/**
 * Explore until drawer「已发现」lists at least minRows ready lore entries.
 * @param {import('playwright').Page} page
 * @param {number} minRows
 * @param {number} loreTimeoutMs
 */
export async function ensureMinDiscoveredRows(page, minRows, loreTimeoutMs) {
  const deadline = Date.now() + loreTimeoutMs;

  await reloadHomesteadSession(page);

  while (Date.now() < deadline) {
    await openDrawerDiscoveries(page);
    const pollMs = Math.min(120_000, deadline - Date.now());
    const rows = pollMs > 5_000 ? await waitForDiscoveredRows(page, minRows, pollMs) : await readDiscoveredRows(page);
    if (rows.length >= minRows) {
      await closeShellDrawer(page);
      return rows;
    }

    await closeShellDrawer(page);
    await disengageDialogue(page);
    await blurComposerForMovement(page);
    await focusExploreForKeyboard(page);

    const remaining = deadline - Date.now();
    if (remaining <= 45_000) break;

    try {
      await exploreUntilLoreDiscover(page, Math.min(180_000, remaining));
    } catch {
      await forceCrossChunkViaSendMoveTo(page, "south").catch(() => {});
    }
    await dismissLoreToast(page).catch(() => {});
    await reloadHomesteadSession(page);
  }

  await openDrawerDiscoveries(page);
  const finalRows = await waitForDiscoveredRows(
    page,
    minRows,
    Math.min(60_000, Math.max(5_000, deadline - Date.now())),
  );
  if (finalRows.length < minRows) {
    throw new Error(`ensureMinDiscoveredRows: rows=${finalRows.length} need ${minRows}`);
  }
  await closeShellDrawer(page);
  return finalRows;
}

/**
 * @param {import('playwright').Page} page
 */
export async function disengageDialogue(page) {
  await closeShellDrawer(page);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const engaged = await page
      .locator('[data-testid="dialogue-overlay"]')
      .getAttribute("data-engaged")
      .catch(() => "false");
    if (engaged !== "true") break;

    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="dialogue-end"]');
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(250);
  }

  await page
    .waitForFunction(
      () =>
        document.querySelector('[data-testid="dialogue-overlay"]')?.getAttribute("data-engaged") ===
        "false",
      { timeout: 10_000 },
    )
    .catch(() => {});

  await blurComposerForMovement(page);
  await focusExploreForKeyboard(page);
}

export async function returnToHomesteadForDialogue(page) {
  await closeShellDrawer(page);
  await disengageDialogue(page);
  await dismissLoreToast(page).catch(() => {});

  const grid = await readPlayerGrid(page);
  const dist =
    grid == null
      ? Infinity
      : Math.abs(grid.x - HOME_DEFAULT_PLAYER_SPAWN.x) +
        Math.abs(grid.y - HOME_DEFAULT_PLAYER_SPAWN.y);

  if (dist > 10) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
      state: "visible",
      timeout: 45_000,
    });
    await page.waitForFunction(() => window.__aetherlife_moveDebug?.() != null, {
      timeout: 30_000,
    });
    await drainMovementPending(page).catch(() => {});
  } else {
    await blurComposerForMovement(page);
    await focusExploreForKeyboard(page);
    await page.evaluate(({ x, y }) => {
      window.__aetherlife_sendMoveTo?.(x, y);
    }, HOME_DEFAULT_PLAYER_SPAWN);
    await drainMovementPending(page).catch(() => {});
    await waitFor(
      async () => {
        const g = await readPlayerGrid(page);
        if (!g) return false;
        const d =
          Math.abs(g.x - HOME_DEFAULT_PLAYER_SPAWN.x) +
          Math.abs(g.y - HOME_DEFAULT_PLAYER_SPAWN.y);
        return d <= 6;
      },
      20_000,
      "homestead spawn grid proximity",
    ).catch(() => {});
  }

  const npc = HOME_NPC_SPAWNS["npc-1"];
  await page.evaluate(({ x, y }) => {
    window.__aetherlife_sendMoveTo?.(x, y + 1);
  }, npc);
  await drainMovementPending(page).catch(() => {});
  await page.waitForTimeout(600);
}

/** @deprecated use returnToHomesteadForDialogue */
export async function returnToHomesteadSpawn(page) {
  return returnToHomesteadForDialogue(page);
}

/**
 * After long exploration, walk back toward spawn / near first NPC so dialogue can engage.
 * @param {import('playwright').Page} page
 */
export async function returnNearNpcForDialogue(page) {
  await returnToHomesteadForDialogue(page);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await page.locator('[data-testid="dialogue-bar"]').isVisible().catch(() => false)) return;
    if (await page.locator('[aria-label="已发现"]').isVisible().catch(() => false)) return;

    const snap = await page.evaluate(({ nx, ny }) => {
      const player = window.__aetherlife_moveDebug?.();
      if (!player) return { near: false, dist: null };
      const dist = Math.abs(player.gridX - nx) + Math.abs(player.gridY - ny);
      if (dist <= 3) return { near: true, dist };
      window.__aetherlife_sendMoveTo?.(nx, ny + 1);
      return { near: false, dist };
    }, { nx: HOME_NPC_SPAWNS["npc-1"].x, ny: HOME_NPC_SPAWNS["npc-1"].y });

    if (snap.near) return;
    await drainMovementPending(page).catch(() => {});
    await page.waitForTimeout(1200);
  }
}

export async function openDrawerDiscoveries(page, opts = {}) {
  const skipHomesteadReturn = opts.skipHomesteadReturn === true;
  await closeShellDrawer(page);
  await dismissLoreToast(page).catch(() => {});
  const drawer = page.locator('[data-testid="shell-drawer"]');
  const discoveriesBtn = page.locator('[aria-label="已发现"]');

  if (!(await drawer.isVisible().catch(() => false))) {
    if (!(await discoveriesBtn.isVisible().catch(() => false))) {
      if (!skipHomesteadReturn) {
        await returnToHomesteadForDialogue(page);
        await returnNearNpcForDialogue(page);
      }
    }

    if (!(await discoveriesBtn.isVisible().catch(() => false))) {
      let engaged = false;
      for (let attempt = 0; attempt < 4 && !(await discoveriesBtn.isVisible().catch(() => false)); attempt += 1) {
        try {
          await engageDialogue(page, { timeoutMs: 45_000 });
          engaged = true;
          break;
        } catch {
          if (!skipHomesteadReturn) {
            await returnToHomesteadForDialogue(page);
          } else {
            await reloadHomesteadSession(page);
          }
          await page.waitForTimeout(800);
        }
      }
      if (!engaged && !(await discoveriesBtn.isVisible().catch(() => false))) {
        await engageDialogue(page, { timeoutMs: 90_000 });
      }
    }

    await discoveriesBtn.waitFor({ state: "visible", timeout: 25_000 });
    await discoveriesBtn.click();
  } else {
    await page.locator("#shell-drawer-tab-discoveries").click();
  }

  await drawer.waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#shell-drawer-tab-discoveries").click();
  await page.locator("#shell-drawer-panel-discoveries").waitFor({
    state: "visible",
    timeout: 10_000,
  });
}

/**
 * @param {import('playwright').Page} page
 */
export async function readDiscoveredRows(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="discovered-lore-row"]')];
    return rows.map((row) => ({
      name: row.querySelector(".discovered-lore-panel__name")?.textContent?.trim() ?? "",
      hook: row.querySelector(".discovered-lore-panel__hook")?.textContent?.trim() ?? "",
      rowText: row.textContent?.trim() ?? "",
    }));
  });
}

/**
 * Scan fixed UI chrome for forbidden quest language.
 * @param {import('playwright').Page} page
 */
export async function scanForbiddenUiTerms(page) {
  const hits = [];
  for (const sel of CHROME_SELECTORS) {
    const loc = page.locator(sel);
    const n = await loc.count();
    for (let i = 0; i < n; i += 1) {
      const text = ((await loc.nth(i).innerText().catch(() => "")) ?? "").trim();
      if (!text) continue;
      for (const term of FORBIDDEN_UI_TERMS) {
        if (text.toLowerCase().includes(term.toLowerCase())) {
          hits.push({ selector: sel, term, text: text.slice(0, 120) });
        }
      }
    }
  }
  return hits;
}

export async function bootRoom(page, webUrl) {
  await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator('[data-testid="phaser-parent"] canvas').first().waitFor({
    state: "visible",
    timeout: 45_000,
  });
  await page.locator('[data-testid="room-scene"]').waitFor({ timeout: 30_000 });
}

export { closeShellDrawer, engageDialogue, sendSpeakOverlay };
