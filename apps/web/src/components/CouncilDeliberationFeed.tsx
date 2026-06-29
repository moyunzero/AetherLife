import type { CouncilDeliberationFeedRow } from "@aetherlife/shared";

type Props = {
  rows: CouncilDeliberationFeedRow[];
};

function truncateQuote(text: string, maxLen = 80): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

function FeedRow({ row }: { row: CouncilDeliberationFeedRow }) {
  if (row.kind === "vote") {
    const voteClass =
      row.vote === "yes"
        ? "council-deliberation-feed__row--vote-yes"
        : "council-deliberation-feed__row--vote-no";
    return (
      <li
        className={`council-deliberation-feed__row council-deliberation-feed__row--vote ${voteClass}`}
      >
        <span className="council-deliberation-feed__speaker">{row.displayName}</span>
        <span className="council-deliberation-feed__vote">
          {row.vote === "yes" ? "赞成" : "反对"}
        </span>
        {row.reasonZh ? (
          <p className="council-deliberation-feed__reason">{row.reasonZh}</p>
        ) : null}
      </li>
    );
  }

  const isTraveler = row.travelerRef === true;
  return (
    <li
      className={`council-deliberation-feed__row council-deliberation-feed__row--quote${
        isTraveler ? " council-deliberation-feed__row--traveler" : ""
      }`}
    >
      <span className="council-deliberation-feed__speaker">{row.displayName}</span>
      {isTraveler ? (
        <span className="council-deliberation-feed__traveler-prefix">据近期旅者言行…</span>
      ) : null}
      <p className="council-deliberation-feed__quote">{truncateQuote(row.text)}</p>
    </li>
  );
}

export function CouncilDeliberationFeed({ rows }: Props) {
  return (
    <ul className="council-deliberation-feed" data-testid="council-deliberation-feed">
      {rows.map((row, index) => (
        <FeedRow key={`${row.kind}-${row.npcId}-${index}`} row={row} />
      ))}
    </ul>
  );
}
