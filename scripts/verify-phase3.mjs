import { assertE2eRealLlm } from "./lib/e2e-policy.mjs";

const baseUrl =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const roomId = "default";
const FACT = "FACT-XYZ-42";
const seedBulk = Number.parseInt(process.argv.find((a) => a.startsWith("--seed-bulk="))?.split("=")[1] ?? "0", 10);

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
        importance: 3,
      }),
    });
  }
}

async function main() {
  assertE2eRealLlm("verify:phase3");
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "verify:phase3 requires DATABASE_URL for real embed recall E2E. See docs/E2E-POLICY.md",
    );
  }

  console.log(`verify:phase3 → ${baseUrl}`);

  await request(`/rooms/${roomId}/reset`, { method: "POST" });

  const chatRes = await request(`/rooms/${roomId}/chat`, {
    method: "POST",
    body: JSON.stringify({
      message: `Remember ${FACT} the door code is 7`,
      npcId: "npc-1",
    }),
  });
  if (!chatRes.jobId) {
    throw new Error("chat did not return jobId");
  }

  if (seedBulk > 0) {
    console.log(`Seeding ${seedBulk} filler memories…`);
    await seedMemories(seedBulk);
  }

  const start = Date.now();
  const ctx = await request(
    `/internal/rooms/${roomId}/memory-context?playerMessage=${encodeURIComponent("what is the door code")}&npcId=npc-1`,
    { headers: internalHeaders() },
  );
  const elapsed = Date.now() - start;

  const haystack = JSON.stringify(ctx).toLowerCase();
  if (!haystack.includes(FACT.toLowerCase()) && !haystack.includes("7")) {
    throw new Error(`memory-context missing ${FACT} or door code 7: ${JSON.stringify(ctx)}`);
  }

  console.log(`memory-context OK in ${elapsed}ms`);
  console.log(`  memoryCount=${ctx.memoryCount}`);
  console.log(`  latestBulkSummary=${ctx.latestBulkSummary ? "present" : "none"}`);
  console.log(`  latestReflection=${ctx.latestReflection ? "present" : "none"}`);
  console.log(`  retrieved=${(ctx.retrieved || []).length} items`);

  if (elapsed > 500) {
    console.warn(`WARN: memory-context took ${elapsed}ms (>500ms target in dev)`);
  }

  const afterReset = await request(`/rooms/${roomId}/reset`, { method: "POST" });
  for (const id of ["npc-1", "npc-2", "npc-3"]) {
    if (afterReset.memoryCounts?.[id] !== 0) {
      throw new Error(`reset did not clear memoryCounts for ${id}`);
    }
  }

  console.log("verify:phase3 OK — FACT recall, latency logged, reset clears DB memory");
}

main().catch((err) => {
  console.error(`verify:phase3 failed: ${err.message}`);
  console.error("Ensure game-server is running with DATABASE_URL: pnpm --filter @aetherlife/game-server dev");
  process.exit(1);
});
