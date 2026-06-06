import {
  checkPlayerMessageContent,
  contentBlockedPayload,
  findNpc,
  MAX_PLAYER_MESSAGE_LEN,
} from "@aetherlife/shared";
import { MemoryService } from "../memory/service.js";
import { addNpcTurnJob } from "../queue/npc-turn.js";
import { getOrCreate } from "../room/store.js";

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
  const room = getOrCreate(roomId);
  return findNpc(room.state, npcId) ? npcId : null;
}

export async function startNpcChatTurn(
  roomId: string,
  message: string,
  npcId: string,
  playerId: string,
): Promise<string> {
  getOrCreate(roomId);
  const jobId = await addNpcTurnJob({ roomId, playerMessage: message, npcId, playerId });
  void MemoryService.getInstance()
    .appendPlayerMemory(roomId, message, npcId, playerId)
    .catch((err) => {
      console.error("[npc-chat] appendPlayerMemory failed", err);
    });
  return jobId;
}
