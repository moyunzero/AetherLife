/**
 * Phase 12 E2E — Collective memory (SOCL-01, SOCL-02).
 * Requires: pnpm dev:stack (no LLM_MOCK=1), REDIS_URL, DATABASE_URL, real LLM keys.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@colyseus/sdk";
import {
  assertE2eNoMock,
  assertE2eRealLlm,
  e2eSpeakTimeoutMs,
} from "./lib/e2e-policy.mjs";

const COLYSEUS_SERVER_MESSAGES = {
  moveAck: "moveAck",
  thinking: "thinking",
  done: "done",
  error: "error",
  speakAck: "speakAck",
  speakBusy: "speakBusy",
  speakIdle: "speakIdle",
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!(key in process.env)) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

const httpBase =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const wsUrl = process.env.GAME_SERVER_WS || "ws://127.0.0.1:2567";
const roomId = process.env.VERIFY_PHASE12_ROOM_ID || `verify-p12-${Date.now()}`;
const VERIFY_PREFIX = "verifyph12test0000";
const PLAYER_A = `${VERIFY_PREFIX}a`;
const PLAYER_B = `${VERIFY_PREFIX}b`;
const NPC_ID = "npc-1";
const skipSpeak = process.env.SKIP_SPEAK_VERIFY === "1";

function waitFor(condition, timeoutMs = 5000, intervalMs = 50, label = "condition") {
  return new Promise((resolveWait, reject) => {
    const started = Date.now();
    const tick = () => {
      if (condition()) {
        resolveWait();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timeout waiting for ${label} (${timeoutMs}ms)`));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function waitSpeakTerminal(room, timeoutMs, label, expectedJobId = null) {
  return new Promise((resolveWait, reject) => {
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      offDone();
      offErr();
      clearTimeout(timer);
      fn();
    };
    const offDone = room.onMessage(COLYSEUS_SERVER_MESSAGES.done, (data) => {
      if (expectedJobId && data?.jobId && data.jobId !== expectedJobId) return;
      finish(() => resolveWait(data));
    });
    const offErr = room.onMessage(COLYSEUS_SERVER_MESSAGES.error, (data) => {
      finish(() =>
        reject(new Error(`${label}: ${data?.message ?? JSON.stringify(data)}`)),
      );
    });
    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `${label}: timeout ${timeoutMs}ms (jobId=${expectedJobId ?? "any"})`,
          ),
        ),
      );
    }, timeoutMs);
  });
}

async function runSpeakTurn(room, payload, label, timeoutMs) {
  const ackPromise = new Promise((resolveAck, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}: no speakAck within 30s`)),
      30_000,
    );
    const cleanup = () => {
      clearTimeout(timer);
      offAck();
      offBusy();
    };
    const offAck = room.onMessage(COLYSEUS_SERVER_MESSAGES.speakAck, (data) => {
      cleanup();
      if (!data?.jobId) {
        reject(new Error(`${label}: speakAck missing jobId`));
        return;
      }
      resolveAck(data.jobId);
    });
    const offBusy = room.onMessage(COLYSEUS_SERVER_MESSAGES.speakBusy, (data) => {
      if (data?.npcId && payload.npcId && data.npcId !== payload.npcId) return;
      cleanup();
      reject(
        new Error(
          `${label}: speakBusy npc=${data?.npcId ?? "?"} reason=${data?.reason ?? "busy"}`,
        ),
      );
    });
  });
  room.send("speak", payload);
  const id = await ackPromise;
  return waitSpeakTerminal(room, timeoutMs, label, id);
}

async function request(path, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  const url = `${httpBase}${path}`;
  let res;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`fetch ${path} failed: ${msg}`);
  }
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

function internalHeaders(playerId) {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (playerId) headers["X-Player-Id"] = playerId;
  return headers;
}

async function preflightWorkerStateHotPath() {
  const probeRoom = process.env.VERIFY_PREFLIGHT_ROOM_ID || "default";
  for (let i = 0; i < 3; i += 1) {
    const started = Date.now();
    const res = await fetch(
      `${httpBase}/internal/rooms/${encodeURIComponent(probeRoom)}/worker-state?skipNearbyLore=1`,
      { headers: internalHeaders(PLAYER_A) },
    );
    const ms = Date.now() - started;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`worker-state preflight → ${res.status}: ${JSON.stringify(body)}`);
    }
    if (ms >= 500) {
      throw new Error(`worker-state preflight slow: ${ms}ms (attempt ${i + 1}/3)`);
    }
  }
  console.log("verify:phase12: worker-state preflight OK (<500ms ×3)");
}

async function healthOk() {
  const { res } = await request("/health");
  if (!res.ok) throw new Error(`health ${res.status}`);
}

function assertStackReady() {
  if (skipSpeak) return;
  if (!process.env.REDIS_URL) {
    throw new Error(
      "REDIS_URL required for phase12 speak tests. Use SKIP_SPEAK_VERIFY=1 for API-only.",
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL required for collective memory E2E.");
  }
}

async function resetRoom() {
  const { res, body } = await request(`/rooms/${encodeURIComponent(roomId)}/reset`, {
    method: "POST",
    headers: { "X-Player-Id": PLAYER_A },
  });
  if (!res.ok) {
    throw new Error(`reset failed: ${res.status} ${JSON.stringify(body)}`);
  }
}

async function getCollectiveState(playerId, npcId = NPC_ID) {
  const qs = new URLSearchParams({ npcId });
  const { res, body } = await request(
    `/rooms/${encodeURIComponent(roomId)}/collective-state?${qs}`,
    { headers: { "X-Player-Id": playerId } },
  );
  if (!res.ok) {
    throw new Error(`collective-state → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function attitudeFor(stateBody, npcId = NPC_ID) {
  const row = stateBody.attitudes?.find((a) => a.npcId === npcId);
  if (!row) {
    throw new Error(`collective-state missing attitude for ${npcId}`);
  }
  return row;
}

async function applyActions(actingNpcId, initiatorPlayerId, actions) {
  const headers = { "Content-Type": "application/json", "X-Player-Id": initiatorPlayerId };
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return request(`/internal/rooms/${encodeURIComponent(roomId)}/apply-actions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ actingNpcId, initiatorPlayerId, actions }),
  });
}

async function fetchRoomState(playerId) {
  const { res, body } = await request(`/rooms/${encodeURIComponent(roomId)}/state`, {
    headers: { "X-Player-Id": playerId },
  });
  if (!res.ok) {
    throw new Error(`GET state → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body.state;
}

async function fetchMemoryContext(playerId, npcId, playerMessage) {
  const qs = new URLSearchParams({ npcId, playerMessage, playerId });
  const res = await fetch(
    `${httpBase}/internal/rooms/${encodeURIComponent(roomId)}/memory-context?${qs}`,
    { headers: internalHeaders(playerId) },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`memory-context → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function npcPosition(state, npcId = NPC_ID) {
  const npc = state?.npcs?.find((n) => n.id === npcId);
  if (!npc) throw new Error(`npc ${npcId} missing in state`);
  return { x: npc.x, y: npc.y };
}

/** D-04: seed ≥2 distinct players in collective window before speak-only events. */
async function seedTwoPlayerWindow() {
  // Default room no longer ships door-1 (Phase 16 map); use collaborate transfer instead.
  const first = await applyActions("npc-1", PLAYER_A, [
    { type: "transfer", itemId: "key-1", toNpcId: "npc-2" },
  ]);
  if (!first.res.ok) {
    throw new Error(`seed transfer A failed: ${first.res.status} ${JSON.stringify(first.body)}`);
  }
  const second = await applyActions("npc-3", PLAYER_B, [
    { type: "transfer", itemId: "note-1", toNpcId: "npc-2" },
  ]);
  if (!second.res.ok) {
    throw new Error(`seed transfer B failed: ${second.res.status} ${JSON.stringify(second.body)}`);
  }
  console.log("verify:phase12: D-04 window seeded (collaborate transfer)");
}

