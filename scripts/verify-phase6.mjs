import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@colyseus/sdk";
import {
  assertE2eNoMock,
  assertE2eRealLlm,
  e2eSpeakTimeoutMs,
} from "./lib/e2e-policy.mjs";
import { HOME_DEFAULT_PLAYER_SPAWN, HOME_MAP_TILE_H, HOME_MAP_TILE_W } from "./lib/home-spawn.mjs";
import { gameServerHttpBase, gameServerWsUrl, loadRootEnv } from "./lib/env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

const httpBase = gameServerHttpBase();
const wsUrl = gameServerWsUrl();
/** Isolated room so dev sessions on `default` do not block movement. */
const roomId = process.env.VERIFY_PHASE6_ROOM_ID || `verify-p6-${Date.now()}`;
const skipSpeak = process.env.SKIP_SPEAK_VERIFY === "1";
const VERIFY_PLAYER_ID = "verifyph6test00001";
const VERIFY_PLAYER_B = "verifyph6test00002";

const STEP_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

async function healthOk() {
  const res = await fetch(`${httpBase}/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
  const body = await res.json();
  if (body.service !== "game-server") throw new Error("unexpected health body");
}

function assertSpeakStackReady() {
  if (skipSpeak) return;
  if (!process.env.REDIS_URL) {
    throw new Error(
      "REDIS_URL is required for speak E2E. Copy .env.example → .env, run pnpm dev:stack (real worker). See docs/E2E-POLICY.md",
    );
  }
}

function waitFor(condition, timeoutMs = 3000, intervalMs = 50) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("timeout waiting for condition"));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

async function waitForPlayersMap(room, timeoutMs = 5000) {
  await waitFor(() => room.state?.players?.get, timeoutMs);
}

/** Try cardinal steps until peer sees a position change (handles map edge + blockers). */
async function moveOneStep(roomA, roomB, sessionA) {
  const start = roomA.state.players.get(sessionA);
  if (!start) throw new Error("player missing before step move");

  for (const [dx, dy] of STEP_DIRS) {
    const nx = start.x + dx;
    const ny = start.y + dy;
    if (nx < 0 || ny < 0 || nx >= HOME_MAP_TILE_W || ny >= HOME_MAP_TILE_H) continue;

    roomA.send("move", { dx, dy });
    try {
      await waitFor(() => {
        const peer = roomB.state.players.get(sessionA);
        return peer?.x === nx && peer?.y === ny;
      }, 2000);
      return { x: nx, y: ny };
    } catch {
      /* blocked or rejected — try next direction */
    }
  }
  throw new Error(
    `no valid step from (${start.x},${start.y}); room may be crowded or grid blocked`,
  );
}

async function moveToTarget(room, sessionId, targetX, targetY) {
  room.send("move", { targetX, targetY });
  await waitFor(() => {
    const p = room.state.players.get(sessionId);
    return p?.x === targetX && p?.y === targetY;
  }, 5000);
}

/** MP-MOV-02: pending/locomotion must suppress local schema snap (Phase 10.5 Wave 2). */
function assertLocalSchemaSnapGate() {
  const r = spawnSync(
    "pnpm",
    [
      "--filter",
      "@aetherlife/shared",
      "exec",
      "vitest",
      "run",
      "src/localPlayerSchemaSnap.test.ts",
    ],
    { cwd: root, stdio: "inherit", env: process.env },
  );
  if (r.status !== 0) {
    throw new Error("MP-MOV-02 localPlayerSchemaSnap unit gate failed");
  }
  console.log("verify:phase6: MP-MOV-02 local schema snap gate OK");
}

async function main() {
  assertE2eNoMock("verify:phase6");
  if (!skipSpeak) assertE2eRealLlm("verify:phase6");
  console.log(`verify:phase6 → ${wsUrl} roomId=${roomId}`);
  assertSpeakStackReady();
  await healthOk();
  if (skipSpeak) {
    assertLocalSchemaSnapGate();
    const flash = spawnSync("node", ["scripts/uat-phase6-move-flash.mjs"], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    if (flash.status !== 0) {
      throw new Error("MP-MOV-02 Phaser schema snap-back gate failed");
    }
    console.log("verify:phase6: MP-MOV-02 Phaser flash gate OK");
  }

  const clientA = new Client(wsUrl);
  const clientB = new Client(wsUrl);

  const roomA = await clientA.joinOrCreate("game_room", {
    mapRoomId: roomId,
    playerId: VERIFY_PLAYER_ID,
  });
  const roomB = await clientB.joinOrCreate("game_room", {
    mapRoomId: roomId,
    playerId: VERIFY_PLAYER_B,
  });

  await waitForPlayersMap(roomA);
  await waitForPlayersMap(roomB);

  let speakJobId = null;
  let sawThinking = false;
  let sawDone = false;
  let rejectSpeak = null;

  const matchesSpeakJob = (data) =>
    !speakJobId || !data?.jobId || data.jobId === speakJobId;

  roomA.onMessage("speakAck", (data) => {
    if (data && typeof data.jobId === "string") speakJobId = data.jobId;
  });
  roomA.onMessage("thinking", (data) => {
    if (matchesSpeakJob(data)) sawThinking = true;
  });
  roomA.onMessage("done", (data) => {
    if (matchesSpeakJob(data)) sawDone = true;
  });
  roomA.onMessage("error", (data) => {
    if (matchesSpeakJob(data) && rejectSpeak) {
      rejectSpeak(new Error(data?.message ?? "speak error"));
    }
  });

  await waitFor(
    () =>
      roomA.state.players.size >= 2 && roomB.state.players.size >= 2,
    5000,
  );

  const sessionA = roomA.sessionId;
  if (roomB.state.players.get(sessionA) === undefined) {
    throw new Error("peer player missing from replicated state");
  }

  const afterStep = await moveOneStep(roomA, roomB, sessionA);
  console.log(`verify:phase6: step sync OK → (${afterStep.x},${afterStep.y})`);

  const sessionB = roomB.sessionId;
  const targetB = {
    x: HOME_DEFAULT_PLAYER_SPAWN.x - 1,
    y: HOME_DEFAULT_PLAYER_SPAWN.y,
  };
  const targetA = {
    x: HOME_DEFAULT_PLAYER_SPAWN.x - 2,
    y: HOME_DEFAULT_PLAYER_SPAWN.y,
  };

  await moveToTarget(roomB, sessionB, targetB.x, targetB.y);
  await waitFor(() => {
    const peerB = roomA.state.players.get(sessionB);
    return peerB?.x === targetB.x && peerB?.y === targetB.y;
  }, 5000);

  await moveToTarget(roomA, sessionA, targetA.x, targetA.y);
  await waitFor(() => {
    const peer = roomB.state.players.get(sessionA);
    return peer?.x === targetA.x && peer?.y === targetA.y;
  }, 5000);
  console.log(`verify:phase6: target move sync OK → (${targetA.x},${targetA.y})`);

  if (!skipSpeak) {
    const speakTimeoutMs = e2eSpeakTimeoutMs();
    const donePromise = new Promise((resolve, reject) => {
      rejectSpeak = reject;
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `speak flow timeout (${speakTimeoutMs / 1000}s) — is worker running with REDIS_URL?`,
            ),
          ),
        speakTimeoutMs,
      );
      const poll = setInterval(() => {
        if (sawDone) {
          clearTimeout(timer);
          clearInterval(poll);
          resolve();
        }
      }, 100);
    });

    roomA.send("speak", {
      text: "hello from verify phase6",
      npcId: "npc-1",
      playerId: VERIFY_PLAYER_ID,
    });

    await donePromise;
    if (!sawThinking || !sawDone) {
      throw new Error(
        `speak incomplete (thinking=${sawThinking}, done=${sawDone}, jobId=${speakJobId ?? "none"})`,
      );
    }
    console.log("verify:phase6: dual-client move + speak OK");
  } else {
    console.log("verify:phase6: dual-client move OK (SKIP_SPEAK_VERIFY=1)");
  }

  await roomA.leave();
  await roomB.leave();

  console.log("verify:phase6 OK");
}

main().catch((err) => {
  console.error(`verify:phase6 failed: ${err.message}`);
  console.error(
    "Ensure full stack: pnpm dev:stack (real worker). Game-server on :2567, REDIS_URL in .env. See docs/E2E-POLICY.md",
  );
  process.exit(1);
});
