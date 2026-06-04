import { describe, expect, it, beforeEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "./index.js";
import { clearAllRooms } from "./room/store.js";
import { MemoryService } from "./memory/service.js";
import { clearMockJobs, getMockJob } from "./queue/npc-turn.js";
import { clearJobSubscribers, peekBufferedJobEvents } from "./sse/hub.js";

describe("game-server", () => {
  const app = createApp();

  beforeEach(() => {
    clearAllRooms();
    clearMockJobs();
    clearJobSubscribers();
    MemoryService.resetForTests();
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
    expect(after.body.memoryCounts["npc-1"]).toBe(before.body.memoryCounts["npc-1"] + 1);
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
        actions: [{ type: "move", x: 4, y: 4 }],
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
