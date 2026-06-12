import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@colyseus/sdk";
import { assertE2eRealLlm, e2eSpeakTimeoutMs } from "./lib/e2e-policy.mjs";
import { pollJobDone, sleep } from "./lib/e2e-sse.mjs";
import { gameServerHttpBase, gameServerWsUrl, loadRootEnv } from "./lib/env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(root);

const baseUrl = gameServerHttpBase();
const wsUrl = gameServerWsUrl();
const roomId = "default";
const VERIFY_PLAYER_ID = "verifyph3test00001";
const FACT = "FACT-XYZ-42";
const seedBulk = Number.parseInt(process.argv.find((a) => a.startsWith("--seed-bulk="))?.split("=")[1] ?? "0", 10);

function playerHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "X-Player-Id": VERIFY_PLAYER_ID,
    ...extra,
  };
}

function internalHeaders() {
  const headers = playerHeaders();
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${options.method || "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function seedMemories(count) {
  for (let i = 0; i < count; i++) {
    await request(`/internal/rooms/${roomId}/memories`, {
      method: "POST",
      headers: internalHeaders(),
      body: JSON.stringify({
        text: `player: filler memory ${i} about room exploration`,
        npcId: "npc-1",
        playerId: VERIFY_PLAYER_ID,
        importance: 3,
      }),
    });
  }
}

async function pollJobDoneForRoom(jobId, timeoutMs = 120_000) {
  return pollJobDone({
    baseUrl,
    roomId,
    jobId,
    playerId: VERIFY_PLAYER_ID,
    timeoutMs,
  });
}

async function waitForMemoryCounts(
  predicate,
  timeoutMs,
  label,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await request(`/rooms/${roomId}/state`, { headers: playerHeaders() });
    const counts = state.memoryCounts ?? {};
    if (predicate(counts)) return counts;
    await sleep(1000);
  }
  throw new Error(`${label} not satisfied within ${timeoutMs}ms`);
}

async function main() {
  assertE2eRealLlm("verify:phase3");
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "verify:phase3 requires DATABASE_URL for real embed recall E2E. See docs/E2E-POLICY.md",
    );
  }

  console.log(`verify:phase3 → ${baseUrl}`);

  const client = new Client(wsUrl);
  const colyseusRoom = await client.joinOrCreate("game_room", {
    mapRoomId: roomId,
    playerId: VERIFY_PLAYER_ID,
  });
  console.log(`verify:phase3: joined Colyseus room ${colyseusRoom.roomId} as ${VERIFY_PLAYER_ID}`);

  await request(`/rooms/${roomId}/reset`, {
    method: "POST",
    headers: playerHeaders(),
    body: JSON.stringify({ playerId: VERIFY_PLAYER_ID }),
  });

  const chatRes = await request(`/rooms/${roomId}/chat`, {
    method: "POST",
    headers: playerHeaders(),
    body: JSON.stringify({
      message: `Remember ${FACT} the door code is 7`,
      npcId: "npc-1",
      playerId: VERIFY_PLAYER_ID,
    }),
  });
  if (!chatRes.jobId) {
    throw new Error("chat did not return jobId");
  }
  console.log(`chat jobId=${chatRes.jobId} — waiting for worker memory write…`);
  await pollJobDoneForRoom(chatRes.jobId, e2eSpeakTimeoutMs());
  // Memory tail runs after SSE "done" (main.py) — wait for DB persist before recall/reset.
  await waitForMemoryCounts(
    (counts) => (counts["npc-1"] ?? 0) > 0,
    e2eSpeakTimeoutMs(),
    "npc-1 memoryCount > 0 after chat",
  );

  if (seedBulk > 0) {
    console.log(`Seeding ${seedBulk} filler memories…`);
    await seedMemories(seedBulk);
  }

  const start = Date.now();
  const ctx = await request(
    `/internal/rooms/${roomId}/memory-context?playerMessage=${encodeURIComponent("what is the door code")}&npcId=npc-1&playerId=${encodeURIComponent(VERIFY_PLAYER_ID)}`,
    { headers: internalHeaders() },
  );
  const elapsed = Date.now() - start;

  const haystack = JSON.stringify(ctx).toLowerCase();
  const hasFact =
    haystack.includes(FACT.toLowerCase()) || haystack.includes("door code is 7");
  const hasStoredMemory = ctx.memoryCount > 0 || (ctx.retrieved || []).length > 0;
  if (!hasFact || !hasStoredMemory) {
    throw new Error(
      `memory-context missing stored recall (${FACT} / door code 7): ${JSON.stringify(ctx)}`,
    );
  }

  console.log(`memory-context OK in ${elapsed}ms`);
  console.log(`  memoryCount=${ctx.memoryCount}`);
  console.log(`  latestBulkSummary=${ctx.latestBulkSummary ? "present" : "none"}`);
  console.log(`  latestReflection=${ctx.latestReflection ? "present" : "none"}`);
  console.log(`  retrieved=${(ctx.retrieved || []).length} items`);

  if (elapsed > 500) {
    console.warn(`WARN: memory-context took ${elapsed}ms (>500ms target in dev)`);
  }

  await request(`/rooms/${roomId}/reset`, {
    method: "POST",
    headers: playerHeaders(),
    body: JSON.stringify({ playerId: VERIFY_PLAYER_ID }),
  });
  await waitForMemoryCounts(
    (counts) => ["npc-1", "npc-2", "npc-3"].every((id) => (counts[id] ?? 0) === 0),
    30_000,
    "reset clears all memoryCounts",
  );

  await colyseusRoom.leave();
  console.log("verify:phase3 OK — FACT recall, latency logged, reset clears DB memory");
}

main().catch((err) => {
  console.error(`verify:phase3 failed: ${err.message}`);
  console.error("Ensure game-server is running with DATABASE_URL: pnpm --filter @aetherlife/game-server dev");
  process.exit(1);
});
