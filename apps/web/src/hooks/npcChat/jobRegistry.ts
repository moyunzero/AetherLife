/** Maps npcId ↔ jobId so parallel speaks (A thinking, tab B) each accept their own events. */
export type NpcJobRegistry = {
  byNpc: Map<string, string>;
  byJob: Map<string, string>;
};

export function createNpcJobRegistry(): NpcJobRegistry {
  return { byNpc: new Map(), byJob: new Map() };
}

export function registerNpcJob(registry: NpcJobRegistry, npcId: string, jobId: string): void {
  const prevJob = registry.byNpc.get(npcId);
  if (prevJob) registry.byJob.delete(prevJob);
  registry.byNpc.set(npcId, jobId);
  registry.byJob.set(jobId, npcId);
}

export function clearNpcJob(registry: NpcJobRegistry, jobId: string): string | undefined {
  const npcId = registry.byJob.get(jobId);
  if (npcId !== undefined && registry.byNpc.get(npcId) === jobId) {
    registry.byNpc.delete(npcId);
  }
  registry.byJob.delete(jobId);
  return npcId;
}

export function resolveNpcForJob(
  registry: NpcJobRegistry,
  jobId: string | undefined,
): string | undefined {
  if (typeof jobId !== "string") return undefined;
  return registry.byJob.get(jobId);
}

export function isTrackedSpeakJob(registry: NpcJobRegistry, jobId: string | undefined): boolean {
  return typeof jobId === "string" && registry.byJob.has(jobId);
}

export function pendingJobNpcIds(registry: NpcJobRegistry): Set<string> {
  return new Set(registry.byNpc.keys());
}

export function collectThinkingNpcIds(
  registry: NpcJobRegistry,
  sendingNpcId: string | null,
): string[] {
  const ids = new Set(registry.byNpc.keys());
  if (sendingNpcId) ids.add(sendingNpcId);
  return [...ids];
}

export function registryToRecord(registry: NpcJobRegistry): Record<string, string> {
  const rec: Record<string, string> = {};
  for (const [npcId, jobId] of registry.byNpc) rec[npcId] = jobId;
  return rec;
}

export function isNpcSpeakInFlight(params: {
  npcId: string;
  speakBusyNpcId: string | null;
  sendingNpcId: string | null;
  pendingJobNpcIds?: Iterable<string>;
  /** @deprecated use pendingJobNpcIds — kept for tests */
  thinkingNpcId?: string | null;
}): boolean {
  const { npcId, speakBusyNpcId, sendingNpcId, pendingJobNpcIds, thinkingNpcId } = params;
  if (speakBusyNpcId === npcId || sendingNpcId === npcId) return true;
  if (thinkingNpcId === npcId) return true;
  if (pendingJobNpcIds) {
    for (const id of pendingJobNpcIds) {
      if (id === npcId) return true;
    }
  }
  return false;
}

/** Sync in-flight refs before queueMicrotask drain — setState lags; refs still block drain. */
export function clearInFlightRefsForDrain(
  refs: {
    thinkingNpcId: { current: string | null };
    speakBusyNpcId: { current: string | null };
    sendingNpcId: { current: string | null };
  },
  npcId: string,
): void {
  if (refs.thinkingNpcId.current === npcId) refs.thinkingNpcId.current = null;
  if (refs.speakBusyNpcId.current === npcId) refs.speakBusyNpcId.current = null;
  if (refs.sendingNpcId.current === npcId) refs.sendingNpcId.current = null;
}
