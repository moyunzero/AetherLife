import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Monorepo root when called from `scripts/*.mjs` (one level below root). */
export function scriptsRepoRoot(fromMetaUrl) {
  return resolve(dirname(fileURLToPath(fromMetaUrl)), "..");
}

/**
 * Load root `.env` into `process.env` without overriding existing vars.
 * @param {string} [rootDir] - defaults to repo root (parent of `scripts/`)
 */
export function loadRootEnv(rootDir) {
  const root =
    rootDir ??
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
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

/** HTTP base for game-server REST (no trailing slash). */
export function gameServerHttpBase() {
  return (
    process.env.GAME_SERVER_URL ||
    `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`
  );
}

/** Colyseus WebSocket URL. */
export function gameServerWsUrl() {
  return process.env.GAME_SERVER_WS || "ws://127.0.0.1:2567";
}
