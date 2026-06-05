import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "@colyseus/sdk";
import {
  COLYSEUS_CLIENT_MESSAGES,
  COLYSEUS_SERVER_MESSAGES,
  sanitizeNpcReplyText,
  type ColyseusSpeakBusyPayload,
  type ColyseusSpeakIdlePayload,
  type RoomState,
  type StatePatchPayload,
} from "@aetherlife/shared";
import { applyStatePatch } from "../lib/applyStatePatch.js";
import { getOrCreatePlayerId, playerApiHeaders } from "../lib/playerSession.js";

export type ChatMessage = {
  id: string;
  role: "player" | "npc" | "error";
  text: string;
  npcId?: string;
  npcName?: string;
};

export type ChatStatus = "idle" | "thinking" | "error";

export type RoomNpc = {
  id: string;
  name: string;
};

export type RoomStateShape = RoomState;

export type ParsedIntent = Record<string, unknown> | null;

const apiBase = import.meta.env.VITE_GAME_SERVER_URL || "/api";
const chatBase = import.meta.env.VITE_AI_GATEWAY_URL || "/v1";
const DEFAULT_NPC_ID = "npc-1";

export function useNpcChat(colyseusRoom: Room | null, mapRoomId = "default") {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [roomState, setRoomState] = useState<RoomStateShape | null>(null);
  const [memoryCounts, setMemoryCounts] = useState<Record<string, number>>({});
  const [activeNpcId, setActiveNpcId] = useState(DEFAULT_NPC_ID);
  const [jobId, setJobId] = useState<string | null>(null);
  const pendingJobIdRef = useRef<string | null>(null);
  const sendingNpcIdRef = useRef<string | null>(null);
  const activeNpcIdRef = useRef(activeNpcId);
  activeNpcIdRef.current = activeNpcId;
  const [error, setError] = useState<string | null>(null);
  const [lastParsedIntent, setLastParsedIntent] = useState<ParsedIntent>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [speakBusyNpcId, setSpeakBusyNpcId] = useState<string | null>(null);
  const [thinkingNpcId, setThinkingNpcId] = useState<string | null>(null);
  const [sendingNpcId, setSendingNpcId] = useState<string | null>(null);
  const stateVersionRef = useRef(0);
  const thinkingNpcIdRef = useRef<string | null>(null);
  thinkingNpcIdRef.current = thinkingNpcId;

  const clearSendingState = useCallback((npcId: string | null) => {
    if (!npcId) return;
    setSendingNpcId((prev) => (prev === npcId ? null : prev));
    setThinkingNpcId((prev) => (prev === npcId ? null : prev));
    if (sendingNpcIdRef.current === npcId) {
      sendingNpcIdRef.current = null;
    }
  }, []);

  const releaseNpcBusy = useCallback((npcId: string) => {
    setSpeakBusyNpcId((prev) => (prev === npcId ? null : prev));
  }, []);

  const refetchState = useCallback(async () => {
    const res = await fetch(`${apiBase}/rooms/${mapRoomId}/state`, {
      headers: playerApiHeaders(),
    });
    if (!res.ok) return;
    const body = await res.json();
    setRoomState(body.state);
    setMemoryCounts(body.memoryCounts ?? {});
  }, [mapRoomId]);

  useEffect(() => {
    const room = colyseusRoom;
    if (!room) return;

    const matchesJob = (eventJobId: unknown) => {
      const pending = pendingJobIdRef.current;
      if (!pending) return false;
      return typeof eventJobId === "string" && eventJobId === pending;
    };

    const onSpeakAck = (data: { jobId?: string }) => {
      if (typeof data?.jobId !== "string") return;
      const npcId = sendingNpcIdRef.current;
      pendingJobIdRef.current = data.jobId;
      setJobId(data.jobId);
      setSendingNpcId(null);
      sendingNpcIdRef.current = null;
      setSpeakBusyNpcId(null);
      if (npcId) {
        setThinkingNpcId(npcId);
        setStatus("thinking");
      }
    };
    const onThinking = (data: { jobId?: string }) => {
      if (!pendingJobIdRef.current) return;
      if (typeof data.jobId === "string" && data.jobId !== pendingJobIdRef.current) return;
      setStatus("thinking");
    };
    const onDone = (data: {
      jobId?: string;
      reply?: string;
      npcName?: string;
      npcId?: string;
      state?: RoomStateShape;
    }) => {
      if (!matchesJob(data?.jobId)) return;
      const replyNpcId =
        typeof data.npcId === "string" ? data.npcId : activeNpcIdRef.current;
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "npc",
          text: sanitizeNpcReplyText(data.reply ?? ""),
          npcId: replyNpcId,
          npcName: typeof data.npcName === "string" ? data.npcName : undefined,
        },
      ]);
      if (data.state) setRoomState(data.state);
      setStatus("idle");
      setThinkingNpcId(null);
      setSpeakBusyNpcId(null);
      setSendingNpcId(null);
      sendingNpcIdRef.current = null;
      pendingJobIdRef.current = null;
      void refetchState();
    };
    const onError = (data: { jobId?: string; message?: string }) => {
      if (data?.jobId && !matchesJob(data.jobId)) return;
      setError(data.message ?? "NPC 回合出错");
      setStatus("error");
      const npcId = sendingNpcIdRef.current ?? thinkingNpcIdRef.current;
      clearSendingState(npcId);
      pendingJobIdRef.current = null;
    };
    const onSpeakBusy = (data: ColyseusSpeakBusyPayload) => {
      const busyNpc = typeof data.npcId === "string" ? data.npcId : sendingNpcIdRef.current;
      if (busyNpc) {
        clearSendingState(busyNpc);
        setSpeakBusyNpcId(busyNpc);
      }
      setStatus("idle");
      pendingJobIdRef.current = null;
      setJobId(null);
    };
    const onSpeakIdle = (data: ColyseusSpeakIdlePayload) => {
      if (typeof data.npcId === "string") {
        releaseNpcBusy(data.npcId);
      }
    };
    const onPatch = (data: StatePatchPayload & { jobId?: string }) => {
      const version = data.stateVersion;
      if (typeof version === "number" && version > stateVersionRef.current) {
        stateVersionRef.current = version;
        setRoomState((prev) => {
          if (!prev) return prev;
          return applyStatePatch(prev, data.delta);
        });
      }
      if (typeof data.npcId === "string") {
        releaseNpcBusy(data.npcId);
      }
    };

    const offSpeakAck = room.onMessage("speakAck", onSpeakAck);
    const offThinking = room.onMessage(COLYSEUS_SERVER_MESSAGES.thinking, onThinking);
    const offDone = room.onMessage(COLYSEUS_SERVER_MESSAGES.done, onDone);
    const offError = room.onMessage(COLYSEUS_SERVER_MESSAGES.error, onError);
    const offSpeakBusy = room.onMessage(COLYSEUS_SERVER_MESSAGES.speakBusy, onSpeakBusy);
    const offSpeakIdle = room.onMessage(COLYSEUS_SERVER_MESSAGES.speakIdle, onSpeakIdle);
    const offPatch = room.onMessage(COLYSEUS_SERVER_MESSAGES.patch, onPatch);

    return () => {
      offSpeakAck();
      offThinking();
      offDone();
      offError();
      offSpeakBusy();
      offSpeakIdle();
      offPatch();
    };
  }, [colyseusRoom, refetchState, clearSendingState, releaseNpcBusy]);

  const resetGame = useCallback(async (): Promise<RoomState | null> => {
    const res = await fetch(`${apiBase}/rooms/${mapRoomId}/reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...playerApiHeaders(),
      },
    });
    if (!res.ok) {
      setError("重置房间失败");
      setStatus("error");
      return null;
    }
    const body = await res.json();
    setMessages([]);
    setRoomState(body.state);
    setMemoryCounts(body.memoryCounts ?? {});
    setActiveNpcId(DEFAULT_NPC_ID);
    setStatus("idle");
    setError(null);
    setJobId(null);
    setSpeakBusyNpcId(null);
    setThinkingNpcId(null);
    setSendingNpcId(null);
    sendingNpcIdRef.current = null;
    pendingJobIdRef.current = null;
    stateVersionRef.current = 0;
    setLastParsedIntent(null);
    setParseError(null);
    return body.state as RoomState;
  }, [mapRoomId]);

  const sendMessage = useCallback(
    async (text: string, npcId: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (speakBusyNpcId === npcId) return;
      if (sendingNpcId === npcId) return;
      if (status === "thinking" && thinkingNpcId === npcId) return;
      const room = colyseusRoom;
      if (!room) {
        setError("未连接游戏房间");
        setStatus("error");
        return;
      }

      setError(null);
      setParseError(null);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "player", text: trimmed },
      ]);
      setSendingNpcId(npcId);
      sendingNpcIdRef.current = npcId;
      pendingJobIdRef.current = null;
      setJobId(null);

      try {
        const parseRes = await fetch(`${chatBase}/rooms/${mapRoomId}/nl/parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, npcId }),
        });
        const parseBody = await parseRes.json().catch(() => ({}));
        if (parseRes.ok) {
          setLastParsedIntent(
            parseBody.parsedIntent && typeof parseBody.parsedIntent === "object"
              ? (parseBody.parsedIntent as ParsedIntent)
              : null,
          );
          setParseError(typeof parseBody.parseError === "string" ? parseBody.parseError : null);
        }

        room.send(COLYSEUS_CLIENT_MESSAGES.speak, {
          text: trimmed,
          npcId,
          playerId: getOrCreatePlayerId(),
        });
      } catch {
        setError("无法联系 AI 网关或游戏服务器");
        setStatus("error");
        clearSendingState(npcId);
        pendingJobIdRef.current = null;
      }
    },
    [status, speakBusyNpcId, sendingNpcId, thinkingNpcId, colyseusRoom, mapRoomId, clearSendingState],
  );

  return {
    messages,
    status,
    roomState,
    memoryCounts,
    activeNpcId,
    setActiveNpcId,
    jobId,
    error,
    lastParsedIntent,
    parseError,
    thinkingNpcId,
    speakQueueBusy: speakBusyNpcId === activeNpcId,
    composerBusyForActiveNpc:
      sendingNpcId === activeNpcId ||
      (status === "thinking" && thinkingNpcId === activeNpcId) ||
      speakBusyNpcId === activeNpcId,
    sendMessage,
    resetGame,
    refetchState,
  };
}
