import { collectiveFeedbackMessage } from "../lib/collectiveInitiator.js";

type Props = {
  kind: "rude" | "help";
};

export function CollectiveFeedbackBanner({ kind }: Props) {
  const message = collectiveFeedbackMessage(kind);
  if (!message) return null;

  return (
    <p
      className="collective-feedback-banner"
      data-testid="collective-feedback-banner"
      role="status"
    >
      {message}
    </p>
  );
}
