/** In-session dialogue transcript per (room, player, npc) — short-term context for LLM turns. */

export type DialogueTurn = { role: "player" | "npc"; text: string };

const sessions = new Map<string, DialogueTurn[]>();

const MAX_TURNS_STORED = 20;

function threadKey(roomId: string, playerId: string, npcId: string): string {
  return `${roomId}:${playerId}:${npcId}`;
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
  turns.push({ role: "player", text: playerText });
  turns.push({ role: "npc", text: npcText });
  while (turns.length > MAX_TURNS_STORED) {
    turns.shift();
  }
  sessions.set(k, turns);
}

export function clearDialogueForPlayer(roomId: string, playerId: string): void {
  const prefix = `${roomId}:${playerId}:`;
  for (const k of [...sessions.keys()]) {
    if (k.startsWith(prefix)) sessions.delete(k);
  }
}

/** Test helper */
export function clearDialogueSessions(): void {
  sessions.clear();
}
