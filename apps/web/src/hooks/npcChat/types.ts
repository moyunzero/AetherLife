import type { RoomState } from "@aetherlife/shared";

export type ChatMessage = {
  id: string;
  role: "player" | "npc" | "error";
  text: string;
  npcId?: string;
  npcName?: string;
  /** PLAY-03: worker-sourced memory citation from speak done payload. */
  memoryQuote?: string;
};

export type ChatStatus = "idle" | "thinking" | "error";

export type RoomNpc = {
  id: string;
  name: string;
};

export type RoomStateShape = RoomState;

export type ParsedIntent = Record<string, unknown> | null;

export type AttitudeGateCue = {
  gateKind: string;
  npcName: string;
};

export type UseNpcChatOptions = {
  onCollectiveUpdated?: () => void;
};
