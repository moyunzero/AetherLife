import {
  COLLECTIVE_EVENT_TTL_MS,
  DEFAULT_COLLECTIVE_WINDOW_MS,
  KIND_FIXED_DELTA,
  bandFromEffectiveScore,
  collectiveWindowMsFromEnv,
  computeEffectiveScore,
  computeWitnessDeltas,
  personalitySeedForNpc,
  type AttitudeBand,
  type CollectiveEventKind,
  type CollectivePosition,
} from "@aetherlife/shared";
import {
  CollectiveRepository,
  createCollectiveRepository,
  type CollectiveEventRow,
  type InsertCollectiveEventInput,
} from "@aetherlife/npc-memory";
import { allowedToolsForBand, type AllowedTool } from "./gate.js";
import { detectSpeakRule } from "./rule-detector.js";
import { getOrCreate } from "../room/store.js";

export type RecordRuleEventInput = {
  roomId: string;
  npcId: string;
  kind: CollectiveEventKind;
  summary: string;
  playerIds: string[];
  npcPositions: ReadonlyMap<string, CollectivePosition>;
  /** Speak rule hits apply per-player rep even solo; action rules still need D-04 window. */
  singlePlayerOk?: boolean;
};

export type RecordRuleEventResult =
  | { recorded: true; eventId: string }
  | { recorded: false; reason: "single_player" | "duplicate_players" };

export type CollectiveContext = {
  band: AttitudeBand;
  effectiveScore: number;
  collectiveWindowMean: number;
  playerReputation: number;
  allowedTools: AllowedTool[];
  recentSummaries: string[];
};

export type CollectiveStateAttitude = {
  npcId: string;
  playerId: string;
  reputation: number;
  collectiveWindowMean: number;
  effectiveScore: number;
  band: AttitudeBand;
};

export type CollectiveStateEvent = {
  id: string;
  roomId: string;
  npcId: string;
  kind: CollectiveEventKind;
  summary: string;
  playerIds: string[];
  deltaScore: number;
  source: CollectiveEventRow["source"];
  createdAt: string;
};

export type CollectiveStatePayload = {
  windowMs: number;
  ttlDays: number;
  attitudes: CollectiveStateAttitude[];
  recentEvents: CollectiveStateEvent[];
};

let repoInstance: CollectiveRepository | null = null;

function getRepo(): CollectiveRepository {
  if (!repoInstance) {
    repoInstance = createCollectiveRepository(process.env.DATABASE_URL);
  }
  return repoInstance;
}

export class CollectiveService {
  constructor(private readonly repo: CollectiveRepository) {}

  static getInstance(): CollectiveService {
    return new CollectiveService(getRepo());
  }

  /** @internal */
  static resetForTests(repo?: CollectiveRepository): void {
    repoInstance = repo ?? new CollectiveRepository(null);
  }

  windowMs(): number {
    return collectiveWindowMsFromEnv(process.env.COLLECTIVE_WINDOW_MS);
  }

  async recordRuleEvent(input: RecordRuleEventInput): Promise<RecordRuleEventResult> {
    const distinct = new Set(input.playerIds);
    if (distinct.size < 2 && !input.singlePlayerOk) {
      const windowCount = await this.repo.countDistinctPlayersInWindow(
        input.roomId,
        input.npcId,
        this.windowMs(),
        input.playerIds,
      );
      if (windowCount < 2) {
        return { recorded: false, reason: "single_player" };
      }
    }

    const deltaScore = KIND_FIXED_DELTA[input.kind];
    const eventInput: InsertCollectiveEventInput = {
      roomId: input.roomId,
      npcId: input.npcId,
      kind: input.kind,
      summary: input.summary,
      playerIds: [...distinct],
      deltaScore,
      source: "rule",
    };

    const eventId = await this.repo.insertEvent(eventInput);
    const witnessUpdates = computeWitnessDeltas(
      { kind: input.kind, deltaScore, playerIds: [...distinct] },
      input.npcId,
      input.npcPositions,
    );

    for (const update of witnessUpdates) {
      await this.repo.applyReputationDelta(
        input.roomId,
        update.npcId,
        update.playerId,
        update.delta,
      );
    }

    await this.repo.pruneExpired();
    return { recorded: true, eventId };
  }

