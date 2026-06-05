# Contributing — AetherLife

面向人类贡献者与 AI 协作者。VibeCoding / 多 Agent 工具链以 **[AGENTS.md](./AGENTS.md)** 为跨工具入口；Cursor 另强制 **[`.cursor/rules/Guidelines.mdc`](.cursor/rules/Guidelines.mdc)**。

## 快速开始

见 [README.md](./README.md)（环境、`.env`、`pnpm dev:stack`、各 phase 验收命令）。

## 开发原则

1. **先复现、再改代码** — 写清验证步骤（脚本或 UAT）。
2. **最小 diff** — 不顺手重构、不扩大范围。
3. **可验证完成** — `pnpm turbo test`、对应 `pnpm verify:phaseN`（**真实 LLM**，见 [docs/E2E-POLICY.md](./docs/E2E-POLICY.md)），或 README 中的手动步骤。
4. **问题留痕** — 非琐碎 bug 记入 [docs/ISSUE-LOG.md](./docs/ISSUE-LOG.md)，并在 Guardrails 中防复发。
5. **阶段演进** — 新 phase 或跨层功能前读 [docs/PHASE-EVOLUTION.md](./docs/PHASE-EVOLUTION.md)，计划内嵌 [.planning/EVOLUTION-AUDIT-TEMPLATE.md](./.planning/EVOLUTION-AUDIT-TEMPLATE.md)。

## AI 协作者必读

| 文件 | 用途 |
|------|------|
| [AGENTS.md](./AGENTS.md) | 命令、边界（Always / Ask / Never）、Colyseus 规则、完成定义 |
| [CLAUDE.md](./CLAUDE.md) | GSD 项目背景、技术栈版本、阶段工作流 |
| [docs/ISSUE-LOG.md](./docs/ISSUE-LOG.md) | 问题台账与 Guardrails |
| [docs/PHASE-EVOLUTION.md](./docs/PHASE-EVOLUTION.md) | 阶段演进防债务 + GSD 映射 |
| [docs/E2E-POLICY.md](./docs/E2E-POLICY.md) | E2E/UAT 禁 mock + 体验验收矩阵 |
| [`.cursor/rules/e2e-policy.mdc`](./.cursor/rules/e2e-policy.mdc) | Agent 自动加载 E2E 约束 |
| [docs/CONTRACTS.md](./docs/CONTRACTS.md) | game-server ↔ worker 契约 |
| [`.cursor/rules/phase-evolution.mdc`](./.cursor/rules/phase-evolution.mdc) | Agent 自动加载约束 |
| [apps/web/AGENTS.md](./apps/web/AGENTS.md) | 前端 + Colyseus hooks 补充 |

GitHub Copilot 会读取 [.github/copilot-instructions.md](./.github/copilot-instructions.md)（指向 AGENTS.md）。

## 提交流程建议

1. 分支开发；变更与 AGENTS.md / issue log 约定一致时，**同一 PR** 更新文档。
2. 运行与改动相关的 verify / test（见 AGENTS.md Key commands）。
3. PR 描述包含：**原因**、**验证方式**、若修 bug 则链到 `ISSUE-NNN`。
4. 勿提交 `.env`、密钥、个人 token。

## 规划与 UAT 产物

阶段计划、UAT、PATTERNS 在 [`.planning/`](./.planning/)，与 `docs/ISSUE-LOG.md` 互补：前者按 phase 验收，后者跨 phase 防复发。
