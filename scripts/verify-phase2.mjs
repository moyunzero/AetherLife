import { assertE2eNoMock } from "./lib/e2e-policy.mjs";

const baseUrl = process.env.GAME_SERVER_URL || "http://127.0.0.1:2567";
const roomId = "default";

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

function findNpc(state, id) {
  return state?.npcs?.find((npc) => npc.id === id);
}

async function main() {
  assertE2eNoMock("verify:phase2");
  console.log(`verify:phase2 → ${baseUrl}`);

  const initial = await request(`/rooms/${roomId}/state`);
  const npc1 = findNpc(initial.state, "npc-1");
  if (npc1?.x !== 2 || npc1?.y !== 2) {
    await request(`/rooms/${roomId}/reset`, { method: "POST" });
  }

  const afterMove = await request(`/rooms/${roomId}/apply-actions`, {
    method: "POST",
    body: JSON.stringify({
      actingNpcId: "npc-1",
      actions: [{ type: "move", x: 5, y: 5 }],
    }),
  });
  const moved = findNpc(afterMove.state, "npc-1");
  if (moved?.x !== 5 || moved?.y !== 5) {
    throw new Error("move did not update npc-1 coordinates");
  }

  const afterInteract = await request(`/rooms/${roomId}/apply-actions`, {
    method: "POST",
    body: JSON.stringify({
      actingNpcId: "npc-1",
      actions: [{ type: "interact", objectId: "door-1" }],
    }),
  });
  const door = afterInteract.state?.objects?.find((o) => o.id === "door-1");
  if (door?.state !== "open") {
    throw new Error("interact did not toggle door-1 to open");
  }

  const reset = await request(`/rooms/${roomId}/reset`, { method: "POST" });
  const resetNpc = findNpc(reset.state, "npc-1");
  if (resetNpc?.x !== 2 || resetNpc?.y !== 2) {
    throw new Error("reset did not restore default npc-1 position");
  }
  if (reset.memoryCounts?.["npc-1"] !== 0) {
    throw new Error("reset did not clear memoryCounts");
  }

  console.log("verify:phase2 OK — move, interact, reset");
}

main().catch((err) => {
  console.error(`verify:phase2 failed: ${err.message}`);
  console.error("Ensure game-server is running: pnpm --filter @aetherlife/game-server dev");
  process.exit(1);
});
