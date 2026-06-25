import { useCallback, useEffect, useRef, useState } from "react";
import { LORE_DISCOVER_TOAST_MS } from "./LoreDiscoverToast.js";
import type { CouncilVoteToast as CouncilVoteToastPayload } from "../hooks/useCouncilDeliberation.js";

type Props = {
  toast: CouncilVoteToastPayload | null;
  onDismiss: () => void;
  onClick?: (toast: CouncilVoteToastPayload) => void;
};

function toastKey(toast: CouncilVoteToastPayload): string {
  if (toast.kind === "deliberation_start") {
    return `start:${toast.proposalTitle}`;
  }
  return `result:${toast.resultEntryId}:${toast.kind}`;
}

function toastModifier(toast: CouncilVoteToastPayload): string {
  if (toast.kind === "deliberation_start") return "";
  if (toast.kind === "vote_epoch") return " council-vote-toast--epoch";
  if (toast.kind === "vote_accepted") return " council-vote-toast--accepted";
  return " council-vote-toast--rejected";
}

export function councilVoteToastTitle(toast: CouncilVoteToastPayload): string {
  switch (toast.kind) {
    case "deliberation_start":
      return "议会开始审议";
    case "vote_accepted":
      return "廷议通过";
    case "vote_rejected":
      return "提案未采纳";
    case "vote_epoch":
      return "纪元大议落槌";
  }
}

export function councilVoteToastBody(toast: CouncilVoteToastPayload): string {
  switch (toast.kind) {
    case "deliberation_start":
      return toast.proposalTitle;
    case "vote_accepted":
      return `${toast.title} · ${toast.yesCount}–${toast.noCount}`;
    case "vote_rejected":
      return toast.title;
    case "vote_epoch":
      return `${toast.title} · ${toast.yesCount}–${toast.noCount}`;
  }
}

export function CouncilVoteToast({ toast, onDismiss, onClick }: Props) {
  const [visible, setVisible] = useState(false);
  const onDismissRef = useRef(onDismiss);
  const onClickRef = useRef(onClick);
  onDismissRef.current = onDismiss;
  onClickRef.current = onClick;

  const dismissNow = useCallback(() => {
    setVisible(false);
    onDismissRef.current();
  }, []);

  const toastIdentity = toast ? toastKey(toast) : null;

  useEffect(() => {
    if (!toastIdentity) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = window.setTimeout(dismissNow, LORE_DISCOVER_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toastIdentity, dismissNow]);

  if (!toast || !visible) return null;

  const handleActivate = () => {
    onClickRef.current?.(toast);
    dismissNow();
  };

  return (
    <div
      className={`lore-discover-toast council-vote-toast${toastModifier(toast)}`}
      data-testid="council-vote-toast"
      role="status"
      aria-label={`${councilVoteToastTitle(toast)}，点击查看`}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleActivate();
        }
      }}
      tabIndex={0}
    >
      <p className="lore-discover-toast__title council-vote-toast__title">
        {councilVoteToastTitle(toast)}
      </p>
      <p className="lore-discover-toast__body council-vote-toast__body">
        {councilVoteToastBody(toast)}
      </p>
    </div>
  );
}
