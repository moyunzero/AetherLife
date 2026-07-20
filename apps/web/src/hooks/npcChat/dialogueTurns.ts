import type { DialogueTurn } from "@aetherlife/shared";
import type { ChatMessage } from "./types.js";

/** Completed player↔npc turns for one NPC thread (mirrors game-server dialogue-session). */
export function recentDialogueTurnsForNpc(
  messages: readonly ChatMessage[],
  npcId: string,
  limit = 10,
): DialogueTurn[] {
  const turns: DialogueTurn[] = [];
  let pendingPlayers: DialogueTurn[] = [];

  for (const m of messages) {
    if (m.role === "error") continue;
    if (m.role === "player") {
      if (m.npcId && m.npcId !== npcId) {
        pendingPlayers = [];
        continue;
      }
      pendingPlayers.push({ role: "player", text: m.text });
      continue;
    }
    if (m.role === "npc") {
      if (m.npcId !== npcId) {
        pendingPlayers = [];
        continue;
      }
      turns.push(...pendingPlayers);
      pendingPlayers = [];
      turns.push({ role: "npc", text: m.text });
    }
  }

  return turns.slice(-limit);
}
