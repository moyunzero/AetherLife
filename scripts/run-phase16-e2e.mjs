#!/usr/bin/env node
/**
 * Phase 16 E2E runner — wait for dev stack, assert real LLM policy, run verify:phase16.
 *
 * Usage:
 *   pnpm e2e:phase16              # stack must already be up (pnpm dev:stack)
 *   pnpm e2e:phase16 --start      # spawn dev:stack in background, then verify
 *
 * Env: same as verify:phase16 (WORLD_SEED, WEB_URL, GAME_SERVER_URL, LLM keys).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertE2eNoMock, assertE2eRealLlm } from "./lib/e2e-policy.mjs";
import { waitForDevStack } from "./lib/wait-for-stack.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
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
const args = process.argv.slice(2);
const shouldStart = args.includes("--start");

function killMockWorker() {
  spawnSync("pkill", ["-f", "LLM_MOCK=1.*src.main"], { stdio: "ignore" });
}

/** @returns {import("node:child_process").ChildProcess | null} */
function startDevStackBackground() {
  console.log("[e2e:phase16] starting pnpm dev:stack in background…");
  const child = spawn("pnpm", ["dev:stack"], {
    cwd: root,
    stdio: "ignore",
    detached: true,
    env: { ...process.env, LLM_MOCK: undefined },
  });
  child.unref();
  return child;
}

async function main() {
  loadEnv();
  assertE2eNoMock("e2e:phase16");
  assertE2eRealLlm("e2e:phase16");
  killMockWorker();

  if (shouldStart) {
    startDevStackBackground();
  }

  console.log("[e2e:phase16] waiting for game-server + web…");
  const { gameServerUrl, webUrl } = await waitForDevStack({ timeoutMs: 180_000 });
  console.log(`[e2e:phase16] stack ready gs=${gameServerUrl} web=${webUrl}`);

  const verify = spawnSync("node", ["scripts/verify-phase16.mjs"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      WEB_URL: webUrl,
      GAME_SERVER_URL: gameServerUrl,
    },
  });

  process.exit(verify.status ?? 1);
}

main().catch((err) => {
  console.error(`[e2e:phase16] ${err.message}`);
  console.error("Start stack: pnpm dev:stack (no LLM_MOCK). Or: pnpm e2e:phase16 --start");
  process.exit(1);
});
