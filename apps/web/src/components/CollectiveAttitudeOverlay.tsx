import { bandLabelZh, type AttitudeBand } from "@aetherlife/shared";
import type { CollectiveAttitudeSnapshot } from "../hooks/useCollectiveAttitude.js";

type Props = {
  snapshot: CollectiveAttitudeSnapshot | null;
  npcName: string;
  showDebug?: boolean;
};

export function CollectiveAttitudeOverlay({ snapshot, npcName, showDebug }: Props) {
  if (!snapshot) return null;

  const bandLabel = bandLabelZh(snapshot.band as AttitudeBand);
  const last = snapshot.recentEvents[0];
  const lastLine = last
    ? `${last.kind} · ${last.summary.slice(0, 40)}`
    : "—";
  const llmRudeHint =
    showDebug && last?.source === "worker" && last.kind === "rude"
      ? `rep ${last.deltaScore >= 0 ? "+" : ""}${last.deltaScore} · llm`
      : null;

  return (
    <div className="collective-attitude-overlay" data-testid="collective-attitude-overlay">
      <div>
        {npcName} 态度 {bandLabel}
      </div>
      <div>
        eff {snapshot.effectiveScore} · rep {snapshot.playerReputation}
      </div>
      <div>{lastLine}</div>
      {llmRudeHint ? <div className="collective-attitude-debug">{llmRudeHint}</div> : null}
    </div>
  );
}
