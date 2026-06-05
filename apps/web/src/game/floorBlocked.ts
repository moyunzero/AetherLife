import type { RoomState } from "@aetherlife/shared";

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Static floor blockers (NPC cells + closed doors) — not other players. */
export function isStaticFloorBlocked(
  map: RoomState | undefined,
  x: number,
  y: number,
): boolean {
  if (!map) return false;
  const key = cellKey(x, y);
  for (const npc of map.npcs) {
    if (cellKey(npc.x, npc.y) === key) return true;
  }
  for (const obj of map.objects) {
    if (obj.kind === "door" && obj.state === "closed" && cellKey(obj.x, obj.y) === key) {
      return true;
    }
  }
  return false;
}
