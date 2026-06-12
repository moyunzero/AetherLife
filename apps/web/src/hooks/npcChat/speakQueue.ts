/** Per-NPC pending speak texts — server `speakBusy` retry only (Phase 12.2 FIFO). */
export type NpcSpeakQueue = Map<string, string[]>;

export function enqueueNpcSpeak(queues: NpcSpeakQueue, npcId: string, text: string): number {
  const q = queues.get(npcId) ?? [];
  q.push(text);
  queues.set(npcId, q);
  return q.length;
}

export function dequeueNpcSpeak(queues: NpcSpeakQueue, npcId: string): string | undefined {
  const q = queues.get(npcId);
  if (!q?.length) return undefined;
  const next = q.shift()!;
  if (q.length === 0) queues.delete(npcId);
  else queues.set(npcId, q);
  return next;
}

/** Drop queued speaks identical to a turn that just finished (duplicate speakBusy retry). */
export function discardQueuedSpeakMatching(
  queues: NpcSpeakQueue,
  npcId: string,
  text: string,
): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  const q = queues.get(npcId);
  if (!q?.length) return 0;
  const kept = q.filter((item) => item.trim() !== normalized);
  const removed = q.length - kept.length;
  if (kept.length === 0) queues.delete(npcId);
  else queues.set(npcId, kept);
  return removed;
}

export function npcSpeakQueueDepth(queues: NpcSpeakQueue, npcId: string): number {
  return queues.get(npcId)?.length ?? 0;
}
