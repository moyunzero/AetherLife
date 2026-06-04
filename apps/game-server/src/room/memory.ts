export type MemoryEvent = {
  id: string;
  timestamp: string;
  text: string;
  importance?: number;
};

export function createMemoryEvent(text: string, importance?: number): MemoryEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    text,
    importance,
  };
}
