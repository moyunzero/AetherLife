# Council personas — 12 席人设单一数据源

权威人设：`packages/shared/src/council/dossiers/npc-1.ts` … `npc-12.ts`，经 `COUNCIL_PERSONAS` / `getPersona()` 对外暴露。

## 镜像（由 dossier 导出，勿手写）

| 产物 | 用途 | 消费者 |
|------|------|--------|
| `packages/shared/council-personas-compact.json` | 投票/辩论：`displayName`、`archetype`、`debateStyle`、`votingLeaning` | `workers/.../council/registry.py` |
| `packages/shared/council-personas-speak.json` | Speak 注入：性格、背景、口吻、关系等 | `workers/.../council/speak_registry.py` → `graph/persona.py` |
| `registry.py` 内 `_FALLBACK_PERSONAS` | JSON 缺失时的 fallback | 同上（export 脚本自动 patch） |

## 维护命令

```bash
# 改 dossier 后：导出 + 审计（须 0 issues）
pnpm council:export-personas
pnpm council:audit-personas

# 回归
pnpm --filter @aetherlife/shared test -- src/council/npcPersonas.test.ts
cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_registry.py tests/test_speak_registry.py tests/test_persona_prompt.py -q
```

## 显示名（当前 12 席）

| ID | displayName | ID | displayName |
|----|-------------|-----|-------------|
| npc-1 | 莫玄虚 | npc-7 | 纳兰温言 |
| npc-2 | 阿斯托利亚 | npc-8 | 克里斯 |
| npc-3 | 诸葛知危 | npc-9 | 楚浅歌 |
| npc-4 | 糖果 | npc-10 | 斯卡蒂 |
| npc-5 | 白星烬 | npc-11 | 叶秋水 |
| npc-6 | 瓦伦丁 | npc-12 | 海莲娜 |

运行时：`mainNpcDisplayName(npcId)` / `getPersona(npcId).displayName`（TypeScript）；worker vote 用 `registry.display_name`；speak 用 `council-personas-speak.json`。

## 历史名称（勿在新代码中使用）

Phase 4–22 原型 trio 曾用 **路昂 / 费雪 / 南宫婉**（对应 npc-1/2/3）。自 Phase 23 起已统一为上表议会名；测试与文档示例应使用 **莫玄虚 / 阿斯托利亚 / 诸葛知危**。
