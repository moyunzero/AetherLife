type MoveIntentKey = string;

function key(roomId: string, npcId: string, playerId: string): MoveIntentKey {
  return `${roomId}:${npcId}:${playerId}`;
}

export type MoveIntent = {
  x: number;
  y: number;
  at: number;
};

export class MoveIntentTracker {
  private readonly intents = new Map<MoveIntentKey, MoveIntent>();

  record(roomId: string, npcId: string, playerId: string, x: number, y: number, at: number): void {
    this.intents.set(key(roomId, npcId, playerId), { x, y, at });
  }

  detectContradict(
    roomId: string,
    npcId: string,
    playerId: string,
    x: number,
    y: number,
    now: number,
    windowMs: number,
  ): { otherPlayerId: string } | null {
    for (const [k, intent] of this.intents) {
      if (!k.startsWith(`${roomId}:${npcId}:`)) continue;
      const otherPlayerId = k.split(":")[2]!;
      if (otherPlayerId === playerId) continue;
      if (now - intent.at > windowMs) continue;
      if (intent.x === x && intent.y === y) continue;
      return { otherPlayerId };
    }
    return null;
  }

  clearRoom(roomId: string): void {
    for (const k of [...this.intents.keys()]) {
      if (k.startsWith(`${roomId}:`)) this.intents.delete(k);
    }
  }

  clearAll(): void {
    this.intents.clear();
  }
}

export const moveIntentTracker = new MoveIntentTracker();
