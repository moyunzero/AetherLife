import { and, desc, eq, gte, lt } from "drizzle-orm";
import {
  COLLECTIVE_EVENT_TTL_MS,
  personalitySeedForNpc,
  type CollectiveEventKind,
  type CollectiveEventSource,
} from "@aetherlife/shared";
import { createDb, type Db } from "../db.js";
import { collectiveEvents, npcAttitudes } from "../schema.js";

export type CollectiveEventRow = {
  id: string;
  roomId: string;
  npcId: string;
  kind: CollectiveEventKind;
  summary: string;
  playerIds: string[];
  deltaScore: number;
  source: CollectiveEventSource;
  createdAt: Date;
};

export type InsertCollectiveEventInput = {
  roomId: string;
  npcId: string;
  kind: CollectiveEventKind;
  summary: string;
  playerIds: string[];
  deltaScore: number;
  source?: CollectiveEventSource;
  createdAt?: Date;
};

/** Full attitude row including semantic columns (D-BELIEF / 29-07 feed). */
export type AttitudeRow = {
  roomId: string;
  npcId: string;
  playerId: string;
  reputation: number;
  currentMood: string;
  keyBeliefs: string[];
  summary: string;
  updatedAt: Date;
};

/** Patch for semantic upsert — omitted keys are not written (D-BELIEF-07). */
export type SemanticStatePatch = {
  mood?: string;
  beliefs?: string[];
  summary?: string;
};

type InMemoryEvent = CollectiveEventRow;
type InMemoryAttitude = {
  roomId: string;
  npcId: string;
  playerId: string;
  reputation: number;
  currentMood: string;
  keyBeliefs: string[];
  summary: string;
  updatedAt: Date;
};

class InMemoryCollectiveStore {
  events: InMemoryEvent[] = [];
  attitudes: InMemoryAttitude[] = [];
  seq = 0;

  nextId() {
    this.seq += 1;
    return `ce-${this.seq}`;
  }
}

function defaultSemanticFields(): Pick<InMemoryAttitude, "currentMood" | "keyBeliefs" | "summary"> {
  return { currentMood: "平静", keyBeliefs: [], summary: "" };
}

export class CollectiveRepository {
  private readonly store: InMemoryCollectiveStore | null;

  constructor(private readonly db: Db | null) {
    this.store = db ? null : new InMemoryCollectiveStore();
  }

  static create(databaseUrl: string | undefined): CollectiveRepository {
    if (!databaseUrl) {
      return new CollectiveRepository(null);
    }
    return new CollectiveRepository(createDb(databaseUrl));
  }

  async insertEvent(input: InsertCollectiveEventInput): Promise<string> {
    const source = input.source ?? "rule";
    const createdAt = input.createdAt ?? new Date();

    if (this.store) {
      const id = this.store.nextId();
      this.store.events.push({
        id,
        roomId: input.roomId,
        npcId: input.npcId,
        kind: input.kind,
        summary: input.summary,
        playerIds: [...input.playerIds],
        deltaScore: input.deltaScore,
        source,
        createdAt,
      });
      return id;
    }

    const rows = await this.db!
      .insert(collectiveEvents)
      .values({
        roomId: input.roomId,
        npcId: input.npcId,
        kind: input.kind,
        summary: input.summary,
        playerIds: input.playerIds,
        deltaScore: input.deltaScore,
        source,
        createdAt,
      })
      .returning({ id: collectiveEvents.id });
    return rows[0]!.id;
  }

