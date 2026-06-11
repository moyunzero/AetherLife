type QueueEntry = {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  priority: number;
};

const MAX_CONCURRENT = 2;

let active = 0;
const queue: QueueEntry[] = [];

function drainQueue(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    queue.sort((a, b) => b.priority - a.priority);
    const next = queue.shift();
    if (!next) break;
    active += 1;
    void Promise.resolve()
      .then(() => next.run())
      .then(next.resolve, next.reject)
      .finally(() => {
        active -= 1;
        drainQueue();
      });
  }
}

function enqueue<T>(run: () => Promise<T>, priority: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({
      run: run as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
      priority,
    });
    drainQueue();
  });
}

/** Limit concurrent lore DB fetches (speak-adjacent). */
export function runWithLoreConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  return enqueue(fn, 0);
}

/** Limit concurrent embed HTTP; higher priority for speak hot path. */
export function runWithEmbedConcurrencyLimit<T>(
  fn: () => Promise<T>,
  options?: { priority?: boolean },
): Promise<T> {
  return enqueue(fn, options?.priority ? 1 : 0);
}

/** Test helper */
export function resetConcurrencyGateForTests(): void {
  queue.length = 0;
  active = 0;
}
