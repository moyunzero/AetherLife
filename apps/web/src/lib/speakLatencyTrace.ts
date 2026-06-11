declare global {
  interface Window {
    __speakLatencyMarks?: Array<{
      event: string;
      t: number;
      data?: Record<string, unknown>;
    }>;
    __speakLatencyT0?: number;
  }
}

/**
 * Determines whether speak latency tracing is enabled for Playwright benchmarks.
 *
 * Checks the build flag `VITE_SPEAK_LATENCY_TRACE` and the page query parameter
 * `?speakLatencyTrace=1`; returns `false` when run in a non-browser (SSR) environment.
 *
 * @returns `true` if tracing is enabled via the build flag or query parameter, `false` otherwise.
 */
export function isSpeakLatencyTraceEnabled(): boolean {
  if (import.meta.env.VITE_SPEAK_LATENCY_TRACE === "1") return true;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("speakLatencyTrace") === "1";
}

/**
 * Record a timestamped latency mark for the speak latency trace.
 *
 * When tracing is enabled, appends an object with the event name, a `performance.now()` timestamp, and optional metadata to `window.__speakLatencyMarks`. Does nothing when tracing is disabled.
 *
 * @param event - A short identifier for the latency event
 * @param data - Optional additional metadata to attach to the mark
 */
export function recordSpeakLatencyMark(
  event: string,
  data?: Record<string, unknown>,
): void {
  if (!isSpeakLatencyTraceEnabled()) return;
  const t = performance.now();
  if (window.__speakLatencyMarks === undefined) {
    window.__speakLatencyMarks = [];
  }
  window.__speakLatencyMarks.push({ event, t, data });
}

/**
 * Clear recorded speak latency marks and reset the baseline timestamp if speak latency tracing is enabled.
 *
 * When enabled, this sets `window.__speakLatencyMarks` to an empty array and `window.__speakLatencyT0` to `undefined`.
 */
export function resetSpeakLatencyMarks(): void {
  if (!isSpeakLatencyTraceEnabled()) return;
  window.__speakLatencyMarks = [];
  window.__speakLatencyT0 = undefined;
}
