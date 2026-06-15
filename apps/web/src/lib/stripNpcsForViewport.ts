export type NpcChip = { id: string; name: string };

/** Viewport-filtered NPC chips when Phaser is active; full list in grid fallback mode. */
export function stripNpcsForViewport(
  npcs: readonly NpcChip[],
  phaserOk: boolean,
  viewportVisibleNpcIds: readonly string[],
): NpcChip[] {
  if (!phaserOk) return [...npcs];
  const visible = new Set(viewportVisibleNpcIds);
  return npcs.filter((npc) => visible.has(npc.id));
}
