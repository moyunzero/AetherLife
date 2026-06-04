import { describe, expect, it } from "vitest";
import { createDefaultRoom, findNpc } from "@aetherlife/shared";
import { applyGameAction, ExecutorError } from "./executor.js";

describe("applyGameAction", () => {
  it("move changes acting npc position only", () => {
    const room = createDefaultRoom();
    const { room: next } = applyGameAction(room, { type: "move", x: 5, y: 5 }, "npc-1");
    expect(findNpc(next, "npc-1")?.x).toBe(5);
    expect(findNpc(next, "npc-1")?.y).toBe(5);
    expect(findNpc(next, "npc-2")?.x).toBe(5);
    expect(findNpc(next, "npc-2")?.y).toBe(2);
  });

  it("interact toggles door for acting npc context", () => {
    const room = createDefaultRoom();
    const { room: next } = applyGameAction(room, { type: "interact", objectId: "door-1" }, "npc-1");
    expect(next.objects[0]?.state).toBe("open");
  });

  it("transfer moves key-1 from npc-1 to npc-2", () => {
    const room = createDefaultRoom();
    const { room: next } = applyGameAction(
      room,
      { type: "transfer", itemId: "key-1", toNpcId: "npc-2" },
      "npc-1",
    );
    expect(findNpc(next, "npc-1")?.inventory).not.toContain("key-1");
    expect(findNpc(next, "npc-2")?.inventory).toContain("key-1");
  });

  it("transfer rejects missing item", () => {
    const room = createDefaultRoom();
    expect(() =>
      applyGameAction(
        room,
        { type: "transfer", itemId: "missing", toNpcId: "npc-2" },
        "npc-1",
      ),
    ).toThrow(ExecutorError);
  });

  it("transfer rejects unknown target npc", () => {
    const room = createDefaultRoom();
    expect(() =>
      applyGameAction(
        room,
        { type: "transfer", itemId: "key-1", toNpcId: "npc-9" },
        "npc-1",
      ),
    ).toThrow(/unknown target npc/);
  });

  it("transfer rejects self target", () => {
    const room = createDefaultRoom();
    expect(() =>
      applyGameAction(
        room,
        { type: "transfer", itemId: "key-1", toNpcId: "npc-1" },
        "npc-1",
      ),
    ).toThrow(/cannot transfer item to self/);
  });

  it("rejects out of bounds move", () => {
    const room = createDefaultRoom();
    expect(() => applyGameAction(room, { type: "move", x: 99, y: 0 }, "npc-1")).toThrow(
      ExecutorError,
    );
  });

  it("rejects unknown acting npc", () => {
    const room = createDefaultRoom();
    expect(() => applyGameAction(room, { type: "move", x: 1, y: 1 }, "npc-9")).toThrow(
      ExecutorError,
    );
  });
});
