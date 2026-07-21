/**
 * Phase 28 player-scoped GET npc-relationships (D-API-01…03, D-GRAPH-02 / C-09b).
 */
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../index.js";
import {
  clearColyseusRoomRegistry,
  registerColyseusRoom,
} from "../colyseus/room-registry.js";
import { GameRoomState, PlayerSchema } from "../colyseus/schema.js";
import { clearAllRooms } from "../room/store.js";
import {
  clearNpcRelationshipsMemory,
  insertRelationshipEdge,
} from "../world/npc-relationships-repository.js";

const ROOM = "room-rel-http";
const PLAYER = "player-alpha01";

describe("npc-relationships routes (C-09b)", () => {
  const app = createApp();

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.INTERNAL_WORKER_TOKEN;
    clearAllRooms();
    clearColyseusRoomRegistry();
    clearNpcRelationshipsMemory();
  });

  it("D-API-01/03: GET /rooms/:roomId/npc-relationships requires joined-room / session scope", async () => {
    const state = new GameRoomState();
    const player = new PlayerSchema();
    player.playerId = PLAYER;
    state.players.set("sess-a", player);
    registerColyseusRoom(ROOM, { state } as never);

    const res = await request(app)
      .get(`/rooms/${ROOM}/npc-relationships`)
      .set("X-Player-Id", "player-bravo001");

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/not connected/);
  });

  it("D-GRAPH-02 / D-API-01: response maps edges to band labels — no raw affection/trust integers", async () => {
    const state = new GameRoomState();
    const player = new PlayerSchema();
    player.playerId = PLAYER;
    state.players.set("sess-rel-list", player);
    registerColyseusRoom(ROOM, { state } as never);

    await insertRelationshipEdge({
      roomId: ROOM,
      npcAId: "npc-1",
      npcBId: "npc-2",
      baseTag: "ally",
      affection: 50,
      trust: 80,
      currentStatus: ["bonded"],
    });

    const res = await request(app)
      .get(`/rooms/${ROOM}/npc-relationships`)
      .set("X-Player-Id", PLAYER);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.edges)).toBe(true);
    expect(res.body.edges.length).toBeGreaterThan(0);

    const edge = res.body.edges[0] as Record<string, unknown>;
    expect(edge).toMatchObject({
      npcAId: "npc-1",
      npcBId: "npc-2",
      baseTag: "ally",
      band: "warm",
      bandLabelZh: "亲近",
    });
    expect(typeof edge.kindLabelZh).toBe("string");
    expect(edge.kindLabelZh).toBeTruthy();
    expect(edge.currentStatus).toEqual(["bonded"]);

    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/"affection"/);
    expect(json).not.toMatch(/"trust"/);
    expect(edge).not.toHaveProperty("affection");
    expect(edge).not.toHaveProperty("trust");
  });

  it("worker internal list still returns full edges with affection/trust", async () => {
    await insertRelationshipEdge({
      roomId: ROOM,
      npcAId: "npc-3",
      npcBId: "npc-4",
      baseTag: "rival",
      affection: -50,
      trust: 20,
    });

    const res = await request(app).get(`/internal/rooms/${ROOM}/npc-relationships`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.edges[0]).toMatchObject({
      affection: -50,
      trust: 20,
    });
  });

  it.skip("D-API-01: relationshipSync broadcast helper emits { hasUpdate } / seq hint only", () => {
    // Filled in plan 07 Task 2
  });
});
