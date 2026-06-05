import type { SyncMetrics } from "../hooks/useColyseusRoom.js";

type Props = {
  metrics: SyncMetrics;
};

/** Dev-only sync diagnostics (Phase 8). */
export function SyncMetricsOverlay({ metrics }: Props) {
  return (
    <div className="sync-metrics-overlay" data-testid="sync-metrics-overlay" aria-hidden>
      <span>RTT {metrics.rttMs != null ? `${metrics.rttMs}ms` : "—"}</span>
      <span>校正 {metrics.corrections}</span>
    </div>
  );
}
