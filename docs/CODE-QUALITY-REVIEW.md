# 全仓库代码质量审查报告

**日期:** 2026-06-12  
**范围:** `apps/*` · `workers/*` · `packages/*` · `scripts/*`（生产源码 + verify 脚本）  
**方法:** 自动化门禁（build/test）+ 四域并行静态审查（game-server / worker+gateway / web / packages+scripts）  
**与 TECH-DEBT-v3 关系:** [`.planning/TECH-DEBT-v3.md`](../.planning/TECH-DEBT-v3.md) 侧重 v3 里程碑债务重验证；**本文档**为全库质量扫描，覆盖更多实现细节与可维护性问题。

**修复批次:** 2026-06-11 — 按 P0→P4 实施；每批 `pnpm turbo test` / worker pytest / gateway pytest / `pnpm agent:verify`。

---

## 1. 自动化门禁（修复后）

| 检查 | 结果 | 说明 |
|------|------|------|
| `pnpm turbo build` | ✅ 5/5 packages | 含 `@aetherlife/game-server` tsc |
| `pnpm turbo test` | ✅ 8/8 packages | web 82 · game-server 182 · packages 等 |
| worker `pytest -q` | ✅ 201 passed | `LLM_MOCK=1` |
| ai-gateway `pytest` | ✅ 12 passed | |
| `pnpm agent:verify` | ✅ L2 通过 | E2E 需 `pnpm dev:stack` + `--e2e` |
| ESLint / 统一 lint | ✅ | `pnpm lint`（scripts/lib + agent-verify） |

---

## 2. 发现汇总（原始扫描）

| 严重度 | game-server | worker+gateway | web | packages+scripts | **合计** |
|--------|------------:|---------------:|----:|-----------------:|---------:|
| Critical / Blocker | 2 | 5 | 3 | 2 | **12** |
| High / Warning | 6 | 14 | 12 | 15 | **47** |
| Medium / Info | 8 | 6 | 8 | 3 | **25** |
| **小计** | 16 | 25 | 23 | 20 | **84** |

---

## 3. Critical / Blocker — 修复状态

| ID | 状态 | 修复摘要 |
|----|------|----------|
| BUILD-01 | ✅ | `intent-cache.ts`：`colyseus.state as GameRoomState` |
| PKG-B01 | ✅ | `COLYSEUS_SERVER_MESSAGES.speakAck` + GameRoom 使用常量 |
| PKG-B02 | ✅ | `npcAttitudes` Drizzle `primaryKey(roomId, npcId, playerId)` |
| GS-C01 | ✅ | `POST /reset` + chat 路由 `assertScopedPlayerRequest` |
| GS-C02 | ✅ | 无 `REDIS_URL` 且非 test 时 `addNpcTurnJob` 抛错 |
| WK-B01/B04 | ✅ | `_parse_bridge_payload` / `_job_id_from_payload` 毒 JSON 防护 |
| WK-B02 | ✅ | `llm_social_turn` provider 全失败时 re-raise |
| WK-B03 | ✅ | `load_memory_context` `httpx.HTTPError` 降级 |
| GW-B05 | ✅ | production 全局异常不泄露 `str(exc)` |
| WEB-C01–C03 | ✅ | `onStateChange`/`onLeave` `.remove()`；cleanup `room.leave()` |

---

## 4. High / Warning — 修复状态

### game-server

| ID | 状态 | 修复摘要 |
|----|------|----------|
| H-01 | ✅ | `apply-actions` 循环只改 `workingState`，最后 `setState` |
| H-02 | ✅ | speak `playerId` 来自 `client.sessionId` 对应玩家 |
| H-03 | ✅ | `tryAcquireNpcSpeakJob` + chat 预生成 jobId |
| H-04 | ✅ | chat/reset `assertScopedPlayerRequest` |
| H-05 | ✅ | `collectPlayerCells` 有 Colyseus 玩家时不混 legacy `map.player` |
| H-06 | ✅ | `ALLOW_OPEN_INTERNAL=1` 在 `NODE_ENV=production` 无效 |
| audit/memory API | ✅ | audit / npc-memory / collective-state 加 `assertScopedPlayerRequest` |
| move 异常无 ack | ✅ | `GameRoom.enqueuePlayerMove` catch 发送 `moveAck` |
| internal memory 长度 | ✅ | `MAX_PLAYER_MESSAGE_LEN` 校验 |
| room store 无淘汰 | ✅ | LRU，`MAX_ROOM_RECORDS=128` |
| job registry 内存 | ✅ | `MAX_JOBS=512` 淘汰最旧条目 |

