import { useCallback, useEffect, useRef, useState } from "react";
import type { LoreDiscoverToast as LoreDiscoverToastPayload } from "../hooks/useChunkLore.js";

export const LORE_DISCOVER_TOAST_MS = 8000;

type Props = {
  toast: LoreDiscoverToastPayload | null;
  onDismiss: () => void;
};

function toastKey(toast: LoreDiscoverToastPayload): string {
  return `${toast.cx},${toast.cy}:${toast.storyHook}`;
}

export function LoreDiscoverToast({ toast, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

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

  return (
    <div
      className="lore-discover-toast"
      data-testid="lore-discover-toast"
      role="status"
      aria-label="发现新地点，点击关闭"
      onClick={dismissNow}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          dismissNow();
        }
      }}
      tabIndex={0}
    >
      <p className="lore-discover-toast__title">发现新土地</p>
      <p className="lore-discover-toast__body">{toast.storyHook}</p>
    </div>
  );
}
