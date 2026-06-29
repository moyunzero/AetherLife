import type { CouncilDeliberationVoteKind } from "@aetherlife/shared";

type Props = {
  voteKind: CouncilDeliberationVoteKind;
};

export function CouncilDeliberationBanner({ voteKind }: Props) {
  const isEpoch = voteKind === "epoch";
  return (
    <div
      className={`council-deliberation-banner${
        isEpoch
          ? " council-deliberation-banner--epoch"
          : " council-deliberation-banner--regular"
      }`}
      data-testid="council-deliberation-banner"
      role="status"
    >
      <p className="council-deliberation-banner__title">
        {isEpoch ? "纪元大议 · 廷议进行中" : "廷议进行中"}
      </p>
    </div>
  );
}
