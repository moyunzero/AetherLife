/**
 * Silent idle relationship decay (D-DECAY-01…04, D-VERIFY-02).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyRelationshipDeltas,
  clearNpcRelationshipsMemory,
  getRelationshipEdge,
  insertRelationshipEdge,
} from "./npc-relationships-repository.js";
import {
  GAME_MONTH_MINUTES,
  clearRelationshipDecayState,
  computeIdleDecayDelta,
  maybeRunRelationshipDecay,
  softBoundsForBaseTag,
} from "./npc-relationship-decay.js";

const ROOM = "room-decay-28-04";

describe("npc-relationship-decay", () => {
  beforeEach(async () => {
    delete process.env.DATABASE_URL;
    clearNpcRelationshipsMemory();
    await clearRelationshipDecayState();
  });

  it("D-DECAY-01: idle decay applies deltas with no UI hint / biography / toast", async () => {
    await insertRelationshipEdge({
      roomId: ROOM,
      npcAId: "npc-1",
      npcBId: "npc-2",
      baseTag: "ally",
      affection: 55,
      trust: 80,
      historySummary: "seed",
    });

    const result = await maybeRunRelationshipDecay(ROOM, GAME_MONTH_MINUTES + 1);
    expect(result.decayed).toBeGreaterThanOrEqual(1);

    const edge = await getRelationshipEdge(ROOM, "npc-1", "npc-2");
    expect(edge!.historySummary).toBe("seed");
    expect(edge!.affection).toBeLessThan(55);
    expect(edge!.affection).toBeGreaterThanOrEqual(softBoundsForBaseTag("ally").floor);
    // Silent: no relationshipSync / biography side effects from this module.
    expect(result.broadcast).toBe(false);
    expect(result.biographyEnqueued).toBe(false);
  });

  it("D-DECAY-02/03: monthly tick drifts idle edges toward 0 with |Δ| 1–3 and base_tag soft floor/ceiling", async () => {
    await insertRelationshipEdge({
      roomId: ROOM,
      npcAId: "npc-3",
      npcBId: "npc-4",
      baseTag: "ally",
      affection: 55,
      trust: 70,
    });

    const before = await getRelationshipEdge(ROOM, "npc-3", "npc-4");
    await maybeRunRelationshipDecay(ROOM, GAME_MONTH_MINUTES + 5);
    const after = await getRelationshipEdge(ROOM, "npc-3", "npc-4");

    const absDelta = Math.abs(after!.affection - before!.affection);
    expect(absDelta).toBeGreaterThanOrEqual(1);
    expect(absDelta).toBeLessThanOrEqual(3);
    expect(after!.affection).toBeLessThan(before!.affection);
    expect(after!.affection).toBeGreaterThanOrEqual(softBoundsForBaseTag("ally").floor);

    // Pure step helper also respects soft bounds + step magnitude.
    const step = computeIdleDecayDelta(55, "ally", () => 0); // step size 1
    expect(Math.abs(step)).toBeGreaterThanOrEqual(1);
    expect(Math.abs(step)).toBeLessThanOrEqual(3);
  });

  it("positive affection already below band floor keeps drifting toward 0 (never snaps up)", () => {
    // ally floor=40; affection 30 must decay to 29, not jump to 40.
    expect(computeIdleDecayDelta(30, "ally", () => 0)).toBe(-1);
    // At/above floor the floor still holds: 41 with step 3 stops at 40.
    expect(computeIdleDecayDelta(41, "ally", () => 0.99)).toBe(-1);
  });

  it("D-DECAY-03: decay does not bump last_interact_at (only real interact sources do)", async () => {
    await insertRelationshipEdge({
      roomId: ROOM,
      npcAId: "npc-5",
      npcBId: "npc-6",
      baseTag: "rival",
      affection: -55,
      trust: 10,
    });
    // Real interact stamps last_interact_at + game-minute.
    await applyRelationshipDeltas({
      roomId: ROOM,
      absoluteGameMinute: 10,
      deltas: [{ npcAId: "npc-5", npcBId: "npc-6", affectionDelta: -1 }],
    });
    const afterInteract = await getRelationshipEdge(ROOM, "npc-5", "npc-6");
    const lastInteract = afterInteract!.lastInteractAt;
    const interactionCount = afterInteract!.interactionCount;
    expect(lastInteract).not.toBeNull();
    expect(interactionCount).toBe(1);

    // Idle after one game-month from that interact.
    await maybeRunRelationshipDecay(ROOM, 10 + GAME_MONTH_MINUTES + 1);
    const afterDecay = await getRelationshipEdge(ROOM, "npc-5", "npc-6");
    expect(afterDecay!.lastInteractAt).toBe(lastInteract);
    expect(afterDecay!.interactionCount).toBe(interactionCount);
    expect(afterDecay!.affection).toBeGreaterThan(afterInteract!.affection); // toward 0

    // Second monthly pass still finds the edge idle (no timestamp refresh).
    await maybeRunRelationshipDecay(ROOM, 10 + 2 * GAME_MONTH_MINUTES + 1);
    const afterSecond = await getRelationshipEdge(ROOM, "npc-5", "npc-6");
    expect(afterSecond!.lastInteractAt).toBe(lastInteract);
    expect(afterSecond!.interactionCount).toBe(interactionCount);
    expect(afterSecond!.affection).toBeGreaterThan(afterDecay!.affection);
  });

  it("D-DECAY-04: decay runs independent of council in-flight; council counts as recent activity", async () => {
    await insertRelationshipEdge({
      roomId: ROOM,
      npcAId: "npc-7",
      npcBId: "npc-8",
      baseTag: "peer",
      affection: 25,
      trust: 60,
    });
    await insertRelationshipEdge({
      roomId: ROOM,
      npcAId: "npc-9",
      npcBId: "npc-10",
      baseTag: "nemesis",
      affection: -55,
      trust: 5,
    });

    // Recent council delta on first edge — should skip decay.
    await applyRelationshipDeltas({
      roomId: ROOM,
      absoluteGameMinute: GAME_MONTH_MINUTES + 100,
      deltas: [{ npcAId: "npc-7", npcBId: "npc-8", affectionDelta: 2 }],
    });
    const recentBefore = await getRelationshipEdge(ROOM, "npc-7", "npc-8");

    // Idle second edge (never interacted since seed at 0).
    const idleBefore = await getRelationshipEdge(ROOM, "npc-9", "npc-10");

    const result = await maybeRunRelationshipDecay(
      ROOM,
      GAME_MONTH_MINUTES + 100,
      { councilInFlight: true },
    );
    expect(result.skippedForCouncil).toBe(false);

    const recentAfter = await getRelationshipEdge(ROOM, "npc-7", "npc-8");
    expect(recentAfter!.affection).toBe(recentBefore!.affection);

    const idleAfter = await getRelationshipEdge(ROOM, "npc-9", "npc-10");
    expect(idleAfter!.affection).toBeGreaterThan(idleBefore!.affection);
  });

  it("decay path source does not call applyDeltaToRow", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "npc-relationship-decay.ts"), "utf8");
    const repo = readFileSync(join(here, "npc-relationships-repository.ts"), "utf8");
    expect(src).not.toMatch(/applyDeltaToRow/);
    expect(src).toMatch(/applyIdleDecayDeltas/);
    expect(repo).toMatch(/applyIdleDecayDeltas/);
    // Idle path must not reuse the interact bump helper — bound the slice to the next export.
    const idleStart = repo.indexOf("export async function applyIdleDecayDeltas");
    const idleEnd = repo.indexOf("export function clearNpcRelationshipsMemory", idleStart);
    expect(idleStart).toBeGreaterThanOrEqual(0);
    expect(idleEnd).toBeGreaterThan(idleStart);
    const idleFn = repo.slice(idleStart, idleEnd);
    expect(idleFn).not.toMatch(/applyDeltaToRow\(/);
  });

  it("GameRoom sequences mutual-chat before ambient dyad enqueue", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const room = readFileSync(join(here, "../colyseus/GameRoom.ts"), "utf8");
    const tickStart = room.indexOf("private onAmbientTick");
    const tickEnd = room.indexOf("private runRelationshipDecayIfDue");
    const tick = room.slice(tickStart, tickEnd);
    expect(tick).toMatch(/enqueueNpcMutualChatIfDue\(\)[\s\S]*\.then\(/);
    expect(tick.indexOf("enqueueNpcMutualChatIfDue")).toBeLessThan(
      tick.indexOf("enqueuePersonalTimelineDyadAmbientIfDue"),
    );
  });

  it("GameRoom ambient tick wires maybeRunRelationshipDecay without LLM", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const room = readFileSync(join(here, "../colyseus/GameRoom.ts"), "utf8");
    expect(room).toMatch(/maybeRunRelationshipDecay/);
    expect(room).toMatch(/runRelationshipDecayIfDue/);
    // Decay call site must not gate on npcSpeakJobs (D-DECAY-04).
    const method = room.slice(room.indexOf("private runRelationshipDecayIfDue"));
    const body = method.slice(0, method.indexOf("private enqueueWorldVoteIfDue"));
    expect(body).not.toMatch(/npcSpeakJobs/);
  });

  it("restart hydrate: SQL last_interact_at prevents idle misclassify at abs=0", async () => {
    const {
      hydrateInteractAbsFromEdges,
      getLastInteractAbsMinute,
    } = await import("./npc-relationships-repository.js");

    const nowAbs = GAME_MONTH_MINUTES + 50;
    const hydrated = hydrateInteractAbsFromEdges(ROOM, nowAbs, [
      {
        npcAId: "npc-11",
        npcBId: "npc-12",
        lastInteractAt: new Date(),
      },
    ]);
    expect(hydrated).toBe(1);
    expect(getLastInteractAbsMinute(ROOM, "npc-11", "npc-12")).toBe(nowAbs);

    await insertRelationshipEdge({
      roomId: ROOM,
      npcAId: "npc-11",
      npcBId: "npc-12",
      baseTag: "ally",
      affection: 55,
      trust: 80,
    });

    await clearRelationshipDecayState();
    const result = await maybeRunRelationshipDecay(ROOM, nowAbs);
    // Hydrated as "just interacted" at nowAbs → not idle → no decay this month.
    expect(result.decayed).toBe(0);
  });
});
