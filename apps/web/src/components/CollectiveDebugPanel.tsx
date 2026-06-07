import type { CollectiveAttitudeSnapshot } from "../hooks/useCollectiveAttitude.js";
import { bandLabelZh, type AttitudeBand } from "@aetherlife/shared";

type Props = {
  snapshot: CollectiveAttitudeSnapshot | null;
  activeNpcName: string;
  loading?: boolean;
};

export function CollectiveDebugPanel({ snapshot, activeNpcName, loading }: Props) {
  return (
    <details className="collective-debug-panel" data-testid="collective-debug-panel">
      <summary>集体记忆调试 · {activeNpcName}</summary>
      {loading ? (
        <p className="collective-debug-panel__body">加载中…</p>
      ) : snapshot ? (
        <div className="collective-debug-panel__body">
          <p>
            band={snapshot.band} ({bandLabelZh(snapshot.band as AttitudeBand)}) effectiveScore=
            {snapshot.effectiveScore} rep={snapshot.playerReputation} windowMean=
            {snapshot.collectiveWindowMean.toFixed(1)}
          </p>
          <pre className="collective-debug-panel__pre">
            {snapshot.recentEvents.length === 0
              ? "(no recent events)"
              : snapshot.recentEvents
                  .map(
                    (e) =>
                      `${e.kind} Δ${e.deltaScore} · ${e.summary} · ${e.createdAt}`,
                  )
                  .join("\n")}
          </pre>
        </div>
      ) : (
        <p className="collective-debug-panel__body">暂无集体记忆数据</p>
      )}
    </details>
  );
}