### worker + gateway

| ID | 状态 | 说明 |
|----|------|------|
| `_speak_in_progress` 无锁 | ✅ | `threading.Lock` + `_is/_set_speak_in_progress` |
| moderation fail-open | ✅ | production 下 moderation API 错误 → deny |
| ambient fallback 死代码 | ⏸ defer | 需单独 spike 验证 provider 链 |
| SOCIAL_LLM_MAX_ATTEMPTS | ⏸ defer | 与 429 重试策略需产品确认 |
| memory tail daemon 统计 | ⏸ defer | 观测性改进，非 blocker |
| OpenRouter schema 校验 | ⏸ defer | gateway 增量 hardening slice |

### web

| 项 | 状态 | 修复摘要 |
|----|------|----------|
| motion bridge 泄漏 | ✅ | `PhaserGame` destroy 置 null |
| useNpcChat AbortController | ✅ | `fetchAbortRef` + signal |
| RoomScene 监听器 | ✅ | shutdown `input.removeAllListeners` + registry 清理 |
| Tab / tabpanel a11y | ✅ | `NpcTabBar` + `ChatPage` tabpanel |
| aria-live 等 | ⏸ defer | 需 UAT phase13 矩阵扩展 |

### packages + scripts

| 项 | 状态 | 修复摘要 |
|----|------|----------|
| transfer schema export + README | ✅ | `transferActionSchema` + 文档 |
| agent-verify scope 默认 fail | ✅ | 声明 `AGENT_SCOPE` 且 scope 外改动失败 |
| verify 脚本 env/speak 重复 | ⏸ defer | 大 refactor；建议独立 phase |
| collective kind 重复 / npcId 默认 | ⏸ defer | 需 migration + 契约对齐 slice |
| phase11 真实 LLM assert | ⏸ defer | E2E 政策已有；脚本增强另开 task |

---

## 5. 验证命令（Done 标准）

```bash
pnpm turbo build
pnpm turbo test
cd workers/agent-worker && LLM_MOCK=1 uv run pytest -q
cd apps/ai-gateway && uv run pytest tests -q
pnpm agent:verify
# merge 前（真实 LLM + dev:stack）:
pnpm agent:verify --e2e
```

**2026-06-11 已跑:** 上述 L2 全部通过（`agent:verify` 未跑 `--e2e`）。

---

## 6. 仍 defer 的项（需单独 slice）

以下项已在 2026-06-11 续作批次完成 ✅：

1. ~~**根目录 ESLint + CI lint**~~ → `eslint.config.js` + `pnpm lint`（`scripts/lib` + `agent-verify`）
2. ~~**verify 脚本公共库**~~ → `scripts/lib/env.mjs`、`home-spawn.mjs`、`e2e-sse.mjs`；已迁移 `agent-verify`、`verify-phase3`、`verify-phase6`
3. ~~**worker 观测 / LLM 重试**~~ → `SOCIAL_LLM_MAX_ATTEMPTS=3`；ambient `_ambient_provider_attempts`；memory tail `tailMs` 日志
4. ~~**packages 类型 drift**~~ → `DEFAULT_NPC_ID`；schema/repository 对齐 `npc-1`；CollectiveEventKind 从 `@aetherlife/shared`  re-export
5. ~~**a11y 深度**~~ → `MessageList` `role="log"` + `aria-live="polite"`
6. ~~**OpenRouter schema 校验**~~ → gateway `_parse_openrouter_content` + pytest

仍可选后续 slice：

- 将其余 ~12 个 verify 脚本迁移至 `scripts/lib/env.mjs`
- `verify-phase11` 真实 LLM assert 增强（E2E 矩阵已有覆盖）
- 全 monorepo ESLint（TypeScript apps）

---

## 7. 与上次 v3 审计的差异

| 维度 | v3 TECH-DEBT 审计 | 本报告（代码质量） |
|------|-------------------|-------------------|
| 目标 | 里程碑债务、CR/WR 重验证 | 全库 bugs / 类型 / 泄漏 / 可维护性 |
| 发现数 | ~12 项 | **84 项（原始）** |
| 修复 | 3 文件 reset tracker | **P0–P2 全修 + P3/P4 主要项 + Medium 一批** |
| build | 未单独 gate | **已修复并通过 turbo build** |

---

*Original scan: 2026-06-12 · Remediation: 2026-06-11*
