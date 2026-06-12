export type InternalLatencyLog = {
  route: string;
  ms: number;
  cacheHit?: boolean;
  skipNearbyLore?: boolean;
  skipEmbed?: boolean;
  roomId?: string;
};

/** Structured stderr log for internal speak hot-path routes. */
export function logInternalLatency(entry: InternalLatencyLog): void {
  const parts = [
    "internal-latency",
    `route=${entry.route}`,
    `ms=${entry.ms}`,
  ];
  if (entry.roomId) parts.push(`room=${entry.roomId}`);
  if (entry.cacheHit !== undefined) parts.push(`cacheHit=${entry.cacheHit ? 1 : 0}`);
  if (entry.skipNearbyLore !== undefined) parts.push(`skipNearbyLore=${entry.skipNearbyLore ? 1 : 0}`);
  if (entry.skipEmbed !== undefined) parts.push(`skipEmbed=${entry.skipEmbed ? 1 : 0}`);
  console.error(parts.join(" "));
}
