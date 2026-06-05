import { MapSchema, Schema, type } from "@colyseus/schema";

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

  @type("number") npc1X = 2;
  @type("number") npc1Y = 2;
  @type("number") npc2X = 5;
  @type("number") npc2Y = 2;
  @type("number") npc3X = 2;
  @type("number") npc3Y = 5;

  @type("boolean") doorOpen = false;
}
