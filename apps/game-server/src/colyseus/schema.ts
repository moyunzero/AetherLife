import { MapSchema, Schema, type } from "@colyseus/schema";
import { DEFAULT_BACKGROUND_NPC_SPAWNS, HOME_NPC_SPAWNS } from "@aetherlife/shared";

export class PlayerSchema extends Schema {
  @type("string") sessionId = "";
  @type("string") playerId = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") facing = "s";
}

export class GameRoomState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();

  @type("number") stateVersion = 0;

  @type("number") npc1X: number = HOME_NPC_SPAWNS["npc-1"].x;
  @type("number") npc1Y: number = HOME_NPC_SPAWNS["npc-1"].y;
  @type("number") npc2X: number = HOME_NPC_SPAWNS["npc-2"].x;
  @type("number") npc2Y: number = HOME_NPC_SPAWNS["npc-2"].y;
  @type("number") npc3X: number = HOME_NPC_SPAWNS["npc-3"].x;
  @type("number") npc3Y: number = HOME_NPC_SPAWNS["npc-3"].y;

  /** Game clock minute-of-day (0–1439); room starts at 6:00 = 360. */
  @type("number") gameMinute = 360;

  @type("string") npc1ActivityKey = "idle";
  @type("string") npc2ActivityKey = "idle";
  @type("string") npc3ActivityKey = "idle";

  @type("string") npc1IntentReasonZh = "";
  @type("string") npc2IntentReasonZh = "";
  @type("string") npc3IntentReasonZh = "";

  @type("boolean") npc1JoinVicinityActive = false;
  @type("boolean") npc2JoinVicinityActive = false;
  @type("boolean") npc3JoinVicinityActive = false;

  @type("number") npc1JoinVicinityUntil = 0;
  @type("number") npc2JoinVicinityUntil = 0;
  @type("number") npc3JoinVicinityUntil = 0;

  @type("number") npc1JoinVicinityStartedAt = 0;
  @type("number") npc2JoinVicinityStartedAt = 0;
  @type("number") npc3JoinVicinityStartedAt = 0;

  @type("boolean") bgNpc1Active = true;
  @type("number") bgNpc1X: number = DEFAULT_BACKGROUND_NPC_SPAWNS[0]!.lx;
  @type("number") bgNpc1Y: number = DEFAULT_BACKGROUND_NPC_SPAWNS[0]!.ly;
  @type("string") bgNpc1ActivityKey = "wandering";

  @type("boolean") bgNpc2Active = true;
  @type("number") bgNpc2X: number = DEFAULT_BACKGROUND_NPC_SPAWNS[1]!.lx;
  @type("number") bgNpc2Y: number = DEFAULT_BACKGROUND_NPC_SPAWNS[1]!.ly;
  @type("string") bgNpc2ActivityKey = "wandering";

  @type("boolean") bgNpc3Active = true;
  @type("number") bgNpc3X: number = DEFAULT_BACKGROUND_NPC_SPAWNS[2]!.lx;
  @type("number") bgNpc3Y: number = DEFAULT_BACKGROUND_NPC_SPAWNS[2]!.ly;
  @type("string") bgNpc3ActivityKey = "wandering";

  @type("boolean") bgNpc4Active = true;
  @type("number") bgNpc4X: number = DEFAULT_BACKGROUND_NPC_SPAWNS[3]!.lx;
  @type("number") bgNpc4Y: number = DEFAULT_BACKGROUND_NPC_SPAWNS[3]!.ly;
  @type("string") bgNpc4ActivityKey = "wandering";

  @type("boolean") doorOpen = false;
}
