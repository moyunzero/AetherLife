/**
 * Agent iteration harness — path → unit tests + golden-flow E2E oracles.
 * See docs/E2E-POLICY.md §8 and .cursor/rules/agent-iteration.mdc
 */

/** @typedef {{ id: string; name: string; verify: string[]; triggers: RegExp[]; requiresStack?: boolean }} GoldenFlow */

/** Packages / areas → fast deterministic checks (mock LLM OK). */
export const UNIT_TEST_RULES = [
  {
    id: "game-server",
    label: "game-server vitest",
    match: (p) => p.startsWith("apps/game-server/"),
    cmd: "pnpm --filter @aetherlife/game-server test",
  },
  {
    id: "worker",
    label: "agent-worker pytest",
    match: (p) => p.startsWith("workers/agent-worker/"),
    cmd: "cd workers/agent-worker && LLM_MOCK=1 uv run pytest -q",
  },
  {
    id: "web",
    label: "web vitest",
    match: (p) => p.startsWith("apps/web/"),
    cmd: "pnpm --filter @aetherlife/web test",
  },
  {
    id: "ai-gateway",
    label: "ai-gateway pytest",
    match: (p) => p.startsWith("apps/ai-gateway/"),
    cmd: "cd apps/ai-gateway && uv run pytest tests -q",
  },
  {
    id: "shared",
    label: "shared package",
    match: (p) => p.startsWith("packages/shared/"),
    cmd: "pnpm --filter @aetherlife/shared test",
  },
  {
    id: "game-actions",
    label: "game-actions package",
    match: (p) => p.startsWith("packages/game-actions/"),
    cmd: "pnpm --filter @aetherlife/game-actions test",
  },
  {
    id: "npc-memory",
    label: "npc-memory package",
    match: (p) => p.startsWith("packages/npc-memory/"),
    cmd: "pnpm --filter @aetherlife/npc-memory test",
  },
  {
    id: "verify-scripts",
    label: "E2E verify scripts (smoke: node syntax)",
    match: (p) => p.startsWith("scripts/verify-") && p.endsWith(".mjs"),
    cmd: "node --check scripts/agent-verify.mjs",
  },
];

/**
 * Regression oracles — run with `pnpm dev:stack` + real LLM.
 * @type {GoldenFlow[]}
 */
export const GOLDEN_FLOWS = [
  {
    id: "GF-01",
    name: "Colyseus speak + dual-client move",
    verify: ["verify:phase6"],
    requiresStack: true,
    triggers: [
      /apps\/game-server\/src\/colyseus\//,
      /apps\/game-server\/src\/routes\/chat\.ts$/,
      /apps\/game-server\/src\/queue\/npc-turn/,
      /apps\/web\/src\/hooks\/useNpcChat/,
    ],
  },
  {
    id: "GF-02",
    name: "Movement sync (no speak)",
    verify: ["verify:phase6:move-only", "verify:phase13"],
    requiresStack: true,
    triggers: [
      /apps\/web\/src\/game\//,
      /apps\/web\/src\/hooks\/useColyseusRoom/,
      /apps\/web\/src\/lib\/playerMoveIntent/,
      /apps\/web\/src\/components\/PhaserGame/,
      /packages\/shared\/src\/.*movement/i,
      /docs\/MOVEMENT-ARCHITECTURE/,
    ],
  },
  {
    id: "GF-03",
    name: "Multiplayer NL + X-Player-Id",
    verify: ["verify:phase8"],
    requiresStack: true,
    triggers: [
      /workers\/agent-worker\/src\/graph\//,
      /workers\/agent-worker\/src\/.*action_sanitize/,
      /docs\/INVARIANTS-MULTIPLAYER/,
      /docs\/CONTRACTS\.md$/,
      /apps\/game-server\/src\/.*roomStateForInitiator/,
      /apps\/game-server\/src\/.*collectPlayerCells/,
    ],
  },
  {
    id: "GF-04",
    name: "Chunk explore + procedural world",
    verify: ["verify:phase10:move-only"],
    requiresStack: true,
    triggers: [
      /packages\/shared\/src\/chunkProcedural/,
      /apps\/game-server\/src\/.*chunk/i,
      /apps\/web\/src\/game\/RoomScene/,
    ],
  },
  {
    id: "GF-05",
    name: "Chunk lore pipeline",
    verify: ["verify:phase11"],
    requiresStack: true,
    triggers: [
      /workers\/agent-worker\/src\/graph\/lore/,
      /apps\/game-server\/src\/.*lore/i,
      /packages\/npc-memory\/.*lore/i,
    ],
  },
  {
    id: "GF-06",
    name: "Collective memory + attitude",
    verify: ["verify:phase12"],
    requiresStack: true,
    triggers: [
      /apps\/game-server\/src\/collective\//,
      /packages\/npc-memory\/src\/collective\//,
      /apps\/web\/src\/hooks\/useCollectiveAttitude/,
      /apps\/web\/src\/components\/Collective/,
      /apps\/game-server\/src\/routes\/collective-state/,
    ],
  },
  {
    id: "GF-07",
    name: "NPC memory + recall",
    verify: ["verify:phase3"],
    requiresStack: true,
    triggers: [
      /apps\/game-server\/src\/memory\//,
      /packages\/npc-memory\/src\/(?!collective)/,
      /workers\/agent-worker\/src\/.*memory/,
    ],
  },
  {
    id: "GF-10",
    name: "Phase 20 memory + speak trust",
    verify: ["verify:phase20"],
    requiresStack: true,
    triggers: [
      /scripts\/verify-phase20\.mjs$/,
      /scripts\/playtest-speak-sla\.mjs$/,
      /scripts\/benchmark-speak-browser\.mjs$/,
      /scripts\/lib\/e2e-memory-helpers\.mjs$/,
      /scripts\/lib\/dialogue-engage\.mjs$/,
      /scripts\/lib\/speak-browser-/,
      /scripts\/assert-refusal-markers-parity\.mjs$/,
      /workers\/agent-worker\/src\/graph\/recall_merge\.py$/,
    ],
  },
  {
    id: "GF-08",
    name: "Phaser reset snap",
    verify: ["uat:phase7:reset-snap"],
    requiresStack: true,
    triggers: [/apps\/web\/src\/ChatPage\.tsx$/, /npcResetEpoch/],
  },
  {
    id: "GF-09",
    name: "Phase 16 ambient + background NPC tier",
    verify: ["verify:phase16"],
    requiresStack: true,
    triggers: [
      /apps\/game-server\/src\/ambient\//,
      /packages\/shared\/src\/backgroundNpc/,
      /apps\/web\/src\/game\/bgNpcLabels/,
      /scripts\/verify-phase16\.mjs$/,
      /apps\/game-server\/data\/world\/.*spawns\.json$/,
    ],
  },
];

