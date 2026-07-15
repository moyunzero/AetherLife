import { useCallback, useEffect, useRef, useState } from "react";
import type { DrawerTab } from "../components/DialogueBar.js";
import type { CollectiveEventSummary } from "./useCollectiveAttitude.js";
import {
  resolveCollectiveInitiatorPlayerId,
} from "../lib/collectiveInitiator.js";

export type UseShellDrawerStateOptions = {
  clearChronicleUnread: () => void;
  mapRoomId: string;
  activeNpcId: string;
  playerId: string;
  collectiveRecentEvents: CollectiveEventSummary[] | undefined;
};

/**
 * Shell drawer open/tab state + collective auto-open (rude event for initiator).
 * Biography stays a council sub-slot (CouncilBiographySlot) — no top-level tab here.
 */
export function useShellDrawerState({
  clearChronicleUnread,
  mapRoomId,
  activeNpcId,
  playerId,
  collectiveRecentEvents,
}: UseShellDrawerStateOptions) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("history");
  const pendingCollectiveAutoOpenRef = useRef(false);

  useEffect(() => {
    const event = collectiveRecentEvents?.[0];
    if (!event || event.kind !== "rude") return;
    if (resolveCollectiveInitiatorPlayerId(event) !== playerId) return;
    const key = `collective-auto-open:${mapRoomId}:${activeNpcId}`;
    if (sessionStorage.getItem(key)) return;
    pendingCollectiveAutoOpenRef.current = true;
    setDrawerTab("collective");
    setDrawerOpen(true);
  }, [collectiveRecentEvents, mapRoomId, activeNpcId, playerId]);

  // Defer sessionStorage until drawer stays open — Strict Mode remount clears the timer
  // before storage is set, so the second mount can still auto-open (dev + Playwright UAT).
  useEffect(() => {
    if (!pendingCollectiveAutoOpenRef.current) return;
    if (!drawerOpen || drawerTab !== "collective") return;
    const key = `collective-auto-open:${mapRoomId}:${activeNpcId}`;
    const t = window.setTimeout(() => {
      sessionStorage.setItem(key, "1");
      pendingCollectiveAutoOpenRef.current = false;
    }, 100);
    return () => window.clearTimeout(t);
  }, [drawerOpen, drawerTab, mapRoomId, activeNpcId]);

  const openDrawer = useCallback(
    (tab: DrawerTab) => {
      setDrawerTab(tab);
      setDrawerOpen(true);
      if (tab === "chronicle") {
        clearChronicleUnread();
      }
    },
    [clearChronicleUnread],
  );

  const handleDrawerTabChange = useCallback(
    (tab: DrawerTab) => {
      setDrawerTab(tab);
      if (tab === "chronicle") {
        clearChronicleUnread();
      }
    },
    [clearChronicleUnread],
  );

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const openChronicle = useCallback(() => {
    setDrawerTab("chronicle");
    setDrawerOpen(true);
  }, []);

  return {
    drawerOpen,
    drawerTab,
    openDrawer,
    handleDrawerTabChange,
    closeDrawer,
    openChronicle,
  };
}
