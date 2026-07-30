import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendCompletedTurn,
  clearDialogueForPlayer,
  clearDialogueSessions,
  dialogueRedisKey,
  getRecentTurns,
  getRecentTurnsAsync,
  resetDialogueRedisForTests,
  setDialogueRedisForTests,
} from "./dialogue-session.js";

type FakeRedis = {
  store: Map<string, string[]>;
  expires: Map<string, number>;
  rpush: ReturnType<typeof vi.fn>;
  ltrim: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  lrange: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
};

function createFakeRedis(): FakeRedis {
  const store = new Map<string, string[]>();
  const expires = new Map<string, number>();
  const redis: FakeRedis = {
    store,
    expires,
    on: vi.fn(),
    rpush: vi.fn(async (key: string, ...values: string[]) => {
      const list = store.get(key) ?? [];
      list.push(...values);
      store.set(key, list);
      return list.length;
    }),
    ltrim: vi.fn(async (key: string, start: number, stop: number) => {
      const list = store.get(key) ?? [];
      // ioredis LTRIM with negative indexes: keep last |start| when start=-N, stop=-1
      if (start < 0 && stop === -1) {
        const keep = Math.abs(start);
        store.set(key, list.slice(-keep));
      } else {
        store.set(key, list.slice(start, stop + 1));
      }
      return "OK";
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      expires.set(key, seconds);
      return 1;
    }),
    lrange: vi.fn(async (key: string, start: number, stop: number) => {
      const list = store.get(key) ?? [];
      if (start === 0 && stop === -1) return [...list];
      return list.slice(start, stop === -1 ? undefined : stop + 1);
    }),
    del: vi.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) {
        if (store.delete(k)) n += 1;
        expires.delete(k);
      }
      return n;
    }),
  };
  return redis;
}

