import { useCallback, useState } from "react";

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

export type RoomStateShape = {
  npcs?: RoomNpc[];
};

export type ParsedIntent = Record<string, unknown> | null;

const apiBase = import.meta.env.VITE_GAME_SERVER_URL || "/api";
const chatBase = import.meta.env.VITE_AI_GATEWAY_URL || "/v1";
const roomId = "default";
const DEFAULT_NPC_ID = "npc-1";

export function useNpcChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [roomState, setRoomState] = useState<RoomStateShape | null>(null);
  const [memoryCounts, setMemoryCounts] = useState<Record<string, number>>({});
  const [activeNpcId, setActiveNpcId] = useState(DEFAULT_NPC_ID);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastParsedIntent, setLastParsedIntent] = useState<ParsedIntent>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const refetchState = useCallback(async () => {
    const res = await fetch(`${apiBase}/rooms/${roomId}/state`);
    if (!res.ok) return;
    const body = await res.json();
    setRoomState(body.state);
    setMemoryCounts(body.memoryCounts ?? {});
  }, []);

  const resetGame = useCallback(async () => {
    const confirmed = window.confirm("开始新游戏？当前对话将被清空。");
    if (!confirmed) return;

    const res = await fetch(`${apiBase}/rooms/${roomId}/reset`, { method: "POST" });
    if (!res.ok) {
      setError("重置房间失败");
      setStatus("error");
      return;
    }
    const body = await res.json();
    setMessages([]);
    setRoomState(body.state);
    setMemoryCounts(body.memoryCounts ?? {});
    setActiveNpcId(DEFAULT_NPC_ID);
    setStatus("idle");
    setError(null);
    setJobId(null);
    setLastParsedIntent(null);
    setParseError(null);
  }, []);

  const sendMessage = useCallback(
    async (text: string, npcId: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === "thinking") return;

      setError(null);
      setParseError(null);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "player", text: trimmed },
      ]);
      setStatus("thinking");

      try {
        const res = await fetch(`${chatBase}/rooms/${roomId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, npcId }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (body?.code === "content_blocked") {
            setError(body.error ?? "无法处理该内容");
            setStatus("error");
            return;
          }
          throw new Error(body?.error ?? "发送失败");
        }

        setLastParsedIntent(
          body.parsedIntent && typeof body.parsedIntent === "object"
            ? (body.parsedIntent as ParsedIntent)
            : null,
        );
        setParseError(typeof body.parseError === "string" ? body.parseError : null);

        const id = body.jobId as string;
        if (!id) throw new Error("missing jobId");
        setJobId(id);

        await new Promise<void>((resolve, reject) => {
          const es = new EventSource(
            `${apiBase}/rooms/${roomId}/events?jobId=${encodeURIComponent(id)}`,
          );

          es.addEventListener("thinking", () => {
            setStatus("thinking");
          });

          es.addEventListener("done", (ev) => {
            try {
              const data = JSON.parse((ev as MessageEvent).data);
              const npcName = typeof data.npcName === "string" ? data.npcName : "";
              const replyNpcId = typeof data.npcId === "string" ? data.npcId : npcId;
              setMessages((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: "npc",
                  text: data.reply ?? "",
                  npcId: replyNpcId,
                  npcName: npcName || undefined,
                },
              ]);
              if (data.state) setRoomState(data.state);
              setStatus("idle");
              void refetchState();
            } catch {
              setError("解析 NPC 回复失败");
              setStatus("error");
            } finally {
              es.close();
              resolve();
            }
          });

          es.addEventListener("error", (ev) => {
            try {
              const data = JSON.parse((ev as MessageEvent).data);
              setError(data.message ?? "NPC 回合出错");
            } catch {
              if (es.readyState === EventSource.CLOSED) return;
              setError("连接中断");
            }
            setStatus("error");
            es.close();
            reject(new Error("sse error"));
          });
        });
      } catch {
        setError((prev) => prev ?? "无法联系 AI 网关");
        setStatus("error");
      }
    },
    [status, refetchState],
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
    sendMessage,
    resetGame,
    refetchState,
  };
}
