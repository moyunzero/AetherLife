import { MapSchema, Schema, type } from "@colyseus/schema";

export class PlayerSchema extends Schema {
  @type("string") sessionId = "";
  @type("string") playerId = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") facing = "s";
}

export class NpcEntityState extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") activityKey = "idle";
  @type("string") intentReasonZh = "";
  @type("boolean") joinVicinityActive = false;
  @type("number") joinVicinityUntil = 0;
  @type("number") joinVicinityStartedAt = 0;
  @type("boolean") isThinking = false;
  @type("boolean") isSpeaking = false;
}

export class GameRoomState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type({ map: NpcEntityState }) npcs = new MapSchema<NpcEntityState>();

  @type("number") schemaVersion = 2;
  @type("number") stateVersion = 0;

  /** Game clock minute-of-day (0–1439); room starts at 6:00 = 360. */
  @type("number") gameMinute = 360;

  @type("boolean") doorOpen = false;
}
