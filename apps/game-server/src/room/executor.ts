import type { GameAction } from "@aetherlife/game-actions";
import { findNpc, type RoomState } from "@aetherlife/shared";

export class ExecutorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutorError";
  }
}

function resolveActingNpc(room: RoomState, actingNpcId: string) {
  const npc = findNpc(room, actingNpcId);
  if (!npc) {
    throw new ExecutorError(`unknown npc ${actingNpcId}`);
  }
  return npc;
}

export function applyGameAction(
  room: RoomState,
  action: GameAction,
  actingNpcId: string,
): { room: RoomState; events: string[] } {
  const next: RoomState = structuredClone(room);
  const acting = resolveActingNpc(next, actingNpcId);
  const events: string[] = [];

  switch (action.type) {
    case "move": {
      if (
        action.x < 0 ||
        action.y < 0 ||
        action.x >= next.width ||
        action.y >= next.height
      ) {
        throw new ExecutorError("move out of bounds");
      }
      acting.x = action.x;
      acting.y = action.y;
      events.push(`${acting.id} moved to (${action.x}, ${action.y})`);
      break;
    }
    case "interact": {
      const obj = next.objects.find((o) => o.id === action.objectId);
      if (!obj) {
        throw new ExecutorError(`unknown object ${action.objectId}`);
      }
      if (obj.kind === "door") {
        obj.state = obj.state === "open" ? "closed" : "open";
        events.push(`door ${obj.id} is now ${obj.state}`);
      } else if (obj.kind === "pickup" && !acting.inventory.includes(obj.id)) {
        acting.inventory.push(obj.id);
        events.push(`${acting.id} picked up ${obj.id}`);
      } else {
        events.push(`${acting.id} interacted with ${obj.id}`);
      }
      break;
    }
    case "speak": {
      events.push(`${acting.id} spoke to ${action.targetId}: ${action.content.slice(0, 80)}`);
      break;
    }
    case "wait": {
      events.push(`${acting.id} waited ${action.durationMs}ms`);
      break;
    }
    case "transfer": {
      if (action.toNpcId === actingNpcId) {
        throw new ExecutorError("cannot transfer item to self");
      }
      const target = findNpc(next, action.toNpcId);
      if (!target) {
        throw new ExecutorError(`unknown target npc ${action.toNpcId}`);
      }
      const itemIndex = acting.inventory.indexOf(action.itemId);
      if (itemIndex === -1) {
        throw new ExecutorError(`item ${action.itemId} not in ${acting.id} inventory`);
      }
      acting.inventory.splice(itemIndex, 1);
      target.inventory.push(action.itemId);
      events.push(`${acting.id} transferred ${action.itemId} to ${target.id}`);
      break;
    }
    default: {
      const _exhaustive: never = action;
      throw new ExecutorError(`unsupported action ${(_exhaustive as GameAction).type}`);
    }
  }

  return { room: next, events };
}
