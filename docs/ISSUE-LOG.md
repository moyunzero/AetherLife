# 问题记录（Issue Log）

本文件是 **AetherLife 开发与修 bug 的权威问题台账**。凡非琐碎缺陷、UAT 失败项、生产/联调异常，修复前后都应在此留痕，避免同类问题复发。

**相关约束：** [AGENTS.md](../AGENTS.md)（跨工具入口）、[`.cursor/rules/Guidelines.mdc`](../.cursor/rules/Guidelines.mdc)（Cursor 行为准则）、[CONTRIBUTING.md](../CONTRIBUTING.md)（协作流程）。项目背景见 [CLAUDE.md](../CLAUDE.md)。

---

## 如何使用

| 阶段 | 动作 |
|------|------|
| 发现 / 复现 | 新增一条记录，状态 `open`，写清复现步骤与环境 |
| 调查 | 补充根因（含误假设），链接相关代码路径 |
| 修复 | 状态 → `fixed`，写修复摘要与 **验证方式**（命令或 UAT 步骤） |
| 防复发 | 在本文 **Guardrails** 增加一条可执行规则；必要时更新 phase `*-PATTERNS.md` / `*-UAT.md` |

**编号：** `ISSUE-NNN`（三位递增）。**状态：** `open` | `investigating` | `fixed` | `wontfix`。

### 单条模板（复制使用）

```markdown
### ISSUE-NNN — 简短标题

- **状态:** open
- **发现:** YYYY-MM-DD
- **阶段/范围:** 例 Phase 06 / apps/web
- **严重性:** blocker | major | minor

**复现**
1. …

**根因**
- …

**修复**
- …

**验证**
- …

**防复发**
- …
```

---

## Guardrails（由已解决问题提炼）

以下规则在代码评审与修 bug 时 **必须检查**：

### Colyseus 客户端（`@colyseus/sdk`）

1. **`room.removeAllListeners()` 无参数，会清空整房间监听**，包括：
   - `onStateChange`（玩家位置 UI 依赖此回调）
   - 全部 `onMessage` 处理器
   - Schema decoder 的 `callbacks`
2. **禁止** 用 `removeAllListeners("messageType")` 假装按类型卸载（类型参数会被忽略）。
3. **正确做法：** `const off = room.onMessage(type, handler)`，cleanup 时调用 `off()`。
4. **禁止** 在注册 Colyseus 监听的 `useEffect` 依赖里放入 `activeNpcId` 等 UI 状态，除非有意全量重绑；切 Tab 应用 ref 读当前 NPC，而不是重跑 effect。

### React + 实时同步

5. 一个 Colyseus `Room` 实例上的 `onStateChange` 应在 **单一 hook**（如 `useColyseusRoom`）注册；其它 hook 只订阅 `onMessage`，且各自用 unsubscribe 清理。
6. 「无法移动」类报告：先区分 **未发 move** vs **已发但 UI 不刷新**（后者优先查 `onStateChange` 是否被误删）。

### 修复流程（对齐 Guidelines.mdc）

7. 修 bug 前写出可复现步骤；修完后给出 **可重复的验证**（脚本、UAT 项或浏览器检查），再标 `fixed`。
8. 不做与问题无关的重构；只删 **本次修改** 产生的无用代码。

### Phaser NPC 重置（星露谷 snap）

9. **禁止** 在 `POST /reset` 完成前递增 `npcResetEpoch`：否则会用**旧** `mapNpcs` 重建 sprite，再在 `npcWorldLive=true` 时从远格 tween 回默认格（「走回」）。
10. 重置顺序：`flushSync` 关闭 animate → `await resetGame()` → `flushSync` 同步 `moveMap` + `npcResetEpoch` → 双 `rAF` 再开启 live。
10b. **NPC 步进时长必须覆盖 LPC gait**：`NPC_GRID_STEP_MS`（600 = 8×75ms）≠ 玩家 `GRID_STEP_MS`（200）。200ms 格间 tween 只能露出 ~2–3 走帧 → 站立姿势滑动（「漂移」）。`npcAnimateMoves` false→true 首帧 snap；曼哈顿/路径 >2 snap；禁止同格 schema 打断进行中步；`moveMap` 始终合并 Colyseus；**`npcWorldLive` 可在 `roomNpcs` 就绪后开启**（勿只等 HTTP roomState）。回归：`lpcNpc1Sheet.test.ts` · `gridMovement.npcCatchup.test.ts`。
11. 回归：`pnpm uat:phase7:reset-snap`（需 `pnpm --filter @aetherlife/shared build` + dev web/gs）。
12. **`window.__aetherlife_npcDebug` 仅允许在 `import.meta.env.DEV` 下挂载**；生产构建不得暴露网格/tween 内省。

### 多人空间 + NL（Phase 08）

13. **`RoomState.player` 不是「当前说话玩家」**；空间推理用 Colyseus `players` + `roomStateForInitiator` / `initiatorPlayerId`（见 [INVARIANTS-MULTIPLAYER.md](./INVARIANTS-MULTIPLAYER.md)）。
14. **`POST /internal/rooms/:id/apply-actions` 须 Bearer + `X-Player-Id`**；`initiatorPlayerId` body 不可覆盖 header；`INTERNAL_WORKER_TOKEN` 未配置时非 test 环境返回 503（fail-closed）。
15. **Reset 仅清请求玩家的 collective attitudes**（`deleteForPlayer`）；room 级 shared events 靠 TTL 自然过期，禁止一人 reset 清空多人窗口。
16. **`join_vicinity` 日 cap 为 worker 进程内计数**（`ambient_intent._join_vicinity_counts`）；worker 重启重置；勿假设跨重启持久。
14. Worker `fetch_state` 必须带 `X-Player-Id`；`apply-actions` 必须带 `initiatorPlayerId`（非 `__legacy__`）。
15. NPC 相对移动吸附优先 **发起者四邻**，禁止仅全局 BFS 落到他人身后纵列。
16. Worker `apply-actions` 前必须 `tool_calls_to_actions`（剥离 LLM 多余字段、跳过幻觉 `objectId`）；见 MP-10、[CONTRACTS.md](./CONTRACTS.md) C-03。
17. 新 phase / 扩展多人·NL·记忆·同步：开工前完成 [Evolution Audit](../.planning/templates/EVOLUTION-AUDIT-TEMPLATE.md)，并对照 [PHASE-EVOLUTION.md](./PHASE-EVOLUTION.md) + 相关 C-xx。
18. 跨层变更（game-server + worker + shared）须 **同一 PR/任务** 改齐并跑双侧测试；禁止只修一端留契约断裂。

### E2E / UAT（真实 LLM）

19. **`pnpm verify:phase*` 与 `pnpm uat:phase*:playwright` 禁止 `LLM_MOCK=1`**；脚本入口 `assertE2eNoMock` / `assertE2eRealLlm`（见 [E2E-POLICY.md](./E2E-POLICY.md)）。
20. E2E 栈必须是 **`pnpm dev:stack`**，验收前 `pkill -f "LLM_MOCK=1.*src.main"`；`dev:stack:mock` 仅本地 UI 冒烟，**不得**作为 phase 验收依据。
21. NL / speak E2E 须断言 **世界状态**（坐标、audit、memory），不能只等 `done` / `moveAck`；多人相对移动用 `GET state` + `X-Player-Id` 验 NPC 四邻。
22. **Colyseus `speak` 与 `POST /chat` 须在入队前走 `checkContentBlocked`**（`packages/shared/src/contentGuard.ts`）；与 ai-gateway blocklist 对齐；禁止仅依赖 gateway 拦截主游戏路径。

### 客户端移动预测 + moveAck

23. **`moveAck` 禁止对过期 ack 做无差别 `visualPos` 回滚**：须用 `reconcileMoveAck`（`packages/shared/src/moveAck.ts`）+ `PendingMove{ clientSeq, toX, toY }` 队列；`ack.clientSeq < lastAckedSeq` 或仍有更高 seq pending 时 **不得** 把显示坐标拉回 ack 位置。
24. **WASD 发 `dx/dy` 时 pending 必须用 `serverToX/Y`（权威链）对 ack**，禁止用视觉 `toX/toY` 比对——领先预测会把正常 ack 误判为拒绝并弹出「位置已与服务器同步」；仅 `ack` 与 `serverToX/Y` 不一致时才 rollback。
25. **`chunksSync` 须按 `chunkViewsFingerprint` 去重**（客户端 `setLoadedChunks`、服务端 `broadcastChunksIfChanged`）；避免每步 move 触发 Phaser `drawFloor` 全量重绘。
26. WASD 预测队列设上限（`MAX_PREDICT_AHEAD`）；禁止恢复 `visualMismatch → setVisualPos(ack)` 一行式校正。
27. 服务端 `GameRoom` 处理 `move` 时 **`ensureChunksForPlayers` 必须包含本步目标格**（`player.x+dx` / `targetX,Y`），再 `buildMoveGrid`；否则 chunk 边界 `void` 拒步而客户端已 walkable。
28. 客户端 `nextServerStepTarget` 的权威基准用 **`authoritativePosRef`**（moveAck + pending 空时的 schema），禁止仅用可能滞后的 `playersRef`。
29. 服务端 `GameRoom` **`move` 必须 per-session 串行**（`moveQueueTail`）；`async` + `await ensureChunks` 并发处理会让多个 `dx/dy` 从同一权威格起算 → 客户端误判 `corrected`。
30. `reconcileMoveAck`：WASD pending 带 `dx/dy`；成功条件含 `authoritative + dx/dy`；乱序 ack `deferred` + 缓冲重放。
31. `sendMove` 必须用 **`clientPredictOrigin`（pending 尾 → visualRef → schema）** 且 **`setVisualOverlay` 同步写 `visualPosRef`**；禁止仅靠 React render 更新 ref（连按 WASD 会重复 from 格 → serverTo/视觉链断裂 → 误 `corrected`）。
32. 本地玩家 Phaser：**按曼哈顿格距 tween**（`STEP_MS * dist`）；`reducedMotion` 时 snap；禁止预测超前时 `stepDist>1` 硬 snap。
33. **`visualPosRef` 仅经 `setVisualOverlay` 更新**；禁止 render 体 `visualPosRef.current = visualPos`（`players` 单独重渲染会把 ref 打回滞后 state）。
34. 相机跟随本地玩家用 **`cam.pan`**（与步进同量级 duration），禁止每格 `centerOn` 瞬移；**禁止**把 `cam.pan()` 返回值当 Tween（返回 Camera）——中断用 **`cam.panEffect.reset()`**。
35. **点击移动前必须排空 WASD 预测队列**（`pendingMovesRef` drain + 从 `authoritativePosRef` 重算路径）；禁止在 in-flight pending 上叠 `sendMoveTo` 步进，否则松键后仍沿旧方向 ack/动画。
36. **本地玩家 locomotion 归 Phaser**（`RoomScene` + `LocalPlayerMotionBridge`）：`enqueueMoveStep` 只写 `visualPosRef` 并发包，禁止每步 `setVisualOverlay` 驱动 React→`syncEntities` tween；WASD 键盘在 `RoomScene.setupInput`，非 `PhaserGame` React hook。
37. **WASD 短按只走一步**：`attachGridMovementKeys` 首步在 `keydown` 立即触发；`setInterval` 重复须在 `HOLD_REPEAT_DELAY_MS`（≥200ms）后才启动，禁止 keydown 同刻启动 interval（否则 ~120ms 轻点会走两格）。
38. **本地 locomotion 在 `LocalPlayerMovementController`**（非 `RoomScene` 内联队列）：`RoomScene` 只委托 bridge；**点击移动**发单条 `{ targetX, targetY, clientSeq }` + `playVisualPath`（禁止每格 `dx/dy` pending 链）；探索坐标优先 `motionBridge.getLogicGrid()`，非仅 `visualPosRef`。
39. **客户端预测在 `ClientMovementPredictor`**（`apps/web/src/lib/clientMovementPredictor.ts`）：pending / `serverTo` / `reconcileMoveAck` / inputBuffer 禁止散落在 hook 或 Scene；编排集中在 `MovementSyncController`。
40. **远程玩家走 `RemotePlayerInterpolator`**：`pushServerCell` 缓冲权威格 + `advance` 每帧一格 `GRID_STEP_MS`；禁止对远程玩家 `tweenEntityOneStep` 跨多格直线（对角滑步）；超 `MAX_CATCHUP_CELLS` 须 `snapToServer`。
41. **点击寻路起点用 Phaser 逻辑格**：pending **排空后**再 `cancelLocomotion`；`sendMoveTo` 用 `getLogicGrid()` 作 path origin；`pushTargetMove` 设 `visualPos=dest`；`leadingVisualAfterAck` 对无 `dx/dy` target 对齐 ack；`pendingMoves>0` 时 `RoomScene` **禁止**把本地玩家 snap 到滞后 schema；`CLICK_PENDING_DRAIN_MS`≥3s；路径播完后可再等 ack，禁止先 cancel 后排空失败导致闪回。
42. **Phaser-first 移动编排**（Phase 10.5）：`MovementSyncController` 负责 pending drain、点击寻路、`moveAck`（`attachRoom`）；`RoomScene` 键盘/点击直连 `movementSync.sendWasd` / `sendMoveTo`；`PhaserGame` **禁止** `onMove`/`onMoveTo` React 桥；`pending` 优先读 `movementSync.getPendingCount()` 而非 React prop；权威说明见 [MOVEMENT-ARCHITECTURE.md](./MOVEMENT-ARCHITECTURE.md)。
43. **预测期禁止 snap 到滞后 auth**：`enqueueStep` 在 `clientCanStep` 失败时**不得**清空 `pending` 或 `snapTo(authoritativePos)`；`applyAck` 在 `corrected` 且 Colyseus schema 已领先 ack 时**不得** snap；`pushRestoreMove` 须 `snapTo(target)` 且 `sendWasd` 在 target pending 完成前不发送；`syncAuthoritativeFromSchema` 在 pending 期可沿 server 链前移 auth。回归：`node scripts/uat-phase6-move-flash.mjs`。
44. **chunk 未同步时客户端预测须可走**：`isTerrainWalkable` 在 `loadedChunks` 缺 chunk 时用 `packages/shared` 的 `biomeAtGlobal(gx,gy,WORLD_SEED)` 程序化 fallback（与 game-server 同 seed）；`chunksSync` 更新后须 `MovementSyncController.onLoadedChunksUpdated()` 重试 `inputBuffer`；禁止 chunk 边界因 `void` 误判阻塞 WASD 直至下一 ack。
45. **chunk 边界 pending 满时禁止视觉停住**：`pending >= MAX_PREDICT_AHEAD` 时若 `clientCanStep` 仍通过，须 `queueVisualOnlyStep`（上限 `MAX_VISUAL_ONLY_AHEAD`）保持 Phaser 步进；服务端 `ensureChunksForPlayers` **禁止**在 move 热路径 `await loadChunkDelta`——须 sync `ensureProceduralEntry` 后后台 `hydrateDelta`；近边界（`lx/ly` 距边 ≤2）可 debounce `requestChunksSync`。
46. **`maybeQueueVisualStep` 禁止要求 logic 与目标曼哈顿距恰好为 1**：连按 WASD / pending 链推进时 `getLogicGrid()` 会滞后于 `serverTo`；除「已在目标格」外须一律 `queueStep`，由 `LocalPlayerMovementController` 步进队列串联 tween。回归：`node scripts/uat-phase6-move-flash.mjs`。
47. **晕影须屏幕空间，禁止世界锚定 Graphics 压实体**：边缘 archival 晕影仅用 CSS `.room-scene-panel__canvas` inset shadow（UI-SPEC D-20）；**禁止**在 `RoomScene` 用固定世界坐标 `Graphics` + 高 `depth` 当 vignette（往北 `gridY` 小时会盖住玩家）。回归：`pnpm uat:vignette:playwright`。
48. **`entityDepth` 须对负 `gridY` 保持正值**：探索北向（`gy < 0`）时 `10 + gy*10` 会变负，玩家沉到 `floorGfx`（depth 0）下面；使用 `ENTITY_DEPTH_BASE`（`entityLayout.entityDepth`）。回归：`pnpm --filter @aetherlife/web test` `entityLayout.test.ts`。
49. **Colyseus 521 不一定是 Cloudflare**：matchmake `join` 在 shard 未创建时返回 **code 521**（`no rooms found`）；Web 客户端应 **`joinOrCreate` 优先**。`resolveColyseusWsUrl()`：**localhost 直连 `ws://127.0.0.1:2567`**（room WS 不经 Vite）；**非 localhost** 走页面同源 + Vite `/matchmake` proxy。禁止隧道场景硬编码 `:2567`。`pnpm dev:stack` 未跑时任何 join 都会失败。
50. **Phaser registry 首次写入是 `setdata` 不是 `changedata`**：`exploreGrid` 等 UI 监听须同时订阅 `setdata` + `changedata`；`RoomScene.syncEntities` 末尾应 `tickExploreGrid()` 以便进房即有坐标条。回归：`pnpm uat:phase10:playwright` + [UAT-CASES.md](../.planning/milestones/v1-phases/11-llm-world-lore/UAT-CASES.md)。
51. **Lore discover toast 在 ready loreSync 触发，不在 pending**：服务端 `isFirstDiscover` 与 `storyHook` 分两条 `loreSync`（pending → ready）；`useChunkLore` 须用 session 级 Set 记住 pending+isFirstDiscover，ready 时再入 toast 队列。禁止 `isFirstDiscover && lore.storyHook` 同条判断。**禁止**在 `useEffect` 里用 `setState` updater 的同步返回值消费 toast 队列；展示用 `toastQueue[0]`，dismiss 再 dequeue。回归：`useChunkLore.test.ts` + `node scripts/debug-lore-toast.mjs`。
52. **NPC speak `done` 不得等 memory tail**：worker `process_job` 在 `run_npc_turn_interactive`（LLM + apply-actions + reply）后立即 emit `done`；`persist_turn_memory` / reflect / summarize 走 `run_npc_memory_tail`，失败只打 stderr，不得拖长 UI「正在思考…」。
53. **Phase 13 实体渲染改动须双 gate**：改 `apps/web/src/game/**` 实体/sprite/decor/nameplate 时 merge 前跑 `pnpm verify:phase6:move-only` + `pnpm verify:phase13`（`pnpm dev:stack`，禁止 `LLM_MOCK`）；`?visualFallback=1` 与 `?phaserFallback=1` 是不同开关。13-02+ 须确保 `FloorRenderer` 等 renderer import 完整（ISSUE-034）。
54. **Speak UX 方案 A（life-sim）**：当前 Tab NPC 在 sending/thinking/speakBusy 时 `composerBusyForActiveNpc` 禁用 textarea + 发送；`sendMessage` **不得**在 in-flight 时客户端 enqueue（仅 server `speakBusy` 路径保留内部队列 drain）。
55. **`onDone` 后 drain 队列前同步 in-flight refs**：`clearInFlightRefsForDrain`（ISSUE-036；仅服务 speakBusy 内部队列）。
56. **Speak 状态提示贴近 composer**：`composer-speak-status` 显示「正在思考…」或多人 busy；勿展示用户侧「已排队 N 条」。
57. **Proximity 铭牌样式（Phase 13 UAT #6/#7，2026-07 刷新）**：`entityLabels.ts` 的 `SCENE_LABEL_FONT`（宋体）、`applyNameplateStyle`（约 10px @ CELL_PX=32、无描边/无底条、轻投影）、`sceneLabelLayout.ts` 名字/状态堆叠、`entitySprites.spriteNameplateY`、`ProximityNameplate.ts` 的 `PROXIMITY_CELLS=2` 为 **已验收契约**；改动须 `pnpm verify:phase13` + 人工 UAT 铭牌可读性。
58. **Phase 8 speakBusy（方案 A）须清 sending 态**：`onSpeakBusy` 在 inflight → `enqueueSpeak` 后 **必须** 同步清 `sendingNpcId` / ref，否则 B 端显示「正在思考…」而非「其他玩家占用」；UAT：`pnpm uat:phase8:playwright` Test 4。
59. **已验收 UX/视觉代码 — 最小 diff**：ISSUE 标 `fixed` 且 UAT/verify 通过的 hook、铭牌、composer 状态机，后续 phase 不得 drive-by 重构；scope 外改动 `pnpm agent:verify:scope` 应 fail。
60. **Decor 须低于同格实体 depth**：`DecorRenderer` 用 `entityDepth(gx, gy, 0)`；玩家/NPC 至少 layer 1。禁止 decor 与实体同 layer 1（同格时后 spawn 的 decor 会盖住角色，如 home 土路围栏）。回归：`entityLayout.test.ts`「同格 entity > decor」+ 实机站 pathRow=6。
61. **被挡 WASD 须转向输入方向**：`clientCanStep` 失败时 `ClientMovementPredictor.notifyBlockedStep` 调用 `onBlockedFace` + `sendMove({ dx, dy })`（**无 clientSeq/pending**）；`LocalPlayerMotionBridge.faceInputDirection` → `playIdleAnim`；服务端 `applyPlayerMove` blocked 分支更新 `player.facing`。禁止仅 `onHint` 而不转向。回归：`clientMovementPredictor.test.ts` + `move-handler.test.ts`。
62. **Interactive speak 记忆召回（PLAY-03 / Phase 20）**：`llm_social_turn._build_social_messages` 须注入 `memory_summary`；口播用**当下口吻直接给事实**，禁止 meta 套话；LLM 拒答或 echo FACT token 时 `compose_reply` → `merge_recall_into_reply` 确定性补全（`recall_merge.py` — **密码/昵称追问须真实值在 reply 内且非含糊多值才可 skip merge**；**`pick_recall_memory` 按问题类型选行**，无匹配行时 **return None**；**密码 `_pick_password_memory` 优先 player seed 行**（`player: 请记住…`），**排除 npc 复述**（「你刚刚说…密码」）；**recency augment** topic/recency/embed）；**`_PASSWORD_ANS_RE` 须 `密码是|为`（非 optional）**；recall 问句行不得当 password fact；含糊 LLM（多数字 / 「不确定」）→ **整句替换为 fact**，禁止 append；**无匹配记忆时 `recall_no_memory_reply`**。**RECALL** intent memory-context **18s×2** + recency augment（ISSUE-050）；CASUAL/SOCIAL_EDGE/NARRATIVE 仍 **8s×1 skipEmbed**。回归：`test_recall_merge.py` · `test_memory_quote.py` · `pnpm verify:phase20`。

### Beginning Fields / Tiled home 地图（Fan-tasy）