  async recordWorkerEvent(input: {
    roomId: string;
    npcId: string;
    kind: CollectiveEventKind;
    summary: string;
    playerIds: string[];
    deltaScore: number;
    npcPositions: ReadonlyMap<string, CollectivePosition>;
  }): Promise<{ eventId: string }> {
    const distinct = [...new Set(input.playerIds)];
    const deltaScore = input.deltaScore;
    const eventInput: InsertCollectiveEventInput = {
      roomId: input.roomId,
      npcId: input.npcId,
      kind: input.kind,
      summary: input.summary.slice(0, 500),
      playerIds: distinct,
      deltaScore,
      source: "worker",
    };

    const eventId = await this.repo.insertEvent(eventInput);
    const witnessUpdates = computeWitnessDeltas(
      { kind: input.kind, deltaScore, playerIds: distinct },
      input.npcId,
      input.npcPositions,
    );

    for (const update of witnessUpdates) {
      await this.repo.applyReputationDelta(
        input.roomId,
        update.npcId,
        update.playerId,
        update.delta,
      );
    }

    await this.repo.pruneExpired();
    return { eventId };
  }

  async deleteForRoom(roomId: string): Promise<void> {
    await this.repo.deleteForRoom(roomId);
  }

  async getCollectiveContext(
    roomId: string,
    npcId: string,
    playerId: string,
  ): Promise<CollectiveContext> {
    const windowMs = this.windowMs();
    const events = await this.repo.listEventsInWindow(roomId, npcId, windowMs);
    const windowDeltas = events.map((e) => e.deltaScore);
    const collectiveWindowMean =
      windowDeltas.length === 0
        ? 0
        : windowDeltas.reduce((sum, d) => sum + d, 0) / windowDeltas.length;
    const playerReputation =
      (await this.repo.getAttitude(roomId, npcId, playerId)) ?? personalitySeedForNpc(npcId);
    const effectiveScore = computeEffectiveScore(playerReputation, windowDeltas);
    const band = bandFromEffectiveScore(effectiveScore);

    return {
      band,
      effectiveScore,
      collectiveWindowMean,
      playerReputation,
      allowedTools: allowedToolsForBand(band),
      recentSummaries: events.slice(0, 5).map((e) => e.summary),
    };
  }

  async getCollectiveState(
    roomId: string,
    playerId: string,
    filterNpcId?: string,
  ): Promise<CollectiveStatePayload> {
    const record = getOrCreate(roomId);
    const npcIds = filterNpcId ? [filterNpcId] : record.state.npcs.map((n) => n.id);

    const attitudes = await Promise.all(
      npcIds.map(async (npcId) => {
        const ctx = await this.getCollectiveContext(roomId, npcId, playerId);
        return {
          npcId,
          playerId,
          reputation: ctx.playerReputation,
          collectiveWindowMean: ctx.collectiveWindowMean,
          effectiveScore: ctx.effectiveScore,
          band: ctx.band,
        };
      }),
    );

    const recentEvents: CollectiveStateEvent[] = [];
    for (const npcId of npcIds) {
      const events = await this.repo.listEventsInWindow(roomId, npcId, this.windowMs());
      for (const event of events) {
        recentEvents.push({
          id: event.id,
          roomId: event.roomId,
          npcId: event.npcId,
          kind: event.kind,
          summary: event.summary,
          playerIds: event.playerIds,
          deltaScore: event.deltaScore,
          source: event.source,
          createdAt: event.createdAt.toISOString(),
        });
      }
    }
    recentEvents.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      windowMs: this.windowMs(),
      ttlDays: Math.round(COLLECTIVE_EVENT_TTL_MS / (24 * 60 * 60 * 1000)),
      attitudes,
      recentEvents: recentEvents.slice(0, 20),
    };
  }

  async detectSpeak(input: {
    roomId: string;
    npcId: string;
    playerId: string;
    text: string;
  }): Promise<void> {
    const rule = detectSpeakRule(input.text);
    if (!rule || "ambiguous" in rule) return;

    const record = getOrCreate(input.roomId);
    const npcPositions = new Map<string, CollectivePosition>(
      record.state.npcs.map((n) => [n.id, { x: n.x, y: n.y }]),
    );

    await this.recordRuleEvent({
      roomId: input.roomId,
      npcId: input.npcId,
      kind: rule.kind,
      summary: rule.summary,
      playerIds: [input.playerId],
      npcPositions,
      singlePlayerOk: true,
    });
  }

  repoRef(): CollectiveRepository {
    return this.repo;
  }
}

export { COLLECTIVE_EVENT_TTL_MS, DEFAULT_COLLECTIVE_WINDOW_MS };
