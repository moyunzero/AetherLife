import { Room, type Client } from "colyseus";
import {
  COLYSEUS_CLIENT_MESSAGES,
  COLYSEUS_MAX_CLIENTS,
  COLYSEUS_ORPHAN_SHARD_WS_CODE,
  COLYSEUS_ROOM_FULL_CODE,
  COLYSEUS_ROOM_FULL_WS_CODE,
  COLYSEUS_SERVER_MESSAGES,
  normalizePlayerId,
  type ColyseusMovePayload,
  type ColyseusSpeakPayload,
  type Facing,
} from "@aetherlife/shared";
import { getOrCreate } from "../room/store.js";
import { emitJobEvent } from "../sse/hub.js";
import { syncColyseusFromMap, syncMapPlayerPosition } from "./bridge.js";
import { registerJob } from "./job-registry.js";
import { applyPlayerMove, applyPlayerMoveTo, buildMoveGrid, findNearestWalkableCell } from "./move-handler.js";
import {
  getContentBlockedResponse,
  startNpcChatTurn,
  validateChatMessage,
  validateChatNpcId,
} from "./npc-chat.js";
import {
  getColyseusRoom,
  tryClaimMapRoom,
  unregisterColyseusRoom,
} from "./room-registry.js";
import { GameRoomState, PlayerSchema } from "./schema.js";
import { bumpStateVersion } from "./version.js";

const TICK_MS = 1000 / 20;

type JoinOptions = { mapRoomId?: string; playerId?: string };

export class GameRoom extends Room {
  /** Logical map room id (join option `roomId`; not Colyseus `this.roomId`). */
  mapRoomId = "default";
  private mapWidth = 8;
  private mapHeight = 8;
  /** npcId → jobId (or pending token before job is created) */
  private npcSpeakJobs = new Map<string, string>();
  private lastAckedSeq = new Map<string, number>();
  /** Set when matchmaker spawned a duplicate shard for the same mapRoomId. */
  private orphanShard = false;

  private get gameState(): GameRoomState {
    return this.state as GameRoomState;
  }

  onCreate(options: JoinOptions) {
    this.mapRoomId = options.mapRoomId ?? "default";
    this.maxClients = COLYSEUS_MAX_CLIENTS;
    this.setState(new GameRoomState());

    const { state: mapState } = getOrCreate(this.mapRoomId);
    this.mapWidth = mapState.width;
    this.mapHeight = mapState.height;
    syncColyseusFromMap(this.gameState, mapState);

    if (!tryClaimMapRoom(this.mapRoomId, this)) {
      this.orphanShard = true;
      this.setMatchmaking({ unlisted: true });
      this.autoDispose = true;
    } else {
      this.setMetadata({ mapRoomId: this.mapRoomId, clientCount: 0 });
    }
    this.setSimulationInterval(() => {}, TICK_MS);

    this.onMessage(COLYSEUS_CLIENT_MESSAGES.move, (client, raw: ColyseusMovePayload) => {
      const { state: mapState } = getOrCreate(this.mapRoomId);
      const grid = buildMoveGrid(mapState, this.gameState, client.sessionId);
      let result;
      if (
        raw &&
        typeof raw === "object" &&
        "targetX" in raw &&
        "targetY" in raw &&
        typeof raw.targetX === "number" &&
        typeof raw.targetY === "number"
      ) {
        result = applyPlayerMoveTo(
          this.gameState,
          client.sessionId,
          raw.targetX,
          raw.targetY,
          grid,
        );
      } else {
        const dx = (raw as { dx?: number })?.dx ?? 0;
        const dy = (raw as { dy?: number })?.dy ?? 0;
        result = applyPlayerMove(this.gameState, client.sessionId, dx, dy, grid);
      }
      if (result.ok) {
        syncMapPlayerPosition(this.mapRoomId, result.x, result.y);
        bumpStateVersion(this.gameState);
        const clientSeq =
          raw && typeof raw === "object" && typeof raw.clientSeq === "number"
            ? raw.clientSeq
            : undefined;
        if (clientSeq !== undefined) {
          this.lastAckedSeq.set(client.sessionId, clientSeq);
          client.send(COLYSEUS_SERVER_MESSAGES.moveAck, {
            clientSeq,
            x: result.x,
            y: result.y,
            facing: result.facing,
          });
        }
      } else {
        const clientSeq =
          raw && typeof raw === "object" && typeof raw.clientSeq === "number"
            ? raw.clientSeq
            : undefined;
        const player = this.gameState.players.get(client.sessionId);
        if (clientSeq !== undefined && player) {
          client.send(COLYSEUS_SERVER_MESSAGES.moveAck, {
            clientSeq,
            x: player.x,
            y: player.y,
            facing: player.facing as Facing,
          });
        }
      }
    });

    this.onMessage(COLYSEUS_CLIENT_MESSAGES.speak, async (client, raw: ColyseusSpeakPayload) => {
      const text = validateChatMessage(raw?.text);
      const npcId = validateChatNpcId(this.mapRoomId, raw?.npcId);
      const playerId = normalizePlayerId(raw?.playerId);
      if (!text || !npcId || !playerId) {
        client.send(COLYSEUS_SERVER_MESSAGES.error, { message: "invalid speak payload" });
        return;
      }
      const blocked = getContentBlockedResponse(text);
      if (blocked) {
        client.send(COLYSEUS_SERVER_MESSAGES.error, blocked);
        return;
      }
      if (this.npcSpeakJobs.has(npcId)) {
        client.send(COLYSEUS_SERVER_MESSAGES.speakBusy, { reason: "npc_busy", npcId });
        return;
      }
      const player = this.gameState.players.get(client.sessionId);
      if (player) {
        player.playerId = playerId;
      }
      const pendingToken = `pending:${client.sessionId}`;
      this.npcSpeakJobs.set(npcId, pendingToken);
      try {
        const jobId = await startNpcChatTurn(this.mapRoomId, text, npcId, playerId);
        this.npcSpeakJobs.set(npcId, jobId);
        registerJob(jobId, this, this.mapRoomId, client.sessionId);
        emitJobEvent(jobId, "thinking", { status: "queued", npcId });
        client.send("speakAck", { jobId });
      } catch (err) {
        if (this.npcSpeakJobs.get(npcId) === pendingToken) {
          this.npcSpeakJobs.delete(npcId);
          this.broadcast(COLYSEUS_SERVER_MESSAGES.speakIdle, { npcId });
        }
        const message = err instanceof Error ? err.message : "speak failed";
        client.send(COLYSEUS_SERVER_MESSAGES.error, { message });
      }
    });
  }

