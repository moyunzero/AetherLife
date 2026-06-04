import type { GameAction } from "@aetherlife/game-actions";
import { MemoryService } from "../memory/service.js";

export async function recordSuccessfulMutation(input: {
  roomId: string;
  npcId: string;
  action: GameAction;
  jobId?: string;
}): Promise<void> {
  try {
    await MemoryService.getInstance().recordMutationAudit({
      roomId: input.roomId,
      npcId: input.npcId,
      jobId: input.jobId,
      actionType: input.action.type,
      actionPayload: JSON.stringify(input.action),
    });
  } catch (err) {
    console.warn("mutation audit insert failed", err);
  }
}