describe("dialogue-session", () => {
  beforeEach(() => {
    clearDialogueSessions();
    resetDialogueRedisForTests();
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    clearDialogueSessions();
    resetDialogueRedisForTests();
    delete process.env.REDIS_URL;
  });

  it("returns empty then appends player/npc pair on completed turn", () => {
    expect(getRecentTurns("default", "p1", "npc-1")).toEqual([]);

    appendCompletedTurn({
      roomId: "default",
      playerId: "p1",
      npcId: "npc-1",
      playerMessage: "你喜欢我吗？",
      npcReply: "我没有那种喜欢。",
    });

    expect(getRecentTurns("default", "p1", "npc-1")).toEqual([
      { role: "player", text: "你喜欢我吗？" },
      { role: "npc", text: "我没有那种喜欢。" },
    ]);
  });

  it("scopes threads by player and npc", () => {
    appendCompletedTurn({
      roomId: "default",
      playerId: "p1",
      npcId: "npc-1",
      playerMessage: "a",
      npcReply: "b",
    });
    appendCompletedTurn({
      roomId: "default",
      playerId: "p2",
      npcId: "npc-1",
      playerMessage: "c",
      npcReply: "d",
    });

    expect(getRecentTurns("default", "p1", "npc-1")).toHaveLength(2);
    expect(getRecentTurns("default", "p2", "npc-1")[0]?.text).toBe("c");
  });

  it("getRecentTurns is sync Map-only (not a Promise)", () => {
    const result = getRecentTurns("default", "p1", "npc-1");
    expect(result).not.toBeInstanceOf(Promise);
    expect(Array.isArray(result)).toBe(true);
  });

  it("degrades to Map-only when REDIS_URL missing without throwing", async () => {
    delete process.env.REDIS_URL;
    resetDialogueRedisForTests();

    expect(() =>
      appendCompletedTurn({
        roomId: "default",
        playerId: "p1",
        npcId: "npc-1",
        playerMessage: "hi",
        npcReply: "hello",
      }),
    ).not.toThrow();

    await expect(getRecentTurnsAsync("default", "p1", "npc-1")).resolves.toEqual([
      { role: "player", text: "hi" },
      { role: "npc", text: "hello" },
    ]);
  });

  it("appendCompletedTurn mirrors to Redis with RPUSH/LTRIM/EXPIRE 7d", async () => {
    const fake = createFakeRedis();
    setDialogueRedisForTests(fake as unknown as import("ioredis").default);

    appendCompletedTurn({
      roomId: "room-a",
      playerId: "p1",
      npcId: "npc-2",
      playerMessage: "你好",
      npcReply: "你好呀",
    });

    const key = dialogueRedisKey("room-a", "p1", "npc-2");
    expect(key).toBe("aetherlife:dialogue:room-a:p1:npc-2");

    await vi.waitFor(() => {
      expect(fake.expire).toHaveBeenCalledWith(key, 7 * 24 * 60 * 60);
    });
    expect(fake.rpush).toHaveBeenCalledWith(
      key,
      JSON.stringify({ role: "player", text: "你好" }),
      JSON.stringify({ role: "npc", text: "你好呀" }),
    );
    expect(fake.ltrim).toHaveBeenCalledWith(key, -20, -1);
  });

  it("getRecentTurnsAsync rehydrates from Redis on Map miss", async () => {
    const fake = createFakeRedis();
    const key = dialogueRedisKey("room-b", "p9", "npc-3");
    fake.store.set(key, [
      JSON.stringify({ role: "player", text: "before restart" }),
      JSON.stringify({ role: "npc", text: "remembered" }),
    ]);
    setDialogueRedisForTests(fake as unknown as import("ioredis").default);

    // Map empty (post-restart) — sync path stays empty
    expect(getRecentTurns("room-b", "p9", "npc-3")).toEqual([]);

    const asyncTurns = await getRecentTurnsAsync("room-b", "p9", "npc-3");
    expect(asyncTurns).toEqual([
      { role: "player", text: "before restart" },
      { role: "npc", text: "remembered" },
    ]);
    // Rehydrated into Map for subsequent sync reads
    expect(getRecentTurns("room-b", "p9", "npc-3")).toEqual(asyncTurns);
    expect(fake.lrange).toHaveBeenCalledWith(key, 0, -1);
  });

  it("getRecentTurnsAsync Map hit skips Redis", async () => {
    const fake = createFakeRedis();
    setDialogueRedisForTests(fake as unknown as import("ioredis").default);

    appendCompletedTurn({
      roomId: "room-c",
      playerId: "p1",
      npcId: "npc-1",
      playerMessage: "cached",
      npcReply: "ok",
    });
    await vi.waitFor(() => expect(fake.rpush).toHaveBeenCalled());
    fake.lrange.mockClear();

    const turns = await getRecentTurnsAsync("room-c", "p1", "npc-1");
    expect(turns).toHaveLength(2);
    expect(fake.lrange).not.toHaveBeenCalled();
  });

  it("clearDialogueForPlayer removes Map and Redis for known keys", async () => {
    const fake = createFakeRedis();
    setDialogueRedisForTests(fake as unknown as import("ioredis").default);

    appendCompletedTurn({
      roomId: "default",
      playerId: "p1",
      npcId: "npc-1",
      playerMessage: "x",
      npcReply: "y",
    });
    appendCompletedTurn({
      roomId: "default",
      playerId: "p1",
      npcId: "npc-2",
      playerMessage: "u",
      npcReply: "v",
    });
    await vi.waitFor(() => expect(fake.rpush.mock.calls.length).toBeGreaterThanOrEqual(2));

    clearDialogueForPlayer("default", "p1");

    expect(getRecentTurns("default", "p1", "npc-1")).toEqual([]);
    expect(getRecentTurns("default", "p1", "npc-2")).toEqual([]);

    await vi.waitFor(() => {
      expect(fake.del).toHaveBeenCalled();
    });
    const deleted = fake.del.mock.calls.flat();
    expect(deleted).toContain(dialogueRedisKey("default", "p1", "npc-1"));
    expect(deleted).toContain(dialogueRedisKey("default", "p1", "npc-2"));
  });

  it("Redis errors are logged and never thrown to caller", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      on: vi.fn(),
      rpush: vi.fn().mockRejectedValue(new Error("redis down")),
      ltrim: vi.fn(),
      expire: vi.fn(),
      lrange: vi.fn().mockRejectedValue(new Error("redis down")),
      del: vi.fn().mockRejectedValue(new Error("redis down")),
    };
    setDialogueRedisForTests(broken as unknown as import("ioredis").default);

    expect(() =>
      appendCompletedTurn({
        roomId: "default",
        playerId: "p1",
        npcId: "npc-1",
        playerMessage: "a",
        npcReply: "b",
      }),
    ).not.toThrow();

    await expect(getRecentTurnsAsync("default", "p1", "npc-1")).resolves.toEqual([
      { role: "player", text: "a" },
      { role: "npc", text: "b" },
    ]);

    // Force Map miss for async rehydrate error path
    clearDialogueSessions();
    setDialogueRedisForTests(broken as unknown as import("ioredis").default);
    await expect(getRecentTurnsAsync("default", "p1", "npc-1")).resolves.toEqual([]);

    expect(() => clearDialogueForPlayer("default", "p1")).not.toThrow();
    errSpy.mockRestore();
  });
});