async function driveHostileFast() {
  const moves = [
    [PLAYER_A, 4, 4],
    [PLAYER_B, 6, 6],
    [PLAYER_A, 3, 3],
    [PLAYER_B, 7, 7],
  ];
  for (const [playerId, x, y] of moves) {
    const before = attitudeFor(await getCollectiveState(PLAYER_A));
    if (before.band === "hostile") {
      console.log("verify:phase12: VERIFY_PHASE12_FAST hostile reached");
      return;
    }

    const { res, body } = await applyActions(NPC_ID, playerId, [{ type: "move", x, y }]);
    if (res.status === 403 && body.code === "hostile_gate") {
      const now = attitudeFor(await getCollectiveState(PLAYER_A));
      if (now.band === "hostile") {
        console.log("verify:phase12: VERIFY_PHASE12_FAST hostile reached (gate blocked move)");
        return;
      }
      throw new Error(
        `driveHostileFast gate before hostile: ${JSON.stringify(body)} band=${now.band}`,
      );
    }
    if (!res.ok) {
      throw new Error(
        `driveHostileFast move (${playerId}→${x},${y}) failed: ${res.status} ${JSON.stringify(body)}`,
      );
    }
  }

  const final = attitudeFor(await getCollectiveState(PLAYER_A));
  if (final.band !== "hostile") {
    throw new Error(
      `VERIFY_PHASE12_FAST did not reach hostile (band=${final.band}, score=${final.effectiveScore})`,
    );
  }
  console.log("verify:phase12: VERIFY_PHASE12_FAST hostile seed OK");
}

