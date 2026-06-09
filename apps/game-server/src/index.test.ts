import { describe, expect, it, beforeEach, vi } from "vitest";
import request from "supertest";
import { CollectiveRepository } from "@aetherlife/npc-memory";
import { createApp } from "./index.js";
import { clearAllActionTrackers } from "./collective/action-tracker.js";
import { CollectiveService } from "./collective/service.js";
import { moveIntentTracker } from "./collective/move-intent-tracker.js";
import { clearAllRooms } from "./room/store.js";
import { MemoryService } from "./memory/service.js";
import { clearMockJobs, getMockJob } from "./queue/npc-turn.js";
import { clearJobRegistry } from "./colyseus/job-registry.js";
import { clearColyseusRoomRegistry } from "./colyseus/room-registry.js";
import { clearJobSubscribers, peekBufferedJobEvents } from "./sse/hub.js";

describe("game-server", () => {
  const app = createApp();

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    clearAllRooms();
    clearMockJobs();
    clearJobSubscribers();
    clearJobRegistry();
    clearColyseusRoomRegistry();
    MemoryService.resetForTests();
    CollectiveService.resetForTests(new CollectiveRepository(null));
    clearAllActionTrackers();
    moveIntentTracker.clearAll();
  });

  it("GET /health returns 200", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "game-server" });
  });

  it("POST /actions/validate accepts valid move", async () => {
    const res = await request(app)
      .post("/actions/validate")
      .send({ type: "move", x: 1, y: 2 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.action).toEqual({ type: "move", x: 1, y: 2 });
  });

  it("POST /actions/validate rejects invalid body with 400", async () => {
    const res = await request(app)
      .post("/actions/validate")
      .send({ type: "fly", x: 0, y: 0 });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("POST /actions/validate rejects invalid JSON with 400", async () => {
    const res = await request(app)
      .post("/actions/validate")
      .set("Content-Type", "application/json")
      .send("{ not-json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: "Invalid JSON" });
  });

  it("POST /actions/validate rejects oversize body with 413", async () => {
    const huge = "x".repeat(20_000);
    const res = await request(app)
      .post("/actions/validate")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ type: "speak", targetId: "a", content: huge }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ ok: false, error: "Payload too large" });
  });

  it("GET /rooms/default/state returns npcs and memoryCounts", async () => {
    const res = await request(app).get("/rooms/default/state");
    expect(res.status).toBe(200);
    expect(res.body.state.npcs).toHaveLength(3);
    expect(res.body.state.objects).toBeDefined();
    expect(res.body.memoryCounts).toEqual({
      "npc-1": 0,
      "npc-2": 0,
      "npc-3": 0,
    });
    expect(res.body.memoryCount).toBeUndefined();
  });

  it("POST /rooms/default/reset returns fresh state and clears all memoryCounts", async () => {
    await request(app)
      .post("/rooms/default/chat")
      .send({ message: "hello", npcId: "npc-1" });

    const res = await request(app).post("/rooms/default/reset");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.state.npcs[0]).toEqual(expect.objectContaining({ id: "npc-1", x: 2, y: 2 }));
    expect(res.body.memoryCounts).toEqual({
      "npc-1": 0,
      "npc-2": 0,
      "npc-3": 0,
    });
  });

  it("POST apply-actions with valid move updates acting npc coordinates", async () => {
    await request(app).post("/rooms/default/reset");
    const res = await request(app)
      .post("/rooms/default/apply-actions")
      .send({
        actingNpcId: "npc-1",
        actions: [{ type: "move", x: 5, y: 5 }],
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.applied).toBe(1);
    expect(res.body.state.npcs[0]).toEqual(expect.objectContaining({ id: "npc-1", x: 5, y: 5 }));
  });

  it("POST apply-actions rejects missing actingNpcId", async () => {
    const res = await request(app)
      .post("/rooms/default/apply-actions")
      .send({ actions: [{ type: "move", x: 5, y: 5 }] });
    expect(res.status).toBe(400);
  });

  it("POST apply-actions rejects invalid action without mutating state", async () => {
    await request(app).post("/rooms/default/reset");
    const before = await request(app).get("/rooms/default/state");
    const res = await request(app)
      .post("/rooms/default/apply-actions")
      .send({
        actingNpcId: "npc-1",
        actions: [{ type: "fly", x: 0, y: 0 }],
      });
    expect(res.status).toBe(400);
    const after = await request(app).get("/rooms/default/state");
    expect(after.body.state.npcs).toEqual(before.body.state.npcs);
  });

  it("GET /internal/rooms/default/worker-state returns state without memoryCounts", async () => {
    const res = await request(app).get("/internal/rooms/default/worker-state");
    expect(res.status).toBe(200);
    expect(res.body.state).toBeDefined();
    expect(Array.isArray(res.body.state.npcs)).toBe(true);
    expect(Array.isArray(res.body.nearbyLore)).toBe(true);
    expect(res.body.memoryCounts).toBeUndefined();
  });

  it("GET /internal/rooms/default/memory-context returns context shape", async () => {
    await request(app)
      .post("/rooms/default/chat")
      .send({ message: "hello npc", npcId: "npc-1" });

    const res = await request(app)
      .get("/internal/rooms/default/memory-context")
      .query({ playerMessage: "hello", npcId: "npc-1" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.retrieved)).toBe(true);
    expect("latestBulkSummary" in res.body).toBe(true);
    expect("latestReflection" in res.body).toBe(true);
    expect(typeof res.body.memoryCount).toBe("number");
    expect(res.body.collective).toEqual(
      expect.objectContaining({
        band: expect.any(String),
        effectiveScore: expect.any(Number),
        allowedTools: expect.any(Array),
      }),
    );
  });

  it("GET /rooms/default/collective-state returns shape without speak text", async () => {
    const repo = CollectiveService.getInstance().repoRef();
    await repo.insertEvent({
      roomId: "default",
      npcId: "npc-1",
      kind: "rude",
      summary: "玩家言语粗鲁",
      playerIds: ["player-a", "player-b"],
      deltaScore: -8,
    });

    const res = await request(app)
      .get("/rooms/default/collective-state")
      .query({ npcId: "npc-1" })
      .set("X-Player-Id", "player-a");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.attitudes)).toBe(true);
    expect(Array.isArray(res.body.recentEvents)).toBe(true);
    expect(res.body.recentEvents[0]).toEqual(
      expect.objectContaining({
        kind: "rude",
        summary: "玩家言语粗鲁",
      }),
    );
    expect(res.body.recentEvents[0].text).toBeUndefined();
  });

  it("POST apply-actions rejects move for hostile attitude gate", async () => {
    const playerId = "hostile-player";
    const repo = CollectiveService.getInstance().repoRef();
    await repo.applyReputationDelta("default", "npc-1", playerId, -35);

    const res = await request(app)
      .post("/rooms/default/apply-actions")
      .send({
        actingNpcId: "npc-1",
        initiatorPlayerId: playerId,
        actions: [{ type: "move", x: 5, y: 5 }],
      });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: false,
        error: "attitude_gate",
        code: "hostile_gate",
        band: "hostile",
        actionType: "move",
      }),
    );
  });

  it("POST reset clears collective events for room", async () => {
    const repo = CollectiveService.getInstance().repoRef();
    await repo.insertEvent({
      roomId: "default",
      npcId: "npc-1",
      kind: "help",
      summary: "协助",
      playerIds: ["p-a", "p-b"],
      deltaScore: 6,
    });

    const resetRes = await request(app).post("/rooms/default/reset");
    expect(resetRes.status).toBe(200);

    const stateRes = await request(app)
      .get("/rooms/default/collective-state")
      .query({ npcId: "npc-1" });
    expect(stateRes.status).toBe(200);
    expect(stateRes.body.recentEvents).toEqual([]);
  });

  it("POST /rooms/default/chat returns jobId with npcId in payload", async () => {
    const before = await request(app).get("/rooms/default/state");
    const res = await request(app)
      .post("/rooms/default/chat")
      .send({ message: "hello npc", npcId: "npc-1" });
    expect(res.status).toBe(200);
    expect(typeof res.body.jobId).toBe("string");
    expect(getMockJob(res.body.jobId)?.npcId).toBe("npc-1");

    const after = await request(app).get("/rooms/default/state");
    // Player memory writes in worker tail (persist_turn_memory), not chat POST — ISSUE-022 / AGENTS.md.
    expect(after.body.memoryCounts).toEqual(before.body.memoryCounts);
    expect(after.body.memoryCounts["npc-2"]).toBe(0);
  });

  it("POST /rooms/default/chat rejects missing npcId", async () => {
    const res = await request(app).post("/rooms/default/chat").send({ message: "hello" });
    expect(res.status).toBe(400);
  });

  it("POST /rooms/default/chat rejects invalid npcId", async () => {
    const res = await request(app)
      .post("/rooms/default/chat")
      .send({ message: "hello", npcId: "npc-9" });
    expect(res.status).toBe(400);
  });

  it("POST /rooms/default/chat rejects empty message", async () => {
    const res = await request(app)
      .post("/rooms/default/chat")
      .send({ message: "   ", npcId: "npc-1" });
    expect(res.status).toBe(400);
  });

  it("GET /rooms/default/npc-memory/npc-1 returns debug shape without retrieved", async () => {
    const res = await request(app).get("/rooms/default/npc-memory/npc-1");
    expect(res.status).toBe(200);
    expect(typeof res.body.memoryCount).toBe("number");
    expect("latestBulkSummary" in res.body).toBe(true);
    expect("latestReflection" in res.body).toBe(true);
    expect(res.body.retrieved).toBeUndefined();
  });

  it("GET /rooms/default/npc-memory/missing returns 404", async () => {
    const res = await request(app).get("/rooms/default/npc-memory/missing");
    expect(res.status).toBe(404);
  });

  it("memory counts are isolated per X-Player-Id", async () => {
    const playerA = "player-alpha01";
    const playerB = "player-bravo001";

    await request(app).post("/rooms/default/reset").set("X-Player-Id", playerA);
    await request(app).post("/rooms/default/reset").set("X-Player-Id", playerB);

    const append = await request(app)
      .post("/internal/rooms/default/memories")
      .set("X-Player-Id", playerA)
      .send({ text: "hello from A", npcId: "npc-1", role: "player", playerId: playerA });
    expect(append.status).toBe(200);

    const stateA = await request(app).get("/rooms/default/state").set("X-Player-Id", playerA);
    const stateB = await request(app).get("/rooms/default/state").set("X-Player-Id", playerB);

    expect(stateA.body.memoryCounts["npc-1"]).toBe(1);
    expect(stateB.body.memoryCounts["npc-1"]).toBe(0);
  });

  it("POST /rooms/default/chat buffers thinking for SSE replay (NLUI-04)", async () => {
    const chat = await request(app)
      .post("/rooms/default/chat")
      .send({ message: "hi", npcId: "npc-1" });
    expect(chat.status).toBe(200);
    const jobId = chat.body.jobId as string;

    const events = peekBufferedJobEvents(jobId);
    expect(events.some((e) => e.type === "thinking")).toBe(true);
    expect(events.find((e) => e.type === "thinking")?.data).toEqual(
      expect.objectContaining({ status: "queued", npcId: "npc-1" }),
    );
  });

  it("POST internal emit done runs check-reply before SSE done (SAFE-02)", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ text: "sanitized reply" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const jobId = "job-check-reply-test";
      const emit = await request(app)
        .post(`/internal/jobs/${jobId}/emit`)
        .send({ type: "done", data: { reply: "raw reply" } });
      expect(emit.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledOnce();

      const done = peekBufferedJobEvents(jobId).find((e) => e.type === "done");
      expect(done?.data).toEqual(
        expect.objectContaining({ reply: "sanitized reply", text: "sanitized reply" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("GET /rooms/default/audit-log lists mutations after apply-actions (SAFE-03)", async () => {
    await request(app).post("/rooms/default/reset");
    const apply = await request(app)
      .post("/rooms/default/apply-actions")
      .send({
        actingNpcId: "npc-1",
        actions: [{ type: "move", x: 5, y: 5 }],
      });
    expect(apply.status).toBe(200);

    const res = await request(app).get("/rooms/default/audit-log?limit=10");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.entries.length).toBeGreaterThanOrEqual(1);
    expect(res.body.entries[0]).toEqual(
      expect.objectContaining({
        roomId: "default",
        npcId: "npc-1",
        actionType: "move",
        source: "executor",
      }),
    );
  });
});
