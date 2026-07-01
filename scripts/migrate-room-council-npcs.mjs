#!/usr/bin/env node
/**
 * Offline fixture check for legacy → 12-council migration (C-08).
 * Runtime path: getOrCreate / setState auto-call migrateRoomCouncilNpcs.
 *
 * Usage: pnpm --filter @aetherlife/shared build && node scripts/migrate-room-council-npcs.mjs
 */
import { migrateRoomCouncilNpcs } from "../packages/shared/dist/index.js";

const legacyFixture = {
  roomId: "legacy-three-seat",
  width: 40,
  height: 40,
  player: { x: 34, y: 13 },
  npcs: [
    { id: "npc-1", name: "莫玄虚", x: 23, y: 10, status: "idle", inventory: ["key-1"] },
    { id: "npc-2", name: "阿斯托利亚", x: 9, y: 21, status: "idle", inventory: ["key-2"] },
    { id: "npc-3", name: "洛璃", x: 28, y: 27, status: "idle", inventory: ["note-1"] },
    {
      id: "bg-villager-1",
      name: "老张",
      x: 33,
      y: 11,
      status: "idle",
      inventory: [],
      isBackgroundNpc: true,
    },
  ],
  objects: [],
};

const result = migrateRoomCouncilNpcs(legacyFixture);
if (!result.changed || result.state.npcs.length !== 12) {
  console.error("migrate-room-council-npcs: FAIL", result);
  process.exit(1);
}
if (result.state.npcs.some((n) => n.id.startsWith("bg-villager"))) {
  console.error("migrate-room-council-npcs: bg-villager not stripped");
  process.exit(1);
}
const npc1 = result.state.npcs.find((n) => n.id === "npc-1");
if (npc1?.x !== 23 || npc1?.y !== 10) {
  console.error("migrate-room-council-npcs: preserved npc-1 coords missing");
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    roomId: result.state.roomId,
    npcCount: result.state.npcs.length,
    reason: result.reason,
  }),
);