  async listEventsInWindow(
    roomId: string,
    npcId: string,
    windowMs: number,
    now = new Date(),
  ): Promise<CollectiveEventRow[]> {
    const ttlCutoff = new Date(now.getTime() - COLLECTIVE_EVENT_TTL_MS);
    const windowCutoff = new Date(now.getTime() - windowMs);

    if (this.store) {
      return this.store.events
        .filter(
          (e) =>
            e.roomId === roomId &&
            e.npcId === npcId &&
            e.createdAt >= ttlCutoff &&
            e.createdAt >= windowCutoff,
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    const rows = await this.db!
      .select()
      .from(collectiveEvents)
      .where(
        and(
          eq(collectiveEvents.roomId, roomId),
          eq(collectiveEvents.npcId, npcId),
          gte(collectiveEvents.createdAt, ttlCutoff),
          gte(collectiveEvents.createdAt, windowCutoff),
        ),
      )
      .orderBy(desc(collectiveEvents.createdAt));

    return rows.map((row) => ({
      id: row.id,
      roomId: row.roomId,
      npcId: row.npcId,
      kind: row.kind,
      summary: row.summary,
      playerIds: row.playerIds,
      deltaScore: row.deltaScore,
      source: row.source,
      createdAt: row.createdAt,
    }));
  }

  async countDistinctPlayersInWindow(
    roomId: string,
    npcId: string,
    windowMs: number,
    extraPlayerIds: string[] = [],
  ): Promise<number> {
    const events = await this.listEventsInWindow(roomId, npcId, windowMs);
    const set = new Set<string>(extraPlayerIds);
    for (const event of events) {
      for (const pid of event.playerIds) set.add(pid);
    }
    return set.size;
  }

  /** Reputation-only helper — callers that need semantic use getAttitudeRow. */
  async getAttitude(roomId: string, npcId: string, playerId: string): Promise<number | null> {
    const row = await this.getAttitudeRow(roomId, npcId, playerId);
    return row?.reputation ?? null;
  }

  async getAttitudeRow(
    roomId: string,
    npcId: string,
    playerId: string,
  ): Promise<AttitudeRow | null> {
    if (this.store) {
      const row = this.store.attitudes.find(
        (a) => a.roomId === roomId && a.npcId === npcId && a.playerId === playerId,
      );
      return row
        ? {
            roomId: row.roomId,
            npcId: row.npcId,
            playerId: row.playerId,
            reputation: row.reputation,
            currentMood: row.currentMood,
            keyBeliefs: [...row.keyBeliefs],
            summary: row.summary,
            updatedAt: row.updatedAt,
          }
        : null;
    }

    const rows = await this.db!
      .select({
        roomId: npcAttitudes.roomId,
        npcId: npcAttitudes.npcId,
        playerId: npcAttitudes.playerId,
        reputation: npcAttitudes.reputation,
        currentMood: npcAttitudes.currentMood,
        keyBeliefs: npcAttitudes.keyBeliefs,
        summary: npcAttitudes.summary,
        updatedAt: npcAttitudes.updatedAt,
      })
      .from(npcAttitudes)
      .where(
        and(
          eq(npcAttitudes.roomId, roomId),
          eq(npcAttitudes.npcId, npcId),
          eq(npcAttitudes.playerId, playerId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return {
      roomId: row.roomId,
      npcId: row.npcId,
      playerId: row.playerId,
      reputation: row.reputation,
      currentMood: row.currentMood,
      keyBeliefs: Array.isArray(row.keyBeliefs) ? [...row.keyBeliefs] : [],
      summary: row.summary,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Write semantic columns only for keys present in patch (D-BELIEF-07/09/13).
   * Success path replaces beliefs entirely when `beliefs` is provided.
   */
  async upsertSemanticState(
    roomId: string,
    npcId: string,
    playerId: string,
    patch: SemanticStatePatch,
  ): Promise<void> {
    const hasMood = patch.mood !== undefined;
    const hasBeliefs = patch.beliefs !== undefined;
    const hasSummary = patch.summary !== undefined;
    if (!hasMood && !hasBeliefs && !hasSummary) return;

    const now = new Date();
    const existing = await this.getAttitudeRow(roomId, npcId, playerId);
    const reputation = existing?.reputation ?? personalitySeedForNpc(npcId);
    const nextMood = hasMood ? patch.mood! : (existing?.currentMood ?? "平静");
    const nextBeliefs = hasBeliefs ? [...patch.beliefs!] : [...(existing?.keyBeliefs ?? [])];
    const nextSummary = hasSummary ? patch.summary! : (existing?.summary ?? "");

    if (this.store) {
      const idx = this.store.attitudes.findIndex(
        (a) => a.roomId === roomId && a.npcId === npcId && a.playerId === playerId,
      );
      if (idx >= 0) {
        const row = this.store.attitudes[idx]!;
        if (hasMood) row.currentMood = patch.mood!;
        if (hasBeliefs) row.keyBeliefs = [...patch.beliefs!];
        if (hasSummary) row.summary = patch.summary!;
        row.updatedAt = now;
      } else {
        this.store.attitudes.push({
          roomId,
          npcId,
          playerId,
          reputation,
          currentMood: nextMood,
          keyBeliefs: nextBeliefs,
          summary: nextSummary,
          updatedAt: now,
        });
      }
      return;
    }

    const conflictSet: {
      updatedAt: Date;
      currentMood?: string;
      keyBeliefs?: string[];
      summary?: string;
    } = { updatedAt: now };
    if (hasMood) conflictSet.currentMood = patch.mood;
    if (hasBeliefs) conflictSet.keyBeliefs = patch.beliefs;
    if (hasSummary) conflictSet.summary = patch.summary;

    await this.db!
      .insert(npcAttitudes)
      .values({
        roomId,
        npcId,
        playerId,
        reputation,
        currentMood: nextMood,
        keyBeliefs: nextBeliefs,
        summary: nextSummary,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [npcAttitudes.roomId, npcAttitudes.npcId, npcAttitudes.playerId],
        set: conflictSet,
      });
  }

  async applyReputationDelta(
    roomId: string,
    npcId: string,
    playerId: string,
    delta: number,
  ): Promise<number> {
    const existing = await this.getAttitude(roomId, npcId, playerId);
    const base = existing ?? personalitySeedForNpc(npcId);
    const next = Math.max(-100, Math.min(100, base + delta));
    const now = new Date();

    if (this.store) {
      const idx = this.store.attitudes.findIndex(
        (a) => a.roomId === roomId && a.npcId === npcId && a.playerId === playerId,
      );
      if (idx >= 0) {
        // Pitfall 3: only reputation + updatedAt — never wipe semantic.
        this.store.attitudes[idx]!.reputation = next;
        this.store.attitudes[idx]!.updatedAt = now;
      } else {
        this.store.attitudes.push({
          roomId,
          npcId,
          playerId,
          reputation: next,
          ...defaultSemanticFields(),
          updatedAt: now,
        });
      }
      return next;
    }

    await this.db!
      .insert(npcAttitudes)
      .values({
        roomId,
        npcId,
        playerId,
        reputation: next,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [npcAttitudes.roomId, npcAttitudes.npcId, npcAttitudes.playerId],
        // Pitfall 3: set list must not include mood/beliefs/summary.
        set: {
          reputation: next,
          updatedAt: now,
        },
      });

    return next;
  }

  async deleteForRoom(roomId: string): Promise<void> {
    if (this.store) {
      this.store.events = this.store.events.filter((e) => e.roomId !== roomId);
      this.store.attitudes = this.store.attitudes.filter((a) => a.roomId !== roomId);
      return;
    }

    await this.db!.delete(collectiveEvents).where(eq(collectiveEvents.roomId, roomId));
    await this.db!.delete(npcAttitudes).where(eq(npcAttitudes.roomId, roomId));
  }

  /** Reset one player: clear attitudes only; room-level events TTL out naturally. */
  async deleteForPlayer(roomId: string, playerId: string): Promise<void> {
    if (this.store) {
      this.store.attitudes = this.store.attitudes.filter(
        (a) => !(a.roomId === roomId && a.playerId === playerId),
      );
      return;
    }

    await this.db!
      .delete(npcAttitudes)
      .where(and(eq(npcAttitudes.roomId, roomId), eq(npcAttitudes.playerId, playerId)));
  }

  async pruneExpired(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - COLLECTIVE_EVENT_TTL_MS);
    if (this.store) {
      const before = this.store.events.length;
      this.store.events = this.store.events.filter((e) => e.createdAt >= cutoff);
      return before - this.store.events.length;
    }

    await this.db!.delete(collectiveEvents).where(lt(collectiveEvents.createdAt, cutoff));
    return 0;
  }

  /** @internal test helper */
  _inMemoryStore(): InMemoryCollectiveStore | null {
    return this.store;
  }
}

export function createCollectiveRepository(databaseUrl: string | undefined): CollectiveRepository {
  if (!databaseUrl) {
    return new CollectiveRepository(null);
  }
  return new CollectiveRepository(createDb(databaseUrl));
}