  onJoin(client: Client, options: JoinOptions) {
    if (this.orphanShard) {
      const primary = getColyseusRoom(this.mapRoomId);
      const full =
        primary !== undefined &&
        primary !== this &&
        primary.clients.length >= COLYSEUS_MAX_CLIENTS;
      client.leave(
        full ? COLYSEUS_ROOM_FULL_WS_CODE : COLYSEUS_ORPHAN_SHARD_WS_CODE,
        full ? COLYSEUS_ROOM_FULL_CODE : "orphan_shard",
      );
      return;
    }
    const { state: mapState } = getOrCreate(this.mapRoomId);
    const occupied: { x: number; y: number }[] = [];
    this.gameState.players.forEach((p) => {
      occupied.push({ x: p.x, y: p.y });
    });
    const spawn = findNearestWalkableCell(mapState, mapState.player.x, mapState.player.y, occupied);
    const player = new PlayerSchema();
    player.sessionId = client.sessionId;
    player.playerId = normalizePlayerId(options?.playerId) ?? "";
    player.x = spawn.x;
    player.y = spawn.y;
    player.facing = "s";
    this.gameState.players.set(client.sessionId, player);
    this.setMetadata({ mapRoomId: this.mapRoomId, clientCount: this.clients.length });
  }

  onLeave(client: Client) {
    this.gameState.players.delete(client.sessionId);
    this.lastAckedSeq.delete(client.sessionId);
    if (!this.orphanShard) {
      this.setMetadata({ mapRoomId: this.mapRoomId, clientCount: this.clients.length });
    }
  }

  onDispose() {
    if (getColyseusRoom(this.mapRoomId) === this) {
      unregisterColyseusRoom(this.mapRoomId);
    }
  }

  /** Release per-NPC speak slot when job completes (called from hub after terminal emit). */
  clearSpeakInFlight(jobId: string): void {
    for (const [npcId, id] of this.npcSpeakJobs.entries()) {
      if (id === jobId) {
        this.npcSpeakJobs.delete(npcId);
        this.broadcast(COLYSEUS_SERVER_MESSAGES.speakIdle, { npcId });
        break;
      }
    }
  }

  /** Called after Map executor mutates NPC/objects */
  refreshFromMap(): void {
    const { state: mapState } = getOrCreate(this.mapRoomId);
    syncColyseusFromMap(this.gameState, mapState);
  }
}