63. **Atlas tileset 须 `loader.spritesheet` 预加载**：`scripts/bake-beginning-fields.mjs` 对含 atlas `image` 的 TSX 写入 `oneCityTilesetManifest.ts` 为 `kind: "spritesheet"` + `frameWidth/Height`（= TSX `tilewidth/height`）；`areaLoader.queueHomeMapAssets` 走 `queueAsset`。**禁止** atlas（Campfire、Tileset_Water、Animation_Flowers_* 等）用 `loader.image` 整图加载——Object layer 的 `setTexture(key, frame)` 无法切帧，会整行重复显示（Campfire 256×32 = 16 帧横条 → 「火墙」）且 `applyObjectTileAnimation` 无效。Collection-of-images 仍 `kind: "image"`（per-tile PNG key）。
64. **Home object layer 手动放置，不用 `createFromObjects`**：Fan-tasy 混用 collection + atlas tile object；`HomeMapBackground` 用 `resolveGidTexture`（`firstgid` 降序 + collection `tiles[].image` 优先，否则 atlas `name`+`localId`）+ `placeTiledTileObject`（`setOrigin(0,1)`，`x/y * TILE_SCALE`）+ `applyObjectTileAnimation`（Tiled `tiles[].animation`，object layer **不**自动播）。`tiles[]` 仅有 animation 元数据、无 `image` 时 **不得** 误判为 collection（ISSUE-042 Campfire）。
65. **改地图/TSX 须重烘焙并实机验 home**：动 `assets/one-city/BeginningFields.json` 或 Fan-tasy TSX 后 `node scripts/bake-beginning-fields.mjs`（`FANTASY_TILESET_ROOT` 指向 Fan-tasy 包根）；commit `apps/web/public/assets/one-city/` + `oneCityTilesetManifest.ts`。回归：`pnpm --filter @aetherlife/web test`；`pnpm dev:stack` 进 home 无 `__MISSING`、Campfire 仅一组 2×2 且火焰动画播放。
66. **Speak 延迟基准须分 SDK vs 浏览器**：`benchmark-llm-e2e-latency.mjs` 仅为 Colyseus-only；玩家体感用 `pnpm benchmark:speak-browser`（禁止 `LLM_MOCK`）。改 speak 热路径后对比 JSON 报告 `total` / `npc_bubble` p50/p95。
67. **`nl/parse` 不得阻塞 `room.send(speak)`**：parse 仅 debug/UI 意图；`dispatchSpeak` 须先 `speak` 再后台 `fetch nl/parse`（ISSUE-045 P0-A）。
68. **Thinking UI 在 dispatch 即显示**：`setThinkingNpcId` / `setStatus('thinking')` 与 `setSendingNpcId` 同步，禁止仅等 `speakAck`（ISSUE-045 P0-B）；勿破坏 speakBusy 方案 A（Guardrail #54–#58）。
69. **CASUAL fast lane 不得破坏 recall/hostile gate**：`SpeakIntent.CASUAL` deterministic（`can_use_casual_fast_lane`）走 `run_casual_fast_lane`（无 LangGraph/checkpoint、skip 全量 memory + `skipNearbyLore`）；`RECALL`/`NARRATIVE` 必须全量 memory + embed；非 deterministic CASUAL 仍走 interactive 图但 skip memory；`audit_reply` 仍为唯一 done guard；改 intent/快路径须 `test_speak_intent.py` + `test_casual_fast_lane.py` + `benchmark:speak-browser` B1 分桶。
70. **speakAck 须先于 Redis enqueue**：`GameRoom` `client.send(speakAck)` 在 `startNpcChatTurn` 之前；payload **须** 含 `{ jobId, npcId }`（ISSUE-048）。fast lane 可在 ms 内 `done`；`useNpcChat` 用 **per-NPC `NpcJobRegistry`** 追踪 job（**禁止** 恢复单槽 `pendingJobIdRef`）；未注册 job 的 `onDone` 可 adopt `jobId` 作兜底（ISSUE-045 P3）。
71. **CASUAL stub 双端真源 + RECALL 禁止早发**：`previewCasualSpeakStub` / `pickCasualReply` 以 `packages/shared`（`stableStringHash` + 模板池）与 Python `stable_string_hash` + `llm_social_turn` 为唯一真源；**禁止** `hash()` 或分叉模板。`RECALL` / `NARRATIVE` / `PHYSICAL` / non-deterministic social **不得** game-server 早发 `speakPartial` 或 Web `client_mirror`（ISSUE-045 P4）。改 stub 须 `speakIntent.test.ts` + `test_casual_reply_pool.py` parity + `benchmark:speak-browser` B1 `ttft_partial` p50 ≤2s。
72. **Phase 17 speak pre-LLM SLA**：interactive `fetch_state` 默认 `skipNearbyLore=1`；NARRATIVE+lore markers lazy lore；worker-state 超时须 stale fallback（禁止 hard-fail job）；`verify:phase12` speak 前 worker-state preflight <500ms×3；speak **error** 终端 job 不得 enqueue ambient `speak_end`；worker 仅 npc 队列空时 drain lore/ambient。回归：`pnpm --filter @aetherlife/game-server test` + `pytest test_fetch_state_and_memory.py` + `verify:phase12`.
73. **internal memory 身份须解析 body.playerId**：`playerIdFromRequest(req, body)` 对 object body 须读 `body.playerId` 再 `resolvePlayerId`；**禁止**把整个 JSON body 当 string 传入（worker POST 无 `X-Player-Id` 时会全落 `__legacy__`，`verify:phase3` memoryCount=0）。worker `memory/client.py` 写路径应同时发 `X-Player-Id`；write 后 `invalidateMemoryContextForPlayer`。回归：`index.test.ts`「worker path body playerId」+ `pnpm verify:phase3` + `pnpm agent:verify --e2e --base`。
74. **并行 speak 须 per-NPC job 路由**：服务端 `npcSpeakJobs` 按 NPC 互斥、不同 NPC 可并行（C-02）；客户端 `useNpcChat` **禁止** 单槽 `pendingJobIdRef` / 全局 `thinkingNpcId` 覆盖并行 job。`onSpeakAck` / `onDone` / `onError` / `speakPartial` 经 `NpcJobRegistry`（`byNpc` + `byJob`）按 `jobId → npcId` 入库，与 **active tab 无关**。`composerBusyForActiveNpc` 仅锁当前 Tab NPC（方案 A，Guardrail #54）。Phaser 铭牌/thinking 用 `thinkingNpcIds` 数组。回归：`useNpcChat.test.ts`（registry + `isNpcSpeakInFlight`）；人工：A 思考中切 B 对话 → 两边 `done` 均出现在各自 Tab 消息列表。
75. **relay 移动意图须覆盖「去 X 那边 / 有事情找」**：`player_requests_move` 的 `MOVE_PATTERNS` 须含 `那边|那里|那儿` 与 `有事情找|事情找`；否则 `classify_speak_intent` → NARRATIVE → `llm_social_turn` 只口播、`tool_calls=[]`（ISSUE-051）。改 `action_intent.py` 须 `test_action_intent.py::test_relay_summon_phrases_from_uat` + 含目标 NPC 名的 inject 用例。
76. **apply_tools 物理兜底 inject**：`social_edge_fast_lane` / 非 physical 分支若 `tool_calls=[]` 但 `player_requests_physical_action`，`apply_tools` 仍须 `inject_relative_move_tool`；`main.py` 在 physical 时禁止走 social fast lane。回归：`test_tool_gate.py::test_apply_tools_injects_move_when_physical_and_tool_calls_empty` + 阿斯托利亚 relay 句 inject 用例（ISSUE-052）。
77. **RECALL overlay 禁止 LLM 流式草稿抢先**：RECALL 问句 `run_social_turn_llm` 禁用 stream partial；`compose_reply` merge 后仅 `partial_emit` 最终 merged reply 一次（ISSUE-053）。回归：`test_social_stream_extract.py` · `test_tool_gate.py::test_compose_reply_recall_emits_merged_partial_for_overlay`。
78. **apply-actions 后须刷新 worker hot snapshot**：`apply_tools` 成功路径在 `safe_response_json` 后须 `_remember_worker_snapshot(room_id, player_id, updated_snapshot)`；否则 3s 内 `fetch_state` 热缓存仍用 apply 前坐标（ISSUE-054）。回归：`test_fetch_state_and_memory.py::test_apply_tools_refreshes_hot_snapshot_cache`。
79. **密码 recall topic 硬过滤**：问「电脑密码」时不得用「门锁/门禁密码」行格式化；`_password_topic` + `_password_topic_score` 对 mismatch 返回 `-1`，`_pick_password_memory` 在 computer/door topic 无匹配行时 return None（ISSUE-054）。回归：`test_recall_merge.py::test_pick_recall_computer_password_rejects_door_lock_only` · `pnpm verify:phase20`。
80. **叙事问句勿误判 PHYSICAL**：standalone `那边|那里|那儿` 会误伤「那里有什么历史？」；`MOVE_PATTERNS` / `speakIntent.ts` 须用 contextual regex（去/到/往…那边、可以去…那边、那边…你去），relay UAT 句仍须 PHYSICAL。回归：`test_speak_intent.py` · `packages/shared/src/speakIntent.test.ts` · `test_action_intent.py::test_relay_summon_phrases_from_uat`。
81. **worker httpx 须 `trust_env=False`**：访问 `127.0.0.1:2567` 一律 `create_http_client()`；macOS 系统 HTTP 代理会导致 emit/append **502**（ISSUE-055）。回归：`tests/test_http_json.py::test_create_http_client_disables_trust_env`。
82. **player 记忆须在 emit `done` 前落库**：`process_job` 在 `done` 前 sync `append_player_memory`（`DEFAULT_IMPORTANCE`）；`persist_turn_memory` 见 `_player_line_persisted` 跳过重复写；tail 仍跑 importance/NPC 行（ISSUE-055）。回归：`pnpm verify:phase21` · `pnpm verify:phase20`。
83. **Ambient NPC 显示名单一来源**：`getPersona` / `mainNpcDisplayName` / `createDefaultRoom` 为 TS 权威；worker ambient fallback 读 `council-personas-compact.json`（`pnpm council:export-personas`）；prompt 优先 `payload.npcName`（GameRoom 注入）。禁止 worker 手写与 dossier 不一致的中文名（ISSUE-056）。回归：`test_ambient_intent.py` · `pnpm council:audit-personas`。
84. **议会 vote LLM 路由禁止智谱**：`world_vote.py` 须走 `nvidia` / `agnes` reflect+lore 槽（`FORBIDDEN_VOTE_PROVIDERS` 含 `zhipu`）；**禁止**将 council debate/vote/proposal 接入智谱 speak 并发=1 路径。回归：`pytest tests/test_world_vote.py -q` · `pnpm verify:phase25`。
85. **审议落槌须 `active: false`**：`writeback_sequence` sealed sync 与 web `reduceDeliberationSync` 须在 `phase=sealed` 时清 `active`（DialogueBar chip / Council banner）；禁止 sealed 仍 `active: true`。回归：`test_world_vote.py::test_writeback_sequence` · `useCouncilDeliberation.test.ts`。
86. **Worker 票决名册对齐 shared**：`registry.py` 须读 `packages/shared/council-personas-compact.json`（`pnpm council:export-personas`）；minutes/displayName 与 Web 12 席一致。回归：`pytest tests/test_registry.py -q` · `pnpm council:audit-personas`。
87. **Force-trigger 单 in-flight**：`forceEnqueueWorldVote` 在 room 已有 pending job 时须 **拒绝**（409）；superseded worker job writeback 前须 `GET world-vote/pending` 校验 `jobId`。回归：`world-vote-trigger.test.ts` · `test_writeback_skipped_when_job_superseded`。
88. **议会人设镜像须从 dossier 导出**：改 `packages/shared/src/council/dossiers/*` 后须 `pnpm council:export-personas` + `pnpm council:audit-personas`（0 issues）；speak 读 `council-personas-speak.json`，**禁止**在 `persona.py` / `speak_dossiers.py` 手写段落。详见 [docs/COUNCIL-PERSONAS.md](./COUNCIL-PERSONAS.md)。回归：`pytest tests/test_speak_registry.py tests/test_registry.py tests/test_persona_prompt.py -q`。
89. **审议 writeback 全链路 fatal**：`world_vote` job 成功须 history + complete + **11** 条 `council-vote-memories` + relationship deltas + sealed sync（含 `resultEntryId`）；**禁止** deltas/memories 静默 skip；顺序 history → complete → deltas → memories → sealed。回归：`test_world_vote.py::test_writeback_sequence` · `service.test.ts` council vote。
90. **提案人不计票**：`vote_minutes.ballots` **必须 11 条**（非提案人）；提案人仅 entry `proposerDisplayName` + minutes 模态「不计票」标注；**禁止** `_cast_single_ballot(is_proposer=True)` 或强制 `vote=yes`。票决 reason 与 vote 矛盾时 `reconcile_ballot_vote_reason` 以理由语气校正。回归：`test_build_minutes_eleven_ballots_excludes_proposer` · `WorldHistoryMinutesModal.test.ts`。
91. **票决 prompt 必含提案人+辩论**：`_cast_single_ballot` 须注入 `ballot_prompt_instructions(proposer_id, proposer_name)`、`format_proposer_relationship(voter, proposer, edges)`、`format_debate_transcript_summary(ctx.debate_transcript)`。回归：`test_cast_ballot_prompt_includes_proposer_and_debate`。
92. **关系 delta 与 UI linkedEdges 分离**：`apply-deltas` 写全量 delta；`councilDeliberationSync.linkedEdges` 仅 `filter_linked_edges_for_ui(top_k=8, min_abs=8)`；提案人↔投票人边由 `_proposer_voter_deltas` 保证；voter↔voter 同阵营须 debate interaction pair。回归：`test_proposer_gets_edge_per_voter` · `test_no_same_camp_mesh_without_debate`。
93. **辩论轮次上限与 instant 默认**：`VOTE_DEBATE_ROUNDS_MAX` 默认 5；trigger/worker `capDebateRoundsMax`；`VOTE_INSTANT_DEBATE` 默认 `1`（单 job 跑完，UAT 兼容）；paced checkpoint 字段 `activeDeliberation` 在 game-server state。回归：`world-vote-pacing.test.ts`。
94. **feedDelta 双槽 + 防御截断**：辩论 LLM 须 `fullText`（transcript，≤180）+ `feedQuote`（feed，≤80）；`finalize_deliberation_sync_payload` 硬截断；**禁止**旅者前缀拼进 feedQuote；单条非法 feed 行 skip，**禁止**整 job 因 Zod 400 失败。详见 [25-FEED-DUAL-OUTPUT.md](../.planning/phases/25-council-vote-debate/25-FEED-DUAL-OUTPUT.md)。回归：`test_vote_prompt.py` · `uat:phase25:core-ui` 连续 2 次 pass。
95. **E2E 前仅单 agent-worker**：`verify:phase*` / `uat:phase*` 前须 `pkill -f "python -m src.main"`（或等价）确保 **仅一个** `pnpm dev:worker` / `dev:stack` worker 消费 Redis；多进程会抢 `world-vote` job，旧代码路径导致 minutes 缺 `debateExcerpts` / feedDelta 400。回归：`uat:phase25:core-ui` T4-debate-excerpts · `pnpm verify:phase25`。
96. **GameRoom tick 仅 LPUSH vote job**：`maybeEnqueueWorldVote` / `tickRoomVoteClock` 在 Colyseus tick 内 **仅** Redis/BullMQ enqueue + 状态机；**禁止** tick 内 LLM/HTTP/worker 同步调用（INVARIANTS MP tick 非阻塞不变）。回归：`world-vote-trigger.test.ts` · `pnpm agent:verify --e2e` GF-01。
97. **关系 delta 仅 worker 异步写**：`applyRelationshipDeltas` 仅经 worker `world_vote` job `POST .../npc-relationships/apply-deltas`；**禁止** `onMessage("speak")` / `GameRoom` handler 内直接改 `npc_relationships`。回归：`test_world_vote.py` · `verify:phase25` affection before/after GET。
98. **编年史 yes/no 须为 11 票真实计数**：`post_world_history` / sealed `councilDeliberationSync` 的 `yesCount`/`noCount` **禁止** `+1` 或超过 11；与 `tally_ballots`（非提案人 11 席）一致；Zod `max(11)`。`recordPlayerSpeak` **仅**在 `startNpcChatTurn` 成功后调用。回归：`test_post_world_history_yes_count_matches_ballot_tally` · `councilDeliberation.test.ts` · `world-vote-trigger.test.ts` speak-order · `pnpm verify:phase25` minutes 11 ballots。

### Phase 26 — Council map presence（C-08 / MP-11）

99. **MapSchema 禁止恢复 flat 三槽**：`GameRoomState.npcs: MapSchema<NpcEntityState>` + `schemaVersion=2` 为唯一 SSOT；**禁止**恢复 `npc1X`/`bgNpc1X` 或 3 主 NPC + 4 bg-villager 模型（MP-12）。改 `schema.ts`/`bridge.ts`/`useColyseusRoom` 须 `pnpm --filter @aetherlife/game-server test -- bridge.test` + `pnpm --filter @aetherlife/web test -- colyseusAmbientSnapshot`。
100. **`verify:phase26` 禁止 mock LLM**：脚本入口 `assertE2eNoMock` + `assertE2eRealLlm`；**禁止** `LLM_MOCK=1` / `dev:stack:mock` 假绿（MAP-05 / T-26-04）。须 `pnpm dev:stack` + 真实 API keys；leaning_drift 子 pytest 可 `LLM_MOCK=1`（非 speak 硬断言）。
101. **Phase 26 勿破坏 frozen UX**：`entityLabels.ts` / `ProximityNameplate.ts` / `entitySprites.ts` / `useNpcChat.ts` speakBusy 方案 A 为已验收契约（Guardrail #57–#59、#106–#107）；Phase 26 仅扩展 12 席 id 范围，merge 前须 `pnpm verify:phase13` + `pnpm verify:phase26`（stack 就绪时）。
102. **MapSchema cleanup 禁止 stale setter**：`useColyseusRoom` unmount 仅 `setRoomNpcs([])`；**禁止** 恢复 `setMainNpcGridById` / `setBgNpcGridById`（ISSUE-096）。改 hook 须 `pnpm --filter @aetherlife/web test`。
103. **npc-memory 新 migration 必须登记 journal**：新增 `packages/npc-memory/migrations/*.sql` 时 **同步** `migrations/meta/_journal.json`；`verify:phase26` 入口已 `db:migrate` preflight（ISSUE-097）。
104. **`verify:phase26` traveler 断言须读完整 chip aria-label**：禁止仅依赖 24 字 `.council-deliberation-chip__title`；vote 前须 rude speak + collective rude API（对齐 phase25，ISSUE-098）。E2E **串行**：智谱并发=1 时禁止并行 `verify:phase26` + `uat:phase26` speak。
105. **议会 `councilSpawns` 须全图分散、勿挤堆**：`x∈[5,33]`、`y∈[5,31]`、互距 Chebyshev ≥3、x/y 跨度均 ≥20（`region-walkability.test.ts`）；**禁止** 12 点挤在单一 ≤4×3 格网或南广场扎堆（ISSUE-099）；改 spawn 后 UAT 用 **新 `roomId`**。布局见 `BEGINNING-FIELDS.md` §议会出生点。

### Character visuals — LPC & CELL_PX（产品决策 · 2026-07）

106. **全员 LPC 角色皮**：本地/远端**所有玩家**与 **`npc-1`…`npc-12`** 使用烘焙 `sprites/lpc-player-1.png` + `sprites/lpc-npc-{1…12}.png`（`createPlayerSprite` → `createLpcNpcSprite`；`spriteProfileForNpc` 映射 npc-1…12）；**禁止**恢复 `sprites/characters.png` 四色 palette 作玩家皮除非新开 phase 决策。`useSpriteEntities()` 门槛：`spritesLpcNpc1` + `spritesNpcs` 均须存在（全部 `lpc-npc-*` 随 `CORE_AREA_ASSETS` 加载）。烘焙：`pnpm assets:sync:lpc-npcs`（源 `npc-asset/player-1.png` + `npc-asset/npc-{1…12}.png`）。文档：[BEGINNING-FIELDS.md](./BEGINNING-FIELDS.md) §角色视觉。回归：`pnpm --filter @aetherlife/web test` + `pnpm verify:phase6:move-only`。
107. **显示格 CELL_PX=32**：`gridLayout.CELL_PX=32`（16px 源 ×2）；角色显示高 `CHAR_DISPLAY_PX=64`（占 2 逻辑格）。改 `CELL_PX` 须同步 `entityLayout.LABEL_SCALE`、`GRID_STEP_MS`、地图注释与 [BEGINNING-FIELDS.md](./BEGINNING-FIELDS.md)。Phase 13.3 历史仍为 48px 校准记录，**当前运行时以 32px 为准**。
108. **Phase 26+ verify 禁止断言 bg-villager**：`verify:phase16` / UAT 脚本 **禁止** 要求房间存在 `bg-villager-*`（ISSUE-101）；ambient/铭牌回归用 12 席 council + `verify:phase26`。
109. **Phase 26 D-MAP-AMB-03 独占 12 分桶（每 tick 仅 1 NPC 移动）已被 26.2 B2 取代**：禁止重新引入 exclusive bucket。走步资格 = **B2 `shouldStepThisTick`**（新开一程；join 绕过）**+ walk/pause**（mid-walk 不重掷 B2）。双 SSOT `maxRadius` 改动必须过 `council-spawn-radius.test.ts`。回归：`pnpm --filter @aetherlife/game-server test -- src/ambient/`。
110. **Ambient 动森式闲逛（26.2 gap）**：`shouldSkipMovement` **仅** `resting`；日程发呆用 `wandering`+`wander`。`stationary` 在 zone 外须 **通勤到最近 zone 格**。选目标 **永不叠格**（占用 + 本 tick reserved）；偏好 `PERSONAL_SPACE≥2`，擦肩可。白天主漫游 zone 为 `beginning-fields@v1:home`（全图）；子 zone orchard/plaza/pond 仅短时人设 linger。改 zones 须双 SSOT（`zones.json` + `defaultBeginningFieldsBundle`）。回归：`src/ambient/` + 新 `roomId` + `?gridDebug=1` 看 zone。
111. **禁止移除 `runAmbientTick` 内 B2 调用**：`shouldStepThisTick(npc.id, …)` 须在 `maxRadius===0` 钉死与 walk/pause 之后、resolve 之前保留（mid-walk / join 绕过）。`45b6455` 曾只留 walk/pause 导致门失效（ISSUE-105）；改 `tick.ts` 须保留 canary `wires shouldStepThisTick(npc.id)` + `skips stepping when shouldStepThisTick fails`。

### Phase 27 — Personal life timeline（C-11）

112. **个人传记隔离**：`npc_personal_timeline` 是唯一个人人生时间线存储；**禁止**把个人 biography 写入 `__council__`（C-07）或玩家 speak `npc_memories`（C-05）。Worker/seed 只经 `insertPersonalTimelineEntry` / internal POST；改写路径须 `pnpm --filter @aetherlife/game-server test -- personal-timeline-repository`（含 isolation 源码断言）。
113. **个人日记须按席位人设写**：weekly/polish/multi/rel/event prompt **必须** `persona_block_for`（speak mirror）；**禁止**无口吻的「人生札记」通稿导致 ENTJ/ESFP 写同款文艺腔（ISSUE-106）。周记须带 `recentBullets`；非廷议双边走 `kind=event` + force REL。回归：`pytest tests/test_personal_timeline.py tests/test_personal_timeline_rel07.py -q` · `pnpm --filter @aetherlife/game-server test -- personal-timeline-dyad personal-timeline-weekly`。

## 记录

### ISSUE-001 — thinking 中切换 NPC Tab 后无法移动（UI 冻结）

- **状态:** fixed
- **发现:** 2026-06-03
- **阶段/范围:** Phase 06 · `apps/web` · Colyseus + NPC 对话
- **严重性:** major
- **关联:** `.planning/milestones/v1-phases/06-colyseus-movement/06-UAT.md`

**复现**

1. 对 NPC1 发送指令，进入 **thinking**。
2. 切换到 **NPC2** Tab。
3. WASD 或点击格子：网格上「你」不移动（或坐标不更新）。

**根因**

- `useNpcChat` 的 `useEffect` 依赖 `activeNpcId`，切 Tab 触发 cleanup。
- cleanup 调用 `room.removeAllListeners("speakAck")` 等；Colyseus SDK 的 `removeAllListeners()` **不接受类型参数**，实际清空 **所有** 监听，包括 `useColyseusRoom` 注册的 `onStateChange`。
- 服务端可能仍处理 `move`，但客户端 `players` 状态不再更新 → 表现为无法移动。

**修复**

- `apps/web/src/hooks/useNpcChat.ts`：用 `room.onMessage` 返回的 unsubscribe 函数清理；从 effect 依赖移除 `activeNpcId`；`onDone` 经 `activeNpcIdRef` 读当前 Tab。

**验证**

