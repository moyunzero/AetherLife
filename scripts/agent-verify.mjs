#!/usr/bin/env node
/**
 * Agent iteration harness — select unit tests + golden-flow E2E oracles from git diff.
 *
 * Usage:
 *   pnpm agent:verify              # fast: unit tests for touched areas
 *   pnpm agent:verify --plan       # print plan only, run nothing
 *   pnpm agent:verify --e2e        # also run golden-flow verify:phase* (needs dev:stack)
 *   pnpm agent:verify --scope-check --scope "apps/game-server/src/collective/*"
 *
 * Env:
 *   AGENT_SCOPE  — declared file/dir scope for --scope-check
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditScope,
  collectGoldenFlows,
  collectUnitCommands,
  flattenVerifyScripts,
  isCrossLayerDiff,
} from "./lib/agent-verify-map.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const planOnly = args.includes("--plan");
const runE2e = args.includes("--e2e");
const scopeCheck = args.includes("--scope-check");
const failFast = args.includes("--fail");
const againstBase = args.includes("--base");

const scopeIdx = args.indexOf("--scope");
const scope =
  (scopeIdx >= 0 ? args[scopeIdx + 1] : undefined) ??
  process.env.AGENT_SCOPE ??
  "";

function git(argsList) {
  const r = spawnSync("git", argsList, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return "";
  return r.stdout.trim();
}

/** @returns {string[]} */
function changedFiles() {
  const unstaged = git(["diff", "--name-only", "HEAD"]).split("\n").filter(Boolean);
  const staged = git(["diff", "--name-only", "--cached"]).split("\n").filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean);
  let branch = [];
  if (againstBase) {
    const base =
      git(["merge-base", "HEAD", "origin/main"]) ||
      git(["merge-base", "HEAD", "main"]) ||
      "HEAD~1";
    branch = git(["diff", "--name-only", `${base}...HEAD`]).split("\n").filter(Boolean);
  }
  return [...new Set([...unstaged, ...staged, ...branch, ...untracked])];
}

function healthOk() {
  try {
    const port = process.env.GAME_SERVER_PORT || "2567";
    const base = process.env.GAME_SERVER_URL || `http://127.0.0.1:${port}`;
    const res = spawnSync("curl", ["-sf", `${base}/health`], { encoding: "utf8" });
    return res.status === 0;
  } catch {
    return false;
  }
}

function runCmd(label, cmd) {
  console.log(`\n▶ ${label}\n   $ ${cmd}\n`);
  if (planOnly) return 0;
  const r = spawnSync(cmd, {
    cwd: root,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  return r.status ?? 1;
}

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

function main() {
  loadEnv();
  const files = changedFiles();

  console.log("=== Agent Verify Harness ===");
  console.log(`Root: ${root}`);
  console.log(`Changed files: ${files.length}`);
  if (files.length === 0) {
    console.log("No local changes detected — nothing to verify.");
    return 0;
  }

  for (const f of files.slice(0, 30)) console.log(`  · ${f}`);
  if (files.length > 30) console.log(`  … +${files.length - 30} more`);

  if (scopeCheck) {
    const audit = auditScope(scope, files);
    console.log("\n--- Scope audit ---");
    if (scope) console.log(`Declared scope: ${scope}`);
    else console.log("Declared scope: (none — set --scope or AGENT_SCOPE)");

    if (audit.protectedTouched.length > 0) {
      console.log("\n⚠ Protected paths touched:");
      for (const p of audit.protectedTouched) {
        console.log(`  [${p.id}] ${p.label}: ${p.file}`);
      }
      console.log("  → Run matching golden flows before merge. See docs/E2E-POLICY.md §8.");
    }

    if (!audit.ok) {
      console.log("\n✗ Out-of-scope changes:");
      for (const f of audit.outOfScope) console.log(`  · ${f}`);
      if (failFast && !planOnly) return 1;
    } else if (scope) {
      console.log("\n✓ All changes within declared scope.");
    }
  }

  const unitCmds = [...collectUnitCommands(files)];
  const flows = collectGoldenFlows(files);
  const crossLayer = isCrossLayerDiff(files);
  const verifyScripts = flattenVerifyScripts(flows, crossLayer);

  console.log("\n--- L2 Unit / package tests ---");
  if (unitCmds.length === 0) {
    console.log("(no package-specific tests mapped — consider `pnpm turbo test` for broad changes)");
  }

  let exitCode = 0;
  for (const cmd of unitCmds) {
    const code = runCmd("unit", cmd);
    if (code !== 0) exitCode = code;
    if (failFast && code !== 0) return code;
  }

  console.log("\n--- L3 Golden-flow regression oracles ---");
  if (flows.length === 0 && !crossLayer) {
    console.log("(no golden flows triggered by this diff)");
  } else {
    for (const flow of flows) {
      console.log(`  [${flow.id}] ${flow.name} → pnpm ${flow.verify.join(", pnpm ")}`);
    }
    if (crossLayer) {
      console.log("  [cross-layer] game-server + worker → pnpm verify:phase8");
    }
  }

  if (!runE2e) {
    console.log("\nℹ Skipping E2E (pass --e2e to run). Requires: pnpm dev:stack + real LLM keys.");
    console.log("  Recommended before merge:");
    for (const script of verifyScripts) {
      console.log(`    pnpm ${script}`);
    }
    return exitCode;
  }

  if (!healthOk()) {
    console.error("\n✗ game-server /health unreachable. Start: pnpm dev:stack");
    console.error("  Kill mock worker: pkill -f \"LLM_MOCK=1.*src.main\" || true");
    return failFast ? 1 : exitCode;
  }

  for (const script of verifyScripts) {
    const code = runCmd("e2e", `pnpm ${script}`);
    if (code !== 0) exitCode = code;
    if (failFast && code !== 0) return code;
  }

  console.log("\n=== Agent verify complete ===");
  return exitCode;
}

process.exit(main());
