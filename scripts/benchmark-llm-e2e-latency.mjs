/**
 * E2E LLM latency benchmark — real stack only (no LLM_MOCK).
 * Measures gateway chat + Colyseus speak paths: speak→thinking, thinking→done, total.
 *
 * Usage: pnpm dev:stack → node scripts/benchmark-llm-e2e-latency.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@colyseus/sdk";
import { assertE2eRealLlm, e2eSpeakTimeoutMs } from "./lib/e2e-policy.mjs";

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

const gatewayUrl =
  process.env.AI_GATEWAY_URL || `http://127.0.0.1:${process.env.AI_GATEWAY_PORT || "8000"}`;
const baseUrl =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const wsUrl = process.env.COLYSEUS_URL || "ws://127.0.0.1:2567";
const roomId = "default";
const speakTimeoutMs = e2eSpeakTimeoutMs();
const VERIFY_PLAYER_ID = "benchmark-player";

async function requestOk(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${options.method || "GET"} ${url} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

/** @returns {{ firstThinkingMs: number|null, totalMs: number, donePayload: object }} */
async function pollSseDone(jobId, timeoutMs) {
  const url = `${baseUrl}/rooms/${roomId}/events?jobId=${encodeURIComponent(jobId)}`;
  const res = await fetch(url, { headers: { Accept: "text/event-stream" } });
  if (!res.ok || !res.body) throw new Error(`SSE subscribe failed ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const t0 = Date.now();
  let firstThinkingMs = null;
  let donePayload = {};

  while (Date.now() - t0 < timeoutMs) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const block of parts) {
      const lines = block.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (event === "thinking" && firstThinkingMs === null) {
        firstThinkingMs = Date.now() - t0;
      }
      if (event === "done") {
        donePayload = JSON.parse(data || "{}");
        await reader.cancel();
        return { firstThinkingMs, totalMs: Date.now() - t0, donePayload };
      }
      if (event === "error") {
        throw new Error(`job error: ${data}`);
      }
    }
  }
  throw new Error("SSE timeout waiting for done");
}

async function benchmarkGatewayChat(message) {
  await requestOk(`${baseUrl}/rooms/${roomId}/reset`, { method: "POST" });
  const tPost = Date.now();
  const chat = await requestOk(`${gatewayUrl}/v1/rooms/${roomId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message, npcId: "npc-1" }),
  });
  const postMs = Date.now() - tPost;
  const { firstThinkingMs, totalMs, donePayload } = await pollSseDone(chat.jobId, speakTimeoutMs);
  const llmDoneMs = firstThinkingMs !== null ? totalMs - firstThinkingMs : null;
  return {
    path: "gateway-chat",
    message,
    jobId: chat.jobId,
    postMs,
    firstThinkingMs,
    llmDoneMs,
    totalMs,
    replyLen: (donePayload.reply ?? "").length,
    llmCallSummary: donePayload.llmCallSummary ?? null,
  };
}

async function benchmarkColyseusSpeak(message) {
  await requestOk(`${baseUrl}/rooms/${roomId}/reset`, { method: "POST" });
  const client = new Client(wsUrl);
  const room = await client.joinOrCreate("game_room", { mapRoomId: roomId });

  let jobId = null;
  let speakAckMs = null;
  let firstThinkingMs = null;
  let donePayload = null;
  let rejectErr = null;

  const t0 = Date.now();

  room.onMessage("speakAck", (data) => {
    if (speakAckMs === null && data?.jobId) {
      speakAckMs = Date.now() - t0;
      jobId = data.jobId;
    }
  });
  room.onMessage("thinking", (data) => {
    if (firstThinkingMs === null && (!data?.jobId || data.jobId === jobId)) {
      firstThinkingMs = Date.now() - t0;
    }
  });
  room.onMessage("done", (data) => {
    if (!data?.jobId || data.jobId === jobId) {
      donePayload = data;
    }
  });
  room.onMessage("error", (data) => {
    if (!data?.jobId || data.jobId === jobId) {
      rejectErr = new Error(data?.message ?? "speak error");
    }
  });

  room.send("speak", {
    text: message,
    npcId: "npc-1",
    playerId: VERIFY_PLAYER_ID,
  });

  const deadline = Date.now() + speakTimeoutMs;
  while (Date.now() < deadline) {
    if (rejectErr) throw rejectErr;
    if (donePayload) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!donePayload) throw new Error(`Colyseus speak timeout (${speakTimeoutMs}ms)`);

  const totalMs = Date.now() - t0;
  const llmDoneMs = firstThinkingMs !== null ? totalMs - firstThinkingMs : null;

  await room.leave();

  return {
    path: "colyseus-speak",
    message,
    jobId,
    speakAckMs,
    firstThinkingMs,
    llmDoneMs,
    totalMs,
    replyLen: (donePayload.reply ?? "").length,
    llmCallSummary: donePayload.llmCallSummary ?? null,
  };
}

function printRow(r) {
  const summary = r.llmCallSummary
    ? JSON.stringify(r.llmCallSummary.calls ?? r.llmCallSummary)
    : "n/a";
  console.log(`\n[${r.path}] "${r.message.slice(0, 40)}..."`);
  console.log(`  jobId=${r.jobId}`);
  if (r.postMs != null) console.log(`  POST ack: ${r.postMs}ms`);
  if (r.speakAckMs != null) console.log(`  speakAck: ${r.speakAckMs}ms`);
  console.log(`  speak→thinking: ${r.firstThinkingMs ?? "n/a"}ms`);
  console.log(`  thinking→done (LLM+tools): ${r.llmDoneMs ?? "n/a"}ms`);
  console.log(`  total E2E: ${r.totalMs}ms`);
  console.log(`  reply chars: ${r.replyLen}`);
  console.log(`  llmCallSummary: ${summary}`);
}

async function main() {
  assertE2eRealLlm("benchmark-llm-e2e-latency");
  await requestOk(`${gatewayUrl}/health`);
  await requestOk(`${baseUrl}/health`);

  console.log("=== LLM E2E Latency Benchmark ===");
  console.log(`gateway=${gatewayUrl} game-server=${baseUrl} timeout=${speakTimeoutMs}ms`);
  console.log(`LLM_PROVIDER=${process.env.LLM_PROVIDER ?? "(from .env)"}`);

  /** @type {Array<Record<string, unknown>>} */
  const results = [];

  results.push(
    await benchmarkGatewayChat("你好，用一句话介绍你自己。"),
  );
  printRow(results.at(-1));

  results.push(
    await benchmarkColyseusSpeak("hello from latency benchmark"),
  );
  printRow(results.at(-1));

  results.push(
    await benchmarkColyseusSpeak("请向右走一步。"),
  );
  printRow(results.at(-1));

  console.log("\n=== JSON summary ===");
  console.log(JSON.stringify({ stamp: new Date().toISOString(), results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
