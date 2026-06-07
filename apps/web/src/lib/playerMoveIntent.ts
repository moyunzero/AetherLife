/** Match worker `player_requests_move` — hostile gate UI fallback when done payload lacks gateRejected. */
export function playerRequestsMove(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return /移动|走到|走去|去\s*[\(（]?\s*\d+\s*[,，]\s*\d+|左侧|右侧|左边|右边|上方|下方|旁边|到我|来我|过来|\bmove\b|\bgo to\b/i.test(
    text,
  );
}
