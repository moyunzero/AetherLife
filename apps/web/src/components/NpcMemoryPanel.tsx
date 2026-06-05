import { useEffect, useState } from "react";
import { playerApiHeaders } from "../lib/playerSession.js";

type MemoryDebug = {
  memoryCount: number;
  latestBulkSummary: string | null;
  latestReflection: string | null;
};

type ParsedIntent = Record<string, unknown> | null;

type Props = {
  roomId: string;
  activeNpcId: string;
  activeNpcName: string;
  lastParsedIntent?: ParsedIntent;
  parseError?: string | null;
};

const apiBase = import.meta.env.VITE_GAME_SERVER_URL || "/api";

export function NpcMemoryPanel({
  roomId,
  activeNpcId,
  activeNpcName,
  lastParsedIntent = null,
  parseError = null,
}: Props) {
  const [debug, setDebug] = useState<MemoryDebug | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    void (async () => {
      try {
        const res = await fetch(`${apiBase}/rooms/${roomId}/npc-memory/${activeNpcId}`, {
          headers: playerApiHeaders(),
        });
        if (!res.ok) {
          throw new Error("加载记忆失败");
        }
        const body = (await res.json()) as MemoryDebug;
        if (!cancelled) setDebug(body);
      } catch {
        if (!cancelled) {
          setDebug(null);
          setError("无法加载 NPC 记忆");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomId, activeNpcId]);

  return (
    <details className="memory-panel">
      <summary>{activeNpcName} 记得关于你的事</summary>
      {error ? <p className="memory-panel__error">{error}</p> : null}
      {debug ? (
        <div className="memory-panel__body">
          <p className="memory-panel__count">未压缩记忆：{debug.memoryCount}</p>
          <p className="memory-panel__label">Bulk summary</p>
          <pre className="memory-panel__text">
            {debug.latestBulkSummary?.trim() || "(none)"}
          </pre>
          <p className="memory-panel__label">Reflection</p>
          <pre className="memory-panel__text">
            {debug.latestReflection?.trim() || "(none)"}
          </pre>
        </div>
      ) : null}
      <p className="memory-panel__label">NL parse (debug)</p>
      {parseError ? <p className="memory-panel__error">{parseError}</p> : null}
      <pre className="memory-panel__text">
        {lastParsedIntent ? JSON.stringify(lastParsedIntent, null, 2) : "(none)"}
      </pre>
    </details>
  );
}
