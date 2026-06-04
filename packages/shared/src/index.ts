export const PACKAGE_SCOPE = "@aetherlife" as const;

export const DEFAULT_PORTS = {
  web: 5173,
  gameServer: 2567,
  aiGateway: 8000,
} as const;

export {
  createDefaultRoom,
  findNpc,
  type GameObject,
  type NpcState,
  type ObjectState,
  type PlayerState,
  type RoomState,
} from "./room.js";
