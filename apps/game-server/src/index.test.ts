import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./index.js";

describe("game-server", () => {
  const app = createApp();

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
});
