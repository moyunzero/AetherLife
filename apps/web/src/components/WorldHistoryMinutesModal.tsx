import type { WorldHistoryPublicEntry } from "@aetherlife/shared";

type Props = {
  entry: WorldHistoryPublicEntry;
  onClose: () => void;
};

function voteLabel(vote: "yes" | "no"): string {
  return vote === "yes" ? "赞成" : "反对";
}

export function WorldHistoryMinutesModal({ entry, onClose }: Props) {
  const { minutes } = entry;
  const isGenesis = minutes.kind === "genesis_signatories";

  return (
    <div
      className="world-history-minutes-backdrop"
      role="presentation"
      data-testid="world-history-minutes-backdrop"
      onClick={onClose}
    >
      <div
        className="world-history-minutes-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="world-history-minutes-title"
        data-testid="world-history-minutes-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="world-history-minutes-modal__header">
          <h2
            id="world-history-minutes-title"
            className="world-history-minutes-modal__title"
            data-testid="world-history-minutes-title"
          >
            {isGenesis ? "太乙志 · 史前纪" : "廷议实录"}
          </h2>
          <button
            type="button"
            className="world-history-minutes-modal__close"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="world-history-minutes-modal__body">
          <section className="world-history-minutes-modal__proposal">
            <p className="world-history-minutes-modal__proposal-text">
              {minutes.proposalFull}
            </p>
          </section>

          {isGenesis ? (
            <section
              className="world-history-minutes-modal__signatories"
              data-testid="world-history-minutes-signatories"
            >
              <h3 className="world-history-minutes-modal__section-title">署名人录</h3>
              <ul className="world-history-minutes-modal__grid">
                {minutes.signatories.map((sig) => (
                  <li
                    key={sig.npcId}
                    className="world-history-minutes-modal__card"
                    data-testid="world-history-signatory-card"
                  >
                    <p className="world-history-minutes-modal__card-name">{sig.displayName}</p>
                    <p className="world-history-minutes-modal__card-faction">{sig.faction}</p>
                    {sig.stanceManifestoShort ? (
                      <p className="world-history-minutes-modal__card-stance">
                        {sig.stanceManifestoShort}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p
                className="world-history-minutes-modal__footnote"
                data-testid="world-history-minutes-footnote"
              >
                {minutes.footnote}
              </p>
            </section>
          ) : (
            <section
              className="world-history-minutes-modal__ballots"
              data-testid="world-history-minutes-ballots"
            >
              <h3 className="world-history-minutes-modal__section-title">票决记录</h3>
              <ul className="world-history-minutes-modal__grid">
                {minutes.ballots.map((ballot) => (
                  <li
                    key={ballot.npcId}
                    className="world-history-minutes-modal__card"
                    data-testid="world-history-ballot-card"
                  >
                    <p className="world-history-minutes-modal__card-name">{ballot.displayName}</p>
                    <p
                      className={`world-history-minutes-modal__vote world-history-minutes-modal__vote--${ballot.vote}`}
                    >
                      {voteLabel(ballot.vote)}
                    </p>
                    <p className="world-history-minutes-modal__card-reason">{ballot.reasonZh}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
