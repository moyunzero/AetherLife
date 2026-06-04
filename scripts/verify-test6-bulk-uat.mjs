/**
 * UAT Test 6: bulk summary after ≥100 raw memories + FACT still retrievable.
 * Requires game-server on 2567 and agent-worker processing jobs.
 */
const baseUrl =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const roomId = "default";
const FACT = "FACT-XYZ-42";
const SEED_COUNT = 100;

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function seedMemories(count) {
  await request(`/internal/rooms/${roomId}/memories`, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({
      text: `player: Remember ${FACT} the door code is 7`,
      npcId: "1",
      importance: 8,
    }),
  });
  for (let i = 1; i < count; i++) {
    if (i % 10 === 0) console.log(`  seeded ${i}/${count - 1} fillers…`);
    await request(`/internal/rooms/${roomId}/memories`, {
      method: "POST",
      headers: internalHeaders(),
      body: JSON.stringify({
        text: `player: filler memory ${i} about room exploration`,
        npcId: "1",
        importance: 3,
      }),
    });
  }
}

async function fetchContext(query) {
  return request(
    `/internal/rooms/${roomId}/memory-context?playerMessage=${encodeURIComponent(query)}&npcId=1`,
    { headers: internalHeaders() },
  );
}

async function main() {
  console.log(`verify-test6 → ${baseUrl}`);
  console.log("1/4 reset room");
  await request(`/rooms/${roomId}/reset`, { method: "POST" });

  console.log(`2/4 seed ${SEED_COUNT} memories (embed — may take several minutes)…`);
  const seedStart = Date.now();
  await seedMemories(SEED_COUNT);
  console.log(`  seed done in ${Math.round((Date.now() - seedStart) / 1000)}s`);

  const before = await fetchContext("what is the door code");
  console.log(
    `  memoryCount=${before.memoryCount} bulk=${before.latestBulkSummary ? "present" : "none"}`,
  );
  if (before.memoryCount < SEED_COUNT) {
    throw new Error(`expected memoryCount≥${SEED_COUNT}, got ${before.memoryCount}`);
  }

  console.log("3/4 chat to trigger worker bulk summarize");
  const chat = await request(`/rooms/${roomId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message: "继续" }),
  });
  console.log(`  jobId=${chat.jobId}`);

  console.log("4/4 poll memory-context for bulk summary (max ~4 min)…");
  for (let i = 0; i < 24; i++) {
    await sleep(10_000);
    const ctx = await fetchContext("what is the door code");
    const hasBulk = Boolean(ctx.latestBulkSummary);
    console.log(
      `  poll ${i + 1}: memoryCount=${ctx.memoryCount} bulk=${hasBulk ? "present" : "none"}`,
    );
    if (hasBulk) {
      const haystack = JSON.stringify(ctx).toLowerCase();
      const factOk =
        haystack.includes(FACT.toLowerCase()) || haystack.includes("door code") || haystack.includes("7");
      if (!factOk) {
        throw new Error(`bulk present but FACT missing: ${JSON.stringify(ctx)}`);
      }
      console.log("verify-test6 OK — bulk summary exists, FACT/door code still retrievable");
      console.log(`  bulk preview: ${String(ctx.latestBulkSummary).slice(0, 120)}…`);
      return;
    }
  }
  throw new Error(
    "timeout: latestBulkSummary still null — is agent-worker running and processing jobs?",
  );
}

main().catch((err) => {
  console.error(`verify-test6 failed: ${err.message}`);
  process.exit(1);
});