/**
 * Stabilization baseline — run without git diff (`pnpm agent:verify:e2e-baseline`).
 * Fast merge gate before v5; full ship gate remains `pnpm verify:phase22`.
 * @type {string[]}
 */
export const E2E_BASELINE_SCRIPTS = [
  "uat:phase7:reset-snap",
  "verify:phase6:move-only",
  "verify:phase13",
];

/** High-risk paths — warn on diff unless listed in declared scope. */
export const PROTECTED_PATH_PATTERNS = [
  { id: "PP-01", label: "Colyseus core", pattern: /^apps\/game-server\/src\/colyseus\/GameRoom\.ts$/ },
  { id: "PP-02", label: "Colyseus room hook", pattern: /^apps\/web\/src\/hooks\/useColyseusRoom\.ts$/ },
  { id: "PP-03", label: "Movement controller", pattern: /^apps\/web\/src\/game\/RoomScene\.ts$/ },
  { id: "PP-04", label: "Worker NL graph", pattern: /^workers\/agent-worker\/src\/graph\// },
  { id: "PP-05", label: "Cross-layer contracts", pattern: /^docs\/CONTRACTS\.md$/ },
  { id: "PP-06", label: "Multiplayer invariants", pattern: /^docs\/INVARIANTS-MULTIPLAYER\.md$/ },
];

/**
 * @param {string[]} files
 * @returns {Set<string>}
 */
export function collectUnitCommands(files) {
  const cmds = new Set();
  for (const file of files) {
    const norm = file.replace(/\\/g, "/");
    for (const rule of UNIT_TEST_RULES) {
      if (rule.match(norm)) cmds.add(rule.cmd);
    }
  }
  return cmds;
}

/**
 * @param {string[]} files
 * @returns {GoldenFlow[]}
 */
export function collectGoldenFlows(files) {
  const matched = new Map();
  for (const file of files) {
    const norm = file.replace(/\\/g, "/");
    for (const flow of GOLDEN_FLOWS) {
      if (flow.triggers.some((re) => re.test(norm))) {
        matched.set(flow.id, flow);
      }
    }
  }
  return [...matched.values()];
}

/**
 * Cross-layer heuristic: game-server + worker touched in same diff.
 * @param {string[]} files
 */
export function isCrossLayerDiff(files) {
  const norm = files.map((f) => f.replace(/\\/g, "/"));
  const gs = norm.some((p) => p.startsWith("apps/game-server/"));
  const wk = norm.some((p) => p.startsWith("workers/agent-worker/"));
  return gs && wk;
}

/**
 * @param {string} scopeGlob e.g. "apps/game-server/src/collective/*"
 * @param {string} filePath
 */
export function pathMatchesScope(scopeGlob, filePath) {
  const norm = filePath.replace(/\\/g, "/");
  const scope = scopeGlob.replace(/\\/g, "/").trim();
  if (!scope) return true;
  if (scope.endsWith("/**")) {
    const prefix = scope.slice(0, -3);
    return norm.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || norm === prefix;
  }
  if (scope.endsWith("/*")) {
    const prefix = scope.slice(0, -1);
    if (!norm.startsWith(prefix)) return false;
    const rest = norm.slice(prefix.length);
    return rest.length > 0 && !rest.includes("/");
  }
  if (scope.includes("*")) {
    const escaped = scope.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(norm);
  }
  return norm === scope || norm.startsWith(`${scope}/`);
}

/**
 * @param {string | undefined} scope
 * @param {string[]} changedFiles
 * @returns {{ ok: boolean; outOfScope: string[]; protectedTouched: { id: string; label: string; file: string }[] }}
 */
export function auditScope(scope, changedFiles) {
  const outOfScope = [];
  const protectedTouched = [];

  for (const file of changedFiles) {
    const norm = file.replace(/\\/g, "/");
    if (scope && !pathMatchesScope(scope, norm)) {
      outOfScope.push(norm);
    }
    for (const pp of PROTECTED_PATH_PATTERNS) {
      if (pp.pattern.test(norm)) {
        protectedTouched.push({ id: pp.id, label: pp.label, file: norm });
      }
    }
  }

  return { ok: outOfScope.length === 0, outOfScope, protectedTouched };
}

/**
 * @param {GoldenFlow[]} flows
 * @param {boolean} crossLayer
 * @returns {string[]}
 */
export function flattenVerifyScripts(flows, crossLayer) {
  const scripts = new Set();
  for (const flow of flows) {
    for (const v of flow.verify) scripts.add(v);
  }
  if (crossLayer) {
    scripts.add("verify:phase8");
  }
  return [...scripts].sort();
}
