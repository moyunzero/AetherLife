/**
 * Phase 28 mutual-chat presentation + linkedEdges hint broadcast (D-MUTUAL-02/04).
 */
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  COLYSEUS_SERVER_MESSAGES,
  findNpc,
} from "@aetherlife/shared";
import { createApp } from "../index.js";
import {
  clearColyseusRoomRegistry,
  registerColyseusRoom,
} from "../colyseus/room-registry.js";
import { GameRoomState } from "../colyseus/schema.js";
import { clearAllRooms, getOrCreate } from "../room/store.js";
import {
  broadcastLinkedEdgesHint,
  broadcastMutualChatBubble,
  clampMutualBubbleText,
  presentNpcMutualChat,
} from "../world/relationship-broadcast.js";

const ROOM = "room-mutual-chat";

describe("relationship-broadcast mutual chat", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.INTERNAL_WORKER_TOKEN;
    clearAllRooms();
    clearColyseusRoomRegistry();
  });

  it("clampMutualBubbleText truncates to ≤20 and strips control chars", () => {
    expect(clampMutualBubbleText("短")).toBe("短");
    expect(clampMutualBubbleText("一二三四五六七八九十一二三四五六七八九十超")).toHaveLength(20);
    expect(clampMutualBubbleText("a\nb\tc")).toBe("abc");
  });

  it("broadcastMutualChatBubble sends ≤20 text and never puts edges on relationshipSync", () => {
    const sends: Array<{ type: string; payload: unknown }> = [];
    const room = {
      clients: [
        {
          send: (type: string, payload: unknown) => {
            sends.push({ type, payload });
          },
        },
      ],
      state: new GameRoomState(),
    };
    registerColyseusRoom(ROOM, room as never);

    broadcastMutualChatBubble(ROOM, {
      npcId: "npc-1",
      peerNpcId: "npc-2",
      text: "今日庭中风软正好叙话超过二十",
      expiresAt: Date.now() + 4000,
    });

    expect(sends).toHaveLength(1);
    expect(sends[0]!.type).toBe(COLYSEUS_SERVER_MESSAGES.mutualChatBubble);
    const bubble = sends[0]!.payload as { text: string };
    expect(bubble.text.length).toBeLessThanOrEqual(20);

    broadcastLinkedEdgesHint(ROOM, {
      linkedEdges: [{ npcAId: "npc-2", npcBId: "npc-1" }],
    });
    const hint = sends.find((s) => s.type === COLYSEUS_SERVER_MESSAGES.relationshipLinkedHint);
    expect(hint).toBeTruthy();
    expect(hint!.payload).toEqual({
      linkedEdges: [{ npcAId: "npc-1", npcBId: "npc-2" }],
    });
    expect(
      sends.some((s) => s.type === COLYSEUS_SERVER_MESSAGES.relationshipSync),
    ).toBe(false);
  });

  it("presentNpcMutualChat sets dual intentReasonZh and broadcasts bubble", () => {
    getOrCreate(ROOM);
    const sends: Array<{ type: string; payload: unknown }> = [];
    const room = {
      clients: [
        {
          send: (type: string, payload: unknown) => {
            sends.push({ type, payload });
          },
        },
      ],
      state: new GameRoomState(),
    };
    registerColyseusRoom(ROOM, room as never);

    const bubble = presentNpcMutualChat(ROOM, {
      npcAId: "npc-1",
      npcBId: "npc-2",
      npcAReasonZh: "与沈清晏交谈中",
      npcBReasonZh: "与莫玄虚交谈中",
      bubbleText: "今日风清",
    });

    expect(bubble?.text).toBe("今日风清");
    const { state: map } = getOrCreate(ROOM);
    expect(findNpc(map, "npc-1")?.intentReasonZh).toContain("交谈中");
    expect(findNpc(map, "npc-2")?.intentReasonZh).toContain("交谈中");
    expect(sends.some((s) => s.type === COLYSEUS_SERVER_MESSAGES.mutualChatBubble)).toBe(
      true,
    );
  });
});

describe("internal npc-mutual-chat routes", () => {
  const app = createApp();

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.INTERNAL_WORKER_TOKEN;
    clearAllRooms();
    clearColyseusRoomRegistry();
  });

  it("POST present requires worker auth when token configured", async () => {
    process.env.INTERNAL_WORKER_TOKEN = "secret-tok";
    const res = await request(app)
      .post(`/internal/rooms/${ROOM}/npc-mutual-chat/present`)
      .send({
        npcAId: "npc-1",
        npcBId: "npc-2",
        npcAReasonZh: "与乙交谈中",
        npcBReasonZh: "与甲交谈中",
        bubbleText: "你好",
      });
    expect(res.status).toBe(401);
  });

  it("POST present + linked-edges-hint succeed with auth", async () => {
    getOrCreate(ROOM);
    const sends: Array<{ type: string; payload: unknown }> = [];
    registerColyseusRoom(ROOM, {
      clients: [
        {
          send: (type: string, payload: unknown) => {
            sends.push({ type, payload });
          },
        },
      ],
      state: new GameRoomState(),
    } as never);

    const present = await request(app)
      .post(`/internal/rooms/${ROOM}/npc-mutual-chat/present`)
      .send({
        npcAId: "npc-1",
        npcBId: "npc-2",
        npcAReasonZh: "与乙交谈中",
        npcBReasonZh: "与甲交谈中",
        bubbleText: "今日庭中风软正好叙话超过二十字",
      });
    expect(present.status).toBe(200);
    expect(present.body.ok).toBe(true);
    expect(present.body.bubble.text.length).toBeLessThanOrEqual(20);
    expect(
      sends.some((s) => s.type === COLYSEUS_SERVER_MESSAGES.relationshipSync),
    ).toBe(true);

    const hint = await request(app)
      .post(`/internal/rooms/${ROOM}/npc-mutual-chat/linked-edges-hint`)
      .send({ linkedEdges: [{ npcAId: "npc-1", npcBId: "npc-2" }] });
    expect(hint.status).toBe(200);
    expect(
      sends.some((s) => s.type === COLYSEUS_SERVER_MESSAGES.relationshipLinkedHint),
    ).toBe(true);
  });
});
