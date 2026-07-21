/**
 * Phase 28 player-scoped GET npc-relationships (D-API-01…03, D-GRAPH-02 / C-09b).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  COLYSEUS_SERVER_MESSAGES,
  type ColyseusRelationshipSyncPayload,
} from "@aetherlife/shared";
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
import {
  broadcastRelationshipSync,
} from "../world/relationship-broadcast.js";
import * as relationshipBroadcast from "../world/relationship-broadcast.js";

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
      affection: 40,
      trust: 80,
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
      kindLabelZh: "同盟",
    });
    expect(Array.isArray(edge.currentStatus)).toBe(true);

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

  it("D-API-01: relationshipSync broadcast helper emits { hasUpdate } / seq hint only", () => {
    const sent: Array<{ type: string; payload: unknown }> = [];
    const fakeRoom = {
      clients: [
        {
          send(type: string, payload: unknown) {
            sent.push({ type, payload });
          },
        },
      ],
    };
    registerColyseusRoom(ROOM, fakeRoom as never);

    const payload: ColyseusRelationshipSyncPayload = {
      hasUpdate: true,
      latestSeq: 3,
    };
    broadcastRelationshipSync(ROOM, payload);

    expect(COLYSEUS_SERVER_MESSAGES.relationshipSync).toBe("relationshipSync");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe(COLYSEUS_SERVER_MESSAGES.relationshipSync);
    expect(sent[0]!.payload).toEqual({ hasUpdate: true, latestSeq: 3 });
    const hintJson = JSON.stringify(sent[0]!.payload);
    expect(hintJson).not.toMatch(/"edges"/);
    expect(hintJson).not.toMatch(/"affection"/);
    expect(hintJson).not.toMatch(/"trust"/);

    // No registered room — must not throw.
    broadcastRelationshipSync("missing-room-rel-sync", { hasUpdate: true });
  });

  it("apply-deltas success invokes broadcastRelationshipSync when edges change", async () => {
    const spy = vi
      .spyOn(relationshipBroadcast, "broadcastRelationshipSync")
      .mockImplementation(() => undefined);

    await insertRelationshipEdge({
      roomId: ROOM,
      npcAId: "npc-1",
      npcBId: "npc-2",
      baseTag: "ally",
      affection: 10,
      trust: 50,
    });

    const res = await request(app)
      .post(`/internal/rooms/${ROOM}/npc-relationships/apply-deltas`)
      .send({
        deltas: [
          {
            npcAId: "npc-1",
            npcBId: "npc-2",
            affectionDelta: 5,
          },
        ],
        voteEpoch: "vote-rel-sync-1",
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.linkedEdges.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledWith(ROOM, { hasUpdate: true });
    spy.mockRestore();
  });
});
