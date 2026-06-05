import type { RoomState, StatePatchPayload } from "@aetherlife/shared";

/** Apply server patch delta onto a room snapshot (immutable). */
export function applyStatePatch(state: RoomState, delta: StatePatchPayload["delta"]): RoomState {
  const next: RoomState = {
    ...state,
    npcs: state.npcs.map((npc) => ({ ...npc })),
    objects: state.objects.map((obj) => ({ ...obj })),
    player: { ...state.player },
  };

  if (delta.npcs?.length) {
    for (const patchNpc of delta.npcs) {
      const npc = next.npcs.find((n) => n.id === patchNpc.id);
      if (npc) {
        npc.x = patchNpc.x;
        npc.y = patchNpc.y;
      }
    }
  }

  if (delta.doorOpen !== undefined) {
    const door = next.objects.find((o) => o.id === "door-1");
    if (door) {
      door.state = delta.doorOpen ? "open" : "closed";
    }
  }

  return next;
}
