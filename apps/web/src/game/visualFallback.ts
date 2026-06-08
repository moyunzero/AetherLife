import type * as Phaser from "phaser";

const REGISTRY_KEY = "visualFallback";

/** URL `?visualFallback=1` forces Graphics/disc path (D-23). */
export function parseVisualFallbackQuery(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("visualFallback") === "1";
}

export function setVisualFallbackRegistry(game: Phaser.Game, active: boolean): void {
  game.registry.set(REGISTRY_KEY, active);
}

export function isVisualFallbackActive(sceneOrGame?: {
  registry: Phaser.Data.DataManager;
}): boolean {
  if (!sceneOrGame) return parseVisualFallbackQuery();
  return Boolean(sceneOrGame.registry.get(REGISTRY_KEY)) || parseVisualFallbackQuery();
}

export function markVisualFallbackFromLoadError(scene: Phaser.Scene): void {
  scene.registry.set(REGISTRY_KEY, true);
}

/** Boot budget: warn >5s; verify:phase13 fails >8s (VIS-04). */
export const BOOT_WARN_MS = 5000;
export const BOOT_FAIL_MS = 8000;

export function logBootTiming(scene: Phaser.Scene, preloadStartMs: number | undefined): number {
  const bootMs = preloadStartMs != null ? performance.now() - preloadStartMs : 0;
  scene.registry.set("bootMs", bootMs);
  if (bootMs > BOOT_WARN_MS) {
    console.warn(`[aetherlife] Phaser boot ${Math.round(bootMs)}ms exceeds ${BOOT_WARN_MS}ms warn threshold`);
  }
  return bootMs;
}
