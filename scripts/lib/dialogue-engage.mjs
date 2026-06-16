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

    const npcTab = page.locator('[data-testid="corner-menu-nearby"] [role="tab"]').first();
    if ((await npcTab.count()) > 0) {
      await npcTab.click();
    } else {
      await cornerMenu.locator(".corner-menu__trigger").click();
      const box = await canvas.boundingBox();
      if (!box) {
        throw new Error("cannot engage dialogue: no nearby NPC chip and canvas missing");
      }
      await canvas.click({
        position: { x: Math.round(box.width * 0.5), y: Math.round(box.height * 0.45) },
      });
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
