import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../index.js";
import {
  clearColyseusRoomRegistry,
  registerColyseusRoom,
} from "../colyseus/room-registry.js";
import { GameRoomState, PlayerSchema } from "../colyseus/schema.js";
import { clearAllRooms } from "../room/store.js";
import { clearPersonalTimelineMemory } from "../world/personal-timeline-repository.js";
import * as personalTimelineBroadcast from "../world/personal-timeline-broadcast.js";
import { createPersonalTimelineRouter } from "./personal-timeline.js";

const ROOM = "room-pt-http";
const NPC_A = "npc-1";
const NPC_B = "npc-2";
const PLAYER = "player-alpha01";

function writeBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    npcId: NPC_A,
    calendarLabel: "太乙元年·春·1月·第1日",
    aetherEpochMinute: 0,
    tag: "daily",
    body: "今日我在田埂边走过。",
    source: "seed",
    ...overrides,
  };
}

describe("personal-timeline HTTP (C-11 / BIO-01)", () => {
  const app = createApp();

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.INTERNAL_WORKER_TOKEN;
    clearAllRooms();
    clearColyseusRoomRegistry();
    clearPersonalTimelineMemory();
  });

  it("GET personal-timeline returns 403 when X-Player-Id is not connected to live room", async () => {
    const state = new GameRoomState();
    const player = new PlayerSchema();
    player.playerId = PLAYER;
    state.players.set("sess-a", player);
    registerColyseusRoom(ROOM, { state } as never);

    const res = await request(app)
      .get(`/rooms/${ROOM}/npcs/${NPC_A}/personal-timeline`)
      .set("X-Player-Id", "player-bravo001");

    expect(res.status).not.toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/not connected/);
  });

  it("GET personal-timeline returns ok:true + bodies for scoped npc only", async () => {
    const markerA = "我记得初到此间的晨雾·隔离标记A。";
    const markerB = "另一席的独白不应混入列表·隔离标记B。";

    const insertA = await request(app)
      .post(`/internal/rooms/${ROOM}/personal-timeline`)
      .send(writeBody({ body: markerA, tag: "reflection" }));
    expect(insertA.status).toBe(200);

    const insertB = await request(app)
      .post(`/internal/rooms/${ROOM}/personal-timeline`)
      .send(
        writeBody({
          npcId: NPC_B,
          body: markerB,
          tag: "reflection",
        }),
      );
    expect(insertB.status).toBe(200);

    const res = await request(app)
      .get(`/rooms/${ROOM}/npcs/${NPC_A}/personal-timeline`)
      .set("X-Player-Id", PLAYER);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBeGreaterThan(0);
    expect(res.body.entries.every((e: { npcId: string }) => e.npcId === NPC_A)).toBe(
      true,
    );
    expect(res.body.entries.some((e: { body: string }) => e.body === markerA)).toBe(
      true,
    );
    expect(res.body.entries.some((e: { body: string }) => e.body === markerB)).toBe(
      false,
    );
    expect(
      res.body.entries.every(
        (e: { body: unknown }) => typeof e.body === "string" && e.body.length > 0,
      ),
    ).toBe(true);
  });

  it("public personal-timeline router has no write methods; POST public path returns 404", async () => {
    const router = createPersonalTimelineRouter();
    const stack = (router as unknown as { stack: Array<{ route?: { methods?: Record<string, boolean>; path?: string } }> })
      .stack;
    const writeMethods = stack
      .filter((layer) => layer.route)
      .flatMap((layer) =>
        Object.entries(layer.route!.methods ?? {})
          .filter(([, enabled]) => enabled)
          .map(([method]) => method.toUpperCase()),
      );
    expect(writeMethods.every((m) => m === "GET" || m === "HEAD")).toBe(true);
    expect(writeMethods).toContain("GET");

    const res = await request(app)
      .post(`/rooms/${ROOM}/npcs/${NPC_A}/personal-timeline`)
      .set("X-Player-Id", PLAYER)
      .send(writeBody());

    expect(res.status).toBe(404);
  });

  it("POST internal personal-timeline returns 401 without Bearer when token configured", async () => {
    const prevNode = process.env.NODE_ENV;
    const prevToken = process.env.INTERNAL_WORKER_TOKEN;
    process.env.NODE_ENV = "production";
    process.env.INTERNAL_WORKER_TOKEN = "secret-token-pt-01";
    try {
      const res = await request(app)
        .post(`/internal/rooms/${ROOM}/personal-timeline`)
        .send(writeBody({ body: "未授权写入尝试。" }));

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevToken !== undefined) process.env.INTERNAL_WORKER_TOKEN = prevToken;
      else delete process.env.INTERNAL_WORKER_TOKEN;
    }
  });

  it("POST internal personal-timeline rejects invalid Zod body with 400", async () => {
    const res = await request(app)
      .post(`/internal/rooms/${ROOM}/personal-timeline`)
      .send({
        npcId: NPC_A,
        calendarLabel: "太乙元年·春·1月·第1日",
        aetherEpochMinute: 0,
        tag: "not-a-real-tag",
        body: "缺合法 tag。",
        source: "seed",
      });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("POST internal personal-timeline inserts and returns entry (memory path)", async () => {
    const spy = vi
      .spyOn(personalTimelineBroadcast, "broadcastPersonalTimelineSync")
      .mockImplementation(() => undefined);

    try {
      const res = await request(app)
        .post(`/internal/rooms/${ROOM}/personal-timeline`)
        .send(
          writeBody({
            tag: "reflection",
            body: "我回想今日的耕作。",
            source: "llm_reflection",
          }),
        );

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.entry).toEqual(
        expect.objectContaining({
          roomId: ROOM,
          npcId: NPC_A,
          tag: "reflection",
          body: "我回想今日的耕作。",
          source: "llm_reflection",
          seq: 1,
        }),
      );
      expect(typeof res.body.entry.id).toBe("string");
      expect(res.body.entry.id.length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("PATCH internal personal-timeline replaces body (D-SEED-04) or 404 when missing", async () => {
    const spy = vi
      .spyOn(personalTimelineBroadcast, "broadcastPersonalTimelineSync")
      .mockImplementation(() => undefined);

    try {
      const created = await request(app)
        .post(`/internal/rooms/${ROOM}/personal-timeline`)
        .send(writeBody({ body: "骨架：幼年往事。" }));
      expect(created.status).toBe(200);
      const entryId = created.body.entry.id as string;

      const patched = await request(app)
        .patch(`/internal/rooms/${ROOM}/personal-timeline/${entryId}`)
        .send({ body: "润色后的第一人称幼年往事，语气更像本人。" });

      expect(patched.status).toBe(200);
      expect(patched.body.ok).toBe(true);
      expect(patched.body.entry.id).toBe(entryId);
      expect(patched.body.entry.seq).toBe(created.body.entry.seq);
      expect(patched.body.entry.body).toContain("润色后");

      const listed = await request(app)
        .get(`/rooms/${ROOM}/npcs/${NPC_A}/personal-timeline`)
        .set("X-Player-Id", PLAYER);
      expect(listed.status).toBe(200);
      expect(listed.body.entries[0].body).toContain("润色后");

      const missing = await request(app)
        .patch(`/internal/rooms/${ROOM}/personal-timeline/missing-entry-id-xyz`)
        .send({ body: "不应找到此条。" });
      expect(missing.status).toBe(404);
      expect(missing.body.ok).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
