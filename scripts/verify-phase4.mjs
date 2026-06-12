import { assertE2eNoMock } from "./lib/e2e-policy.mjs";

const baseUrl =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const roomId = "default";
const SECRET = "SECRET-LUANG-42";

function internalHeaders() {
  const headers = { "Content-Type": "application/json" };
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
  return { status: res.status, body };
}

async function requestOk(path, options = {}) {
  const { status, body } = await request(path, options);
  if (status < 200 || status >= 300) {
    throw new Error(`${options.method || "GET"} ${path} → ${status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  assertE2eNoMock("verify:phase4");
  console.log(`verify:phase4 → ${baseUrl}`);

  await requestOk(`/rooms/${roomId}/reset`, { method: "POST" });

  const state = await requestOk(`/rooms/${roomId}/state`);
  if (!Array.isArray(state.state?.npcs) || state.state.npcs.length !== 3) {
    throw new Error("expected 3 npcs in room state");
  }
  const names = state.state.npcs.map((n) => n.name);
  for (const expected of ["路昂", "费雪", "南宫婉"]) {
    if (!names.includes(expected)) {
      throw new Error(`missing npc name ${expected}`);
    }
  }
  if (state.memoryCount !== undefined) {
    throw new Error("state must not include singular memoryCount");
  }
  if (!state.memoryCounts || typeof state.memoryCounts !== "object") {
    throw new Error("state must include memoryCounts map");
  }
  for (const id of ["npc-1", "npc-2", "npc-3"]) {
    if (!(id in state.memoryCounts)) {
      throw new Error(`memoryCounts missing key ${id}`);
    }
  }

  const missingNpcId = await request(`/rooms/${roomId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message: "hello" }),
  });
  if (missingNpcId.status !== 400) {
    throw new Error("chat without npcId should return 400");
  }

  await requestOk(`/internal/rooms/${roomId}/memories`, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({
      text: `player: remember ${SECRET}`,
      npcId: "npc-1",
      importance: 8,
    }),
  });

  const ctxNpc2 = await requestOk(
    `/internal/rooms/${roomId}/memory-context?playerMessage=${encodeURIComponent("secret token")}&npcId=npc-2`,
    { headers: internalHeaders() },
  );
  const ctxHaystack = JSON.stringify(ctxNpc2).toLowerCase();
  if (ctxHaystack.includes(SECRET.toLowerCase())) {
    throw new Error("npc-2 memory-context leaked npc-1 secret");
  }

  const transfer = await requestOk(`/internal/rooms/${roomId}/apply-actions`, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({
      actingNpcId: "npc-1",
      actions: [{ type: "transfer", itemId: "key-1", toNpcId: "npc-2" }],
    }),
  });
  const npc1 = transfer.state.npcs.find((n) => n.id === "npc-1");
  const npc2 = transfer.state.npcs.find((n) => n.id === "npc-2");
  if (npc1?.inventory?.includes("key-1")) {
    throw new Error("key-1 still in npc-1 inventory after transfer");
  }
  if (!npc2?.inventory?.includes("key-1")) {
    throw new Error("key-1 not in npc-2 inventory after transfer");
  }

  const debug1 = await requestOk(`/rooms/${roomId}/npc-memory/npc-1`);
  const debug2 = await requestOk(`/rooms/${roomId}/npc-memory/npc-2`);
  for (const debug of [debug1, debug2]) {
    if (typeof debug.memoryCount !== "number") {
      throw new Error("npc-memory debug missing memoryCount");
    }
    if (!("latestBulkSummary" in debug) || !("latestReflection" in debug)) {
      throw new Error("npc-memory debug missing summary fields");
    }
    if ("retrieved" in debug) {
      throw new Error("npc-memory debug must not expose retrieved");
    }
  }

  const afterReset = await requestOk(`/rooms/${roomId}/reset`, { method: "POST" });
  for (const id of ["npc-1", "npc-2", "npc-3"]) {
    if (afterReset.memoryCounts[id] !== 0) {
      throw new Error(`reset did not clear memoryCounts for ${id}`);
    }
  }

  console.log("verify:phase4 OK — multi-npc state, isolation, transfer, debug API");
}

main().catch((err) => {
  console.error(`verify:phase4 failed: ${err.message}`);
  console.error("Ensure game-server is running: pnpm --filter @aetherlife/game-server dev");
  process.exit(1);
});
