import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Monorepo root when called from `scripts/*.mjs` (one level below root). */
export function scriptsRepoRoot(fromMetaUrl) {
  return resolve(dirname(fileURLToPath(fromMetaUrl)), "..");
}

/** Strip matching outer quotes from `.env` values (`"x"` / `'x'`). */
export function unquoteEnvValue(raw) {
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
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
      process.env[key] = unquoteEnvValue(trimmed.slice(eq + 1));
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

/** Colyseus WebSocket URL — derives from HTTP base when unset. */
export function gameServerWsUrl() {
  if (process.env.GAME_SERVER_WS) {
    return process.env.GAME_SERVER_WS;
  }
  try {
    const url = new URL(gameServerHttpBase());
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "ws://127.0.0.1:2567";
  }
}
