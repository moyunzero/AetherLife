/**
 * Full-stack E2E orchestrator — Phase 1 (cloud) + 2→13 + 16, real LLM only.
 * Phase 9 voice deferred. Requires: pnpm dev:stack running. See docs/E2E-FULL-RUN.md
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertE2eNoMock, assertE2eRealLlm } from "./lib/e2e-policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
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
const logDir = resolve(root, ".planning/e2e-full-run");
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const logPath = resolve(logDir, `e2e-full-${stamp}.log`);
const runArtifactDir = resolve(logDir, `e2e-full-${stamp}`);

/** Phase → UAT screenshot source (archived after each UAT step). */
const UAT_SHOT_DIRS = {
  "6": ".planning/phases/06-colyseus-movement/uat-screenshots",
  "7": ".planning/phases/07-2-5d-renderer/uat-screenshots",
  "8": ".planning/phases/08-multiplayer-room/uat-screenshots",
  "10": ".planning/phases/10-chunk-terrain/uat-screenshots",
  "11": ".planning/phases/11-llm-world-lore/uat-screenshots",
  "12.1": ".planning/phases/12.1-llm-social-perception/uat-screenshots",
  "13": ".planning/phases/13-phaser-world-visuals/screenshots",
};

const httpGs = process.env.GAME_SERVER_URL || "http://127.0.0.1:2567";
const httpAi = process.env.AI_GATEWAY_URL || "http://127.0.0.1:8000";
const webUrl = process.env.WEB_URL || "http://localhost:5173";

const continueOnFail = process.env.E2E_FULL_CONTINUE === "1";
const skipUat = process.env.E2E_FULL_SKIP_UAT === "1";

/** @type {Array<{ phase: string; kind: string; script: string; env?: Record<string, string> }>} */
const STEPS = [
  { phase: "1", kind: "verify", script: "verify:cloud" },
  { phase: "2", kind: "verify", script: "verify:phase2" },
  { phase: "3", kind: "verify", script: "verify:phase3" },
  { phase: "4", kind: "verify", script: "verify:phase4" },
  { phase: "5", kind: "verify", script: "verify:phase5" },
  { phase: "6", kind: "verify", script: "verify:phase6" },
  { phase: "6", kind: "uat", script: "uat:phase6:playwright" },
  { phase: "7", kind: "verify", script: "verify:phase7" },
  { phase: "7", kind: "uat", script: "uat:phase7:playwright" },
  { phase: "7", kind: "uat", script: "uat:phase7:reset-snap" },
  { phase: "8", kind: "verify", script: "verify:phase8" },
  { phase: "8", kind: "uat", script: "uat:phase8:playwright" },
  { phase: "10", kind: "verify", script: "verify:phase10" },
  { phase: "10", kind: "uat", script: "uat:phase10:playwright" },
  { phase: "11", kind: "verify", script: "verify:phase11" },
  { phase: "11", kind: "uat", script: "uat:phase11:playwright" },
  {
    phase: "12",
    kind: "verify",
    script: "verify:phase12",
    env: { VERIFY_PHASE12_FAST: "1" },
  },
  { phase: "12.1", kind: "uat", script: "uat:phase12.1:playwright" },
  { phase: "13", kind: "verify", script: "verify:phase13" },
  { phase: "13", kind: "uat", script: "uat:phase13:playwright" },
  { phase: "16", kind: "verify", script: "verify:phase16" },
];

/**
 * Writes a prefixed E2E run message to stdout and returns that message with a trailing newline.
 * @param {string} line - Message text to log.
 * @returns {string} The logged message prefixed with "[e2e-full-run] " and terminated with `\n`.
 */
function log(line) {
  const msg = `[e2e-full-run] ${line}`;
  console.log(msg);
  return msg + "\n";
}

