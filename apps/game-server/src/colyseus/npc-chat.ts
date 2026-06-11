import {
  checkPlayerMessageContent,
  contentBlockedPayload,
  findNpc,
  isBackgroundNpc,
  MAX_PLAYER_MESSAGE_LEN,
} from "@aetherlife/shared";
import { addNpcTurnJob } from "../queue/npc-turn.js";
import { getOrCreate } from "../room/store.js";
import { getRecentTurns } from "../npc/dialogue-session.js";

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

/**
 * Validate that an NPC ID refers to an existing, non-background NPC in a room.
 *
 * @param roomId - The room identifier to look up the NPC in
 * @param npcId - The candidate NPC id to validate
 * @returns `npcId` if it identifies an existing, non-background NPC in the room, `null` otherwise
 */
export function validateChatNpcId(roomId: string, npcId: unknown): string | null {
  if (typeof npcId !== "string" || !npcId.trim()) return null;
  const room = getOrCreate(roomId);
  const npc = findNpc(room.state, npcId);
  if (!npc || isBackgroundNpc(npc)) return null;
  return npcId;
}

/**
 * Enqueues an NPC chat-turn job for a player's message in a room.
 *
 * Gathers recent dialogue context for the (roomId, playerId, npcId) tuple and schedules work to generate the NPC's response.
 *
 * @param roomId - The room identifier where the chat occurs
 * @param message - The player's message text to send to the NPC
 * @param npcId - The target NPC's identifier
 * @param playerId - The player's identifier who initiated the message
 * @param jobId - Optional external identifier to associate with the enqueued job
 * @param options - Optional flags controlling job behavior
 * @param options.casualPreviewEmitted - If true, indicates a casual preview has already been emitted for this turn
 * @returns The identifier of the enqueued NPC turn job
 */
export async function startNpcChatTurn(
  roomId: string,
  message: string,
  npcId: string,
  playerId: string,
  jobId?: string,
  options?: { casualPreviewEmitted?: boolean },
): Promise<string> {
  getOrCreate(roomId);
  const recentTurns = getRecentTurns(roomId, playerId, npcId, 10);
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
