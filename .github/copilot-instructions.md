# GitHub Copilot — repository instructions

Follow the root **[AGENTS.md](../AGENTS.md)** for all AI-assisted work in this repository:

- Behavioral rules (Guidelines.mdc alignment)
- pnpm commands and verification scripts
- Colyseus listener guardrails
- Issue log workflow ([docs/ISSUE-LOG.md](../docs/ISSUE-LOG.md))
- Phase evolution: [docs/PHASE-EVOLUTION.md](../docs/PHASE-EVOLUTION.md), [docs/CONTRACTS.md](../docs/CONTRACTS.md), [.cursor/rules/phase-evolution.mdc](../.cursor/rules/phase-evolution.mdc)
- E2E/UAT: [docs/E2E-POLICY.md](../docs/E2E-POLICY.md) — `verify:phase*` / `uat:phase*` must use real LLM (`pnpm dev:stack`, never `LLM_MOCK=1`)

For project background and GSD phase workflow, see [CLAUDE.md](../CLAUDE.md).

Do not commit secrets. Do not call `room.removeAllListeners()` on Colyseus rooms.
