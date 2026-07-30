/** In-session dialogue transcript per (room, player, npc) — short-term context for LLM turns.
 * Map is hot cache; Redis mirrors for restart continuity (D-SESS-01…06).
 * Sync getRecentTurns stays Map-only — never await Redis on speak stub path.
 */

import { Redis } from "ioredis";

export type DialogueTurn = { role: "player" | "npc"; text: string };

const sessions = new Map<string, DialogueTurn[]>();

/** Tracked Redis keys written this process — clear without KEYS/SCAN. */
const knownRedisKeys = new Set<string>();

const MAX_TURNS_STORED = 20;
const DIALOGUE_TTL_SECONDS = 7 * 24 * 60 * 60;
const REDIS_KEY_PREFIX = "aetherlife:dialogue:";

let dialogueRedis: Redis | null | undefined;

function threadKey(roomId: string, playerId: string, npcId: string): string {
  return `${roomId}:${playerId}:${npcId}`;
}

export function dialogueRedisKey(roomId: string, playerId: string, npcId: string): string {
  return `${REDIS_KEY_PREFIX}${roomId}:${playerId}:${npcId}`;
}

function getDialogueRedis(): Redis | null {
  if (dialogueRedis !== undefined) return dialogueRedis;
  const url = process.env.REDIS_URL;
  if (!url) {
    dialogueRedis = null;
    return null;
  }
  dialogueRedis = new Redis(url, { maxRetriesPerRequest: null });
  dialogueRedis.on("error", (err) => {
    console.error("[redis] dialogue-session", err.message);
  });
  return dialogueRedis;
}

/** @internal — inject fake Redis or force null for unit tests. */
export function setDialogueRedisForTests(client: Redis | null): void {
  dialogueRedis = client;
}

/** @internal — reset lazy singleton so next getDialogueRedis re-reads env. */
export function resetDialogueRedisForTests(): void {
  dialogueRedis = undefined;
  knownRedisKeys.clear();
}

function parseTurn(raw: string): DialogueTurn | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as DialogueTurn).role &&
      ((parsed as DialogueTurn).role === "player" || (parsed as DialogueTurn).role === "npc") &&
      typeof (parsed as DialogueTurn).text === "string"
    ) {
      return { role: (parsed as DialogueTurn).role, text: (parsed as DialogueTurn).text };
    }
  } catch {
    /* ignore malformed */
  }
  return null;
}

async function mirrorAppendToRedis(
  roomId: string,
  playerId: string,
  npcId: string,
  playerTurn: DialogueTurn,
  npcTurn: DialogueTurn,
): Promise<void> {
  const redis = getDialogueRedis();
  if (!redis) return;
  const key = dialogueRedisKey(roomId, playerId, npcId);
  knownRedisKeys.add(key);
  try {
    await redis.rpush(key, JSON.stringify(playerTurn), JSON.stringify(npcTurn));
    await redis.ltrim(key, -MAX_TURNS_STORED, -1);
    await redis.expire(key, DIALOGUE_TTL_SECONDS);
  } catch (err) {
    console.error("[dialogue-session] Redis mirror failed", err);
  }
}

async function deleteRedisKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const redis = getDialogueRedis();
  if (!redis) return;
  try {
    await redis.del(...keys);
  } catch (err) {
    console.error("[dialogue-session] Redis clear failed", err);
  }
}

export function getRecentTurns(
  roomId: string,
  playerId: string,
  npcId: string,
  limit = 10,
): DialogueTurn[] {
  const turns = sessions.get(threadKey(roomId, playerId, npcId)) ?? [];
  return turns.slice(-limit);
}

/**
 * Async hydrate for already-async job paths (npc-chat).
 * Map hit → return; miss → LRANGE rehydrate → Map. Never throws on Redis errors.
 */
export async function getRecentTurnsAsync(
  roomId: string,
  playerId: string,
  npcId: string,
  limit = 10,
): Promise<DialogueTurn[]> {
  const k = threadKey(roomId, playerId, npcId);
  if (sessions.has(k)) {
    return (sessions.get(k) ?? []).slice(-limit);
  }

  const redis = getDialogueRedis();
  if (!redis) {
    return [];
  }

  const key = dialogueRedisKey(roomId, playerId, npcId);
  try {
    const raw = await redis.lrange(key, 0, -1);
    // Concurrent appendCompletedTurn during LRANGE must win — do not clobber Map.
    if (sessions.has(k)) {
      return (sessions.get(k) ?? []).slice(-limit);
    }
    const turns: DialogueTurn[] = [];
    for (const item of raw) {
      const turn = parseTurn(item);
      if (turn) turns.push(turn);
    }
    // Do not negatively cache empty threads (multi-instance / later Redis write).
    if (turns.length === 0) {
      return [];
    }
    sessions.set(k, turns);
    knownRedisKeys.add(key);
    return turns.slice(-limit);
  } catch (err) {
    console.error("[dialogue-session] Redis rehydrate failed", err);
    return [];
  }
}

export function appendCompletedTurn(input: {
  roomId: string;
  playerId: string;
  npcId: string;
  playerMessage: string;
  npcReply: string;
}): void {
  const playerText = input.playerMessage.trim();
  const npcText = input.npcReply.trim();
  if (!playerText || !npcText) return;

  const k = threadKey(input.roomId, input.playerId, input.npcId);
  const turns = sessions.get(k) ?? [];
  const playerTurn: DialogueTurn = { role: "player", text: playerText };
  const npcTurn: DialogueTurn = { role: "npc", text: npcText };
  turns.push(playerTurn);
  turns.push(npcTurn);
  while (turns.length > MAX_TURNS_STORED) {
    turns.shift();
  }
  sessions.set(k, turns);

  // Fire-and-forget Redis mirror — never block speak / hub path.
  void mirrorAppendToRedis(input.roomId, input.playerId, input.npcId, playerTurn, npcTurn);
}

export function clearDialogueForPlayer(roomId: string, playerId: string): void {
  const prefix = `${roomId}:${playerId}:`;
  const redisPrefix = `${REDIS_KEY_PREFIX}${roomId}:${playerId}:`;
  for (const k of [...sessions.keys()]) {
    if (k.startsWith(prefix)) sessions.delete(k);
  }
  const toDelete: string[] = [];
  for (const rk of [...knownRedisKeys]) {
    if (rk.startsWith(redisPrefix)) {
      knownRedisKeys.delete(rk);
      toDelete.push(rk);
    }
  }
  void deleteRedisKeys(toDelete);
}

/**
 * Drop in-process Map cache for a room only — Redis lists stay intact.
 * Simulates game-server restart Map loss for D-SESS / UAT (LRANGE rehydrate).
 */
export function evictDialogueMapForRoom(roomId: string): number {
  const id = roomId.trim();
  if (!id) return 0;
  const prefix = `${id}:`;
  let n = 0;
  for (const k of [...sessions.keys()]) {
    if (k.startsWith(prefix)) {
      sessions.delete(k);
      n += 1;
    }
  }
  return n;
}

/** Test / UAT: async turns for a thread (Map hit or Redis rehydrate). */
export async function listDialogueTurnsForUat(
  roomId: string,
  playerId: string,
  npcId: string,
  limit = 10,
): Promise<DialogueTurn[]> {
  return getRecentTurnsAsync(roomId, playerId, npcId, limit);
}

/** Test helper */
export function clearDialogueSessions(): void {
  sessions.clear();
  knownRedisKeys.clear();
}