1. `pnpm dev:stack` 启动全栈。
2. 复现步骤 1–3：thinking 中切 Tab 后 WASD/点格，「你」与底部坐标应更新。

**防复发**

- 见上文 Guardrails **Colyseus 客户端** 第 1–4 条。

---

### ISSUE-002 — 新游戏确认后 NPC 走回默认格（应 snap）

- **状态:** fixed
- **发现:** 2026-06-04
- **阶段/范围:** Phase 07 · `apps/web` · Phaser `RoomScene` + `ChatPage` 重置
- **严重性:** major
- **关联:** `.planning/milestones/v1-phases/07-2-5d-renderer/07-UAT.md` Test 5

**复现**

1. 通过 `apply-actions` 或对话让 `npc-1` 离开默认格（如 6,6）。
2. 点击「新游戏」→「确认开始」。
3. NPC 以逐格动画走回 (2,2)，而非瞬移 snap。

**根因**

- `setNpcResetEpoch` 在 `await resetGame()` **之前**执行：Phaser 用旧坐标销毁/重建 sprite。
- `moveMap` 与 `roomState` 不同步一帧时，可能在 `npcAnimateMoves=true` 时从旧 `gridX/Y` tween 到新默认格。
- 首轮 `awaitingResetRef` 只挡住 effect 误开 live，未解决 epoch 顺序问题。

**修复**

- `performResetGame`：`resetGame()` 后再 `flushSync` 更新 `moveMap` + `npcResetEpoch`。
- `resetGame` 返回 `RoomState | null` 供重置路径使用。
- `scripts/uat-phase7-reset-snap.mjs` + `window.__aetherlife_npcDebug` 供 E2E 检测 tween。

**验证**

1. `pnpm --filter @aetherlife/shared build`
2. `pnpm dev` + game-server 2567
3. `pnpm uat:phase7:reset-snap` → OK
4. 浏览器复现步骤 1–3：确认后 NPC 应瞬移到默认格

**防复发**

- 见 Guardrails **Phaser NPC 重置** 第 9–11 条。

---

### ISSUE-003 — 多人并行对话「移动到我下方」NPC 跟错玩家

- **状态:** fixed
- **发现:** 2026-06-04
- **阶段/范围:** Phase 08 · game-server + worker · 多人 NL 移动
- **严重性:** major
- **关联:** [docs/INVARIANTS-MULTIPLAYER.md](./INVARIANTS-MULTIPLAYER.md)

**复现**

1. 玩家 A 对莫玄虚说「移动到我的下方」→ 莫玄虚位置正确。
2. 玩家 B 对阿斯托利亚说「移动到我的下方」→ 阿斯托利亚出现在莫玄虚下方纵列，而非 B 身旁。

**根因**

- `RoomState.player` 为单人字段；`syncMapPlayerPosition` 仅保留最后移动者。
- Worker `fetch_state` 未传 `X-Player-Id`，Prompt 将「我」绑定到错误的 `player` 坐标。
- `playerId` 只用于记忆分桶，未参与空间上下文。
- 目标格被占时全局 BFS 吸附，无「相对发起者」锚点。

**修复**

- `roomStateForInitiator` / `findPlayerCellByPlayerId`；GET state 按 `X-Player-Id` 覆盖视图。
- Worker `fetch_state` 带 header；`apply-actions` 带 `initiatorPlayerId` + `moveAnchorCell` 四邻优先吸附。
- Prompt 明确「本次发起指令的玩家」。

**验证**

- `pnpm --filter @aetherlife/game-server test`
- 双人手动：各自对不同 NPC 说「移动到我的下方」，NPC 应贴近对应玩家四邻。

**防复发**

- Guardrails 多人空间第 13–15 条；`docs/INVARIANTS-MULTIPLAYER.md` MP-01…08。

**续发（2026-06-04）— 玩家 B 仍 400**

- **现象：** A→莫玄虚「移动到我的下方」成功；B→阿斯托利亚同指令 `apply-actions` 400，阿斯托利亚未动。
- **根因：** LLM 常在 `move`/`interact` 参数中带 `reason` 等额外键，或幻觉 `door-2`；服务端 `GameActionSchema` 为 `.strict()`，整批拒绝并返回 400。
- **修复：** `workers/agent-worker/src/graph/action_sanitize.py` + `apply_tools` 清洗；无效 `interact` 跳过保留 `move`。
- **验证：** `cd workers/agent-worker && uv run pytest tests/test_action_sanitize.py -q`

---

### ISSUE-004 — 连续移动时角色闪回旧格（预测 + 过期 moveAck 回滚）

- **状态:** fixed
- **发现:** 2026-06-05
- **阶段/范围:** Phase 08–10 · `apps/web` · Colyseus 移动预测
- **严重性:** major

**复现**

1. `pnpm dev:stack` 进入房间，按住或快速连按 WASD 移动。
2. 角色先向前走，突然跳回 1–2 格前的位置，再继续移动；地板/相机偶发闪烁。
3. `SyncMetricsOverlay`「校正」计数持续上升。

**根因**

- `sendMove` 无节流地推进 `visualPos` 并连发 `move`（`clientSeq` 递增），预测可领先服务器多格。
- `onMoveAck` 在 `visual.x !== data.x` 时 **无差别** `setVisualPos(ack)`，滞后 ack（如 seq=1 到达时 visual 已在 seq=3 位置）把显示坐标 **拉回** 旧格。
- Phase 8 计划中的 pending 队列 + replay 未落地，仅实现简化预测。
- Phase 10 每步 move `broadcast(chunksSync)` → 客户端 `setLoadedChunks` → Phaser 每帧 `drawFloor()` + `centerCameraOnPlayer()`，放大闪烁。

**修复**

- `packages/shared/src/moveAck.ts`：`reconcileMoveAck` — 忽略过期 ack、中间 ack 不改领先 visual、仅拒绝时 rollback。
- `useColyseusRoom`：`PendingMove` 含 `toX/toY`、`lastAckedSeqRef`、`MAX_PREDICT_AHEAD`、`chunkViewsFingerprint` 去重。
- `GameRoom.broadcastChunksIfChanged`；`RoomScene` 按 fingerprint 跳过 `drawFloor`；`tweenEntityTo` 同目标 tween 不重启。

**验证**

- `pnpm --filter @aetherlife/shared test`（含 `moveAck.test.ts`）
- `pnpm --filter @aetherlife/game-server test`
- `pnpm --filter @aetherlife/web build`
- 手动：快速 WASD，无闪回；校正计数仅在撞墙/拒绝时增加

**防复发**

- Guardrails 第 23–26 条；修改 `useColyseusRoom` / `moveAck` 时跑 shared 单测。

**续发（2026-06-05）— 首轮修复后仍闪回**

- **现象：** `reconcileMoveAck` 已忽略过期 ack，但连按 WASD 仍偶发跳格。
- **根因 1：** 队列清空时 `visualMatches → setVisualPos(null)`，而 Colyseus `players` 仍落后 1–2 格 → `displayPlayers` 短暂显示旧权威坐标。
- **根因 2：** `tweenEntityOneStep` 启动时即写 `ent.gridX=目标格`，每次 `onStateChange` 触发 `syncEntities` 走「已到达」分支 `stopEntityMotion`+snap，打断 140ms tween。
- **修复：** 仅 `serverSelf` 与 ack 一致时清 `visualPos`；本地玩家改 **snap**（不 tween）；远程 tween 在 `onComplete` 才更新 `gridX`。
- **续发 2：** ack 成功路径**完全不再**改写 `visualPos`；仅 `pending` 为空且 `players` 追上 `visualPos` 时由 hook `useEffect` 清 overlay；本地 sprite 同格跳过 snap、相机同格不重复 `centerOn`。
- **续发 3（「位置已与服务器同步」）：** 客户端用视觉 `toX` 对 ack，服务器用权威格 `player.x + dx` 回 ack → 误判 `corrected` 并 `setVisualPos(ack)` 闪回。修复：`PendingMove.serverToX/Y` + `nextServerStepTarget` + reconcile 比对 `serverTo`。
- **续发 4（走出家园仍闪回 + 同步提示）：** ① 服务端 `move` 前 `ensureChunksForPlayers` 仅含**当前**玩家格，目标格 chunk 未加载 → `getWalkability` 为 `void` → 拒绝移动但客户端已预测 → `corrected`。修复：`GameRoom` 在 grid 构建前把 **目标格**（`player.x+dx` 或 `targetX/Y`）加入 preload。② `nextServerStepTarget` 在 pending 清空后用滞后的 `playersRef` 作权威基准 → serverTo 链断裂。修复：`authoritativePosRef` 在 moveAck 成功/校正及 `onStateChange`（pending 空）时更新。
- **续发 5（随意走仍校正）：** `onMessage(move)` 为 `async` 且 `await ensureChunks` — 连按 WASD 时多个 handler **并发**，各从同一 `player.x/y` 应用 `dx/dy`，ack 与客户端 `serverTo` 链系统性错位。修复：`moveQueueTail` 串行 `processPlayerMove`；pending 增 `dx/dy`；reconcile 以 `authoritative+dx/dy` 兜底匹配；乱序 ack 缓冲重放。
- **续发 6（重启后仍闪回）：** `visualPosRef` 仅在 React render 时从 state 同步，`sendMove` 连发时 `fromX/Y` 重复用 schema 旧格 → 多条 pending 同 `toX` 但 `serverTo` 累进 → ack 与视觉脱节 → `corrected`。修复：`clientPredictOrigin` + `setVisualOverlay` 同步 ref；`leadingVisualAfterAck` 在 pending 尾/落后 ack 时对齐视觉；本地玩家 1 格 tween 减瞬移感。
- **续发 7（仍校正 + 晃眼）：** 渲染体 `visualPosRef.current = visualPos` 在 `players` 单独重渲染时把 ref 打回滞后 state → 预测链再断。本地玩家预测超前时 `stepDist>1` 硬 snap + 相机 `centerOn` 瞬移。修复：去掉 render 写 ref；本地玩家按格距 tween；相机 `pan`；`?reducedMotion=1` 关动效。
- **续发 8（黑屏 / PhaserGame 崩溃）：** `cam.pan()` 返回 **Camera** 而非 `Tween`；把返回值存为 `cameraPanTween` 并在下次 `onStateChange` 调 `.stop()` → `TypeError` → React 整树卸载黑屏。修复：取消 tween 字段；中断用 `cam.panEffect.reset()`。
- **续发 9（Phase 10.5 Phaser-first 后仍闪回）：** `moveAck` 已排空且 tween 结束后，滞后 Colyseus `players` schema 仍触发 `syncEntities` 本地 `snapEntityToGrid`；`syncAuthoritativeFromSchema` 亦用滞后 schema 覆盖 ack 后的 `authoritativePos`。修复：`shouldSuppressLocalSchemaSnap` 在 local≠schema 时抑制 snap；`syncAuthoritativeFromSchema` 在 auth≠schema 时不回退；`scripts/uat-phase6-move-flash.mjs` 纳入 `verify:phase6:move-only`。
- **续发 10（预测期 snap 到滞后 auth）：** `clientCanStep` 失败时 `enqueueStep` 清空 pending 并 `snapTo(authoritativePos)`；`moveAck.corrected` 在 **logic grid / visual 已领先 ack** 时仍 snap（即使 Colyseus schema 与滞后 ack 同格）；restore target 与 WASD 竞态。修复：blocked 仅拒绝本步；stale corrected 用 `getLogicGrid()`∥`visualPos` 判定、禁止 snap；restore `snapTo(target)` + 阻塞 WASD；pending 期 schema 沿链前移 auth。
- **验证（续发 9–10）：** `pnpm verify:phase6:move-only`；`node scripts/uat-phase6-move-flash.mjs`

---

### ISSUE-005 — 长按 WASD 松开后点击移动，角色仍沿旧方向走

- **状态:** fixed
- **发现:** 2026-06-05
- **阶段/范围:** Phase 06–08 · `apps/web` · WASD 长按 + 点击寻路
- **严重性:** major

**复现**

1. `pnpm dev:stack` 进入房间，长按 W/A/S/D 移动数格后松键。
2. 立刻点击地图另一位置。
3. 角色继续沿长按方向滑几步，或路径/落点与点击目标不符，像「长按没结束」。

**根因**

- 松键只停 `useGridMovementKeys` 的 interval，**不**清空 `pendingMovesRef`（最多 6 步 in-flight）。
- `sendMoveTo` 从 `clientPredictOrigin`（pending 尾）算路并立刻 `enqueueMoveStep`，与未 ack 的 WASD 步混在同一队列；ack 回放期间 visual 仍沿旧方向推进。
- Phaser `walkLocalPlayerSteps` 为追上领先 visual 做多格 tween，与新一轮点击步进叠加。

**修复**

- `sendMoveTo`：先 `setAnimating(true)`，**drain** pending（≤5s），从 `authoritativePosRef` 重算路径；必要时清错位 `visualPos`。
- `RoomScene.tweenLocalPlayerTo`：`animating` 时禁止 `walkLocalPlayerSteps`，单格 tween 或 snap 重同步。

**验证**

- `pnpm --filter @aetherlife/shared test`
- 手动：长按 W 3–5 格 → 松键 → 点击远处格；应只走向点击目标，无沿 W 方向惯性

**防复发**

- Guardrails 第 35 条。

---

### ISSUE-006 — 轻点 WASD 偶尔走两格

- **状态:** fixed
- **发现:** 2026-06-05
- **阶段/范围:** Phase 06–08 · `apps/web` · `gridMovement.ts`
- **严重性:** major

**复现**

1. `pnpm dev:stack` 进入房间，快速点按 W/A/S/D（非长按）。
2. 偶发角色移动 **两格**，网络 pending 也会出现两条 move。

**根因**

- `attachGridMovementKeys` 在 `keydown` 立即 `fireHeld()` 走一步，同时启动 `setInterval(fireHeld, 120ms)`。
- 轻点时长若略大于 120ms，interval 会在松键前再触发一次 → 第二步并非用户意图。

**修复**

- 首步仍在 `keydown` 立即触发；**延迟 `HOLD_REPEAT_DELAY_MS`（200ms）** 后才启动 `setInterval` 自动重复。
- 重复 `keydown`（`heldKey === key`）忽略；`keyup`/`blur` 同时清 timeout + interval。

**验证**

- 手动：快速点按同一方向键 20 次，应始终只走 1 格/次；长按 ≥300ms 应连续移动。

**防复发**

- Guardrails 第 37 条。

---

### ISSUE-007 — 点击单元格移动中途闪回再走向目标

- **状态:** fixed
- **发现:** 2026-06-05
- **阶段/范围:** Phase 06–08 · `apps/web` · 点击寻路 + moveAck
- **严重性:** major

**复现**

1. `pnpm dev:stack` 进入房间；WASD 或上一段移动后立刻点击地图格。
2. 角色沿路径走几步后**闪回**较早格子，再继续走向点击目标（或出现「位置已与服务器同步」）。

**根因**

- `sendMoveTo` 在 `cancelLocomotion` 后仍用滞后 `authoritativePos` 作 `prepareClickOrigin` snap，Phaser sprite 逻辑格已领先 → 点击瞬间被拉回权威格。
- `pushTargetMove` 未更新 `visualPos`；`leadingVisualAfterAck` 对无 `dx/dy` 的 target pending 误判为「视觉领先」而保留起点 overlay。
- `applyAck` 校正时 `snapTo` 未取消进行中的 `playVisualPath`，动画与权威位置打架。

**修复**

- 点击 path origin / snap 优先 `getLogicGrid()`。
- `pushTargetMove` 设 `visualPos` 为目的地；`leadingVisualAfterAck` 对点击 pending 对齐 ack 终点。
- 校正且 `animating` 时 `cancelLocomotion` + `onClickPathAborted` 结束点击 Promise。
- **续发（位置同步中 + 闪回）**：`cancelLocomotion` 挪到 pending 排空**之后**；`RoomScene` 在 `pendingMoves>0` 时不把本地玩家 snap 到 schema；`CLICK_PENDING_DRAIN_MS` 提至 3s；路径播完后再等 ack。

**验证**

- `pnpm --filter @aetherlife/shared test`
- 手动：WASD 走 2–3 格 → 立刻点击远处格，应无闪回；纯点击长路径 ack 中途不应回弹；不应频繁出现「位置同步中」后闪回起点

**防复发**

- Guardrails 第 41 条。

---

### ISSUE-008 — 跨 8×8 chunk 边界移动卡顿

- **状态:** fixed（续发 12 · 2026-06-05）
- **发现:** 2026-06-05
- **阶段/范围:** Phase 10 · `apps/web` · chunk 边界 + WASD 预测
- **严重性:** major

**复现**

1. `pnpm dev:stack` 进入房间，从家园格（x≈4–7）长按 D/→ 走向 x≥8（下一 chunk）。
2. 在 x=7→8 边界处角色停顿 ~120ms+，像「卡一下再走」；`inputBuffer` 有值直至 `chunksSync` 或下一 ack。

**根因**

- `isTerrainWalkable` 在目标 chunk 尚未出现在 `loadedChunks` 时返回 `false`（void）。
- `enqueueStep` 判阻 → `sendWasd` 写入 `inputBuffer`，但 **`chunksSync` 到达前不会重试**（仅 `applyAck` 路径会 drain buffer）。
- 服务端 move 前已 `ensureChunksForPlayers`，客户端预测与服务端 walkability **不对称**。

**修复**

- 将 `generateChunkBase` / `biomeAtGlobal` 迁入 `packages/shared`（`chunkProcedural.ts`）；web `isTerrainWalkable` 缺 chunk 时用 `WORLD_SEED` 程序化 fallback。
- `vite.config` 从根 `.env` 注入 `__AETHERLIFE_WORLD_SEED__`。
- `ClientMovementPredictor.retryBufferedInput` + `MovementSyncController.onLoadedChunksUpdated`；`chunksSync` 后立即更新 `loadedChunksRef` 并重试。

**验证**

- `pnpm --filter @aetherlife/shared test`
- `pnpm --filter @aetherlife/web test`
- 浏览器：长按 D 过 x=7→8→9 无肉眼停顿；`window.__aetherlife_moveDebug()` 在边界处 `pending` 连续递增

**续发 11（2026-06-05）— 程序化 fallback 后仍边界卡顿**

- **复现：** 长按 D 过 x=7→8 仍有 ~120ms+ 停顿；`pending` 顶满 8 时 `locomoting=false` 且 `gridX` 不变。
- **根因：**
  1. 服务端 `ensureChunksForPlayers` 对新 chunk **`await loadChunkDelta`（Postgres）**，串行 move 队列在边界首次跨 chunk 时 ack 延迟 → `MAX_PREDICT_AHEAD` 满 → **不发包也不 `queueStep`**。
  2. `sendWasd` pending 满时只写 `inputBuffer`，视觉完全停住。
- **修复：**
  - `ChunkLoader.ensureProceduralEntry`：sync 程序化 tiles 入缓存，delta 后台 `hydrateDelta`（move 路径不阻塞 DB）。
  - `ClientMovementPredictor`：`queueVisualOnlyStep` + `maybeQueueVisualStep`（逻辑格已领先时不重复 tween）；`enqueueStep` 以 `serverToX/Y` 为权威目标。
  - `MovementSyncController`：`sendWasd` 前 `retryBufferedInput`；近 chunk 边 `requestChunksSync`（400ms debounce）。
  - `__aetherlife_moveDebug` 暴露 `visualOnlyAhead` / `inputBuffer`。
- **验证：** `pnpm --filter @aetherlife/web test`（含 visual-only 用例）；`pnpm --filter @aetherlife/game-server test`。

**续发 12（2026-06-05）— 页面角色完全不移动**

- **复现：** 长按 D/→；`moveDebug` 显示 `pending` 递增但 `gridX` 不变、`locomoting=false`；或 E2E `uat-phase6-move-flash` 报 `movement did not advance`。
- **根因：** 续发 11 在 `maybeQueueVisualStep` 加入 `dist !== 1` 早退：逻辑格滞后于 `serverTo` 时（曼哈顿距 >1）跳过 `queueStep`，Phaser 本地步进队列断链。
- **修复：** 移除 `dist !== 1` 检查；仅当 `logic` 已在目标格时跳过；其余一律 `queueStep`。
- **验证：** `pnpm --filter @aetherlife/web test`；`node scripts/uat-phase6-move-flash.mjs`（gridX 2→15，无闪回）。

**防复发**

- Guardrails 第 44–46 条。

---

### ISSUE-009 — 往上走角色被暗角遮住

- **状态:** fixed（2026-06-05）
- **发现:** 2026-06-05
- **阶段/范围:** Phase 07 · `apps/web` · `RoomScene` vignette
- **严重性:** major

**复现**

1. `pnpm dev:stack` 进入房间，长按 `W` / `↑` 往北走（`gridY` 减小至 0–2）。
2. 本地玩家圆环/标签渐隐，像「藏进地图顶边」。

**根因**

- `drawVignette()` 在**世界坐标 (0,0)–(480,480)** 画顶部条带，`vignetteGfx.setDepth(50)` 高于玩家 `entityDepth`（`gy` 小时约 16）。
- 相机跟随到低 `gy` 时该条带进入视口并叠在玩家之上（非屏幕空间晕影）。

**修复（方案 A）**

- 移除 `vignetteGfx` / `drawVignette()`；边缘晕影仅保留 CSS `inset box-shadow`（与 07-UI-SPEC D-20 一致）。
- Phaser 4.0.0 包内无 `camera.postFX.addVignette`；未引入 postFX 依赖。

**验证**

- `pnpm --filter @aetherlife/web test`（13 passed）
- `pnpm uat:vignette:playwright` → `gridY 4→1`，截图见 `uat-screenshots/vignette-fix/`
- 文档：[docs/VIGNETTE-FIX-UAT.md](./VIGNETTE-FIX-UAT.md)

**防复发**

- Guardrails 第 47 条。

---

### ISSUE-010 — 探索北向（负 gridY）玩家被地板盖住

- **状态:** fixed（2026-06-05）
- **发现:** 2026-06-05（ISSUE-009 修复后用户 UAT）
- **阶段/范围:** Phase 07 · `RoomScene` · `entityDepth`
- **严重性:** major

**复现**

1. 从家园往北探索至 `gridY < 0`（如格 (5, -11) chunk (0,-2)）。
2. 玩家 marker 完全不可见，地图仍正常渲染。

**根因**

- `entityDepth = 10 + gy*10 + gx`；`gy=-11` 时 depth ≈ -93。
- `floorGfx` 默认 depth 0，实体 depth 为负时绘制在地板**之下**。
- 与 ISSUE-009（晕影）无关；家园内小 `gy` 时旧公式仍为正，故仅负坐标暴露。

**修复**

- `entityLayout.entityDepth`：`ENTITY_DEPTH_BASE (10000) + gy*10 + gx + layer`。
- `floorGfx/pathGfx/flashGfx` 固定 depth 0/1/2；`syncEntities` 每帧刷新玩家 depth。

**验证**

- `pnpm --filter @aetherlife/web test`（含 `entityLayout.test.ts`）
- 手动：刷新后回到 (5,-11)，金色「你」应可见

---

### ISSUE-011 — matchmake/join 控制台 521，Phaser 已加载但进不了房

- **状态:** fixed
- **发现:** 2026-06-06
- **阶段/范围:** Phase 11 · `apps/web` · Colyseus 进房
- **严重性:** major

**复现**

1. 打开 `http://localhost:5173`（或 Cloudflare 隧道仅暴露 5173）。
2. DevTools Network 见 `:2567/matchmake/join/game_room` **521**；或 `pnpm dev:stack` 未启动时完全无法进房。
3. Phaser canvas 已渲染，但「正在连接 Colyseus…」不消失或报错。

**根因**

