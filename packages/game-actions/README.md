# @aetherlife/game-actions

Shared Core-4 action contract for AetherLife. Single Zod source used by the game-server (validation) and AI agents (tool definitions).

## Overview

All game mutations flow through a discriminated union on `type`:

| Type | Purpose |
|------|---------|
| `move` | Move to grid coordinates |
| `interact` | Interact with a world object |
| `speak` | Speak to a target |
| `wait` | Pause for a duration |
| `transfer` | Transfer an item from inventory to another NPC |

## game-server usage

Import `safeParseGameAction` and reject invalid payloads before any executor runs (Phase 2+):

```typescript
import { safeParseGameAction } from "@aetherlife/game-actions";

const parsed = safeParseGameAction(req.body);
if (!parsed.success) {
  // return 400
}
// use parsed.data
```

## Agent usage

Use `toOpenAIToolDefinitions()` for LangGraph / OpenAI function calling. Do not hand-write JSON Schema.

```typescript
import { toOpenAIToolDefinitions } from "@aetherlife/game-actions";

const tools = toOpenAIToolDefinitions();
```

## Example payloads

```json
{ "type": "move", "x": 10, "y": 4 }
```

```json
{ "type": "interact", "objectId": "door-1" }
```

```json
{ "type": "speak", "targetId": "npc-1", "content": "Hello!" }
```

```json
{ "type": "wait", "durationMs": 1500 }
```

```json
{ "type": "transfer", "itemId": "key-1", "toNpcId": "npc-2" }
```

## Adding actions (future phases)

1. Extend the Zod union in `schemas.ts`
2. Add Vitest coverage
3. Regenerate tools via `toOpenAIToolDefinitions()` — never duplicate schema by hand
