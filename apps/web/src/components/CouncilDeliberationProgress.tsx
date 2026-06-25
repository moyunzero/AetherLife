import type { CouncilDeliberationPhase } from "@aetherlife/shared";

type Props = {
  round: number;
  roundTotal: number;
  phase: CouncilDeliberationPhase;
};

const PHASE_LABEL: Record<CouncilDeliberationPhase, string> = {
  proposal: "提案宣读",
  debate: "辩论",
  vote: "表决",
  sealed: "落槌",
};

export function CouncilDeliberationProgress({ round, roundTotal, phase }: Props) {
  const roundLabel =
    phase === "debate" || phase === "vote" || phase === "sealed"
      ? `第 ${round}/${roundTotal} 轮辩论`
      : null;

  return (
    <div className="council-deliberation-progress" data-testid="council-deliberation-progress">
      {roundLabel ? (
        <p className="council-deliberation-progress__round">{roundLabel}</p>
      ) : null}
      <p className="council-deliberation-progress__phase">{PHASE_LABEL[phase]}</p>
    </div>
  );
}
