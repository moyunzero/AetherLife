/**
 * MP-MOV-02: local player must not snap to lagging Colyseus schema while predicting.
 * Used by Phaser RoomScene.syncEntities; unit-tested for verify:phase6:move-only gate.
 */
export type LocalSchemaSnapInput = {
  pendingMoves: number;
  isLocomoting: boolean;
  /** Local logic grid (sprite / motion bridge). */
  localX?: number;
  localY?: number;
  /** Colyseus schema cell — may lag behind acked position. */
  schemaX?: number;
  schemaY?: number;
};

export function shouldSuppressLocalSchemaSnap(input: LocalSchemaSnapInput): boolean {
  if (input.pendingMoves > 0 || input.isLocomoting) return true;
  if (
    input.localX !== undefined
    && input.localY !== undefined
    && input.schemaX !== undefined
    && input.schemaY !== undefined
    && (input.localX !== input.schemaX || input.localY !== input.schemaY)
  ) {
    return true;
  }
  return false;
}
