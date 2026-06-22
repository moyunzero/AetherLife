import assert from "node:assert/strict";
import test from "node:test";
import {
  auditScope,
  collectGoldenFlows,
  collectUnitCommands,
  flattenVerifyScripts,
  isCrossLayerDiff,
  pathMatchesScope,
} from "./lib/agent-verify-map.mjs";

test("collectUnitCommands maps game-server paths", () => {
  const cmds = collectUnitCommands(["apps/game-server/src/index.ts"]);
  assert.ok([...cmds].some((c) => c.includes("game-server")));
});

test("collectGoldenFlows triggers GF-06 for collective", () => {
  const flows = collectGoldenFlows(["apps/game-server/src/collective/service.ts"]);
  assert.ok(flows.some((f) => f.id === "GF-06"));
});

test("isCrossLayerDiff detects game-server + worker", () => {
  assert.equal(
    isCrossLayerDiff([
      "apps/game-server/src/colyseus/GameRoom.ts",
      "workers/agent-worker/src/graph/prompt.py",
    ]),
    true,
  );
  assert.equal(isCrossLayerDiff(["apps/web/src/ChatPage.tsx"]), false);
});

test("pathMatchesScope supports trailing glob", () => {
  assert.ok(pathMatchesScope("apps/game-server/src/collective/*", "apps/game-server/src/collective/gate.ts"));
  assert.ok(!pathMatchesScope("apps/game-server/src/collective/*", "apps/game-server/src/colyseus/GameRoom.ts"));
});

test("auditScope flags out-of-scope files", () => {
  const r = auditScope("apps/web/src/components/*", [
    "apps/web/src/components/Foo.tsx",
    "apps/game-server/src/index.ts",
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.outOfScope.length, 1);
});

test("flattenVerifyScripts adds phase8 on cross-layer", () => {
  const scripts = flattenVerifyScripts([], true);
  assert.ok(scripts.includes("verify:phase8"));
});

test("E2E_BASELINE_SCRIPTS includes GF-08 oracle", async () => {
  const { E2E_BASELINE_SCRIPTS } = await import("./lib/agent-verify-map.mjs");
  assert.ok(E2E_BASELINE_SCRIPTS.includes("uat:phase7:reset-snap"));
  assert.ok(E2E_BASELINE_SCRIPTS.includes("verify:phase6:move-only"));
  assert.ok(E2E_BASELINE_SCRIPTS.includes("verify:phase13"));
});
