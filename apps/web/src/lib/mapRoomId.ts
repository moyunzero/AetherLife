/** Logical map room id from `?room=` query (Colyseus + HTTP room APIs). */
export function getMapRoomId(): string {
  if (typeof window === "undefined") return "default";
  const fromQuery = new URLSearchParams(window.location.search).get("room")?.trim();
  return fromQuery || "default";
}
