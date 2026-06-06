let loreEnqueueCounter = 0;
let lorePostCounter = 0;

export function incrementLoreEnqueueCounter(): void {
  loreEnqueueCounter += 1;
}

export function incrementLorePostCounter(): void {
  lorePostCounter += 1;
}

export function getLoreMetrics(): { enqueues: number; posts: number } {
  return { enqueues: loreEnqueueCounter, posts: lorePostCounter };
}

/** Test helper */
export function resetLoreMetrics(): void {
  loreEnqueueCounter = 0;
  lorePostCounter = 0;
}
