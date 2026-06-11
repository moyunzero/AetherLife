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

/** Enabled via build flag or `?speakLatencyTrace=1` for Playwright benchmarks. */
export function isSpeakLatencyTraceEnabled(): boolean {
  if (import.meta.env.VITE_SPEAK_LATENCY_TRACE === "1") return true;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("speakLatencyTrace") === "1";
}

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

export function resetSpeakLatencyMarks(): void {
  if (!isSpeakLatencyTraceEnabled()) return;
  window.__speakLatencyMarks = [];
  window.__speakLatencyT0 = undefined;
}