- `useColyseusRoom` 硬编码 `ws://hostname:2567`，绕过 Vite `/matchmake` 代理；隧道/仅 5173 暴露时直连 2567 失败。
- 先进 `client.join` 再 `joinOrCreate`：新 room 时 **Colyseus 正常返回 HTTP 521**（`no rooms found`），DevTools 误报为「服务器挂了」。
- `dev:stack` 停止时 game-server 不可达，所有 matchmake 失败。

**修复**

- `useColyseusRoom`：`resolveColyseusWsUrl()`（localhost → `ws://127.0.0.1:2567`；隧道 → 同源 `/matchmake`）；`joinOrCreate` 优先。
- `PhaserGame.tsx`：`exploreGrid` 监听 `setdata` + `changedata`（坐标条进房即显）。
- `RoomScene.ts`：`syncEntities` 末尾 `tickExploreGrid()`。
- `GameRoom.ts`：`onJoin` 调用 `onPlayerEnterChunk`，home 显示「晨曦村」lore。

**验证**

- `pnpm dev:stack` → 进房无持久「正在连接 Colyseus…」；DevTools 偶发 521 可忽略。
- `pnpm uat:phase10:playwright` + `pnpm uat:phase11:playwright`（2026-06-06 PASS）
- Cursor Browser API：见 `.planning/milestones/v1-phases/11-llm-world-lore/UAT-CASES.md` §C

**防复发**

- Guardrails 第 49–50 条。

---

### ISSUE-012 — 进房后 explore 坐标条空白（Phaser 4 setdata）

- **状态:** fixed
- **发现:** 2026-06-06（ISSUE-011 修复后 UAT）
- **阶段/范围:** Phase 10–11 · `PhaserGame` · `RoomScene`
- **严重性:** major

**复现**

1. Colyseus 已进房，Phaser canvas 正常，但 `explore-coords-strip` 长期空白或仅显示引导文案。
2. 移动后坐标条才出现。

**根因**

- Phaser registry 首次 `set("exploreGrid")` 触发 **`setdata`**，后续才 **`changedata`**。
- React 只监听 `changedata`，错过初始值。

**修复**

- `PhaserGame` 同时监听 `setdata` / `changedata`。
- `RoomScene.syncEntities` 末尾 `tickExploreGrid()`。

**验证**

- `pnpm uat:phase10:playwright`（strip 进房即见）
- Browser API 截图：`uat-screenshots/browser-api/04-joined-chenxi-home.png`

**防复发**

- Guardrails 第 50 条。

---

### ISSUE-013 — lore ready 后无 discover toast（isFirstDiscover 与 storyHook 分消息）

- **状态:** fixed
- **发现:** 2026-06-06（Phase 11 conversational UAT Test 6）
- **阶段/范围:** Phase 11 · `useChunkLore.ts` · `LoreDiscoverToast`
- **严重性:** major

**复现**

1. 走出家园进入新 chunk，探索条显示 biome + 「正在书写这片土地…」。
2. 等待 LLM ready，地名/flavor 正常更新。
3. Canvas 上方 **无** `lore-discover-toast`（storyHook 旁白）。

**根因**

- 服务端：`isFirstDiscover: true` 仅在 **pending** loreSync；**ready** 带 `storyHook` 但无 `isFirstDiscover`。
- 客户端 toast 条件 `isFirstDiscover && lore.storyHook` 同条消息，永远不满足。
- **第二处：** `ChatPage` 在 `useEffect` 里调用 `consumeDiscoverToast()`，依赖 `setState` updater 同步返回值；React 异步批处理下 `picked` 恒为 `null`，队列有项但 UI 不渲染。

**修复**

- `loreDiscoverToastsFromSync`：pending+isFirstDiscover 记入 Set，ready 时入队。
- `ChatPage`：直接 `discoverToast = loreToastQueue[0]`，dismiss 时再 `consumeDiscoverToast()`。
- `LoreDiscoverToast`：toast `pointer-events: auto` + 点击 dismiss；effect 按 chunk 身份键计时，`onDismiss` 用 ref，避免 Phaser 重渲染重置 8s 定时器。
- 单测 `useChunkLore.test.ts`；回归 `node scripts/debug-lore-toast.mjs`。

**验证**

- `pnpm --filter @aetherlife/web test`
- `node scripts/debug-lore-toast.mjs`（2026-06-06：sawPending→ready，toast visible）
- 手动：硬刷新 → 新 chunk ready → map 底部 overlay「发现新土地」；**点击关闭** + **约 8s 自消**（2026-06-06 用户 UAT pass）

**防复发**

- Guardrails 第 51 条。

---

### ISSUE-014 — NPC speak 后「正在思考…」过久

- **状态:** fixed
- **发现:** 2026-06-06（Phase 11.6 智谱 GLM-4.7-Flash 真实联调）
- **阶段/范围:** `workers/agent-worker` · `useNpcChat` · speak → done 链路
- **严重性:** major

**复现**

1. `pnpm dev:stack`（真实 LLM，如 `LLM_PROVIDER=zhipu`）。
2. 对 NPC 发「移动到我的下方」等含物理动作的指令。
3. UI 长时间显示「{NPC}正在思考…」，直到 worker 整图跑完才收到 `done`。

**根因**

- `process_job` 在 LangGraph **整图**（含 `persist_turn_memory` 的 importance LLM、reflect、summarize）完成后才 `emit done`；UI 的 thinking 状态绑定 `done`。
- 物理动作指令若首轮无 tool call，`_invoke_llm_turn` 会 **二次** invoke LLM（叠加智谱 2–15s/次延迟）。

**修复**

- 拆分为 `run_npc_turn_interactive`（fetch → LLM → apply → reply）与 `run_npc_memory_tail`；`process_job` **先 emit done，再跑 memory tail**（tail 失败不影响已展示的回复）。
- `build_turn_messages`：物理动作指令追加「必须调用 move/interact/wait」系统提示，降低双 invoke 概率。

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_npc_loop_mock.py -q`
- 手动：`pnpm dev:stack` → 对 NPC 发移动指令 → thinking 应在首轮 LLM+apply 后结束（memory 仍在后台写入）

**防复发**

- Guardrails 第 52 条。

---

### ISSUE-015 — Colyseus speak 阻塞：speakAck 等待 sync memory embed

- **状态:** fixed
- **发现:** 2026-06-06
- **阶段/范围:** Phase 08 / apps/game-server `npc-chat.ts`
- **严重性:** major

**复现**

1. `pnpm dev:stack` → 客户端 `room.send("speak", …)` 或 `pnpm verify:phase8` parallel speakAck 用例。
2. `startNpcChatTurn` 在 `addNpcTurnJob` 之前 `await appendPlayerMemory()`（内部 `scoreImportance` + `embedText` 调 LLM）。
3. `onMessage("speak")` 被阻塞 30–90s，`speakAck` 迟迟不发。

**根因**

- 玩家发言记忆写入（importance + embedding）在 Colyseus 消息 handler 内同步 await，与 worker 队列解耦不足。

**修复**

- `startNpcChatTurn`：先 `addNpcTurnJob` 返回 `jobId`，`appendPlayerMemory` 改为 fire-and-forget（`.catch` 打日志）。

**验证**

- `pnpm verify:phase8`（parallel speakAck、~200s 内通过）
- probe：`speakAck` ~3–4s（`playerId` ≥8 字符）

**防复发**

- Guardrails 第 54 条。

---

### ISSUE-016 — verify:phase8 memory recall 与 async append 竞态

- **状态:** fixed
- **发现:** 2026-06-06
- **阶段/范围:** Phase 08 / `scripts/verify-phase8.mjs`
- **严重性:** major

**复现**

1. ISSUE-015 修复后，`pnpm verify:phase8` memory FACT 用例。
2. speak 终端事件已返回，但 `GET /internal/.../memory-context` 立即查询。
3. 报错：`memory-context missing FACT-P8-…`。

**根因**

- `appendPlayerMemory` 异步化后，embed/importance 仍在进行；verify 单次 GET 无重试。

**修复**

- `verify-phase8.mjs`：memory-context 用 `waitFor` 轮询（默认 90s，`VERIFY_MEMORY_POLL_MS` 可覆盖）。

**验证**

- `pnpm verify:phase8` → `Colyseus speak → memory recall OK`

**防复发**

- Guardrails 第 55 条。

---

### ISSUE-017 — verify:phase11 dedup 段 lore GET 已过但 posts 未 +1

- **状态:** fixed
- **发现:** 2026-06-06
- **阶段/范围:** Phase 11 / `scripts/verify-phase11.mjs`
- **严重性:** minor

**复现**

1. `pnpm verify:phase11` dual-tab dedup 段。
2. `GET /chunks/2/0/lore` 已有 `nameZh`，但单次 `fetchLoreMetrics()` 快照 `posts` 仍为 baseline。
3. 报错：`dual-tab dedup: posts expected +1 (before=42 after=42)`。

**根因**

- Worker POST lore 与 metrics 内存计数在时间上紧挨 GET 断言；脚本未 poll `posts`，偶发竞态。
- 同段 chunk 边界 WASD 易超时，已改用 DEV `__aetherlife_sendMoveTo`（`sendMoveToGrid`）。

**修复**

- `verify-phase11.mjs`：GET lore 通过后 `waitFor` poll `metrics.posts >= before + 1`（与 `enqueues` 一致）。
- dedup 移动：`sendMoveToGrid` + staging 坐标 `(14,7)/(13,7)`，y=7 直达避免 chunk `(2,1)` 额外 enqueue。

**验证**

- `pnpm verify:phase11` OK（`.planning/e2e-full-run/verify-phase11-20260606-215345.log`）

**防复发**

- Guardrails 第 56 条。

---

### ISSUE-018 — 连续 speak 两轮 NPC 回复完全相同

- **状态:** fixed
- **发现:** 2026-06-06
- **阶段/范围:** Phase 12 / worker prompt + game-server speak
- **严重性:** major（体验）

**复现**

1. 对同一 NPC 连问「你喜欢我吗？」与「为什么你对我的态度是戒备」。
2. 两轮 `done.reply` 措辞几乎一致；调试面板 attitude 均为 wary。

**根因**

- Worker 每轮仅发送 System + 当前 `Player message`，**无 Chat UI 可见的多轮历史**。
- NPC 回复在 `done` 之后才 async 写入 memory；第二轮 prompt 看不到上一轮 Q&A。
- 两问均关于关系/态度，system 中 attitude 块相同，小模型易复读人设话术。

**修复**

- game-server：`npc/dialogue-session.ts` 在 `emitJobEvent(done)` 同步追加 player+npc 对；`startNpcChatTurn` 将 `recentTurns` 写入 job payload。
- worker：`build_turn_messages` 注入最近 10 条 Human/AI 交替消息 + system 规则 6（针对最新一条、勿复读）。

**验证**

- `pnpm --filter @aetherlife/game-server test -- src/npc/dialogue-session.test.ts src/sse/hub.colyseus.test.ts`
- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_graph_tools.py -q`

**防复发**

- Guardrails 第 57 条。

---

### ISSUE-019 — 切换 NPC tab 态度 chip 在戒备/平常间闪烁

- **状态:** fixed
- **发现:** 2026-06-07
- **阶段/范围:** Phase 12 UAT / `apps/web/src/hooks/useCollectiveAttitude.ts`
- **严重性:** major（UI 错态）

**复现**

1. `?collectiveDebug=1` 下切换莫玄虚/诸葛知危 tab。
2. chip 与 overlay 在「戒备 eff -5」与「平常 eff 15」间来回跳。

**根因**

- `useCollectiveAttitude` 切换 `activeNpcId` 时未 abort 进行中的 fetch；旧 NPC 的 `collective-state` 响应晚到，覆盖新 tab 的 snapshot（莫玄虚 seed -5 与诸葛知危 +15 串台）。

**修复**

- effect 内 `AbortController` + request 序号；snapshot 带 `npcId`。
- 改为 bulk `GET /collective-state`（无 `npcId`）一次拉齐全部 NPC，按 `npcId` 缓存在 Map；切换 tab 只读缓存，不再 per-tab 请求（消除 chip 空白等待）。

**验证**

- 手动：切换三个 NPC tab，chip 即时显示且稳定为 seed；无戒备/平常闪烁。
- `pnpm --filter @aetherlife/web test`

**防复发**

- Guardrails 第 58 条。

---

### ISSUE-020 — 单人 rude speak 态度无变化（规则词表 + D-04 误挡）

- **状态:** fixed
- **发现:** 2026-06-07
- **阶段/范围:** Phase 12 UAT Test 5 · `rule-detector.ts` · `collective/service.ts`
- **严重性:** major（功能未触发）

**复现**

1. 单人进房，对阿斯托利亚说「你来打我啊，你是个变态」。
2. chip / DEV overlay 仍为「平常 eff 0」，无 `rude` event。

**根因**

1. `RUDE_PATTERN` 仅匹配「粗鲁|滚|笨蛋|讨厌|去死」，未覆盖「变态/打你」等常见辱骂。
2. `recordRuleEvent` 对 **所有** 规则事件套用 D-04「窗内 ≥2 玩家」，单人 speak 规则被 `single_player` 丢弃，reputation 不更新。

**修复**

- 扩展 `RUDE_PATTERN`（变态、打你/打我、傻逼等）。
- `detectSpeak` 调用 `recordRuleEvent` 时传 `singlePlayerOk: true`；**action** 规则（compete/collaborate/contradict）仍要求双人窗。

**验证**

- Phase 12.1 Option B：`LLM_MOCK=1 uv run pytest tests/test_npc_social_order.py tests/test_social_turn.py -q`； insult 后 `collectiveUpdated` + web refetch。
- 历史（Phase 12 规则路径）：`pnpm --filter @aetherlife/game-server test -- src/collective`

**防复发**

- Guardrails 第 59 条。

**后续（方案 A，2026-06-07）**

- 「你是不是有病？」未命中词表；D-02 `ambiguous` / worker refine 未接线；`turn_importance` 仅评 NPC 回复。
- 扩展 rude + ambiguous 词表；job `collectiveAmbiguous`；`max(player,npc)` importance。
- 验证：`pnpm --filter @aetherlife/game-server test -- src/collective`；`cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_collective_refine.py -q`。

---

### ISSUE-021 — detectSpeak 后 pruneExpired 传 Date 进 raw SQL 报错

- **状态:** fixed
- **发现:** 2026-06-07
- **阶段/范围:** Phase 12 UAT · `packages/npc-memory/src/collective/repository.ts` · `pruneExpired`
- **严重性:** major（控制台 ERR_INVALID_ARG_TYPE；prune 失败）

**复现**

1. `pnpm dev:stack` + 真实 `DATABASE_URL`，对 NPC 说「你好丑啊」等 rude 句。
2. game-server 日志：`[npc-chat] detectSpeak failed TypeError … Received an instance of Date`。
3. overlay 可能已显示 rep/eff 变化（insert + applyReputationDelta 已成功），但 prune 步骤抛错。

**根因**

- `pruneExpired` 使用 `` sql`${collectiveEvents.createdAt} < ${cutoff}` ``；postgres.js 绑定参数不接受裸 `Date`，须 Drizzle `lt()` 或 ISO 字符串。

**修复**

- `pruneExpired` 改为 `lt(collectiveEvents.createdAt, cutoff)`。

**验证**

- `pnpm --filter @aetherlife/npc-memory test -- src/collective/repository.test.ts`
- `pnpm --filter @aetherlife/game-server test -- src/collective/service.test.ts`
- 重启 dev:stack 后 rude speak，终端无 `detectSpeak failed`。

**防复发**

- Guardrails 第 61 条。

---

### ISSUE-022 — speak 瞬间双路智谱 chat → appendPlayerMemory 429

- **状态:** fixed
- **发现:** 2026-06-07
- **阶段/范围:** Phase 11.6 / 12 · `npc-chat.ts` · worker `persist_turn_memory` · `importance.ts`
- **严重性:** major（终端刷 `[npc-chat] appendPlayerMemory failed` 429；玩家记忆可能未写入）

**复现**

1. `.env`：`LLM_PROVIDER=zhipu`，`LLM_MODEL=glm-4.7-flash`（智谱账户并发=1）。
2. `pnpm dev:stack` → 对 NPC speak。
3. game-server 日志：`appendPlayerMemory failed` + 智谱 429；`pnpm verify:llm-models` 在已有 worker 占用时 probe 亦 429。

**根因**

- ISSUE-015 将 `appendPlayerMemory` 改为 fire-and-forget，但仍与 worker 主对话 **并行** 各打一路智谱 chat。
- 智谱 **glm-4.7-flash 账户级并发=1**；第二路请求立即 429。
- game-server importance 无 provider 分离、无 429 降级。

**修复**

- P0：`startNpcChatTurn` 移除 `appendPlayerMemory`；worker `persist_turn_memory` 串行 `append_player_memory` + `append_npc_memory`。
- P2：`score_turn_importance` 单次 LLM 评 player+npc。
- P3：`LLM_PROVIDER_IMPORTANCE`（默认 Agnes）供 worker + game-server importance。
- P1：game-server `scoreImportance` 429 → 默认 importance 5 仍写入。
- 文档：根 `AGENTS.md`「智谱 GLM-4.7-Flash（账户并发=1）」。

**验证**

- `pnpm --filter @aetherlife/game-server test -- src/memory/openRouterKeys.test.ts`
- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_memory_client.py tests/test_importance.py -q`
- 手动：`pnpm dev:stack` → speak → 无 `appendPlayerMemory failed`；worker tail 后 `memory-context` 含 `player:` 行

**防复发**

- Guardrails 第 62 条。

---

### ISSUE-023 — hostile 移动 gate 无 attitude-gate-hint

- **状态:** fixed
- **发现:** 2026-06-07（Phase 12 UAT Test 6）
- **阶段/范围:** worker `npc_loop` · `main.py` · `useNpcChat` · `ChatPage`
- **严重性:** major（gate 行为正确但 UI 契约未满足）

**复现**

1. 莫玄虚 band=敌意（eff &lt; -30）。
2. 发送「你移动到我的下方！！！」。
3. NPC 不移动，但 **无** `data-testid="attitude-gate-hint"` banner。

**根因**

- hostile 时 LLM 常只调 `wait`（allowed）；`inject_relative_move_tool` 因已有 state-changing tool 不再注入 `move` → `gate_rejected` 仍为 false。
- 客户端 hint 仅监听回复子串「当前关系较紧张」；`gate_rejected` 未经 Colyseus `done` 转发。

**修复**

- `_finalize_hostile_gate`：hostile + 移动/交互意图但 tool_calls 无 move/interact → `gate_rejected` + `gate_kind`。
- worker `done` payload 增加 `gateRejected` / `gateKind`。
- `useNpcChat` → `attitudeGateCue`；`ChatPage` 显示 UI-SPEC copy 3s。

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_tool_gate.py -q`
- 手动：重启 dev:stack → hostile → 移动指令 → 见「{NPC}似乎不愿协助你移动。」约 3s

**防复发**

- Guardrails 第 63 条。

---

### ISSUE-024 — 新游戏 reset 后态度 chip/debug 不恢复 seed

- **状态:** fixed
- **发现:** 2026-06-07（Phase 12 UAT Test 9）
- **阶段/范围:** `useCollectiveAttitude` · `ChatPage` · `useNpcChat`
- **严重性:** major（reset API 成功但 UI 看似无反应）

**复现**

1. rude speak 使莫玄虚 band 偏离 seed。
2. 点击「新游戏」→「确认开始」。
3. 对话可能清空，但 **态度 chip / CollectiveDebugPanel 仍为 reset 前 band 与 events**。

**根因**

- `collectiveRefreshKey = messages.length`；reset 后 length→0。
- `useCollectiveAttitude` 第二段 effect 有 `refreshKey <= 0` 早退，**不 refetch** collective-state。
- 内存 Map 保留旧 snapshot，用户感知「页面没反应」。

**修复**

- 去掉 `refreshKey <= 0`  guard（改为 `< 0` 仅作无效键）。
- 导出 `invalidateCollective()`；`performResetGame` 在 `resetGame()` 成功后调用。
- `resetGame` 增加 try/catch，网络失败时显示「重置房间失败」。

**验证**

- `pnpm --filter @aetherlife/web test -- useCollectiveAttitude`
- 手动：rude speak → 新游戏 → chip 回「戒备」、debug events 清空

**防复发**

- Guardrails 第 64 条。

---

### ISSUE-025 — Phase 12.1 insult 有敌意回复但 eff/rep 不变（LLM kind=ignore）

- **状态:** fixed
- **发现:** 2026-06-07（Phase 12.1 UAT #5，`?collectiveDebug=1`）
- **阶段/范围:** `llm_social_turn.py` · `collective/social_turn.py`
- **严重性:** major（collective 未写入；`collectiveUpdated` 未 emit）

**复现**

1. `pnpm dev:stack`，对莫玄虚说「你好丑啊，活该被打」。
2. NPC 回复明显敌意（握钥匙、阴郁），但 overlay 仍为「戒备 eff -5 · rep -5」，recent events 无 `source=worker` rude。

**根因**

1. **主因（已修）**：Worker `collective/repository.py` 的 `_use_in_memory()` 只读 `os.environ["DATABASE_URL"]`，而 pydantic 从 `.env` 加载到 `settings.database_url` **不会**写入 os.environ。dev:stack 下 worker 把 collective 写入**进程内内存**，game-server 读 Postgres → UI 永远 eff/rep=seed、无 events。
2. **次因**：真实 LLM 常返回 `social.kind=ignore` 与 hostile reply 不一致 → `reconcile_social_perception` 升级（见上一版 fix）。

**修复**

- `_database_url()` 回退 `get_settings().database_url`；`run_worker()` 启动时 sync 到 os.environ。
- Worker `process_job` 成功后打印 `social applied …` / `social skipped …` 到 **`[worker]` 终端**（与 `job received` 同处）。
- `reconcile_social_perception()` + prompt 加强（ insult 必须 rude）。

**验证**

- `cd workers/agent-worker && uv run pytest tests/test_collective_repository_db.py tests/test_social_turn.py tests/test_npc_social_order.py -q`
- 重启 `pnpm dev:stack` → insult 阿斯托利亚 → `[worker]` 见 `social applied … collectiveUpdated=True` → overlay eff/rep 变化 + recent event

**防复发**

- Guardrails 第 70 条。

---

### LLM / OpenRouter

