import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CouncilDeliberationFeedRow,
  type CouncilDeliberationPhase,
  type CouncilDeliberationPublicState,
  type CouncilDeliberationVoteKind,
  type LinkedEdge,
  safeParseCouncilDeliberationSyncPayload,
} from "@aetherlife/shared";

export type CouncilVoteToast =
  | { kind: "deliberation_start"; proposalTitle: string }
  | {
      kind: "vote_accepted";
      title: string;
      yesCount: number;
      noCount: number;
      resultEntryId: string;
    }
  | { kind: "vote_rejected"; title: string; resultEntryId: string }
  | {
      kind: "vote_epoch";
      title: string;
      yesCount: number;
      noCount: number;
      resultEntryId: string;
    };

export type PendingUiEvent =
  | { type: "append_feed"; rows: CouncilDeliberationFeedRow[] }
  | { type: "toast"; toast: CouncilVoteToast };

export type DeliberationCoreState = {
  active: boolean;
  voteKind: CouncilDeliberationVoteKind;
  phase: CouncilDeliberationPhase;
  round: number;
  roundTotal: number;
  proposalTitle: string;
  feedRows: CouncilDeliberationFeedRow[];
  linkedEdges: LinkedEdge[];
};

export const IDLE_CORE: DeliberationCoreState = {
  active: false,
  voteKind: "regular",
  phase: "proposal",
  round: 0,
  roundTotal: 1,
  proposalTitle: "",
  feedRows: [],
  linkedEdges: [],
};

export function buildResultToast(
  payload: Pick<
    CouncilDeliberationPublicState,
    "voteKind" | "status" | "proposalTitle" | "yesCount" | "noCount" | "resultEntryId"
  >,
): CouncilVoteToast | null {
  const entryId = payload.resultEntryId;
  const title = payload.proposalTitle ?? "";
  if (!entryId || !title) return null;
  const yes = payload.yesCount ?? 0;
  const no = payload.noCount ?? 0;
  if (payload.status === "accepted") {
    if (payload.voteKind === "epoch") {
      return {
        kind: "vote_epoch",
        title,
        yesCount: yes,
        noCount: no,
        resultEntryId: entryId,
      };
    }
    return {
      kind: "vote_accepted",
      title,
      yesCount: yes,
      noCount: no,
      resultEntryId: entryId,
    };
  }
  if (payload.status === "rejected") {
    return { kind: "vote_rejected", title, resultEntryId: entryId };
  }
  return null;
}

export function reduceDeliberationSync(
  prev: DeliberationCoreState,
  payload: CouncilDeliberationPublicState,
  opts: { speakBusy: boolean; startToast?: CouncilVoteToast | null },
): {
  core: DeliberationCoreState;
  deferred: PendingUiEvent[];
  immediateToasts: CouncilVoteToast[];
  deliberationJustStarted: boolean;
} {
  const deferred: PendingUiEvent[] = [];
  const immediateToasts: CouncilVoteToast[] = [];
  const deliberationJustStarted = payload.active && !prev.active;

  let feedRows = prev.feedRows;
  if (payload.clearFeed || payload.phase === "sealed") {
    feedRows = [];
  }

  let linkedEdges = prev.linkedEdges;
  if (deliberationJustStarted) {
    linkedEdges = payload.linkedEdges ?? [];
  } else if (payload.linkedEdges !== undefined) {
    linkedEdges = payload.linkedEdges;
  }

  const core: DeliberationCoreState = {
    active: payload.phase === "sealed" ? false : payload.active,
    voteKind: payload.voteKind,
    phase: payload.phase,
    round: payload.round,
    roundTotal: payload.roundTotal,
    proposalTitle: payload.proposalTitle ?? prev.proposalTitle,
    feedRows,
    linkedEdges,
  };

  if (opts.startToast) {
    if (opts.speakBusy) {
      deferred.push({ type: "toast", toast: opts.startToast });
    } else {
      immediateToasts.push(opts.startToast);
    }
  }

  const delta = payload.feedDelta ?? [];
  if (delta.length > 0) {
    if (opts.speakBusy) {
      deferred.push({ type: "append_feed", rows: delta });
    } else {
      core.feedRows = [...feedRows, ...delta];
    }
  }

  if (payload.phase === "sealed") {
    const resultToast = buildResultToast(payload);
    if (resultToast) {
      if (opts.speakBusy) {
        deferred.push({ type: "toast", toast: resultToast });
      } else {
        immediateToasts.push(resultToast);
      }
    }
  }

  return { core, deferred, immediateToasts, deliberationJustStarted };
}