async function healthOk(url, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label} ${url} → ${res.status}`);
}

function archiveUatScreenshots(phase, script) {
  const srcRel = UAT_SHOT_DIRS[phase];
  if (!srcRel) return null;
  const src = resolve(root, srcRel);
  if (!existsSync(src)) return null;
  const dest = resolve(runArtifactDir, "screenshots", `phase-${phase}`, script.replace(/:/g, "-"));
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
  return dest;
}

function runStep(step) {
  const env = { ...process.env, ...(step.env ?? {}) };
  const started = Date.now();
  const header = `\n========== Phase ${step.phase} ${step.kind}: pnpm ${step.script} ==========\n`;
  process.stdout.write(header);

  const result = spawnSync("pnpm", [step.script], {
    cwd: root,
    env: {
      ...env,
      E2E_SPEAK_TIMEOUT_MS: env.E2E_SPEAK_TIMEOUT_MS || "240000",
      UAT_SPEAK_TIMEOUT_MS: env.UAT_SPEAK_TIMEOUT_MS || "180000",
    },
    stdio: "inherit",
    shell: false,
  });
  const ms = Date.now() - started;
  const ok = result.status === 0;
  let screenshotArchive = null;
  if (step.kind === "uat") {
    screenshotArchive = archiveUatScreenshots(step.phase, step.script);
  }
  return { ...step, ok, ms, exitCode: result.status ?? 1, header, screenshotArchive };
}

async function main() {
  assertE2eNoMock("e2e:full-run");
  assertE2eRealLlm("e2e:full-run");

  mkdirSync(logDir, { recursive: true });
  mkdirSync(runArtifactDir, { recursive: true });
  let buf = log(`log → ${logPath}`);
  buf += log(`artifacts → ${runArtifactDir}`);
  buf += log(`continueOnFail=${continueOnFail} skipUat=${skipUat}`);

  await healthOk(`${httpGs}/health`, "game-server");
  await healthOk(`${httpAi}/health`, "ai-gateway");
  await healthOk(webUrl, "web");
  buf += log("stack health OK");

  const steps = skipUat ? STEPS.filter((s) => s.kind === "verify") : STEPS;
  /** @type {Array<ReturnType<typeof runStep>>} */
  const results = [];
  const t0 = Date.now();

  for (const step of steps) {
    const r = runStep(step);
    results.push(r);
    buf += r.header;
    buf += log(
      `Phase ${r.phase} ${r.kind} ${r.script}: ${r.ok ? "PASS" : "FAIL"} (${Math.round(r.ms / 1000)}s)`,
    );
    if (r.screenshotArchive) {
      buf += log(`  📸 archived → ${r.screenshotArchive}`);
    }
    if (!r.ok && !continueOnFail) {
      buf += log("stopped on first failure (set E2E_FULL_CONTINUE=1 to run all)");
      break;
    }
  }

  const failed = results.filter((r) => !r.ok);
  const summary = {
    runId: `RUN-${stamp}`,
    totalMs: Date.now() - t0,
    passed: results.filter((r) => r.ok).length,
    failed: failed.length,
    steps: results.map((r) => ({
      phase: r.phase,
      kind: r.kind,
      script: r.script,
      ok: r.ok,
      ms: r.ms,
    })),
  };

  buf += log(`done: ${summary.passed} pass, ${summary.failed} fail, ${Math.round(summary.totalMs / 60000)} min`);
  writeFileSync(logPath, buf, "utf8");
  writeFileSync(resolve(runArtifactDir, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(resolve(logDir, `e2e-full-${stamp}.json`), JSON.stringify(summary, null, 2));

  console.log(`\nSummary written: ${logPath}`);
  if (failed.length > 0) {
    console.error("Failed steps:");
    for (const f of failed) {
      console.error(`  - Phase ${f.phase} ${f.kind}: pnpm ${f.script}`);
    }
    process.exit(1);
  }
  console.log("e2e:full-run OK");
}

main().catch((err) => {
  console.error(`e2e:full-run failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
