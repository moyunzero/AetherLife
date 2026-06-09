import { Room, type Client } from "colyseus";
import {
  COLYSEUS_CLIENT_MESSAGES,
  COLYSEUS_MAX_CLIENTS,
  COLYSEUS_ORPHAN_SHARD_WS_CODE,
  COLYSEUS_ROOM_FULL_CODE,
  COLYSEUS_ROOM_FULL_WS_CODE,
  COLYSEUS_SERVER_MESSAGES,
  chunkOf,
  chunkViewsFingerprint,
  defaultSpawnGlobal,
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
import { getChunkLoader } from "../world/chunk-loader.js";
import { chunkCrossed, onPlayerEnterChunk } from "../world/lore-orchestrator.js";
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
import { runAmbientTick } from "../ambient/tick.js";
import { getChunkLoader } from "../world/chunk-loader.js";

export const AMBIENT_MS = 6000;

type JoinOptions = { mapRoomId?: string; playerId?: string };

export class GameRoom extends Room {
  /** Logical map room id (join option `roomId`; not Colyseus `this.roomId`). */
  mapRoomId = "default";
  /** npcId → jobId (or pending token before job is created) */
  private npcSpeakJobs = new Map<string, string>();
  /** Per-NPC patrol waypoint cursor (room-local ambient state). */
  private ambientWaypointCursors = new Map<string, number>();
  private lastAckedSeq = new Map<string, number>();
  private lastChunksFingerprint = "";
  /** Set when matchmaker spawned a duplicate shard for the same mapRoomId. */
  private orphanShard = false;
  /** Per-session move pipeline — async chunk load must not interleave dx/dy handlers. */
  private moveQueueTail = new Map<string, Promise<void>>();

  private enqueuePlayerMove(client: Client, raw: ColyseusMovePayload): void {
    const sid = client.sessionId;
    const tail = this.moveQueueTail.get(sid) ?? Promise.resolve();
    const run = tail.then(() => this.processPlayerMove(client, raw));
    const settled = run.catch((err) => {
      console.error("[GameRoom] move failed", err);
    });
    this.moveQueueTail.set(sid, settled);
  }

  private async processPlayerMove(client: Client, raw: ColyseusMovePayload): Promise<void> {
    const { state: mapState } = getOrCreate(this.mapRoomId);
    const loader = getChunkLoader(this.mapRoomId);
    const mover = this.gameState.players.get(client.sessionId);
    const prevGx = mover?.x ?? 0;
    const prevGy = mover?.y ?? 0;
    const positions: { gx: number; gy: number }[] = [];
    this.gameState.players.forEach((p) => positions.push({ gx: p.x, gy: p.y }));
    if (mover) {
      if (
        raw &&
        typeof raw === "object" &&
        "targetX" in raw &&
        "targetY" in raw &&
        typeof raw.targetX === "number" &&
        typeof raw.targetY === "number"
      ) {
        positions.push({ gx: raw.targetX, gy: raw.targetY });
      } else {
        const dx = (raw as { dx?: number })?.dx ?? 0;
        const dy = (raw as { dy?: number })?.dy ?? 0;
        positions.push({ gx: mover.x + dx, gy: mover.y + dy });
      }
    }
    await loader.ensureChunksForPlayers(positions);
    const grid = buildMoveGrid(mapState, this.gameState, client.sessionId, loader);
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
      const after = [{ gx: result.x, gy: result.y }];
      this.gameState.players.forEach((p, sid) => {
        if (sid !== client.sessionId) after.push({ gx: p.x, gy: p.y });
      });
      await loader.ensureChunksForPlayers(after);
      this.broadcastChunksIfChanged(loader);
      if (chunkCrossed(prevGx, prevGy, result.x, result.y)) {
        const { cx, cy } = chunkOf(result.x, result.y);
        const playerId = mover?.playerId?.trim() || client.sessionId;
        void onPlayerEnterChunk({
          mapRoomId: this.mapRoomId,
          sessionId: client.sessionId,
          playerId,
          cx,
          cy,
        }).catch((err) => {
          console.error("[GameRoom] lore enter chunk failed", err);
        });
      }
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
      if (result.facingUpdated) {
        bumpStateVersion(this.gameState);
      }
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
  }

  private broadcastChunksIfChanged(loader: ReturnType<typeof getChunkLoader>): void {
    const views = loader.getLoadedChunkViews();
    const fp = chunkViewsFingerprint(views);
    if (fp === this.lastChunksFingerprint) return;
    this.lastChunksFingerprint = fp;
    this.broadcast(COLYSEUS_SERVER_MESSAGES.chunksSync, { chunks: views });
  }

  private get gameState(): GameRoomState {
    return this.state as GameRoomState;
  }

  onCreate(options: JoinOptions) {
    this.mapRoomId = options.mapRoomId ?? "default";
    this.maxClients = COLYSEUS_MAX_CLIENTS;
    this.setState(new GameRoomState());
    this.gameState.gameMinute = 360;

    const { state: mapState } = getOrCreate(this.mapRoomId);
    syncColyseusFromMap(this.gameState, mapState);

    if (!tryClaimMapRoom(this.mapRoomId, this)) {
      this.orphanShard = true;
      this.setMatchmaking({ unlisted: true });
      this.autoDispose = true;
    } else {
      this.setMetadata({ mapRoomId: this.mapRoomId, clientCount: 0 });
    }
    this.setSimulationInterval((dt) => this.onAmbientTick(dt), AMBIENT_MS);

    this.onMessage(COLYSEUS_CLIENT_MESSAGES.move, (client, raw: ColyseusMovePayload) => {
      this.enqueuePlayerMove(client, raw);
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
        registerJob(jobId, this, this.mapRoomId, client.sessionId, {
          npcId,
          playerId,
          playerMessage: text,
        });
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

    this.onMessage(COLYSEUS_CLIENT_MESSAGES.requestChunksSync, async (client) => {
      const loader = getChunkLoader(this.mapRoomId);
      const positions: { gx: number; gy: number }[] = [];
      this.gameState.players.forEach((p) => positions.push({ gx: p.x, gy: p.y }));
      await loader.ensureChunksForPlayers(positions);
      client.send(COLYSEUS_SERVER_MESSAGES.chunksSync, {
        chunks: loader.getLoadedChunkViews(),
      });
    });
  }

  async onJoin(client: Client, options: JoinOptions) {
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
    const loader = getChunkLoader(this.mapRoomId);
    const defaultSpawn = defaultSpawnGlobal();
    const occupied: { x: number; y: number }[] = [];
    this.gameState.players.forEach((p) => {
      occupied.push({ x: p.x, y: p.y });
    });
    await loader.ensureChunksForPlayers([{ gx: defaultSpawn.x, gy: defaultSpawn.y }]);
    const grid = buildMoveGrid(mapState, this.gameState, client.sessionId, loader);
    const spawn = findNearestWalkableCell(
      defaultSpawn.x,
      defaultSpawn.y,
      grid,
    );
    const player = new PlayerSchema();
    player.sessionId = client.sessionId;
    player.playerId = normalizePlayerId(options?.playerId) ?? "";
    player.x = spawn.x;
    player.y = spawn.y;
    player.facing = "s";
    this.gameState.players.set(client.sessionId, player);
    const allPos: { gx: number; gy: number }[] = [];
    this.gameState.players.forEach((p) => allPos.push({ gx: p.x, gy: p.y }));
    await loader.ensureChunksForPlayers(allPos);
    const views = loader.getLoadedChunkViews();
    this.lastChunksFingerprint = chunkViewsFingerprint(views);
    client.send(COLYSEUS_SERVER_MESSAGES.chunksSync, { chunks: views });
    this.setMetadata({ mapRoomId: this.mapRoomId, clientCount: this.clients.length });

    const { cx, cy } = chunkOf(spawn.x, spawn.y);
    void onPlayerEnterChunk({
      mapRoomId: this.mapRoomId,
      sessionId: client.sessionId,
      playerId: player.playerId || client.sessionId,
      cx,
      cy,
    }).catch((err) => {
      console.error("[GameRoom] lore enter chunk on join failed", err);
    });
  }

  onLeave(client: Client) {
    this.gameState.players.delete(client.sessionId);
    this.lastAckedSeq.delete(client.sessionId);
    this.moveQueueTail.delete(client.sessionId);
    if (!this.orphanShard) {
      this.setMetadata({ mapRoomId: this.mapRoomId, clientCount: this.clients.length });
    }
  }

  onDispose() {
    if (getColyseusRoom(this.mapRoomId) === this) {
      unregisterColyseusRoom(this.mapRoomId);
    }
  }

  private onAmbientTick(_dt: number): void {
    if (this.orphanShard) return;
    const { state: mapState } = getOrCreate(this.mapRoomId);
    const loader = getChunkLoader(this.mapRoomId);
    runAmbientTick({
      roomId: this.mapRoomId,
      gameState: this.gameState,
      map: mapState,
      loader,
      npcSpeakJobs: this.npcSpeakJobs,
      waypointCursors: this.ambientWaypointCursors,
    });
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