52. **OpenRouter 429（含 `free-models-per-day`）** 时 worker `summarize` / `importance` 与 game-server `importance.ts` 须轮换 `OPENROUTER_API_KEY_2`（与 `embed.ts` 同 `openRouterKeys()` 逻辑）。
53. **Lore 主 provider 失败**（429/403/502–504/404/402/连接超时）须走 `LLM_PROVIDER_LORE_FALLBACK`；JSON 解析失败 **不得** fallback（见 `should_try_lore_provider_fallback`）。
54. **Phase 11.7+ lore fallback 默认 NVIDIA**：`verify-llm-models` 的 `loreProviderConfig` 必须含 `nvidia`/`siliconflow`；probe [05] 为 fallback 哨兵（见 ISSUE-031 fixed）。
55. **`verify:phase8` speak 可靠性（ISSUE-032 fixed）**：须 worker BRPOP FIFO + parallel `createSpeakDrain` + NL `inject_relative_move_tool` 快路径；**禁止** 仅调大 timeout 或轮间 cooldown 冒充修复（D-14）。Ship 前 `pnpm agent:verify --e2e` 三连 pass。
54. **Colyseus `onMessage("speak")` 不得 await** `appendPlayerMemory` / embed / importance LLM；先 `addNpcTurnJob` + `speakAck`，记忆写入异步。
55. **`verify:phase*` 断言 DB/记忆 recall** 时，若 speak 路径已 async append，须 poll `memory-context`（或等价 API），不得 speak 刚结束就单次 GET。
56. **`verify:phase11` lore dedup** 断言 `metrics.posts` 前须 poll 至 `>= baseline + 1`（与 GET lore 分开）；chunk 边界移动优先 `sendMoveToGrid` / `__aetherlife_sendMoveTo`，避免 WASD predict 队列超时。
57. **NPC speak LLM 须带短期多轮上下文**：game-server `dialogue-session` 在 `done` 同步写入 transcript，入队 job 时传 `recentTurns`；worker `build_turn_messages` 用 Human/AI 交替消息链 +「针对最新一条、勿复读」规则。禁止仅依赖向量 retrieved memory 充当会话历史。
58. **`useCollectiveAttitude` 等按 activeNpcId 轮询的 hook**：一次 bulk `collective-state` 拉齐全部 NPC 并缓存；切换 tab 只读缓存。轮询须 abort 旧 fetch + 序号丢弃 stale 响应；禁止 per-tab 串行请求导致 chip 空白或错态。
59. **Phase 12.1+ speak 社交感知**：Worker `llm_social_turn` → `apply_social_from_llm` 须在 `compose_reply` **之前**写入 collective（`source=worker`）；**禁止** game-server `npc-chat` speak 路径调用 `detectSpeak`/`recordRuleEvent`。客户端在 job `done.collectiveUpdated` 时 **单次** refetch collective-state；禁止 400ms/3.5s 轮询链。**Action** 类 collective（compete/collaborate）仍仅 server 规则 + D-04 双人窗。
60. **Phase 12.1 structured social**：LLM parse 失败 → `ignore`，**禁止** server rude 词表回退；已移除 job `collectiveAmbiguous` speak 路径。`turn_importance` 须 `max(score(player_message), score(npc_reply))`。
61. **Drizzle + Postgres 条件值**：禁止在 `` sql`… ${date}` `` 中直接插 `Date`；用 `lt`/`gte`/`eq` 列比较，或显式 `.toISOString()` + timestamptz cast。
62. **智谱 GLM-4.7-Flash 账户并发=1**：禁止 speak 瞬间并行智谱 chat（game-server `appendPlayerMemory` + worker `llm_turn`）；玩家/NPC 记忆仅在 worker `persist_turn_memory` 写入；importance 默认 `LLM_PROVIDER_IMPORTANCE=agnes`；`scoreImportance` 429 降级为 5。见根 `AGENTS.md`。
63. **Hostile attitude gate UI**：worker `done` 须带 `gateRejected`（+ `gateKind`）；hostile 且玩家移动/交互意图但本轮无 move/interact tool 时 `_finalize_hostile_gate` 置 gate；客户端用 `attitude-gate-hint` 展示 UI-SPEC copy，禁止仅依赖回复子串。
64. **新游戏 reset 后 collective 须失效缓存**：`resetGame()` 清空 messages 时 `refreshKey` 变为 0，禁止 `useCollectiveAttitude` 用 `refreshKey <= 0` 跳过 refetch；`performResetGame` 成功须 `invalidateCollective()`（清 Map + 拉 collective-state）。
65. **Agent 迭代大任务先 Plan Mode**，一次一个 slice；prompt 声明 **scope**（允许改的路径）。
66. **Agent 完成前跑** `pnpm agent:verify`；触及 speak/移动/多人/collective 跑 `pnpm agent:verify --e2e`（须 `pnpm dev:stack` + 真实 LLM）。
67. **scope 漂移或旧功能坏了 → revert 重跑**，禁止多轮 prompt 救场。
68. 动 Protected paths（`GameRoom.ts`、`useColyseusRoom.ts`、`RoomScene.ts`、`workers/.../graph/`）须跑 [E2E-POLICY §8 Golden Flows](./E2E-POLICY.md#8-golden-flowsagent-迭代回归预言机)。
69. 本地 push 前：`pnpm hooks:install` 启用 pre-push → `agent:verify --base`。
70. **Phase 12.1 LLM social 一致性**：`run_social_turn_llm` parse 成功后须 `reconcile_social_perception`；明显侮辱/求助而 LLM 标 `ignore` 时 worker 启发式升级（非 server `detectSpeak`）；禁止仅依赖 LLM kind 与 reply 情绪脱节时不写 collective。
71. **Worker collective 持久化**：`collective/repository.py` 的 `_use_in_memory()` / DB 连接须读 `get_settings().database_url`，**不能**只查 `os.environ["DATABASE_URL"]`（pydantic `.env` 不会自动注入 environ）；否则 dev:stack 下 worker 写内存、game-server 读 Postgres，UI 永远 seed 不变。
72. **Supabase 连接预算**：game-server 须共用 `getSharedDb`/`getSharedSql`（单池）；worker collective 须 `psycopg_pool` 复用（禁止每 SQL `psycopg.connect()`）；`.env` 用 pooler **6543**，避免 5432 session pool_size 15 打满。
73. **6543 Transaction pooler**：须禁用 prepared statements（`postgres.js` `prepare: false`；psycopg `prepare_threshold=None`）。否则 `prepared statement "_pg3_N" does not exist`，worker job 失败、speak 无回复、collective 不写。
74. **首屏 room/collective state**：`GET /rooms/:id/state` 与 `/collective-state` 须 retry（game-server 晚于 Vite）；NPC 用 `moveMap` 兜底；collective 失败后用 `baselineCollectiveSnapshots()`；禁止把 `snapshot === null` 永久显示为「加载中」。
75. **jsonb + PgBouncer 6543**：`getSharedSql` 使用 `prepare: false` 时禁止 `sql.json()`；写入 jsonb 用 `JSON.stringify` 字符串参数（见 ISSUE-028）。
76. **Worker npc-turn FIFO**：game-server `LPUSH` + worker **`BRPOP`**（禁止 `BLPOP` LIFO）；worker 启动时 `DEL` stale `aetherlife:npc-turn:jobs`。
77. **social JSON parse 失败**：`run_social_turn_llm` 同 provider **单次** LLM 后即切换 fallback（禁止 parse 失败连打 3 次）；retryable 耗尽 degrade 到 `ignore`。
78. **NL 相对移动快路径**：`inject_relative_move_tool` 已产出 `move` 时 **禁止**再调 main tool LLM（「移动到我的下方」等）。
79. **memory tail 异步**：`run_npc_memory_tail` 须在 `emit done` 之后 **daemon thread**；禁止阻塞下一 speak job dequeue。
80. **STAB-02 门禁**：Phase 12.2+ speak 变更 ship 前 `pnpm agent:verify --e2e` **连续 3 次** exit 0（真实 LLM）；禁止 cooldown-only / timeout-only verify 脚本交差（D-14）。
81. **BullMQ ambient jobId**：`npc-ambient-intent` 的 `jobId` **禁止**含 `:`（BullMQ 非法字符）；用 `ambient-${roomId}-${npcId}-${trigger}-${gameMinute}`（见 ISSUE-043）。
82. **Ambient pending 键**：`pendingByNpc` / `clearPendingNpcIntentJob` 须 **`roomId:npcId`** 作用域；禁止仅 `npcId` 去重（跨房间阻塞 verify 入队）。
83. **Worker ambient BRPOP**：改 `workers/agent-worker` 或长时间 `dev:stack` 后须 **重启 worker**；启动日志须含 `waiting for … ambient-intent jobs`；`verify:phase16` / P16-07 **禁止** `LLM_MOCK`。
84. **Ambient fallback reasonZh**：segment_change 须 **同步** `pickIntentFallbackReasonZh`（game-server）+ worker `_fallback_intent`（动机层，禁止 activity 复述）；`tick` cache miss **禁止**清空 `intentReasonZh`。
85. **Intent 第三行渐进**：默认两行（名+activity）；≤2 格 + dwell≥1s 或 segment 首进才显示 `reasonZh`；移动中 NPC 完全隐藏第三行；`join_vicinity` 隐藏 intent。
86. **Ambient NPC 坐标走 Colyseus schema**：服务端 `runAmbientTick` 只 bump `npc*X/Y` on schema，**不** broadcast speak `patch`；Web **必须**在 `useColyseusRoom.onStateChange` 读 `npc1X/Y…` + `bgNpc*X/Y` merge 进 `moveMap`，`displayNpcs` **位置以 moveMap 为准**（禁止 `roomState?.npcs` 覆盖 stale 坐标）。Speak `registerJob` **须先于** `addNpcTurnJob` LPUSH（ISSUE-044）。

---

### ISSUE-026 — Supabase EMAXCONNSESSION pool_size 15（dev:stack speak 失败）

- **状态:** fixed
- **发现:** 2026-06-07（Phase 12.1 UAT，`pnpm dev:stack` 首条 speak job）
- **阶段/范围:** worker `collective/repository.py` · `packages/npc-memory/db.ts` · game-server chunk/lore repos
- **严重性:** blocker（worker job 失败；UI 显示 connection error）

**复现**

1. `pnpm dev:stack`，对 NPC speak。
2. `[worker] job failed … FATAL: (EMAXCONNSESSION) max clients reached in session mode - pool_size: 15`

**根因**

1. Supabase session pooler 全局上限 ~15；dev:stack 多进程各自建 postgres 池（memory max=5 + collective max=5 + chunk max=3 + lore max=3 + LangGraph checkpointer 1）。
2. Worker collective 每 DB 操作 `psycopg.connect()` 新开连接；单次 social apply 可连续 10+ 连接。

**修复**

- `packages/npc-memory`：`getSharedDb` / `getSharedSql` 单池 max=3（memory + collective + chunk/lore 共用）。
- Worker：`collective/db_pool.py` `ConnectionPool` max_size=2；`insert_worker_event` 单事务写 event + witness rep。
- `.env.example` 强调 port **6543** pooler，勿用 5432 session 上限。
- **6543 追加**：`prepare: false` / `prepare_threshold=None`（PgBouncer transaction 模式不支持 prepared statement）。

**验证**

- 重启 `pnpm dev:stack` → speak 不再 EMAXCONNSESSION；`[worker] social applied …`
- `cd workers/agent-worker && uv run pytest tests/test_social_turn.py -q`

**防复发**

- Guardrails 第 72 条。

---

### ISSUE-027 — 进页 NPC 不显示（game-server 未就绪时 state fetch 失败）

- **状态:** fixed
- **发现:** 2026-06-07（Phase 12.1 UAT，刷新 ChatPage）
- **阶段/范围:** `apps/web/src/hooks/useNpcChat.ts` · `ChatPage.tsx`
- **严重性:** high（地图无 NPC、无 Tab、placeholder 显示「角色」）

**复现**

1. `pnpm dev:stack`，Vite 先于 game-server listen 2567 时打开 http://localhost:5173
2. Vite proxy：`/rooms/default/state` → `ECONNREFUSED 127.0.0.1:2567`
3. `refetchState()` 在 `!res.ok` 时静默 return，`roomState` 长期为 `null`

**根因**

首屏单次 fetch 无 retry；`sceneMapNpcs` / `npcs` 仅读 `roomState?.npcs ?? []`。  
同 race 影响 `GET /collective-state`：`useCollectiveAttitude` 失败后 cache 为空，debug 面板把 `snapshot === null` 误显示为「加载中…」，Tab 无态度 chip。

**修复**

- `refetchState({ retryUntilMs })`：400ms 间隔重试直至成功或超时（mount 用 15s）。
- `displayNpcs = roomState?.npcs ?? moveMap.npcs`（`createDefaultRoom` 兜底）。
- `fetchCollective({ retryUntilMs: 15_000 })` + 失败时 `baselineCollectiveSnapshots()`（personality seed）。
- `CollectiveDebugPanel` 区分 `loading` vs 无数据。

**验证**

- 重启 dev:stack → 刷新页面 → 地图显示莫玄虚/阿斯托利亚/诸葛知危 + NPC Tab。

**防复发**

- Guardrails 第 74 条。

---

### ISSUE-028 — verify:phase12 中途 `fetch failed` + chunk delta 持久化 TypeError

- **状态:** fixed
- **发现:** 2026-06-07（自动化 `VERIFY_PHASE12_FAST=1 pnpm verify:phase12`）
- **阶段/范围:** `scripts/verify-phase12.mjs` · `apps/game-server/src/world/chunk-repository.ts` · `lore-repository.ts`
- **严重性:** high（Phase 12 协议 E2E 无法 pass；chunk 写库可能静默失败）

**复现**

1. `pnpm dev:stack`（真实 LLM，无 mock）
2. `VERIFY_PHASE12_FAST=1 pnpm verify:phase12`
3. 输出：`baseline band=wary effectiveScore=-5` 后约 5min → `verify:phase12 failed: fetch failed`
4. 同期 game-server 日志：

```text
TypeError [ERR_INVALID_ARG_TYPE]: The "string" argument must be of type string...
    at saveChunkDelta (.../chunk-repository.ts:50:9)
```

**根因**

- `getSharedSql` 使用 `prepare: false`（Supabase 6543 transaction pooler）。`sql.json(obj)` 在非 prepared 绑定路径下传入 Object，postgres.js `byteLength` 抛 `ERR_INVALID_ARG_TYPE`。
- `apply-actions` interact（door）触发 `persistDelta` → game-server 异常 → 后续 HTTP `fetch failed`。

**修复**

- `chunk-repository.ts` / `lore-repository.ts`：`JSON.stringify(...)` 写入 jsonb 列（不用 `sql.json`）。
- `verify-phase12.mjs`：`request()` 包装 fetch 输出 path。

**验证**

```bash
pnpm dev:stack
pnpm --filter @aetherlife/game-server test
VERIFY_PHASE12_FAST=1 pnpm verify:phase12
E2E_FULL_CONTINUE=1 pnpm e2e:full-run
```

**防复发**

- Guardrails 第 75 条：PgBouncer 6543 + `prepare: false` 时禁止 `sql.json()`，jsonb 用 `JSON.stringify`。

---

### ISSUE-029 — hostile NL speak `load_tools_for_binding` UnboundLocalError

- **状态:** fixed
- **发现:** 2026-06-07（`VERIFY_PHASE12_FAST=1 pnpm verify:phase12` 末步「移动到我的下方」）
- **阶段/范围:** `workers/agent-worker/src/graph/nodes/llm_social_turn.py`
- **严重性:** high（hostile 下 NL 移动 speak 500，verify:phase12 失败）

**根因**

`_invoke_tool_turn` 在 `LLM_MOCK` 分支内 `from src.graph.tools import load_tools_for_binding`，使 Python 将同名符号视为函数局部变量；真实 LLM 路径引用时未赋值 → `UnboundLocalError`。

**修复**

删除 mock 分支内重复 import（模块顶已 import）。

**验证**

`VERIFY_PHASE12_FAST=1 pnpm verify:phase12` → `worker gate hint in reply OK` + `verify:phase12 OK`

---

### ISSUE-030 — chunk-lore 被 speak 队列饿死

- **状态:** fixed
- **发现:** 2026-06-07（`pnpm verify:phase11` / 全量 `e2e:full-run` lore ready 120s 超时；metrics `enqueues>0 posts=0`）
- **阶段/范围:** `workers/agent-worker/src/main.py` · `scripts/verify-phase11.mjs`
- **严重性:** high（Phase 11 探索叙事 E2E 无法通过）

**根因**

Worker 主循环仅在 npc-turn 队列 **连续 5s 为空** 时才 `BLPOP` chunk-lore。全量 E2E 或 Redis speak 积压时 lore 永不执行。

**修复**

1. 每处理完一个 speak job 后 `LPOP` 至多一条 chunk-lore（公平 drain，不阻塞 speak 优先策略）。
2. verify:phase11 缓存重入断言改为 **enqueues 不变**（全局 `posts` 会被积压 lore 误伤）。

**验证**

`pnpm verify:phase11`（worker 重启后）→ first discover + cache hit + dedup

**防复发**

- 全量跑前读 E2E-RUN-LOG；lore 超时先查 worker 是否 `[lore_complete]` / `lore job received`。

---

### ISSUE-031 — verify:llm-models 误报 NVIDIA_API_KEY 缺失（脚本未注册 nvidia provider）

- **状态:** fixed
- **发现:** 2026-06-07（Phase 11.7 E2E 复验 `pnpm verify:llm-models`）
- **阶段/范围:** `scripts/verify-llm-models.mjs` · Phase 11.7
- **严重性:** major（误报导致以为 `.env` 未配置 Key）

**复现**
1. `.env` 已填 `NVIDIA_API_KEY`，`LLM_PROVIDER_LORE_FALLBACK=nvidia`
2. `pnpm verify:llm-models` → probe [05] `missing API key`（keyLabel 显示 `API_KEY`）

**根因**
- `loreProviderConfig` 仅有 groq/agnes/openrouter/zhipu/cerebras，**无 `nvidia` / `siliconflow`**；`loreFbCfg` 为 `undefined` 时走 missing 分支，与 `.env` 是否填 Key 无关。

**修复**
- `verify-llm-models.mjs`：注册 `nvidia` + `siliconflow`；`resolveLoreFallbackModel()` 对齐 worker 默认；新增 importance / social 探针；`.env` 值去引号。

**验证**
- `pnpm verify:llm-models` → [05] Lore fallback **PASS**（NVIDIA_API_KEY）；[06] importance PASS

---

### ISSUE-032 — verify:phase8 speak / NL 偶发 timeout（parallel + memory FACT）

- **状态:** fixed
- **发现:** 2026-06-07（11.7 E2E：`verify:phase8` 首次 fail，冷却复跑 pass）
- **阶段/范围:** Phase 08 / 12.2 speak reliability · worker queue · social LLM · verify script
- **严重性:** major（CI/全量 E2E flaky）

**复现**
1. `pnpm dev:stack`（真实 worker，无 mock）
2. `pnpm verify:phase8` → parallel speak OK 后 `NL npc-1 player A: timed out` 或 `memory FACT speak: timeout 180000ms`
3. 无代码修复时冷却 2–3min 复跑有时 pass（假阳性）

**根因**
1. **队列 LIFO**：game-server `LPUSH` + worker **`BLPOP`** → 并行 speak 后进先出，NL job 饿死。
2. **E2E 竞态**：parallel drain 在 `speakAck` 之后才注册 listener，先完成的 `done` 可漏收。
3. **social JSON parse 浪费**：非 JSON 响应时同 provider **重试 3 次**（~30–120s/次），挤占 180s 客户端超时。
4. **NL 慢路径**：相对移动仍走 main tool LLM，即使 `inject_relative_move_tool` 可确定性解析。
5. **memory tail 阻塞 dequeue**：`run_npc_memory_tail` 在 emit `done` 前同步跑 importance LLM。
6. **智谱单槽**（次要）：12.2-01 已迁 SiliconFlow；残留 flake 主要来自 1–5。

**修复**
- Worker：`BLPOP` → **`BRPOP`**；启动 **`DEL`** stale bridge queue；memory tail → **daemon thread** after `done`。
- `run_social_turn_llm`：JSON parse fail **break** 至下一 provider；retryable 耗尽 **degrade** ignore。
- `llm_social_turn`：相对移动 **inject 快路径** 跳过 main tool LLM。
- `scripts/verify-phase8.mjs`：`createSpeakDrain` + `runSpeakTurn` 全程 drain。
- Phase 12.2-01/02/03：SiliconFlow 主路径、per-NPC FIFO、`llmCallSummary` 可观测。

**验证**
- `pnpm agent:verify` — game-server 95 + web 23 + worker 130 passed
- `pnpm verify:phase8` — OK（~142s，parallel + dual NL + memory FACT）
- `pnpm agent:verify --e2e` — **连续 3 次** exit 0（2026-06-07，`.planning/milestones/v2-phases/12.2-speak-reliability/e2e-triple-run.log`）
- `pnpm verify:llm-models` — 8/9 pass（Cerebras reserved probe HTML 403 已知非阻塞）

---

### ISSUE-033 — verify:llm-models 未覆盖 11.7 角色路由探针

- **状态:** fixed
- **发现:** 2026-06-07（11.7 E2E 复验）
- **阶段/范围:** `scripts/verify-llm-models.mjs`
- **严重性:** minor

**根因**
- 脚本未探测 `LLM_PROVIDER_SOCIAL` / `LLM_PROVIDER_IMPORTANCE`；lore fallback 未注册 NVIDIA provider（见 ISSUE-031）。

**修复**
- 同 ISSUE-031：新增 Memory importance、NPC social JSON 探针；`loreProviderConfig` 补全 nvidia/siliconflow。

**验证**
- `pnpm verify:llm-models` → [05] lore fallback、[06] importance、[07] social PASS

---

### ISSUE-034 — Phase 13 RoomScene 缺 FloorRenderer import → Phaser boot 全 fallback

- **状态:** fixed
- **发现:** 2026-06-07（`/gsd-execute-phase 13` E2E：`pnpm verify:phase6:move-only` / `verify:phase13`）
- **阶段/范围:** `apps/web/src/game/RoomScene.ts`
- **严重性:** critical（`create()` 抛 `FloorRenderer is not defined`，`probePhaserBoot` false，全页 MovementPanel fallback）

**根因**

13-02 引入 `FloorRenderer` 实例字段但未添加 `import { FloorRenderer } from "./FloorRenderer.js"`。

**修复**

补 import。

**验证**

- `pnpm verify:phase6:move-only` → OK
- `pnpm verify:phase13` → OK（bootMs≈600ms，chunk dist=2）

---

### ISSUE-035 — NPC 思考中 composer 被禁用无法输入/排队

- **状态:** fixed
- **发现:** 2026-06-08（Phase 13 UAT Test 7）
- **阶段/范围:** `apps/web/src/ChatPage.tsx` · `useNpcChat.composerBusyForActiveNpc`
- **严重性:** major（用户无法打字；与 speak 队列 UX 矛盾）

**复现**

1. 对当前 Tab NPC 发送一条 speak，进入「思考中」
2. 尝试在底部输入框继续输入 → textarea `disabled`，无法打字

**根因**

- `composerBusyForActiveNpc` 在 `thinking` / `speakBusy` / `sending` 时为 true，绑定了 `textarea disabled`
- `sendMessage` 已在 in-flight 时 `enqueueNpcSpeak` 排队，UI 却禁止输入

**修复（2026-06-08 方案 A）**

- 产品改为 life-sim 方案 A：thinking/sending/speakBusy 时禁用 composer，不再客户端排队
- `sendMessage` in-flight 时直接 return；ISSUE-036 drain/ref 修复保留（仅 speakBusy 内部队列）

**验证**

- `pnpm --filter @aetherlife/web test`
- 手动：speak 后思考中输入框禁用、placeholder「请等待…回复」、composer 显示「正在思考…」

---

### ISSUE-036 — 思考中排队消息不回复 + banner 不可见/文案错误

- **状态:** fixed
- **发现:** 2026-06-08（Phase 13 UAT / 用户连发两条 speak）
- **阶段/范围:** `useNpcChat.ts` drain · `ChatPage.tsx` banner/composer 状态
- **严重性:** major（第二条消息永不发送；UX 误导）

**复现**

1. 对 NPC 发送「你在干什么？」，进入思考
2. 思考中再发「你怎么喜欢诸葛知危啊」
3. 第一条有回复，第二条无回复；顶部无排队提示（或显示「其他玩家」）

**根因**

- `onDone` 用 `queueMicrotask(drainSpeakQueue)`，但 `thinkingNpcIdRef` 仍指向该 NPC（setState 未 flush），`isNpcInFlightNow` 为 true → drain 直接 return，队列卡住
- 顶部 banner：`speakQueueBusy` 在单人 thinking 时也 true，却走「其他玩家」分支；banner 在 `chat-main` 顶部，用户视线在 composer

**修复**

- `clearInFlightRefsForDrain` + `onDone`/`onSpeakAck`/`clearSendingState` 同步 refs
- composer 上方 `composer-speak-status`（思考 / 已排队 N 条）
- 顶部 banner 仅在 `speakQueueDepth > 0` 或多人 `speakBusyNpcId` 时显示

**验证**

- `pnpm --filter @aetherlife/web test`（含 `clearInFlightRefsForDrain` 单测）
- 手动：思考中连发两条 → composer 显示「已排队 1 条」→ 第一条回复后第二条自动发出并回复

---

### ISSUE-037 — Phase 8 speakBusy 时 B 端无「其他玩家占用」banner

- **状态:** fixed
- **发现:** 2026-06-08（e2e-full-run `uat:phase8` Test 4）
- **阶段/范围:** `useNpcChat.ts` · `uat-phase8-playwright.mjs` · 方案 A
- **严重性:** major

**复现**

1. Tab A 对 NPC speak，进入 sending/thinking
2. Tab B 同 room 对同一 NPC 抢发
3. B 仅见「正在思考…」，无 `banner-speak-queue` / 「其他玩家…」；UAT 等 banner 15s 超时

**根因**

- 方案 A：`sendMessage` in-flight 直接 return，占用 UI 靠 `speakBusyNpcId` + `composerSpeakBusyOtherPlayer`
- `onSpeakBusy` inflight 路径 `enqueueSpeak` 后未清 `sendingNpcId` → B 仍判为自身 sending/thinking

**修复**

- `onSpeakBusy`：inflight enqueue 后 `setSendingNpcId(null)` + ref 同步
- `scripts/uat-phase8-playwright.mjs` Test 4：断言 banner **或** `composer-speak-status` 含「其他玩家/稍候」

**验证**

- `pnpm --filter @aetherlife/web test -- src/hooks/useNpcChat.test.ts`
- `source .env && UAT_SPEAK_TIMEOUT_MS=180000 pnpm uat:phase8:playwright`（Test 4 pass；整体可能因 LLM 延迟在 NPC reply 超时）

**防复发**

- Guardrail #58

---

### ISSUE-038 — Phase 13 实装地砖后 proximity 铭牌对比度不足

- **状态:** fixed
- **发现:** 2026-06-08（Kenney 地砖 UAT 后用户截图：铭牌再次难以辨认）
- **阶段/范围:** `entityLabels.ts` · Phase 13 VIS-04 / UAT #6
- **严重性:** major

**复现**

1. `pnpm dev:stack`，进房 sprite 模式（非 visualFallback）
2. 靠近 NPC/远程玩家或 speak 选中 NPC
3. 铭牌在棕色/花纹地砖上几乎看不清（11px + 仅 stroke，无 shadow）

**根因**

- Phase 13 UAT #6 已加 stroke 色，但 **11px + 3px stroke** 在 Kenney 高纹理地砖上仍不足
- 后续 phase 改动未回归目视对比度（自动化 verify 不覆盖可读性）

**修复**

- `NAMEPLATE_FONT_SIZE` 12px、`NAMEPLATE_STROKE_WIDTH` 4、fontWeight 600、`setShadow` 深色投影
- `entityLabels.test.ts` 锁定 `applyNameplateStyle` 调用契约

**验证**

- `pnpm --filter @aetherlife/web test -- src/game/entityLabels.test.ts`
- `pnpm verify:phase13` + 人工：≤2 格 / speak 时铭牌在头顶清晰可读

**防复发**

- Guardrail #57、#59

---

### ISSUE-039 — home 土路围栏 decor 盖住玩家/NPC

- **状态:** fixed
- **发现:** 2026-06-08（Phase 13.2 UAT 实机：莫玄虚/阿斯托利亚等站在 y=6 土路时石墙画在角色上方，仅露脚）
- **阶段/范围:** `DecorRenderer.ts` · `entityLayout.ts` · Phase 13.2 homeLayout
- **严重性:** major

**复现**

1. `pnpm dev:stack`，进 home chunk，玩家或 NPC 站在 `homeLayout` 围栏行（gy=6）
2. 水平 fence decor 与角色同格，身体被挡、铭牌仍可见

**根因**

- `DecorRenderer` 与实体均用 `entityDepth(gx, gy, 1)`；decor 在 `refresh` 中后创建，同 depth 时 decor 在上层

**修复**

- decor 统一 `entityDepth(..., 0)`（`DECOR_DEPTH_LAYER`）；实体保持 layer 1+

**验证**

- `pnpm --filter @aetherlife/web test -- src/game/entityLayout.test.ts`
- 维护者实机 pass（土路 y=6 角色不再被围栏挡住）

**防复发**

- Guardrail #60

---

### ISSUE-040 — 被挡 WASD 角色仍朝下 idle 不转向

- **状态:** fixed
- **发现:** 2026-06-08（Phase 14.1 UAT：左右被 NPC/箱挡住时按 A/D sprite 仍朝 south）
- **阶段/范围:** `clientMovementPredictor` · `move-handler` · Phase 14.1 blocked-move-facing
- **严重性:** minor

**复现**

1. `pnpm dev:stack`，站在 NPC 或障碍前
2. 按 A 或 D（或 W/S）尝试移动
3. 角色保持朝下 idle，不朝输入方向

**根因**

- 朝向仅在成功 `enqueueStep` / 服务端迈格时更新；`clientCanStep` 失败路径只 `onHint` 并 return
- 服务端 `applyPlayerMove` blocked 不写 `player.facing`；客户端不发 move 包

**修复**

- Wave 1：`onBlockedFace` + `faceInputDirection` → `playIdleAnim`
- Wave 2：`notifyBlockedStep` 发无 `clientSeq` 的 `{ dx, dy }`；`applyPlayerMove` blocked 更新 facing + `GameRoom` `bumpStateVersion`

**验证**

- `pnpm --filter @aetherlife/web test -- clientMovementPredictor`
- `pnpm --filter @aetherlife/game-server test -- move-handler`
- `pnpm agent:verify`

**防复发**

- Guardrail #61

---

<!-- 新问题上文追加，保持 ISSUE 编号递增 -->

### ISSUE-041 — PLAY-03 有 memoryQuote 但口播拒答 + social LLM 偶发 ~135s

- **状态:** fixed
- **发现:** 2026-06-09（Phase 15 PLAY-03 UAT：引用块显示「密码是 7」，NPC 口播「请自重…不向不信任的人透露」；debug log 慢路径 SiliconFlow APITimeout ×3 ≈137s）
- **阶段/范围:** `llm_social_turn.py` · `config.py` · PLAY-03 D-memory-uat
- **严重性:** major

**复现**

1. 同 `playerId` 跨 refresh 写入 FACT（如门禁密码 7），再追问「你还记得门禁密码是什么吗」
2. UI 出现 `npc-memory-callback`，但 NPC 正文未回答「7」
3. 偶发 speak job 150s+：`load_memory` 后 SiliconFlow social 三次 APITimeout 才 fallback

**根因**

- Interactive speak 图只用 `llm_social_turn`；`_build_social_messages` 未注入 `memory_summary`，与 `memoryQuote`（`pick_memory_quote`）分叉
- 低态度 band + 无记忆 prompt → 戒备 persona 覆盖事实召回
- `run_social_turn_llm` 每 provider `range(3)` 重试 × `llm_social_request_timeout=45` → ~135s 才切 fallback

**修复**

- Social system prompt + `_build_social_messages` 注入 Memory summary；回忆追问用**当下口吻直接给事实**，禁止 meta 套话（「你上次说过/还记得吗」）；低好感可冷淡但不得与记忆矛盾
- `compose_reply` → `merge_recall_into_reply`（`recall_merge.py`）：LLM 拒答/未含答案时确定性补全（如「门禁密码是 7。」），无 villager 式 callback 口癖
- Interactive 图：`fetch_state_and_memory` 并行 `fetch_state` + `load_memory_context`；memory-context 18s timeout、2 次 retry
- `SOCIAL_LLM_MAX_ATTEMPTS=1`；`llm_social_request_timeout=20`；默认 `LLM_PROVIDER_SOCIAL_FALLBACK=nvidia`；social JSON 解析增加 fence/trailing-comma/reply 字段修复，减少 parse fail 触发第二 provider

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_recall_merge.py tests/test_llm_social_memory.py tests/test_llm_social_degrade.py tests/test_tool_gate.py -q`（141 passed 全量 worker）
- `pnpm verify:phase15` 或 PLAY-03 手动：refresh 后追问密码，正文含「7」、**无**「你上次说过」；`npc-memory-callback` 引用块仍可显示

**防复发**

- Guardrail #62（Guardrails 小节）：interactive speak social 须注入 memory；social 重试/timeout 见 `test_llm_social_degrade`

---

### ISSUE-042 — Beginning Fields Campfire 整图加载 → 火墙 + 无动画

- **状态:** fixed
- **发现:** 2026-06-09（home 换 Fan-tasy Beginning Fields 后 UAT：Campfire 横向重复整排、无火焰动画）
- **阶段/范围:** `HomeMapBackground.ts` · `areaLoader.ts` · `scripts/bake-beginning-fields.mjs` · `oneCityTilesetManifest.ts`
- **严重性:** major

**复现**

1. `pnpm dev:stack`，进 home 区域（chunk 0,0 Beginning Fields）
2. Object Layer 1 的 Campfire（Tiled 为 2×2 四个 tile object，gid 5770–5787）显示为 **多行重复火焰**（像一堵火墙）
3. 火焰 **不播放** Tiled 定义的 animation

**根因**

- `Campfire.png` 为 256×32 atlas（16×16 × 32 frames，16 列）；manifest 用 `loader.image` 整图加载
- Object layer 手动 `scene.add.sprite(..., "Campfire", localFrame)` + `setTexture(key, frame)` **依赖 spritesheet 切帧**；整图纹理无 frame index → Phaser 显示全宽贴图，scale 3 后约 768px 宽 ≈ 16 个篝火并排
- 4 个 tile object 各渲染一整行 → 截图「火墙」；`applyObjectTileAnimation` 切帧同样无效
- Tile layer 用 `addTilesetImage` 可正常切格；**object layer sprite 不会**自动按 Tiled animation 播（须 `applyObjectTileAnimation` + 有效 frame）

**修复**

- `bake-beginning-fields.mjs`：atlas TSX → manifest `kind: "spritesheet"` + `frameWidth/Height`；collection PNG 仍 `kind: "image"`
- `areaLoader.queueHomeMapAssets`：统一 `queueAsset()`（与 `CORE_AREA_ASSETS` 同路径）
- `resolveGidTexture`：Campfire 等 `tiles[]` 仅含 animation、无 `image` 时走 atlas 分支（非 collection）
- Object layer：`placeTiledTileObject` + `applyObjectTileAnimation`

**验证**

- `node scripts/bake-beginning-fields.mjs`
- `pnpm --filter @aetherlife/web test`（66 passed）
- 实机：home 仅 **一个** 2×2 Campfire，火焰动画播放；Object layer `__MISSING` = 0

**防复发**

- Guardrail #63–#65；[apps/web/AGENTS.md](../apps/web/AGENTS.md) § Beginning Fields

---

### ISSUE-043 — verify:phase16 P16-07 无 ambient reasonZh（intent 不入队 / worker 不消费）

- **状态:** fixed
- **发现:** 2026-06-10（Phase 16 Wave 2 E2E，`pnpm verify:phase16` P16-07 长期失败）
- **阶段/范围:** `apps/game-server/src/queue/npc-ambient-intent.ts` · `internal-ambient-intent.ts` · `GameRoom.ts` · `workers/agent-worker/src/graph/ambient_intent.py` · `workers/agent-worker/src/main.py`
- **严重性:** blocker（Phase 16 intent 契约 C-06 无法 E2E 验收）

**复现**

1. `pnpm dev:stack`（无 mock worker），`pnpm verify:phase16`
2. P16-05/P16-06 可能绿，但 P16-07 `intent subline signal` 失败：`reasonZhById` 空、`visibleIntent=false`、`dom=[]`
3. 或 game-server 日志 BullMQ `Custom jobId cannot contain :`；worker 日志无 `ambient-intent jobs`

**根因**

1. **BullMQ jobId 含 `:`**（旧格式 `room:npc:…`）→ 入队失败，segment_change 永不触发 worker。
2. **`pendingByNpc` 仅按 `npcId` 去重** → 其他房间同 id NPC 占 pending，verify 房间 `verify-p16-*` 无法入队。
3. **Stale worker 未 BRPOP** `aetherlife:npc-ambient-intent:jobs`（仅 npc-turn + chunk-lore）→ job 堆在 Redis 无人消费。
4. **Worker `_fallback_intent` 空 `reasonZh`** → LLM 降级后 registry 仍无文案，P16-07 三路径皆失败。
5. **（辅助）** verify 房间初始 `gameMinute=479` 才能在 E2E 窗口内跨 480 触发 segment_change（已固化于 `GameRoom` verify 房间分支）。

**修复**

- `ambientIntentJobId` 改为无冒号；`pendingKey = roomId:npcId`；`clearPendingNpcIntentJob(roomId, npcId)`。
- `verify-p16-*` 房间 `gameMinute=479` 启动。
- `_fallback_intent` 按 activity 填充默认中文 `reasonZh`。
- `scripts/verify-phase16.mjs`：Playwright 截图 + `verify-report.json`；P16-07 接受 registry `reasonZhById` **或** proximity visible intent **或** DOM。

**验证**

- `pnpm --filter @aetherlife/game-server test -- npc-ambient-intent` → 3 passed
- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_ambient_intent.py -q` → 5 passed
- `pnpm dev:stack`（确认 worker 日志含 ambient-intent BRPOP）→ `pnpm verify:phase16` → P16-00…P16-08 全绿
- 报告：`.planning/milestones/v3-phases/16-intelligent-ambient-npcs/verify-screenshots/verify-report.json`（`pass: true`，2026-06-10）；P16-07：`reasonZhById.npc-1` =「在果园区域巡视，观察作物生长情况」（玩家距 NPC >2 格，`visibleIntent`/`dom` 为空符合设计）

**防复发**

- Guardrails 第 81–84 条；[docs/CONTRACTS.md](./CONTRACTS.md) C-06

---

### ISSUE-044 — speak 后 NPC 只动一格、ambient tick 客户端不更新

- **状态:** fixed
- **发现:** 2026-06-10（Phase 16 UAT Test 11；对话指莫玄虚移动后仅一格，12:00 仍静止）
- **阶段/范围:** `apps/web/src/hooks/useColyseusRoom.ts` · `ChatPage.tsx` · `apps/game-server/src/colyseus/GameRoom.ts`
- **严重性:** major（World Alive 观感阻塞 UAT #11）

**复现**

1. `pnpm dev:stack` → 与莫玄虚 speak 让其移动
2. NPC tween 一格后停住；游戏时间推进至 12:00+ 仍无 ambient wander
3. 服务端 ambient tick 仍在跑（schema `npc1X/Y` 在变），Phaser 不跟

**根因**

1. **客户端未订阅主 NPC 坐标**：`onStateChange` 只同步 activity/clock/bgNpc，未读 `npc1X/Y…npc3X/Y`。
2. **`displayNpcs = roomState?.npcs ?? moveMap`**：speak 后 HTTP `roomState` 长期 stale，覆盖 `moveMap` 中唯一一次 patch 坐标。
3. Ambient tick **不** broadcast speak 风格 `patch`（设计如此）；坐标仅经 Colyseus schema 传播。
4. **（次要）** `registerJob` 在 `addNpcTurnJob` 之后 → 极快 mock worker 可能 `clearSpeakInFlight` 未命中，NPC 永久 skip ambient。

**修复**

- `colyseusAmbientSnapshot.ts`：`mainNpcGridById` + export；`useColyseusRoom` 暴露 `mainNpcGridById`/`bgNpcGridById`。
- `ChatPage`：Colyseus grid merge 进 `moveMap`；`displayNpcs` 位置 overlay 自 `moveMap`。
- `GameRoom` speak：`randomUUID` → `registerJob` → `startNpcChatTurn(..., jobId)`。

**验证**

- `pnpm --filter @aetherlife/web test` → 79 passed（含 `colyseusAmbientSnapshot.test.ts`）
- `pnpm --filter @aetherlife/game-server test` → 154 passed
- 手动：`pnpm dev:stack` → speak 移动 → 等待 1–2 分钟 → 主/背景 NPC 持续 tween（UAT #11）

**防复发**

- Guardrail #86

---

### ISSUE-045 — Web Speak 体感 ~60s（nl/parse 阻塞 + worker 慢路径）

- **状态:** fixed
- **发现:** 2026-06-10（文档 SDK benchmark ~10–25s，浏览器体感 60s+）
- **阶段/范围:** `apps/web` speak 热路径 · `workers/agent-worker` interactive 图 · 基准脚本
- **严重性:** major（延迟 SLA、UAT 体感）

**复现**

1. `pnpm dev:stack` → Web 与 NPC speak
2. 点击发送后长时间无「正在思考…」；总等待远超 Colyseus-only benchmark
3. `benchmark-llm-e2e-latency.mjs` 仍 ~10–20s total

**根因**

1. **H-Web** `useNpcChat` 在 `room.send(speak)` **之前** `await nl/parse`（OpenRouter，最多 ~2s），且 parse 与 worker LLM 争用路由。
2. **H-UI** thinking 气泡仅在 `speakAck` 后出现，放大「无反馈」体感。
3. **H-Worker** 闲聊仍走 social LLM + memory-context（曾 18s timeout）；物理句未稳定命中 `action_intent` 快路径时串行 main LLM；`fetch_state` 曾 12s×3 重试。
4. **口径** 旧文档 §3.2 仅 SDK，未含浏览器分段，易误判为「已达标」。

**修复**

- **P0-A/B** `useNpcChat`：先 `speak`、后台 `nl/parse`；dispatch 即 thinking + `speakLatencyTrace`（`VITE_SPEAK_LATENCY_TRACE=1`）。
- **P1** worker：`memory-context` interactive **8s**；`fetch_state` **6s×2**；`_deterministic_social_turn` 规则跳过 social LLM；物理快路径扩展（`action_intent`）。
- **P2（2026-06-10 全量提速 Slice 0–4）** `SpeakIntent` 路由；CASUAL `skipEmbed`；worker-state LRU 2.5s；PHYSICAL 跳过 social LLM；`speakPartial` 流式 TTFT；`phaseTimingMs` / `speakIntent` on done；移除 game-server done 同步 `check-reply`。
- **P3（2026-06-11 B1 Fast Lane A+B+D）** `can_use_casual_fast_lane` + `run_casual_fast_lane`（绕过 LangGraph/checkpoint）；`process_job` early `speakPartial`；CASUAL skip 全量 memory；`_pick_casual_reply` 模板池；done 含 `t_fast_lane_ms` / `t_fetch_state_ms` / `t_compose_ms`；`GameRoom` **speakAck 先于 enqueue** + `useNpcChat` done adopt `jobId`（fast-lane race）。
- **P4（2026-06-11 TTFT ≤2s）** `@aetherlife/shared` 镜像 `classifySpeakIntent` + `previewCasualSpeakStub`（`stableStringHash`）；`GameRoom` / `chat.ts` **speakAck 后立即** `emitJobEvent(speakPartial)`；`useNpcChat` dispatch **client_mirror**（`recordSpeakLatencyMark` `source: client_mirror`）；enqueue `casualPreviewEmitted` → worker 跳过重复 `partial_emit`；Python `_pick_casual_reply` 改用 `stable_string_hash`。
- **测量** `scripts/benchmark-speak-browser.mjs` + `pnpm benchmark:speak-browser`（含 `speak_partial` TTFT、`speakIntent`）。
- **清理** 移除 session `e437ef` debug ingest（`RoomScene` / `ChatPage` / `hub.ts`）。

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest -q` → **180 passed**
- `pnpm --filter @aetherlife/game-server test` → **160 passed**（含 `speak/casual-stub.test.ts`；`lore-repository` 偶发 5s 超时与 P4 无关）
- `pnpm --filter @aetherlife/web test` → **80 passed**（含 `useNpcChat.test.ts` speakPartial、`MessageList.test.ts` streaming）
- `BENCHMARK_ROUNDS=15 pnpm benchmark:speak-browser`（2026-06-11 Slice 0–4，`pnpm dev:stack` 真实 LLM）→ B1 p50 **11.4s** ttft **8.2s** / B2 p50 **15.5s** ttft **4.5s** / B3 p50 **6.9s** ttft **3.1s**；JSON `.planning/benchmarks/speak-browser-1781148871581.json`
- P3 后 B1 15 轮（同环境，真实 LLM）→ total p50 **3.4s** p95 **6.0s** / ttft p50 **3.3s** p95 **6.6s**（total **达标** ≤5s；TTFT 仍 >2s — queue+worker 启动占主导，见 LLM-E2E §3.2.1）；全量 benchmark 在 B2 r15 超时中断（LLM 波动，非 fast lane 回归）
- P4 后 `BENCHMARK_ROUNDS=15 pnpm benchmark:speak-browser`（`pnpm dev:stack` 真实 LLM）→ B1 total p50 **4521 ms** p95 **9476 ms** / ttft p50 **1 ms**（**达标** ≤2s）；`speakIntent=casual` 全轮；JSON `.planning/benchmarks/speak-browser-1781155186602.json`；见 [LLM-E2E-FLOW-AND-LATENCY.md](./LLM-E2E-FLOW-AND-LATENCY.md) §3.2.1 P4 run
- P0 基线 `BENCHMARK_ROUNDS=5` → B1 **12.0s** / B3 **10.5s** / B2 **20.6s**；`nl_parse` p50 **0–1 ms**

**防复发**

- Guardrails #66–#71；[docs/LLM-E2E-FLOW-AND-LATENCY.md](./LLM-E2E-FLOW-AND-LATENCY.md) §3.2.1

---

### ISSUE-046 — Phase 16 后 speak worker-state 6s 硬失败（pre-LLM 挤占）

- **状态:** fixed
- **发现:** 2026-06-11（`verify:phase12` speak 阶段 `worker-state timeout` / `job failed: timed out`）
- **阶段/范围:** Phase 17 speak pre-LLM SLA · game-server internal routes · worker `fetch_state`
- **严重性:** major（speak 热路径不可用）

**根因**

1. NARRATIVE 路径未 `skipNearbyLore=1`，game-server 9×串行 `getChunkLore`。
2. `fetch_state` 超时 raise 导致 job 硬失败（memory-context 已 8s 降级）。
3. Phase 16 ambient/lore drain + embed 与 speak 争用单 event loop。

**修复（Phase 17）**

- 默认 `skipNearbyLore=1` + NARRATIVE lazy lore；`buildNearbyLore` 并行 + chunk LRU；worker-state cache TTL 8s（skip-lore）。
- worker stale snapshot fallback（300s TTL，`_stale=true`）。
- memory skipEmbed 矩阵 + 5s memory-context cache；speak 期间 defer ambient；worker drain 背压；embed/lore semaphore。
- `verify:phase12` worker-state preflight <500ms×3。

**验证**

- `pnpm --filter @aetherlife/game-server test` → **174 passed**
- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest -q` → **182 passed**（含 `test_fetch_state_and_memory.py` ×5）
- `pnpm agent:verify` → L2 pass
- `pnpm verify:phase16` → OK（2026-06-11）
- `pnpm verify:phase12` → worker-state preflight OK + dual speak OK ~106s；后续 hostile-drive 用例 Colyseus `CONNECT_TIMEOUT`（infra，非 pre-LLM 回归）

**防复发**

- Guardrail #72；[docs/CONTRACTS.md](./CONTRACTS.md) C-01 Phase 17 行

---

### ISSUE-047 — worker internal memory POST 全落 __legacy__（verify:phase3 memoryCount=0）

- **状态:** fixed
- **发现:** 2026-06-11
- **阶段/范围:** Phase 17.1 · `apps/game-server/src/http/player-id.ts` · worker memory client
- **严重性:** major

**复现**
1. `pnpm dev:stack`（真实 LLM，无 mock worker）
2. `pnpm verify:phase3` 或 `pnpm agent:verify --e2e --base`
3. speak job `done` 后 180s 内 `GET /internal/npcs/npc-1/memories?playerId=verifyph3test00001` → `count: 0`；`__legacy__` 有记忆

**根因**
- Phase 17.1 CR-03 引入 `playerIdFromRequest(req, req.body)`，但 `resolvePlayerId` 只接受 string；object body 被当作无效输入 → `__legacy__`
- Worker `append_player_memory` 仅 JSON body 带 `playerId`，未发 `X-Player-Id` header

**修复**
- `player-id.ts`：`playerIdFromBody` 从 object 提取 `playerId` 字段
- `workers/agent-worker/src/memory/client.py`：写路径 `_game_headers(..., player_id=...)` 双保险
- `internal-memories.ts`：write 后 `invalidateMemoryContextForPlayer`
- 测试：`index.test.ts` worker path body-only playerId

**验证**
- `pnpm --filter @aetherlife/game-server test` → 181 passed
- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest -q` → 201 passed
- `pnpm verify:phase3` → OK（memoryCount=2）
- `pnpm agent:verify --e2e --base` → phase3/6/8/10/11 全通过

**防复发**
- Guardrail #73

---

### ISSUE-048 — 并行 speak 切 Tab 后 A 的回复丢失（仅见 B 的 done）

- **状态:** fixed
- **发现:** 2026-06-11
- **阶段/范围:** Phase 08+ · `apps/web/src/hooks/useNpcChat.ts` · `GameRoom.ts` · Phaser 铭牌
- **严重性:** major

**复现**

1. `pnpm dev:stack`，对 NPC A（如 npc-1 莫玄虚）发送消息，进入「思考中」。
2. **不等待** A 完成，切到 NPC B Tab 并对 B speak。
3. 等待 B 的 `done`；切回 A Tab。
4. **期望：** A、B 的 assistant 回复均在各自消息列表。**实际（修复前）：** 仅 B 有回复，A 的 `done` 被丢弃。

**根因**

- 服务端正常：`GameRoom.npcSpeakJobs` 按 `npcId` 互斥，A/B 可并行 worker job。
- 客户端 `useNpcChat` 使用**单一** `pendingJobIdRef` + `matchesJob()`：B 的 `speakAck` 覆盖 jobId 后，A 的 `onDone` 不再匹配，消息未 append。
- `speakAck` 原先仅 `{ jobId }`，快速连续 speak 时 `sendingNpcIdRef` 可能已指向 B，ack 绑定易错。

**修复**

- `useNpcChat.ts`：`NpcJobRegistry`（`registerNpcJob` / `resolveNpcForJob` / `isTrackedSpeakJob`）；`pendingJobsByNpc` + `streamingByNpc`；`thinkingNpcIds` 供 UI/Phaser。
- `GameRoom.ts`：`speakAck` 增加 `npcId`。
- `ChatPage` / `PhaserGame` / `RoomScene` / `ProximityNameplate`：多 NPC thinking 态与铭牌强制显示。
- `useNpcChat.test.ts`：registry 与更新后的 `isNpcSpeakInFlight` 单测。

**验证**

- `pnpm --filter @aetherlife/web test` → 81 passed
- `pnpm --filter @aetherlife/game-server test` → 181 passed
- `pnpm agent:verify` → OK
- 人工 UAT：A 思考 → 切 B speak → 两边 done 均入库

**防复发**

- Guardrail #74；[docs/CONTRACTS.md](./CONTRACTS.md) C-02 `speakAck` 行

---

### ISSUE-049 — 多人同房间 `POST /reset` 仍重置共享 RoomState

- **状态:** open (deferred)
- **发现:** 2026-06-12
- **阶段/范围:** v3 audit · `apps/game-server/src/routes/rooms.ts` · `reset(roomId)`
- **严重性:** medium

**现象**

- 玩家 A 调用 `POST /reset` 时，除 per-player memory/collective/dialogue 外，`reset(roomId)` 仍重建**整房间**默认 `RoomState`（NPC/物体位置等），同房间其他玩家可见世界被重置（griefing 风险）。

**已缓解（2026-06-12）**

- Reset 路径改为 `clearActionTrackersForPlayer` / `moveIntentTracker.clearForPlayer`（不再 `clearActionTrackersForRoom`）。
- `resetColyseusFromMap` 使用 scoped player snap（WR-05 fixed）。

**待办**

- 设计多人安全 reset：仅 initiator 可见状态 vs 房间级 reset 权限 / 房主确认。
- UAT：2 人同房间 reset 边界用例。

**验证（partial fix）**

- `pnpm --filter @aetherlife/game-server test`

**关联**

- TECH-DEBT-v3 WR-01

---

### ISSUE-050 — Phase 20 SOLO-01 跨 session 记忆召回失败（token echo + memory-context 超时）

- **状态:** fixed
- **发现:** 2026-06-16
- **阶段/范围:** Phase 20 · `workers/agent-worker/src/graph/recall_merge.py` · `npc_loop.py` · `memory/client.py`
- **严重性:** major

**复现**

1. `pnpm dev:stack` + 真实 LLM
2. 种子密码/昵称 → reload → 追问「门禁密码是多少」「我叫什么」
3. **期望：** 口播含正确密码/昵称；对话历史有 memoryQuote。**实际：** 拒答、echo FACT token（如 sunset42）、或「你的名字是…」截断；记忆 tab 有 6 条但 speak 路径无 memoryQuote
4. `pnpm verify:phase20` → exit 1（memory wait 超时 / firstTextMs>8s）

**根因**

1. `reply_covers_recall` 在 LLM 回复含 FACT seed token 但无真实密码/昵称时仍返回 True → `merge_recall_into_reply` 跳过确定性补全
2. RECALL speak 使用 interactive memory-context **8s×1**（相对 ISSUE-041 的 18s×2 回归）→ 慢 embed 时常 `retrieved=[]` → 无 `pick_memory_quote`、merge 无输入
3. **（2026-06-16 续）** `merge_recall_into_reply` / `pick_memory_quote` 仅取 **最高分** 记忆行；密码追问时 embed 常把昵称行排在密码行前 → merge 不补全
4. **（2026-06-16 续）** `is_recall_question` 把含「告诉」的 **seed 陈述**（如「我告诉你…密码是111」）误判为 recall → 同一轮 merge 注入旧记忆 666
5. **（2026-06-16 续）** 密码追问时 `pick_recall_memory` 无密码行仍 **fallback 最高分 unrelated 行**；无行或 `format_recall_answer` 失败时 merge **放行 LLM 编造**（如 123456）
6. **（2026-06-16 续）** `_PASSWORD_ANS_RE` 中 `(?:是|为)?` 可选 → 「电脑密码**吗**？」被解析为 password=`吗`；embed 把 **recall 问句** 当高分记忆 → 口播 `电脑密码是 吗？。` + memoryQuote 引用问句本身
7. **（2026-06-16 续）** 密码更新后 `pick_recall_memory` 仍按 **embed 最高分** 取第一条密码行（111/555 常高于 0101）；LLM 口播「111 和 555 不确定」因含 111 → `reply_covers_recall` 误判已覆盖，跳过 merge
8. **（2026-06-16 续）** LLM 口播已含 canonical 密码（0101）但仍列旧值 → `reply_covers_recall` 仅查 `pwd in hay` → merge **append** `{draft} {fact}` → 「111、555…不确定。 电脑密码是 0101。」
9. **（2026-06-16 续）** `_pick_password_memory` 未区分 **player seed** vs **npc 复述**（`npc: 你刚刚说…0101`）→ memoryQuote 引用 NPC 行而非玩家 seed

**修复**

- `recall_merge.py`：密码/昵称追问必须先验 extracted value 在 reply 中，再考虑 seed token
- `memory/client.py`：`_MEMORY_CONTEXT_RECALL_TIMEOUT_S=18`、`_MEMORY_CONTEXT_RECALL_ATTEMPTS=2`
- `npc_loop.py`：RECALL intent 用上述 timeout/attempts；embed 空时 `fetch_recent_memories` fallback
- `recall_merge.pick_recall_memory`：按问题类型（密码/昵称）在 `retrieved` 中选匹配行；**无匹配行 return None**；LLM 口播缺真实密码/昵称时用 `format_recall_answer` **替换**（非 append）
- `recall_merge.recall_no_memory_reply`：recall 问但无事实 → 诚实拒答（禁止编造数字密码）
- `is_recall_question`：**披露/seed**（「我告诉你」「请记住」）不算 recall；弱 marker（告诉/说过/之前）须带问号或「多少/叫什么/是什么」
- `_PASSWORD_ANS_RE`：**强制** `密码是|密码为`（禁止 optional 是/为）；`extract_password_answer` 对 recall 问句 early return None
- **RECALL 密码追问**：`needs_recency_augment` → `fetch_recent_memories(20)` + `augment_retrieved_with_recent`；`_pick_password_memory` **player seed 池优先** + topic/recency/embed；`reply_covers_recall` 拒绝含糊多值；含糊或多数字时 merge **只返回 fact**（不 append draft）
- `memory_quote.py` + `main.py`：recall 时 `pick_memory_quote` 传入 `player_message`
- 测试：`test_merge_recall_password_prefers_password_row_over_higher_nickname` · `test_merge_recall_men_suo_password_question` · `test_merge_recall_no_memory_blocks_hallucinated_password` · `test_merge_recall_rejects_recall_question_as_password_memory` · `test_merge_recall_replaces_ambiguous_llm_even_when_canonical_in_reply` · `test_pick_recall_prefers_player_seed_over_npc_paraphrase` · `test_merge_recall_uses_latest_player_seed_999`

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_recall_merge.py tests/test_fetch_state_and_memory.py tests/test_memory_quote.py -q` → 27 passed
- `pnpm agent:verify` → OK（worker 222 passed）
- 手动 UAT Test 2（诸葛知危 seed + reload + 密码召回）→ 用户确认 pass（2026-06-16）
- `pnpm verify:phase20` → 待人工/UAT 确认（latency smoke 可能仍 >8s，与 recall 逻辑独立）

**防复发**

- Guardrail #62 更新

---

### ISSUE-051 — 「去诸葛知危那边」口头答应但 NPC 不移动

- **状态:** fixed
- **发现:** 2026-06-16
- **阶段/范围:** Phase 20 · `workers/agent-worker/src/graph/action_intent.py`
- **严重性:** major

**复现**

1. `pnpm dev:stack` + 真实 LLM
2. 对莫玄虚说：「你可以去诸葛知危那边吗？他有事情找你」
3. **期望：** 莫玄虚口播答应并 pathfind 至诸葛知危格。**实际：** 仅口播「好，我会去诸葛知危那里…」，地图上仍「在漫步」、坐标不变

**根因**

- `player_requests_move` 的 `MOVE_PATTERNS` 未含 `那边|那里|那儿` 与 `有事情找|事情找`
- 用户句「你可以去诸葛知危那边吗？他有事情找你」→ `player_requests_move=False` → `SpeakIntent.NARRATIVE`
- `llm_social_turn` 非 physical 分支固定 `tool_calls=[]`，无 `inject_relative_move_tool`

**修复**

- `action_intent.py`：`MOVE_PATTERNS` 增补 `那边|那里|那儿` 与 `有事情找|事情找`
- `test_action_intent.py`：UAT 句「你可以去诸葛知危那边吗？他有事情找你」断言 PHYSICAL + inject 至 (15,8)

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_action_intent.py -q` → pass
- `pnpm agent:verify` → OK（229 worker passed）

**防复发**

- Guardrail #75

---

### ISSUE-052 — 阿斯托利亚 relay「去莫玄虚那边」口播移动但 sprite 不动

- **状态:** fixed
- **发现:** 2026-06-16
- **阶段/范围:** Phase 20 · `workers/agent-worker`（`npc_loop.apply_tools` · `main.py` fast lane）
- **严重性:** major

**复现**

1. `pnpm dev:stack` + 真实 LLM；莫玄虚 relay 至诸葛知危已可移动（ISSUE-051 后）
2. 对阿斯托利亚说：「你可以去莫玄虚那边吗？他好像有事情找你」
3. **期望：** 阿斯托利亚口播答应并移动至莫玄虚格。**实际：** 口播「好的，我就去找莫玄虚…」，地图上仍「在漫步」、坐标不变

**根因**

- 隔离测试下 intent/inject 对阿斯托利亚 relay 句正常（PHYSICAL + move→莫玄虚坐标）
- 运行时若走 `social_edge_fast_lane` 或 `llm_social_turn` 非 physical 分支，固定 `tool_calls=[]` 且 **apply_tools 不再 inject**，导致只口播不 apply-actions
- 终端可见 worker-state/memory-context fetch 但缺少完整 job 日志时，亦需排查 duplicate worker（旧代码进程）

**修复**

- `apply_tools`：在 filter 前对 `player_requests_physical_action` 调用 `inject_relative_move_tool`（兜底）
- `main.py`：`player_requests_physical_action` 时跳过 social edge fast lane；`job received` 日志带 `npcId`
- `packages/shared/src/speakIntent.ts`：MOVE_PATTERNS 与 Python 同步（`那边|有事情找`）
- 测试：阿斯托利亚 relay 句 inject + `test_apply_tools_injects_move_when_physical_and_tool_calls_empty`

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_action_intent.py tests/test_tool_gate.py -q`
- `pnpm agent:verify`

**防复发**

- Guardrail #76

---

### ISSUE-053 — RECALL 问句 overlay 先显示 LLM 流式草稿再跳成 no-memory 兜底

- **状态:** fixed
- **发现:** 2026-06-16
- **阶段/范围:** Phase 20 · `workers/agent-worker`（`llm_social_turn` · `npc_loop.compose_reply` · `speakPartial` / `DialogueOverlay`）
- **严重性:** major

**复现**

1. `pnpm dev:stack` + 真实 LLM
2. 问 NPC：「还记得我家电脑密码吗？」（有/无 seed 均可复现 flicker）
3. **期望：** overlay 只显示 merge 后的最终口播。**实际：** 先流式出现 LLM JSON 片段（如「电脑密码是 吗?。」），`done` 后突然变成 no-memory 兜底；流式清空时偶见上一轮 nickname 的 `lastLine` 闪回

**根因**

- `run_social_turn_llm` 在 `compose_reply` 之前通过 `partial_emit` 推送 LLM `reply` 流
- `merge_recall_into_reply` 仅在 `compose_reply` 运行，会整句替换为确定性 fact / `recall_no_memory_reply`
- `DialogueOverlay`：`displayLine = streamingReply || lastLine`

**修复**

- RECALL 问句：`run_social_turn_llm` 禁用 LLM stream partial，改 `invoke`
- `compose_reply`：merge 后对 RECALL 再 `partial_emit` 最终 merged reply 一次

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_social_stream_extract.py tests/test_tool_gate.py::test_compose_reply_recall_emits_merged_partial_for_overlay -q`
- `pnpm agent:verify`

**防复发**

- Guardrail #77

---

### ISSUE-054 — apply-actions 后 hot snapshot 未刷新 + 电脑密码误用门锁记忆

- **状态:** fixed
- **发现:** 2026-06-16（CodeRabbit PR #9）
- **阶段/范围:** Phase 20 · `npc_loop.apply_tools` · `recall_merge._pick_password_memory` · `action_intent` / `speakIntent`
- **严重性:** major

**复现**

1. 连续 speak 间隔 &lt;3s：`apply-actions` 移动 NPC 后，下一次 `fetch_state` 仍读热缓存旧坐标
2. 问「还记得我家电脑密码吗？」仅 seed 过「门禁密码是 7」→ 口播可能被格式化为电脑密码

**根因**

- `apply_tools` 更新 `room_snapshot` 但未 `_remember_worker_snapshot`
- `_password_topic_score` 对门锁行在电脑追问时返回 0，仍可作为唯一候选被 pick

**修复**

- `apply_tools` 成功路径 `_remember_worker_snapshot` 写入 apply 后 state
- `_password_topic` + topic score `-1` mismatch；computer/door 无匹配行时 `_pick_password_memory` → None
- contextual `那边|那里|那儿` regex（保留 relay summon 句）

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest -q`（242 passed）
- `pnpm agent:verify`
- `pnpm verify:phase20` · `pnpm verify:overlay-streaming`（真实 LLM，`pnpm dev:stack`）

**防复发**

- Guardrails #78–#80

---

### ISSUE-055 — verify:phase21 memory-context 超时（httpx 502 + tail 竞态）

- **状态:** fixed
- **发现:** 2026-06-16（Phase 21 E2E）
- **阶段/范围:** worker `http_json` · `main.process_job` · `persist_turn_memory` · `scripts/verify-phase21.mjs` · `e2e-memory-helpers.mjs`
- **严重性:** major（`pnpm verify:phase21` / `verify:phase20` memory poll 600s 超时）

**复现**

1. `pnpm dev:stack`（真实 LLM，macOS 常开系统 HTTP 代理）
2. `pnpm verify:phase21` → memory seed speak 完成，`waitForMemoryContext` 600s 超时；或 reload 后 `npc-memory-callback` 180s 超时
3. worker stderr：`502 Bad Gateway` on `/internal/rooms/.../memories` 或 `/internal/jobs/.../emit`

**根因**

1. **httpx 走系统代理**：默认 `trust_env=True`，`127.0.0.1:2567` 经代理 → 502；`curl` 同 URL 200
2. **memory tail 竞态**：`emit done` 后 daemon thread 才 `append_player_memory`；E2E 立即 poll `memory-context` / `recent-memories`，tail 若排队或 502 则 needle 永不出现
3. **E2E drawer**：`openShellDrawerHistory` 在 drawer 已开（collective tab）时 early return，MessageList / `npc-memory-callback` 不可见

**修复**

- `workers/agent-worker/src/http_json.py`：`create_http_client(trust_env=False)`；全 worker 写路径统一
- `main.process_job`：`emit done` **前** sync `append_player_memory` + `_player_line_persisted`；tail 跳过重复 player 行
- `persist_turn_memory`：`append_player_memory` 先于 `score_turn_importance`（tail 内不阻塞落库）
- E2E：`openShellDrawerHistory` / discoveries 强制切 tab；reload 后等 canvas；`verify:phase21` memory seed 在 explore 前

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest -q` → **243 passed**（2026-06-18；`FakeClient.__init__(*args, **kwargs)` 适配 `create_http_client(trust_env=False)`）
- `pnpm verify:phase21`（`pnpm dev:stack`，无 `LLM_MOCK`）→ **exit 0**（2026-06-18，~103s）：
  - `memorySpeakMs=14089` → `memory seed persisted (FACT-P21-…)`
  - `recallMs reply="门禁密码是 7"` · `memory citation + recall OK` · `verify:phase21 OK`

**防复发**

- Guardrails #81–#82

---

### ISSUE-056 — ambient intent LLM 使用错误 NPC 中文名（林小满 vs 莫玄虚）

- **状态:** fixed
- **发现:** 2026-06-24（优化路线图审计）
- **阶段/范围:** `workers/agent-worker/src/graph/ambient_intent.py` · `GameRoom.enqueueAmbientIntentIfIdle`
- **严重性:** major（沉浸感 / 与 dossier 权威名分裂）

**根因**

`NPC_DISPLAY_NAMES` 硬编码旧名（林小满/陈叔/阿禾），未与 `getPersona` / room snapshot 同步。

**修复**

- `NPC_DISPLAY_NAMES` 从 `council-personas-compact.json` 加载（12 席）；prompt 优先 `payload.npcName`（game-server 从 room snapshot 注入）
- `packages/shared/src/npcDisplayNames.ts`：`MAIN_NPC_DISPLAY_NAMES` 由 dossier 派生

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_ambient_intent.py -q`
- `pnpm council:audit-personas` → 0 issues

**防复发**

- Guardrails #83

---

### ISSUE-057 — Phase 25 审议 UI 僵尸态 + 票决名册漂移 + 重复 trigger 双写编年史

- **状态:** fixed
- **发现:** 2026-06-25（Phase 25 UAT）
- **阶段/范围:** `world_vote.py` · `registry.py` · `useCouncilDeliberation.ts` · `world-vote-trigger.ts`
- **严重性:** major

**复现**

1. Force-trigger 审议落槌后编年史已有「已采纳」，DialogueBar 仍显示「议会审议中」
2. Council 名册显示「糖果」，廷议实录显示「莉莉丝·绯月」（同 npc-4）
3. 连续两次 force-trigger → 编年史两条近似提案

**根因**

- `writeback_sequence` sealed sync 发送 `active: true`，chip 永不消失
- Worker `registry.py` 与 `packages/shared` LOCKED dossiers 人名/倾向不一致
- `addWorldVoteJob` replace pending 不取消 worker 内旧 job，两 job 均 writeback

**修复**

- sealed sync 改 `active: false`；client `reduceDeliberationSync` 在 `phase=sealed` 强制清 active
- 新增 `council-personas-compact.json` + `council-personas-speak.json`，worker registry / speak 从 shared 加载；维护见 [COUNCIL-PERSONAS.md](./COUNCIL-PERSONAS.md)
- `forceEnqueueWorldVote` pending 时拒绝；worker writeback 前校验 `GET world-vote/pending`
- vote JSON 增加 prose 恢复 + 按 `votingLeaning` 的 fallback 表决

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_world_vote.py tests/test_registry.py -q`
- `pnpm --filter @aetherlife/game-server test`
- `pnpm --filter @aetherlife/web test -- useCouncilDeliberation`

**防复发**

- Guardrails #85–#87

---

### ISSUE-058 — 审议 writeback 半吊子：编年史成功但 job failed（memories 500 / deltas skip）

- **状态:** fixed
- **发现:** 2026-06-25（Phase 25 UAT 完整体验验收）
- **阶段/范围:** `world_vote.py` · `internal-memories.ts` · `MemoryService` · `MemoryRepository`
- **严重性:** major

**复现**

1. Force-trigger 审议落槌 → 编年史 + minutes 正常
2. Worker log：`memories 500` 或 relationship deltas timeout → job failed
3. DB `__council__` 廷议记忆 0 条；UI 像成功但 SOCIETY RAG / 关系 hint 缺失

**根因**

- Writeback 顺序：sealed sync 在前，12 条 memory 串行 POST（每条 embed + DB）易超时
- `apply_relationship_deltas` 异常被 swallow → 关系边未写
- Job 成功标准过宽：history 写入即 UI 像完成，tail 失败仍标 failed

**修复**

- Writeback 顺序：`world_history` → `post_vote_complete` → `apply_relationship_deltas`（3 次 retry，fatal）→ `append_council_memories` bulk → sealed sync（含 `resultEntryId` + `linkedEdges`）
- **`council-vote-memories` 写 11 条**（非提案人表决记忆）
- `voteEpoch` 含 `jobId`，避免同 `gameMinute` 重跑 UNIQUE 冲突
- `buildCouncilMemoryContext` 合并最近 `廷议表决` 记忆（skipEmbed 路径仍可 RAG）

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_world_vote.py -q`
- `pnpm --filter @aetherlife/game-server test -- service.test`
- UAT：一轮 force-trigger 后 DB 12 条 `__council__` + worker job 无 failed

**防复发**

- Guardrail #90

---

### ISSUE-059 — 提案人误出现在票决记录且 vote/reason 矛盾

- **状态:** fixed
- **发现:** 2026-06-25（Phase 25 UAT）
- **阶段/范围:** `world_vote.py` · `vote_prompt.py` · `worldHistory.ts` · `WorldHistoryMinutesModal.tsx`
- **严重性:** major

**复现**

1. 莫玄虚为提案人，minutes 仍显示其「赞成」卡片
2. 理由文案像反对（「此议过激…不宜通过」）但 vote 强制为 yes

**根因**

- `build_minutes`  prepend 提案人 pseudo-ballot；`_cast_single_ballot(is_proposer=True)` 强制 `vote=yes` 但 LLM reason 自由发挥
- Phase 25 契约应为 **11 人表决**，提案人不计票

**修复**

- minutes / schema 改为 **11 条 ballots**（排除 proposer）；UI 标注「提案人：XXX（不计票）」
- 删除提案人表决 LLM 调用；非提案人票决增加 `reconcile_ballot_vote_reason`（reason 反对语气 → vote=no）
- 读库 legacy 12 条 minutes 按 `proposerNpcId` 自动 strip 提案人

**验证**

- `pytest tests/test_world_vote.py tests/test_vote_prompt.py -q`
- `pnpm --filter @aetherlife/shared test` · `WorldHistoryMinutesModal.test.ts`

**防复发**

- Guardrail #90

---

### ISSUE-060 — 11 席票决 LLM 上下文不足：人设/提案人关系/辩论未充分注入

- **状态:** fixed
- **发现:** 2026-06-25（Phase 25 UAT 票决质量分析）
- **阶段/范围:** `world_vote.py` · `vote_prompt.py` · `persona.py` · `relationship_prompt.py` · Phase 25 REL-04 / D-VOTE-UX-03
- **严重性:** major（体验/叙事一致性，非 blocker crash）

**现象**

1. 票决 reason 有时像某席口吻，但 **vote 与 persona `votingLeaning` / `votingLogic` 绑定弱**（如保守派席对激进提案仍大量 yes）
2. reason 可点名提案人（如阿斯托利亚批莫玄虚），但 **不保证**来自 runtime 关系或辩论，更像 LLM 从提案摘要猜的
3. 辩论 feed 与 minutes 票决 **可能脱节**（辩论里 oppose，票决 prompt 无辩论 transcript）

**根因（代码审计 `_cast_single_ballot`）**

| 维度 | 现状 | 缺口 |
|------|------|------|
| 身份/性格 | `build_persona_block` 注入职业、性格、口吻、`votingLogic`（**截断 ~120 字**） | 无硬约束；`votingLeaning` 仅「参考」；JSON parse 失败走 `_leaning_default_vote` + 泛化 fallback |
| 与提案人关系 | `format_relationship_block_for_npc` top5（\|affection\|） | **票决 prompt 未标明提案人 id/名**；关系块**不优先**提案人边，可能不在 top5 |
| 辩论立场 | `debate_transcript` 写入 ctx | **`cast_ballots` 不读 transcript**；票决仅 title + proposal 前 400 字 |
| RAG | speak 路径有 dual RAG | **world_vote 票决 job 无** council/world_history RAG |
| 校验 | `reconcile_ballot_vote_reason` | 只修 vote/reason **语气矛盾**，不校验 persona leaning |

**后续修改建议（按优先级）**

- **P0** 票决 prompt 增加 `提案人：{displayName}({npcId})` + **`format_proposer_relationship(voter, proposer, edges)`** 专段
- **P0** 票决注入本轮 **debate transcript**（或每席 stance 摘要），对齐 D-VOTE-UX-03「feed 与 minutes 一致」
- **P1** `votingLogic` 结构化/放宽截断；JSON fallback 用 leaning + **对提案人 registry/runtime 关系** 定票（swing 禁止纯 hash）
- **P1** 可选：票决前拉轻量 council RAG（1–2 bullet，skipEmbed 可接受）
- **P2** 指标/日志：leaning=against 席对激进提案 yes 率异常时告警（不硬改票）

**涉及文件**

- `workers/agent-worker/src/graph/world_vote.py` — `_cast_single_ballot` · `cast_ballots`
- `workers/agent-worker/src/council/vote_prompt.py` — `ballot_prompt_instructions`
- `workers/agent-worker/src/council/relationship_prompt.py` — 新增 proposer 专段 helper
- `workers/agent-worker/tests/test_world_vote.py` — prompt 含 proposer + transcript 断言

**验证（修复后）**

- unit：`test_cast_ballot_includes_proposer_and_debate_context`
- UAT：同一议案辩论 oppose 席 minutes 票型与 feed stance 一致率 ↑；莫玄虚提案时 npc-2/4 反对倾向可感知

**防复发（修复 closed 时补）**

- Guardrail #91

**验证（已跑）**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_world_vote.py -q -k ballot`
- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_vote_prompt.py -q -k proposer`

---

### ISSUE-061 — 关系引擎排除提案人：零 linkedEdges + O(n²) 同票抱团

- **状态:** fixed
- **发现:** 2026-06-26（Phase 25 UAT Test 6 + 用户叙事分析）
- **阶段/范围:** `relationship_deltas.py` · `world_vote.py` · REL-03
- **严重性:** major（叙事不合理）

**现象**

- 莫玄虚提案被否决，名册 hint 上莫玄虚无「近期有变」，其余 11 席几乎全有
- 10 人投反对仍两两 +affection（同阵营全连接）

**根因**

- `_vote_deltas` 仅用 non_proposer ballots；提案人不在任何边
- 辩论 transcript 不含提案人
- 同阵营 O(n²) 无交锋门槛

**修复计划**

- `.planning/phases/25-council-vote-debate/25-08-PLAN.md` Wave 8 — **已实施** `_proposer_voter_deltas` + debate-pair gated voter mesh + `filter_linked_edges_for_ui`

**验证（已跑）**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_relationship_deltas.py -q`

**防复发**

- Guardrail #92

---

### ISSUE-094 — feedDelta 超 80 字导致 council-deliberation-sync 400、vote job 失败

- **状态:** fixed
- **发现:** 2026-06-29
- **阶段/范围:** Phase 25 · `world_vote.py` · `vote_prompt.py` · `worldHistory.ts` · UAT `uat:phase25:core-ui`
- **严重性:** major（间歇性整局廷议失败）

**复现**

1. `pnpm dev:stack` + `pnpm uat:phase25:core-ui`
2. Worker 日志：`council-deliberation-sync 400` · `feedDelta String must contain at most 80 character(s)`
3. `world-vote job failed`；Council Tab feed 停更

**根因**

- 辩论 prompt 要求 `text(≤120字)`，transcript 允许 200 字；feed 从同一字段硬切 80
- 旅者前缀 `据近期旅者言行，` 拼在 text 上进一步挤占 feed 预算
- `finalize_deliberation_sync_payload` 有截断但路径/LLM 爆长仍偶发漏网；400 直接 `raise_for_status` 终止 job

**修复**

- 双输出槽 `fullText`（≤180，transcript/minutes）+ `feedQuote`（≤80，feed）
- `clamp_feed_quote` / `finalize_deliberation_sync_payload` 硬封顶；旅者引用仅 `travelerRef` + UI 前缀
- `voteMinutesSchema.debateExcerpts` + `WorldHistoryMinutesModal` 辩论摘录区块
- 设计文档：[25-FEED-DUAL-OUTPUT.md](../.planning/phases/25-council-vote-debate/25-FEED-DUAL-OUTPUT.md)

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_vote_prompt.py tests/test_world_vote.py -q` → 29 passed
- `pnpm --filter @aetherlife/shared test -- worldHistory` → 11 passed
- `pnpm --filter @aetherlife/web test -- WorldHistoryMinutesModal` → 3 passed

**防复发**

- Guardrail #94

---

### ISSUE-095 — PR #15 CodeRabbit CR：yesCount+1、speak 误记票、RAG 否决案顺序等

- **状态:** fixed
- **发现:** 2026-06-29
- **阶段/范围:** Phase 25 · PR #15 CodeRabbit review · `world_vote.py` · `GameRoom.ts` · `world_history_rag.py` · `internal-memories.ts` · `internal-world-history.ts` · `main.py` · `npc_loop.py` · `councilDeliberation.ts` · `world-vote.ts`
- **严重性:** major（编年史 tally 虚高、speak 入队失败仍触发 vote pacing、RAG 引用旧否决案）

**修复摘要（P0→P2）**

| 项 | 修复 |
|----|------|
| yesCount +1 | `post_world_history` / sealed sync 使用真实 `tally_ballots` 计数，禁止 +1 |
| lore 饿死 vote | `main.py` lore 分支 `continue` 前 `drain_one_world_vote_job` |
| speak 误记票 | `recordPlayerSpeak` 移到 `startNpcChatTurn` 成功之后 |
| RAG 否决案 | `rejected[-1]` → `rejected[0]`（newest-first 与 GET 序一致） |
| paths fallback | `parents[4]` → `parents[3]` |
| stable hash | `hash()` → `stable_string_hash`；`_env_int` 容错 |
| failure cleanup | `post_deliberation_failed` 检查 `is_job_still_pending` |
| ballot 400 | 非法行整批 400 + npcId 去重 |
| vote 行 proposerNpcId | internal world-history 强制 |
| skip_dual_rag | casual fast-lane 跳过 relationship edges GET |
| Zod max | `yesCount`/`noCount` max 12→11 |
| mockJobs | replace/clear 时 `mockJobs.delete` |
| registry | compact/speak JSON fail-fast（12 席） |

**验证**

- `pnpm agent:verify` → game-server 257 + shared 222 + worker 328 passed
- `pnpm verify:phase25` OK (466s) · `minutes modal 11 ballots` · `debate excerpts=11`
- `pnpm uat:phase25:core-ui` OK (346s) · 8 screenshots
- Browser MCP：`browser-mcp-cr-fix` 房连接 + UAT 11 票纪要截图 → `.planning/.../browser-mcp-cr-fix/`

**防复发**

- Guardrail #98

---

### ISSUE-096 — Phase 26 UAT ChatPage 白屏（useColyseusRoom cleanup 引用已删 setter）

- **状态:** fixed
- **发现:** 2026-06-30（Phase 26 UAT / Browser MCP）
- **阶段/范围:** `apps/web/src/hooks/useColyseusRoom.ts` · MapSchema 迁移遗留
- **严重性:** blocker

**根因**

- MapSchema 迁移后 cleanup 仍调用 `setMainNpcGridById({})` / `setBgNpcGridById({})`，unmount 抛错 → ChatPage 白屏。

**修复**

- cleanup 改为 `setRoomNpcs([])`（commit `412a064`）。

**验证**

- `pnpm --filter @aetherlife/web test` · Browser MCP 可见 12 NPC 地图

**防复发**

- Guardrail #102

---

### ISSUE-097 — `0010_npc_leaning_drift` 未登记 journal → world-vote `relation "npc_leaning_drift" does not exist`

- **状态:** fixed
- **发现:** 2026-06-30（verify:phase26）
- **阶段/范围:** `packages/npc-memory/migrations/` · `verify:phase26.mjs`
- **严重性:** blocker

**根因**

- SQL 文件存在但 `migrations/meta/_journal.json` 无 `0010_npc_leaning_drift` 条目，`db:migrate` 跳过。

**修复**

- journal 补登记；`verify:phase26` 入口加 `db:migrate` preflight。

**验证**

- `pnpm --filter @aetherlife/npc-memory db:migrate` · `verify:phase26` vote 段通过

**防复发**

- Guardrail #103

---

### ISSUE-098 — verify:phase26 traveler 断言 flaky（chip 24 字截断 + 缺 rude collective 前置）

- **状态:** fixed
- **发现:** 2026-06-30（verify:phase26 Run 2）
- **阶段/范围:** `scripts/verify-phase26.mjs`
- **严重性:** major

**根因**

- 断言仅读 `.council-deliberation-chip__title`（24 字截断），LLM 提案标题前段可无「旅者」；collective 事件被标为 optional，worker 无旅者素材时提案不含旅者语义。

**修复**

- 对齐 phase25：rude speak + 等待 collective rude API；断言轮询 chip `aria-label` + banner + feed。

**验证**

- `pnpm verify:phase26`（Run 3 重跑）

**防复发**

- Guardrail #104

---

### ISSUE-099 — 议会 spawn 集中南广场：同屏只见 9 人、占格堵路

- **状态:** fixed
- **发现:** 2026-06-30（UAT `uat-spawn-audit-v2/v3`）
- **阶段/范围:** `spawns.json` · Phase 26 地图 presence
- **严重性:** major（UX）

**根因**

- Phase 26 初版「使馆区聚集」+ 后修南移 y=17–19 仍 **12 点挤在相邻格**；镜头跟玩家 `(34,13)` 时南侧集群在视口外或重叠可数为 9 堆；NPC 格占 `buildGlobalMoveGrid` 导致「该方向无法移动」。

**修复**

- **全图分散** 12 锚点（西北→东南岸，见 `BEGINNING-FIELDS.md` §议会出生点）；`maxRadius: 0`；单测改 Chebyshev 间距 + 地图跨度；名册 hint 改「地图各区域」；`26-CONTEXT` D-MAP-SPAWN-01 修订。

**验证**

- `pnpm --filter @aetherlife/game-server test -- region-walkability`（9/9）
- 新房间 `?room=uat-spawn-dispersed`：`__aetherlife_npcDebug()` → 12 sprites，坐标分布于 x∈[8,38] y∈[7,29]

**防复发**

- Guardrail #105：改 `councilSpawns` 须跑 `region-walkability` 分散断言；**禁止** 12 点挤在单一 ≤4×3 格网；已存在房间须换新 `roomId` 验收。

---

### ISSUE-100 — `uat:phase7:reset-snap` 仍断言 `HOME_NPC_SPAWNS` 旧坐标（Phase 26 后超时）

- **状态:** fixed
- **发现:** 2026-06-30（`pnpm agent:verify --e2e` GF-08）
- **阶段/范围:** `scripts/uat-phase7-reset-snap.mjs` · Phase 26 council shuffle
- **严重性:** major（E2E 假红）

**根因**

- Phase 26 后 `createDefaultRoom` 用 `shuffleCouncilSpawnAssignments` + `councilSpawns`；`default` 房 npc-1 家在 `(20,26)`，脚本仍等 `(23,10)`（legacy `HOME_NPC_SPAWNS`）→ reset 后 `waitForFunction` 10s 超时。

**修复**

- 新增 `scripts/lib/council-spawn.mjs`（`councilNpcHome(roomId, npcId)` → `createDefaultRoom` SSOT）；`uat-phase7-reset-snap.mjs` 改读 council home；post-reset 超时 20s。

**验证**

- `pnpm --filter @aetherlife/shared build` · `pnpm uat:phase7:reset-snap` → OK ~44s

**防复发**

- Guardrail #106：`uat:phase7:reset-snap` / 任何 reset-home E2E **禁止**硬编码 `HOME_NPC_SPAWNS` 作 council 默认格；须 `councilNpcHome(roomId, npcId)` 或 `GET state` 后 `createDefaultRoom` 对齐。

---

### ISSUE-101 — `verify:phase16` 仍断言 2–4 bg npc（Phase 26 移除 bg 层）

- **状态:** fixed
- **发现:** 2026-06-30（`pnpm agent:verify --e2e` GF-09）
- **阶段/范围:** `scripts/verify-phase16.mjs` · Phase 26 12 席 council
- **严重性:** major（E2E 假红）

**根因**

- Phase 26 删除 `bg-villager-*` 房间种子；P16-10/11 仍要求 2–4 bg npc + 11px bg 铭牌 → `expected 2–4 bg npcs, got 0`。

**修复**

- P16-11：断言 12 council + 0 bg + `bg-villager-1`/非法 id speak 400。
- P16-10：走近 council npc-1，断言 `__aetherlife_councilNameplateDebug` VIS-04 13px proximity 铭牌；`roomSceneSync` 新增 debug hook。
- `docs/E2E-POLICY.md` §3.1 phase16 行更新。

**验证**

- `pnpm verify:phase16` · `pnpm agent:verify --e2e`

**防复发**

- Guardrail #108：Phase 26+ 后 **禁止** verify/UAT 脚本断言 `bg-villager` 房间存在；ambient 回归用 12 席 council + `verify:phase26` 地图门禁。

---

### ISSUE-102 — 全员 LPC 角色皮与 CELL_PX=32 视觉刷新

- **状态:** fixed
- **发现:** 2026-07-01（Phase 26.1 产品决策）
- **阶段/范围:** `apps/web/src/game/**` · LPC 资产管线 · 铭牌布局
- **严重性:** minor（视觉/文档；非多人契约变更）

**决策**

- **全员 LPC**：所有玩家（含远端）+ **`npc-1`…`npc-12`** 使用 `sprites/lpc-player-1.png` + `sprites/lpc-npc-{1…12}.png`；废弃 `sprites/characters.png` 四色 palette 作玩家皮。
- **显示格**：`CELL_PX=32`（16×2）；角色高 64px（2 格）；`GRID_STEP_MS=200`。

**交付**

- `scripts/sync-npc-lpc-assets.mjs` · `pnpm assets:sync:lpc-npcs`（源 `npc-asset/player-1.png` + `npc-{1…12}.png` → 13 张烘焙 atlas）
- `lpcNpc1Sheet.ts`（`LPC_NPC_PROFILES` · `spriteProfileForNpc`）· `entitySprites` LPC 路径 · `sceneLabelLayout.ts` 铭牌堆叠
- `HomeMapBackground.ts` Object Shadows → Phaser `Layer`（`MULTIPLY`）；`entityLayout.MAP_TILE_DEPTH_*` 瓦片 depth 带
- 文档：[BEGINNING-FIELDS.md](./BEGINNING-FIELDS.md) §角色视觉 · Guardrails #106–#107

**验证**

- `pnpm assets:sync:lpc-npcs`（13× 704×256）
- `pnpm --filter @aetherlife/web exec vitest run src/game/lpcNpc1Sheet.test.ts`
- `pnpm --filter @aetherlife/web test`
- `pnpm verify:phase6:move-only` · `pnpm verify:phase13`（须 `pnpm dev:stack`）

**防复发**

- Guardrail #106（全员 LPC）· #107（CELL_PX=32）

---

### ISSUE-103 — World Alive UAT：站桩 + 重叠扎堆（动森感不足）

- **状态:** fixed
- **发现:** 2026-07-15（`/gsd-verify-work 26.2` 人工）
- **阶段/范围:** Phase 26.2 gap · `apps/game-server/src/ambient/**` · `data/schedules/npc-4|7.json`
- **严重性:** major

**根因**

- `shouldSkipMovement` 把日程 `idle` 当睡觉 → npc-4/7 早晨长时间冻住。
- `stationary` 且 spawn 离 zone >`LINGER_RADIUS` 时 `nearby=[]` 原地 fallback → 全天 stationary 席位永久站桩。
- `pickZoneTarget` 不看他人占位 → 多人可同去一格，视觉重叠扎堆。
- 每 tick 重抽目标 + 概率门 → 不像「走到再停」的真人节奏。

**修复**

- 仅 `resting` 跳过移动；npc-4/7 idle 段并进 `wandering`+`wander`。
- zone 外 stationary → 通勤最近 zone 格；选格排除占用/本 tick reserved，偏好 `PERSONAL_SPACE=2`。
- `AmbientMotion` walk/pause（到达停 2–8 tick，走路超时 48 tick 重抽）。

**验证**

- `pnpm --filter @aetherlife/game-server test -- src/ambient/`
- 实机：`pnpm dev:stack` + **新 roomId**，看 2–3 min（无永久站桩、无叠格）

**防复发**

- Guardrail #110

---

### ISSUE-104 — Ambient NPC 冷启动/步进呈 idle「漂移」（无可读走帧）

- **状态:** fixed
- **发现:** 2026-07-15（Phase 26.2 World Alive 实机）
- **阶段/范围:** Phase 26.2 · `apps/web/src/game/**` · `ChatPage` `npcWorldLive`
- **严重性:** major（世界「活着」体感）

**复现**

1. `pnpm dev:stack`，硬刷新进房（新 roomId 更易见）。
2. 观察议会 NPC ambient 前几步：角色滑动到邻格，几乎不见 LPC walk 帧；稍后偶发可见走帧。

**根因**

- NPC 格间 tween 误用玩家 WASD 的 `GRID_STEP_MS=200`；LPC walk 循环为 **8×75ms≈600ms** → 200ms 仅露 ~2–3 帧，观感 = 站立姿势滑动（「漂移」）。
- `npcWorldLive` 曾只等 HTTP `roomState`：Colyseus 已有格时 early ambient 仍走 `snapNpcTo`（无 walk）。
- 叠加：live 边沿未 snap、远距 catch-up tween、同格 schema 打断进行中步、`moveMap` 被滞后 HTTP 盖写。

**修复**

- 新增 `NPC_GRID_STEP_MS=600`；步进时 `anims.timeScale = cycleMs / stepMs` 对齐 gait。
- LPC `play(key, false)` 强制 idle→walk；同目标中途不打断；远距/多格 snap（`NPC_ANIMATE_CATCHUP_MAX_CELLS=2`）。
- `npcWorldLive` 在 `roomNpcs` 就绪即可开；`moveMap` 始终合并 Colyseus；live 边沿首帧 snap。

**验证**

- `pnpm --filter @aetherlife/web exec vitest run src/game/lpcNpc1Sheet.test.ts src/game/gridMovement.npcCatchup.test.ts`
- `pnpm --filter @aetherlife/web exec vitest run src/game/`
- 实机硬刷新：ambient 每步有清晰 walk 循环（非 idle 滑行）

**防复发**

- Guardrail **10b**（NPC 步进须覆盖 LPC gait / live 门禁）

---

### ISSUE-105 — B2 `shouldStepThisTick` 从 `runAmbientTick` 被摘掉（仅留导出）

- **状态:** fixed
- **发现:** 2026-07-15（`/gsd-validate-phase 26.2` Nyquist）
- **阶段/范围:** Phase 26.2 · `apps/game-server/src/ambient/tick.ts`
- **严重性:** major（D-22/D-25 / MAP-06 门失效；多人同分钟概率门与 join 绕过半段不可证）

**复现**

1. `grep -c 'shouldStepThisTick(npc.id' apps/game-server/src/ambient/tick.ts` → `0`
2. 在 gate-FAIL 分钟跑 `runAmbientTick`（无 walk hold）→ NPC 仍可步进

**根因**

- `0952357` 接入 B2；`45b6455` 引入 walk/pause 时删除了循环内调用，docs 误改为「历史断言」。

**修复**

- 恢复：非 mid-walk、非 `joinVicinityActive` 时 `!shouldStepThisTick(npc.id, …) → continue`
- mid-walk Continuum 与 join 仍绕过；C-06 / ambient README / Guardrail #109+#111 对齐

**验证**

- `pnpm --filter @aetherlife/game-server test -- src/ambient/ src/world/council-spawn-radius.test.ts`（含 B2 wire canaries）

**防复发**

- Guardrail #111

---

### ISSUE-106 — 周记/人生札记串味：ENTJ 阿斯托利亚与 ESFP 楚浅歌写成同款文艺腔

- **状态:** fixed
- **发现:** 2026-07-19
- **阶段/范围:** Phase 27 · `workers/agent-worker` personal_timeline + GS weekly enqueue
- **严重性:** major（人设可感知失败；BIO voice）

**复现**

1. Roster 打开阿斯托利亚 / 楚浅歌 `llm_scheduled` 周记（太乙元年·春·1月·第2日）
2. 正文均为「听风过竹 / 袖中思绪」类通稿，与 ENTJ 鹰派 / ESFP 享乐口吻无关

**根因**

- `build_weekly_digest_prompt` 仅有 npcId+显示名，无 speak 人设块；措辞「人生札记」诱导通用文艺腔
- `maybeEnqueuePersonalTimelineWeekly` 未传 `recentBullets`

**修复**

- `persona_block_for`（speak mirror）注入 weekly/polish/multi/rel；反套话规则
- 周记装配 `assembleWeeklyRecentBullets`
- 实装 `kind=event`（apply-deltas + force 双边 REL）；speak 提及 / ambient 近邻触发
- 清理 `default` 房既有 `llm_scheduled` 假周记

**验证**

- `cd workers/agent-worker && LLM_MOCK=1 uv run pytest tests/test_personal_timeline.py tests/test_personal_timeline_rel07.py -q`
- `pnpm --filter @aetherlife/game-server test -- personal-timeline-dyad personal-timeline-weekly`

**防复发**

- Guardrail #113；C-11 人设日记 / event 行

---

<!-- 新问题上文追加，保持 ISSUE 编号递增 -->
