type Props = {
  proposalTitle: string;
  onOpenCouncil: () => void;
};

function truncateTitle(title: string, maxLen = 24): string {
  const trimmed = title.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

export function CouncilDeliberationChip({ proposalTitle, onOpenCouncil }: Props) {
  return (
    <button
      type="button"
      className="council-deliberation-chip"
      data-testid="council-deliberation-chip"
      aria-label={`议会审议中：${proposalTitle}`}
      onClick={onOpenCouncil}
    >
      <span className="council-deliberation-chip__label">议会审议中</span>
      {proposalTitle ? (
        <span className="council-deliberation-chip__title">{truncateTitle(proposalTitle)}</span>
      ) : null}
    </button>
  );
}
