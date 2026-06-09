export type ObjectState = "open" | "closed" | "idle";

export type PlayerState = {
  x: number;
  y: number;
};

export type NpcState = {
  id: string;
  name: string;
  x: number;
  y: number;
  status: string;
  inventory: string[];
  /** Ambient activity key (server-authoritative; optional until ambient tick writes). */
  activityKey?: string;
};

export type GameObject = {
  id: string;
  kind: string;
  x: number;
  y: number;
  state: ObjectState;
};

export type RoomState = {
  roomId: string;
  width: number;
  height: number;
  player: PlayerState;
  npcs: NpcState[];
  objects: GameObject[];
};

export function findNpc(room: RoomState, npcId: string): NpcState | undefined {
  return room.npcs.find((npc) => npc.id === npcId);
}

export function createDefaultRoom(roomId = "default"): RoomState {
  return {
    roomId,
    width: 8,
    height: 8,
    player: { x: 4, y: 4 },
    npcs: [
      {
        id: "npc-1",
        name: "路昂",
        x: 2,
        y: 2,
        status: "idle",
        inventory: ["key-1"],
      },
      {
        id: "npc-2",
        name: "费雪",
        x: 5,
        y: 2,
        status: "idle",
        inventory: ["key-2"],
      },
      {
        id: "npc-3",
        name: "南宫婉",
        x: 2,
        y: 5,
        status: "idle",
        inventory: ["note-1"],
      },
    ],
    objects: [],
  };
}
