import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@colyseus/sdk";
import { assertE2eNoMock } from "./lib/e2e-policy.mjs";

const CHUNK_SIZE = 8;
const COLYSEUS_CLIENT_MESSAGES = {
  requestChunksSync: "requestChunksSync",
};
const COLYSEUS_SERVER_MESSAGES = {
  moveAck: "moveAck",
  chunksSync: "chunksSync",
};

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

if (!process.env.WORLD_SEED) {
  process.env.WORLD_SEED = "42";
}

const httpBase =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const wsUrl = process.env.GAME_SERVER_WS || "ws://127.0.0.1:2567";
const roomId = process.env.VERIFY_PHASE10_ROOM_ID || `verify-p10-${Date.now()}`;
const VERIFY_PLAYER_ID = "verifyph10test0001";

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

async function request(path, options = {}) {
  const res = await fetch(`${httpBase}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${options.method || "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function moveToTarget(room, sessionId, targetX, targetY) {
  room.send("move", { targetX, targetY });
  await waitFor(() => {
    const p = room.state.players.get(sessionId);
    return p?.x === targetX && p?.y === targetY;
  }, 12_000, 80, `move to (${targetX},${targetY})`);
}

function runChunkLoaderTest() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@aetherlife/game-server", "exec", "vitest", "run", "src/world/chunk-loader.test.ts", "-t", "persists and reloads"],
      {
        cwd: root,
        stdio: "inherit",
        // In-memory delta path; HTTP interact above already exercised Postgres.
        env: { ...process.env, DATABASE_URL: "" },
      },
    );
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`chunk-loader door reload test exit ${code}`));
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
  await waitFor(() => latestChunks.length > 0, 8000, 80, "initial chunksSync");
  const sessionId = room.sessionId;

  const home = biomeAt(latestChunks, 0, 0);
  const scrub = biomeAt(latestChunks, 8, 0);
  const wetland = biomeAt(latestChunks, 9, 0);
  if (home !== "home") throw new Error(`(0,0) expected home, got ${home}`);
  if (scrub !== "scrub") throw new Error(`(8,0) expected scrub, got ${scrub}`);
  if (wetland !== "wetland") throw new Error(`(9,0) expected wetland, got ${wetland}`);
  console.log("verify:phase10: seed biome snapshot OK");

  const self = room.state.players.get(sessionId);
  if (!self) throw new Error("self player missing");

  await moveToTarget(room, sessionId, 7, 0);
  await moveToTarget(room, sessionId, 8, 0);
  await waitFor(() => latestChunks.length > 0, 3000, 50, "chunks after cross-chunk");
  const after = room.state.players.get(sessionId);
  if (after?.x !== 8 || after?.y !== 0) {
    throw new Error(`cross-chunk move failed: at (${after?.x},${after?.y})`);
  }
  console.log("verify:phase10: cross-chunk move (7,0)→(8,0) OK");

  const afterInteract = await request(`/internal/rooms/${roomId}/apply-actions`, {
    method: "POST",
    headers: (() => {
      const h = { "Content-Type": "application/json" };
      const token = process.env.INTERNAL_WORKER_TOKEN;
      if (token) h.Authorization = `Bearer ${token}`;
      return h;
    })(),
    body: JSON.stringify({
      actingNpcId: "npc-1",
      actions: [{ type: "interact", objectId: "door-1" }],
    }),
  });
  const door = afterInteract.state?.objects?.find((o) => o.id === "door-1");
  if (door?.state !== "open") {
    throw new Error("interact did not open door-1");
  }
  const refetch = await request(`/rooms/${roomId}/state`);
  const door2 = refetch.state?.objects?.find((o) => o.id === "door-1");
  if (door2?.state !== "open") {
    throw new Error("door-1 state not persisted in room HTTP state");
  }
  console.log("verify:phase10: door delta HTTP state OK");

  await runChunkLoaderTest();
  console.log("verify:phase10: chunk-loader door reload unit OK");

  await room.leave();
  console.log("verify:phase10 OK — biome seed, cross-chunk, door delta");
}

main().catch((err) => {
  console.error(`verify:phase10 failed: ${err.message}`);
  console.error("Ensure pnpm dev:stack is running with WORLD_SEED=42 in .env");
  process.exit(1);
});
