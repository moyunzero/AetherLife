/**
 * Shared Phase 19 immersive-shell dialogue engagement for E2E/benchmark scripts.
 * Opens dialogue via corner-menu NPC tab or canvas click; waits for dialogue-bar.
 */
export async function engageDialogue(page) {
  const dialogueBar = page.locator('[data-testid="dialogue-bar"]');
  if (await dialogueBar.isVisible().catch(() => false)) {
    return;
  }

  const cornerMenu = page.locator('[data-testid="corner-menu"]');
  await cornerMenu.locator(".corner-menu__trigger").click();

  const npcTab = page.locator('[data-testid="npc-avatar-strip"] [role="tab"]').first();
  if ((await npcTab.count()) > 0) {
    await npcTab.click();
  } else {
    await cornerMenu.locator(".corner-menu__trigger").click();
    const canvas = page.locator('[data-testid="phaser-stage-fill"] canvas').first();
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error("cannot engage dialogue: no nearby NPC chip and canvas missing");
    }
    await canvas.click({
      position: { x: Math.round(box.width * 0.5), y: Math.round(box.height * 0.45) },
    });
  }

  await dialogueBar.waitFor({ state: "visible", timeout: 20_000 });
}
