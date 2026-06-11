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

type InMemoryEvent = CollectiveEventRow;
type InMemoryAttitude = {
  roomId: string;
  npcId: string;
  playerId: string;
  reputation: number;
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

  async getAttitude(roomId: string, npcId: string, playerId: string): Promise<number | null> {
    if (this.store) {
      const row = this.store.attitudes.find(
        (a) => a.roomId === roomId && a.npcId === npcId && a.playerId === playerId,
      );
      return row?.reputation ?? null;
    }

    const rows = await this.db!
      .select({ reputation: npcAttitudes.reputation })
      .from(npcAttitudes)
      .where(
        and(
          eq(npcAttitudes.roomId, roomId),
          eq(npcAttitudes.npcId, npcId),
          eq(npcAttitudes.playerId, playerId),
        ),
      )
      .limit(1);
    return rows[0]?.reputation ?? null;
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
        this.store.attitudes[idx]!.reputation = next;
        this.store.attitudes[idx]!.updatedAt = now;
      } else {
        this.store.attitudes.push({ roomId, npcId, playerId, reputation: next, updatedAt: now });
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
