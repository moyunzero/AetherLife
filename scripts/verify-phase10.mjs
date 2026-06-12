import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@colyseus/sdk";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";
import { gameServerHttpBase, gameServerWsUrl, loadRootEnv } from "./lib/env.mjs";

const CHUNK_SIZE = 8;
const COLYSEUS_CLIENT_MESSAGES = {
  requestChunksSync: "requestChunksSync",
};
const COLYSEUS_SERVER_MESSAGES = {
  moveAck: "moveAck",
  chunksSync: "chunksSync",
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase = gameServerHttpBase();
const wsUrl = gameServerWsUrl();
const roomId = process.env.VERIFY_PHASE10_ROOM_ID || `verify-p10-${Date.now()}`;
const VERIFY_PLAYER_ID = "verifyph10test0001";

/** Keep in sync with packages/shared/src/homeMap.ts */
const HOME_SPAWN = { x: 34, y: 13 };

function waitFor(condition, timeoutMs = 8000, intervalMs = 50, label = "condition") {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timeout waiting for ${label} (${timeoutMs}ms)`));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function biomeAt(chunks, gx, gy) {
  const cx = Math.floor(gx / CHUNK_SIZE);
  const cy = Math.floor(gy / CHUNK_SIZE);
  const chunk = chunks.find((c) => c.cx === cx && c.cy === cy);
  if (!chunk) return null;
  const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return chunk.tiles.find((t) => t.lx === lx && t.ly === ly)?.biome ?? null;
}

async function moveToTarget(room, sessionId, targetX, targetY) {
  room.send("move", { targetX, targetY });
  await waitFor(() => {
    const p = room.state.players.get(sessionId);
    return p?.x === targetX && p?.y === targetY;
  }, 12_000, 80, `move to (${targetX},${targetY})`);
}

function runVitestFilter(pkg, relPath, titleFilter, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["--filter", pkg, "exec", "vitest", "run", relPath, "-t", titleFilter],
      { cwd: root, stdio: "inherit", env },
    );
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${relPath} (${titleFilter}) exit ${code}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  assertE2eNoMock("verify:phase10");

  const seed = Number.parseInt(process.env.WORLD_SEED, 10);
  if (seed !== 42) {
    throw new Error(`verify:phase10 requires WORLD_SEED=42 (got ${process.env.WORLD_SEED})`);
  }

  console.log(`verify:phase10 → ${wsUrl} roomId=${roomId} WORLD_SEED=${seed}`);

  const health = await fetch(`${httpBase}/health`);
  if (!health.ok) throw new Error(`health ${health.status}`);

  await runVitestFilter(
    "@aetherlife/game-server",
    "src/world/noise.test.ts",
    "seed=42 snapshot",
  );
  console.log("verify:phase10: procedural seed biome unit OK");

  let latestChunks = [];
  const client = new Client(wsUrl);
  const room = await client.joinOrCreate("game_room", {
    mapRoomId: roomId,
    playerId: VERIFY_PLAYER_ID,
  });

  room.onMessage(COLYSEUS_SERVER_MESSAGES.chunksSync, (data) => {
    if (Array.isArray(data?.chunks)) latestChunks = data.chunks;
  });

  await waitFor(() => room.state?.players?.get, 5000, 50, "players map");
  room.send(COLYSEUS_CLIENT_MESSAGES.requestChunksSync, {});
  await waitFor(() => latestChunks.length >= 3, 8000, 80, "initial chunksSync");
  const sessionId = room.sessionId;

  const self = room.state.players.get(sessionId);
  if (!self) throw new Error("self player missing");
  if (self.x !== HOME_SPAWN.x || self.y !== HOME_SPAWN.y) {
    throw new Error(
      `expected spawn (${HOME_SPAWN.x},${HOME_SPAWN.y}), got (${self.x},${self.y})`,
    );
  }

  const spawnBiome = biomeAt(latestChunks, HOME_SPAWN.x, HOME_SPAWN.y);
  if (!spawnBiome) {
    throw new Error(
      `spawn biome missing from chunksSync at (${HOME_SPAWN.x},${HOME_SPAWN.y})`,
    );
  }
  console.log(`verify:phase10: homestead chunksSync OK (spawn biome=${spawnBiome})`);

  const crossTarget = { x: HOME_SPAWN.x - 2, y: HOME_SPAWN.y };
  await moveToTarget(room, sessionId, crossTarget.x, crossTarget.y);
  await waitFor(() => latestChunks.length >= 3, 3000, 50, "chunks after cross-chunk");
  const after = room.state.players.get(sessionId);
  if (after?.x !== crossTarget.x || after?.y !== crossTarget.y) {
    throw new Error(
      `cross-chunk move failed: at (${after?.x},${after?.y}), expected (${crossTarget.x},${crossTarget.y})`,
    );
  }
  console.log(
    `verify:phase10: cross-chunk move (${HOME_SPAWN.x},${HOME_SPAWN.y})→(${crossTarget.x},${crossTarget.y}) OK`,
  );

  await runVitestFilter(
    "@aetherlife/game-server",
    "src/world/chunk-loader.test.ts",
    "persists and reloads",
    { ...process.env, DATABASE_URL: "" },
  );
  console.log("verify:phase10: chunk-loader door delta unit OK");

  await room.leave();
  console.log("verify:phase10 OK — seed unit, homestead chunks, cross-chunk, door delta unit");
}

main().catch((err) => {
  console.error(`verify:phase10 failed: ${err.message}`);
  console.error("Ensure pnpm dev:stack is running with WORLD_SEED=42 in .env");
  process.exit(1);
});
