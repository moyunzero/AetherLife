import {
  checkPlayerMessageContent,
  contentBlockedPayload,
  findNpc,
  isCouncilNpcId,
  MAX_PLAYER_MESSAGE_LEN,
} from "@aetherlife/shared";
import { addNpcTurnJob } from "../queue/npc-turn.js";
import { getOrCreate } from "../room/store.js";
import { getRecentTurnsAsync } from "../npc/dialogue-session.js";

export function validateChatMessage(message: unknown): string | null {
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > MAX_PLAYER_MESSAGE_LEN) return null;
  return trimmed;
}

/** Blocklist parity with ai-gateway ContentGuard (sync rules only). */
export function getContentBlockedResponse(text: string): ReturnType<typeof contentBlockedPayload> | null {
  const check = checkPlayerMessageContent(text);
  if (check.allowed) return null;
  return contentBlockedPayload();
}

export function validateChatNpcId(roomId: string, npcId: unknown): string | null {
  if (typeof npcId !== "string" || !npcId.trim()) return null;
  if (!isCouncilNpcId(npcId)) return null;
  const room = getOrCreate(roomId);
  const npc = findNpc(room.state, npcId);
  if (!npc) return null;
  return npcId;
}

export async function startNpcChatTurn(
  roomId: string,
  message: string,
  npcId: string,
  playerId: string,
  jobId?: string,
  options?: { casualPreviewEmitted?: boolean },
): Promise<string> {
  getOrCreate(roomId);
  // Async hydrate (Redis on Map miss) — speak stub in GameRoom/chat stays sync getRecentTurns.
  const recentTurns = await getRecentTurnsAsync(roomId, playerId, npcId, 10);
  return addNpcTurnJob({
    roomId,
    playerMessage: message,
    npcId,
    playerId,
    recentTurns,
    jobId,
    casualPreviewEmitted: options?.casualPreviewEmitted,
  });
}