export function applyPendingUiEvents(
  core: DeliberationCoreState,
  events: PendingUiEvent[],
): { core: DeliberationCoreState; toasts: CouncilVoteToast[] } {
  let next = core;
  const toasts: CouncilVoteToast[] = [];
  for (const event of events) {
    if (event.type === "append_feed") {
      next = {
        ...next,
        feedRows: [...next.feedRows, ...event.rows],
      };
    } else {
      toasts.push(event.toast);
    }
  }
  return { core: next, toasts };
}

export function useCouncilDeliberation(speakBusy = false) {
  const [core, setCore] = useState<DeliberationCoreState>(IDLE_CORE);
  const [toastQueue, setToastQueue] = useState<CouncilVoteToast[]>([]);
  const [chronicleUnread, setChronicleUnread] = useState(false);
  const speakBusyRef = useRef(speakBusy);
  const prevSpeakBusyRef = useRef(speakBusy);
  const pendingRef = useRef<PendingUiEvent[]>([]);
  const startToastSentRef = useRef(false);
  speakBusyRef.current = speakBusy;

  const mergeCouncilDeliberationSync = useCallback((raw: unknown) => {
    const parsed = safeParseCouncilDeliberationSyncPayload(raw);
    if (!parsed.success) return;

    const payload = parsed.data;

    setCore((prev) => {
      const justStarted = payload.active && !prev.active;
      if (!payload.active) {
        startToastSentRef.current = false;
      }

      let startToastForReduce: CouncilVoteToast | null = null;
      if (
        payload.active &&
        payload.proposalTitle &&
        (justStarted || (!prev.proposalTitle && payload.proposalTitle)) &&
        !startToastSentRef.current
      ) {
        startToastSentRef.current = true;
        startToastForReduce = {
          kind: "deliberation_start",
          proposalTitle: payload.proposalTitle,
        };
      }

      const { core: nextCore, deferred, immediateToasts } = reduceDeliberationSync(
        prev,
        payload,
        {
          speakBusy: speakBusyRef.current,
          startToast: startToastForReduce,
        },
      );
      if (deferred.length > 0) {
        pendingRef.current = [...pendingRef.current, ...deferred];
      }
      if (immediateToasts.length > 0) {
        setToastQueue((q) => [...q, ...immediateToasts]);
      }
      return nextCore;
    });
  }, []);

  useEffect(() => {
    const prevBusy = prevSpeakBusyRef.current;
    prevSpeakBusyRef.current = speakBusy;
    if (prevBusy && !speakBusy) {
      const pending = pendingRef.current;
      if (pending.length > 0) {
        pendingRef.current = [];
        setCore((prev) => {
          const { core: flushed, toasts } = applyPendingUiEvents(prev, pending);
          if (toasts.length > 0) {
            setToastQueue((q) => [...q, ...toasts]);
          }
          return flushed;
        });
      }
    }
  }, [speakBusy]);

  const markChronicleVoteEntry = useCallback(() => {
    setChronicleUnread(true);
  }, []);

  const clearChronicleUnread = useCallback(() => {
    setChronicleUnread(false);
  }, []);

  const consumeVoteToast = useCallback((): CouncilVoteToast | null => {
    let picked: CouncilVoteToast | null = null;
    setToastQueue((q) => {
      if (q.length === 0) return q;
      picked = q[0]!;
      return q.slice(1);
    });
    return picked;
  }, []);

  const resetDeliberation = useCallback(() => {
    setCore(IDLE_CORE);
    setToastQueue([]);
    pendingRef.current = [];
    setChronicleUnread(false);
  }, []);

  return {
    active: core.active,
    voteKind: core.voteKind,
    phase: core.phase,
    round: core.round,
    roundTotal: core.roundTotal,
    proposalTitle: core.proposalTitle,
    feedRows: core.feedRows,
    linkedEdges: core.linkedEdges,
    toastQueue,
    chronicleUnread,
    mergeCouncilDeliberationSync,
    markChronicleVoteEntry,
    clearChronicleUnread,
    consumeVoteToast,
    resetDeliberation,
  };
}
