/**
 * Shared Phase 19 immersive-shell dialogue engagement for E2E/benchmark scripts.
 * Opens dialogue via corner-menu NPC tab or canvas click; waits for dialogue-bar.
 */
export async function engageDialogue(page, { timeoutMs = 45_000 } = {}) {
  const dialogueBar = page.locator('[data-testid="dialogue-bar"]');
  if (await dialogueBar.isVisible().catch(() => false)) {
    return;
  }

  const cornerMenu = page.locator('[data-testid="corner-menu"]');
  await cornerMenu.waitFor({ state: "visible", timeout: 30_000 });

  // Status dot is always on the trigger; "已连接" text only renders inside the open panel.
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-testid="corner-menu"] .corner-menu__status-dot--ok'),
      ),
    { timeout: 45_000 },
  );

  const deadline = Date.now() + timeoutMs;
  const canvas = page.locator('[data-testid="phaser-stage-fill"] canvas').first();

  while (Date.now() < deadline) {
    if (await dialogueBar.isVisible().catch(() => false)) {
      return;
    }

    await cornerMenu.locator(".corner-menu__trigger").click();

    const npcChip = page.locator("#npc-avatar-npc-1");
    try {
      await npcChip.waitFor({ state: "visible", timeout: 12_000 });
      await npcChip.click();
    } catch {
      const npcTab = page.locator('[data-testid="corner-menu-nearby"] [role="tab"]').first();
      try {
        await npcTab.waitFor({ state: "visible", timeout: 12_000 });
        await npcTab.click();
      } catch {
        await cornerMenu.locator(".corner-menu__trigger").click();
        const box = await canvas.boundingBox();
        if (!box) {
          throw new Error("cannot engage dialogue: no nearby NPC chip and canvas missing");
        }
        await canvas.click({
          position: { x: Math.round(box.width * 0.5), y: Math.round(box.height * 0.45) },
        });
      }
    }

    try {
      await dialogueBar.waitFor({ state: "visible", timeout: 5_000 });
      return;
    } catch {
      await page.waitForTimeout(400);
    }
  }

  throw new Error(`engageDialogue: dialogue-bar not visible within ${timeoutMs}ms`);
}

/**
 * Engage dialogue with a specific council NPC (corner-menu avatar chip).
 * @param {import('playwright').Page} page
 * @param {string} npcId e.g. "npc-4"
 */
export async function engageNpcDialogue(page, npcId, { timeoutMs = 45_000 } = {}) {
  const dialogueBar = page.locator('[data-testid="dialogue-bar"]');
  if (await dialogueBar.isVisible().catch(() => false)) {
    return;
  }

  const cornerMenu = page.locator('[data-testid="corner-menu"]');
  await cornerMenu.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-testid="corner-menu"] .corner-menu__status-dot--ok'),
      ),
    { timeout: 45_000 },
  );

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await dialogueBar.isVisible().catch(() => false)) {
      return;
    }
    await cornerMenu.locator(".corner-menu__trigger").click();
    const chip = page.locator(`#npc-avatar-${npcId}`);
    try {
      await chip.waitFor({ state: "visible", timeout: 12_000 });
      await chip.click();
      await dialogueBar.waitFor({ state: "visible", timeout: 8_000 });
      return;
    } catch {
      await cornerMenu.locator(".corner-menu__trigger").click();
      await page.waitForTimeout(400);
    }
  }

  throw new Error(`engageNpcDialogue: dialogue-bar not visible for ${npcId} within ${timeoutMs}ms`);
}
