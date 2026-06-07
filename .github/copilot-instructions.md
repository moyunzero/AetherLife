# GitHub Copilot — repository instructions

Follow [README.md](../README.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) for setup and verification.

Critical rules:

- Do not commit `.env` or API keys.
- Do not call `room.removeAllListeners()` on Colyseus rooms — use per-handler unsubscribe from `room.onMessage()`.
- Do not block Colyseus `onMessage` handlers on LLM calls; use async worker + queue.
- Multiplayer: human positions live in `players`, not lone `RoomState.player`; spatial NL needs `X-Player-Id`.
- Phase verify scripts (`pnpm verify:phase*`) require real LLM — never `LLM_MOCK=1` or `dev:stack:mock`.

Cross-layer contracts: [docs/CONTRACTS.md](../docs/CONTRACTS.md), [docs/INVARIANTS-MULTIPLAYER.md](../docs/INVARIANTS-MULTIPLAYER.md).
