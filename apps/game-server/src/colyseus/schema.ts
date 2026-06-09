import { MapSchema, Schema, type } from "@colyseus/schema";
import { HOME_NPC_SPAWNS } from "@aetherlife/shared";

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

  @type("boolean") doorOpen = false;
}