async function driveHostileSpeak(roomA, speakTimeoutMs) {
  const maxRudeSpeaks = 7;
  for (let i = 0; i < maxRudeSpeaks; i++) {
    const st = await getCollectiveState(PLAYER_A);
    const att = attitudeFor(st);
    if (att.band === "hostile") {
      console.log(`verify:phase12: hostile band after ${i} extra rude speak(s)`);
      return;
    }
    await runSpeakTurn(
      roomA,
      { text: "你真粗鲁", npcId: NPC_ID, playerId: PLAYER_A },
      `rude hostile drive ${i + 1}`,
      speakTimeoutMs,
    );
    await new Promise((r) => setTimeout(r, 300));
  }
  const final = attitudeFor(await getCollectiveState(PLAYER_A));
  if (final.band !== "hostile") {
    throw new Error(
      `failed to reach hostile band (effectiveScore=${final.effectiveScore}, rep=${final.reputation})`,
    );
  }
}

async function main() {
  assertE2eNoMock("verify:phase12");
  if (!skipSpeak) assertE2eRealLlm("verify:phase12");
  assertStackReady();

  console.log(`verify:phase12 → ${httpBase} roomId=${roomId}`);
  await healthOk();
  await resetRoom();

  const clientA = new Client(wsUrl);
  const clientB = new Client(wsUrl);
  const roomA = await clientA.joinOrCreate("game_room", {
    mapRoomId: roomId,
    playerId: PLAYER_A,
  });
  await waitFor(() => roomA.state?.players?.get, 5000);
  const colyseusRoomId = roomA.roomId;

  const roomB = await clientB.join("game_room", {
    mapRoomId: roomId,
    playerId: PLAYER_B,
  });
  await waitFor(() => roomB.state?.players?.get, 5000);
  if (roomB.roomId !== colyseusRoomId) {
    throw new Error(`player B joined ${roomB.roomId}, expected ${colyseusRoomId}`);
  }
  console.log(`verify:phase12: 2 clients joined ${colyseusRoomId}`);

  const baseline = await getCollectiveState(PLAYER_A);
  const baselineAtt = attitudeFor(baseline);
  if (baselineAtt.band !== "wary" && baselineAtt.band !== "neutral") {
    throw new Error(
      `baseline band expected wary/neutral (npc-1 seed -5), got ${baselineAtt.band}`,
    );
  }
  console.log(
    `verify:phase12: baseline band=${baselineAtt.band} effectiveScore=${baselineAtt.effectiveScore}`,
  );

  await seedTwoPlayerWindow();

  if (skipSpeak) {
    console.log("verify:phase12: SKIP_SPEAK_VERIFY=1 — API-only checks skipped after seed");
    await roomA.leave();
    await roomB.leave();
    console.log("verify:phase12 OK (speak skipped)");
    return;
  }

  for (const r of [roomA, roomB]) {
    r.onMessage(COLYSEUS_SERVER_MESSAGES.thinking, () => {});
    r.onMessage(COLYSEUS_SERVER_MESSAGES.speakIdle, () => {});
  }

  await preflightWorkerStateHotPath();

  const speakTimeoutMs = e2eSpeakTimeoutMs();
  const speakStart = Date.now();

  await runSpeakTurn(
    roomA,
    { text: "你真粗鲁", npcId: NPC_ID, playerId: PLAYER_A },
    "player A rude",
    speakTimeoutMs,
  );
  await runSpeakTurn(
    roomB,
    { text: "请帮帮忙", npcId: NPC_ID, playerId: PLAYER_B },
    "player B help",
    speakTimeoutMs,
  );
  const speakMs = Date.now() - speakStart;
  console.log(`verify:phase12: dual speak OK (~${Math.round(speakMs / 1000)}s real LLM)`);

  {
    const pollEnd = Date.now() + 10_000;
    let kindsOk = false;
    while (Date.now() < pollEnd) {
      const st = await getCollectiveState(PLAYER_A);
      const kinds = (st.recentEvents ?? []).map((e) => e.kind);
      if (kinds.includes("rude") && kinds.includes("help")) {
        kindsOk = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!kindsOk) {
      const st = await getCollectiveState(PLAYER_A);
      const kinds = (st.recentEvents ?? []).map((e) => e.kind);
      throw new Error(`recentEvents missing rude/help: ${kinds.join(",") || "(empty)"}`);
    }
  }

  const afterSpeak = await getCollectiveState(PLAYER_A);
  const afterAtt = attitudeFor(afterSpeak);
  if (afterAtt.effectiveScore === baselineAtt.effectiveScore) {
    throw new Error(
      `effectiveScore unchanged after rude+help (${afterAtt.effectiveScore})`,
    );
  }
  console.log(
    `verify:phase12: collective delta effectiveScore ${baselineAtt.effectiveScore} → ${afterAtt.effectiveScore}`,
  );

  if (process.env.VERIFY_PHASE12_FAST === "1") {
    await driveHostileFast();
  } else {
    await driveHostileSpeak(roomA, speakTimeoutMs);
  }

  const hostileState = await getCollectiveState(PLAYER_A);
  const hostileAtt = attitudeFor(hostileState);
  if (hostileAtt.band !== "hostile") {
    throw new Error(`expected hostile band, got ${hostileAtt.band}`);
  }

  const memCtx = await fetchMemoryContext(PLAYER_A, NPC_ID, "帮我移动");
  const allowed = memCtx.collective?.allowedTools ?? memCtx.allowedTools ?? [];
  if (allowed.includes("move")) {
    throw new Error(`memory-context allowedTools still includes move: ${JSON.stringify(allowed)}`);
  }
  console.log("verify:phase12: memory-context hostile allowedTools OK");

  const gateRes = await applyActions(NPC_ID, PLAYER_A, [{ type: "move", x: 5, y: 5 }]);
  if (gateRes.res.status !== 403 || gateRes.body.code !== "hostile_gate") {
    throw new Error(
      `hostile apply-actions gate expected 403 hostile_gate, got ${gateRes.res.status} ${JSON.stringify(gateRes.body)}`,
    );
  }
  console.log("verify:phase12: apply-actions hostile_gate 403 OK");

  const beforeMoveSpeak = npcPosition(await fetchRoomState(PLAYER_A));
  const moveSpeakDone = await runSpeakTurn(
    roomA,
    { text: "移动到我的下方", npcId: NPC_ID, playerId: PLAYER_A },
    "hostile NL move blocked",
    speakTimeoutMs,
  );
  const doneNpc = npcPosition(moveSpeakDone?.state);
  if (beforeMoveSpeak.x !== doneNpc.x || beforeMoveSpeak.y !== doneNpc.y) {
    throw new Error(
      `NPC moved under hostile gate (speak path): before (${beforeMoveSpeak.x},${beforeMoveSpeak.y}) done (${doneNpc.x},${doneNpc.y})`,
    );
  }
  await new Promise((r) => setTimeout(r, 1500));
  const afterMoveSpeak = npcPosition(await fetchRoomState(PLAYER_A));
  if (beforeMoveSpeak.x !== afterMoveSpeak.x || beforeMoveSpeak.y !== afterMoveSpeak.y) {
    const manhattan =
      Math.abs(afterMoveSpeak.x - beforeMoveSpeak.x) +
      Math.abs(afterMoveSpeak.y - beforeMoveSpeak.y);
    if (manhattan > 1) {
      throw new Error(
        `NPC moved under hostile gate: before (${beforeMoveSpeak.x},${beforeMoveSpeak.y}) http (${afterMoveSpeak.x},${afterMoveSpeak.y})`,
      );
    }
    console.log(
      "verify:phase12: ambient npc drift 1 cell after hostile speak (speak path unchanged — pass)",
    );
  }
  const reply = moveSpeakDone?.reply ?? "";
  if (reply.includes("当前关系较紧张")) {
    console.log("verify:phase12: worker gate hint in reply OK");
  } else {
    console.log("verify:phase12: no gate hint in reply (coords unchanged — pass)");
  }

  await roomA.leave();
  await roomB.leave();
  console.log("verify:phase12 OK");
}

function formatErr(err) {
  if (err instanceof Error) {
    const code = err.code;
    return code !== undefined ? `${err.message} (code=${code})` : err.message;
  }
  return String(err);
}

main().catch((err) => {
  console.error(`verify:phase12 failed: ${formatErr(err)}`);
  process.exit(1);
});
