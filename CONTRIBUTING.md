# Contributing — AetherLife

面向人类贡献者。请先阅读 [README.md](./README.md)（环境、`.env`、`pnpm dev:stack`、各 phase 验收命令）。

## 开发原则

1. **先复现、再改代码** — 写清验证步骤（脚本或手动 UAT）。
2. **最小 diff** — 不顺手重构、不扩大范围。
3. **可验证完成** — `pnpm turbo test`、对应 `pnpm verify:phaseN`（须真实 LLM 与 `pnpm dev:stack`，禁止 `LLM_MOCK=1` 跑 phase 验收），或 README 中的手动步骤。
4. **跨层改动** — 改 game-server + worker 时两侧测试都要跑；见 [docs/CONTRACTS.md](./docs/CONTRACTS.md) 与 [docs/INVARIANTS-MULTIPLAYER.md](./docs/INVARIANTS-MULTIPLAYER.md)。

## 关键约束

- **Colyseus 客户端**：用 `room.onMessage(type, fn)` 返回的 unsubscribe；禁止 `room.removeAllListeners("speakAck")`（会清掉 `onStateChange`）。
- **Speak 路径**：禁止在 Colyseus `onMessage` 内阻塞 LLM；worker 异步 + 队列。
- **多人空间**：人类坐标在 `players` map，NL 须带 `X-Player-Id` / `initiatorPlayerId`。
- **Secrets**：勿提交 `.env` 或 API key。

## PR 建议

1. 说明改了什么、如何验证（命令或步骤）。
2. 触及 UI/网络时附手动验证说明。
3. 跨层 API 变更时更新 [docs/CONTRACTS.md](./docs/CONTRACTS.md)。

## 架构参考

| 文件 | 用途 |
|------|------|
| [docs/CONTRACTS.md](./docs/CONTRACTS.md) | 跨层 API 契约 |
| [docs/INVARIANTS-MULTIPLAYER.md](./docs/INVARIANTS-MULTIPLAYER.md) | 多人 / NL 不变量 |
| [docs/MOVEMENT-ARCHITECTURE.md](./docs/MOVEMENT-ARCHITECTURE.md) | 移动与同步 |
