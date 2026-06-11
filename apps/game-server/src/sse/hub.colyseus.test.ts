import { beforeEach, describe, expect, it, vi } from "vitest";
import { COLYSEUS_SERVER_MESSAGES } from "@aetherlife/shared";
import { clearJobRegistry, registerJob } from "../colyseus/job-registry.js";
import { GameRoomState } from "../colyseus/schema.js";
import {
  clearDialogueSessions,
  getRecentTurns,
} from "../npc/dialogue-session.js";
import { clearJobSubscribers, emitJobEvent } from "./hub.js";

describe("hub colyseus routing", () => {
  beforeEach(() => {
    clearJobSubscribers();
    clearJobRegistry();
    clearDialogueSessions();
  });

  it("sends speakPartial only to initiator", () => {
    const sends = new Map<string, unknown[]>();
    const mockRoom = {
      broadcast: vi.fn(),
      clients: [
        {
          sessionId: "a",
          send: vi.fn((t: string, p: unknown) => {
            const list = sends.get("a") ?? [];
            list.push({ type: t, payload: p });
            sends.set("a", list);
          }),
        },
        { sessionId: "b", send: vi.fn() },
      ],
      state: new GameRoomState(),
    };

    registerJob("job-partial", mockRoom as never, "default", "a");
    emitJobEvent("job-partial", "speakPartial", { text: "你好呀", npcId: "npc-1" });

    const aSends = sends.get("a") ?? [];
    expect(
      aSends.some(
        (s) =>
          (s as { type: string }).type === COLYSEUS_SERVER_MESSAGES.speakPartial &&
          (s as { payload: { text?: string } }).payload?.text === "你好呀",
      ),
    ).toBe(true);
  });

  it("sends thinking only to initiator", () => {
    const broadcasts: { type: string; payload: unknown }[] = [];
    const sends = new Map<string, unknown[]>();
    const mockRoom = {
      broadcast: (type: string, payload: unknown) => {
        broadcasts.push({ type, payload });
      },
      clients: [
        { sessionId: "a", send: vi.fn((t: string, p: unknown) => {
          const list = sends.get("a") ?? [];
          list.push({ type: t, payload: p });
          sends.set("a", list);
        }) },
        { sessionId: "b", send: vi.fn() },
      ],
      state: new GameRoomState(),
    };

    registerJob("job-1", mockRoom as never, "default", "a");
    emitJobEvent("job-1", "thinking", { npcId: "npc-1" });

    expect(broadcasts.some((b) => b.type === COLYSEUS_SERVER_MESSAGES.thinking)).toBe(false);
    expect(sends.get("a")?.some((s) => (s as { type: string }).type === COLYSEUS_SERVER_MESSAGES.thinking)).toBe(true);
  });

  it("sends done only to initiator and patch to room", () => {
    const broadcasts: { type: string; payload: unknown }[] = [];
    const initiatorSends: { type: string; payload: unknown }[] = [];
    const state = new GameRoomState();
    const mockRoom = {
      broadcast: (type: string, payload: unknown) => {
        broadcasts.push({ type, payload });
      },
      clients: [
        {
          sessionId: "init",
          send: vi.fn((t: string, p: unknown) => {
            initiatorSends.push({ type: t, payload: p });
          }),
        },
        { sessionId: "peer", send: vi.fn() },
      ],
      state,
    };

    registerJob("job-2", mockRoom as never, "default", "init");
    const snapshot = {
      width: 8,
      height: 8,
      player: { x: 4, y: 4 },
      npcs: [
        { id: "npc-1", name: "A", x: 2, y: 2 },
        { id: "npc-2", name: "B", x: 5, y: 2 },
        { id: "npc-3", name: "C", x: 2, y: 5 },
      ],
      objects: [{ id: "door-1", kind: "door", x: 4, y: 3, state: "closed" }],
    };

    emitJobEvent("job-2", "done", {
      reply: "secret reply",
      npcId: "npc-1",
      state: snapshot,
    });

    expect(initiatorSends.some((s) => s.type === COLYSEUS_SERVER_MESSAGES.done)).toBe(true);
    expect(broadcasts.some((b) => b.type === COLYSEUS_SERVER_MESSAGES.patch)).toBe(true);
    expect(state.stateVersion).toBeGreaterThan(0);
  });

  it("records completed turn in dialogue session on done", () => {
    const mockRoom = {
      broadcast: vi.fn(),
      clients: [{ sessionId: "init", send: vi.fn() }],
      state: new GameRoomState(),
    };

    registerJob("job-3", mockRoom as never, "default", "init", {
      npcId: "npc-1",
      playerId: "player-a",
      playerMessage: "你好",
    });

    emitJobEvent("job-3", "done", {
      reply: "你好呀",
      npcId: "npc-1",
      state: { width: 8, height: 8, player: { x: 0, y: 0 }, npcs: [], objects: [] },
    });

    expect(getRecentTurns("default", "player-a", "npc-1")).toEqual([
      { role: "player", text: "你好" },
      { role: "npc", text: "你好呀" },
    ]);
  });
});
