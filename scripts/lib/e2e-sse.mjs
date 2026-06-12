/**
 * Subscribe to game-server job SSE until `done` or `error`.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl - game-server HTTP base
 * @param {string} opts.roomId
 * @param {string} opts.jobId
 * @param {string} [opts.playerId] - X-Player-Id header
 * @param {number} [opts.timeoutMs=120_000]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function pollJobDone({
  baseUrl,
  roomId,
  jobId,
  playerId,
  timeoutMs = 120_000,
}) {
  const started = Date.now();
  const url = `${baseUrl}/rooms/${roomId}/events?jobId=${encodeURIComponent(jobId)}`;
  const headers = { Accept: "text/event-stream" };
  if (playerId) headers["X-Player-Id"] = playerId;

  const res = await fetch(url, { headers });
  if (!res.ok || !res.body) {
    throw new Error(`SSE subscribe failed ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  /** @param {number} ms */
  async function readWithTimeout(ms) {
    let timer;
    try {
      return await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("SSE read timeout")), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  while (Date.now() - started < timeoutMs) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) break;

    let chunk;
    try {
      chunk = await readWithTimeout(remaining);
    } catch (err) {
      await reader.cancel().catch(() => {});
      throw err;
    }

    const { value, done } = chunk;
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
      if (event === "done") {
        await reader.cancel();
        return JSON.parse(data || "{}");
      }
      if (event === "error") {
        throw new Error(`job error: ${data}`);
      }
    }
  }
  await reader.cancel().catch(() => {});
  throw new Error(`job ${jobId} did not complete within ${timeoutMs}ms`);
}

/** @param {number} ms */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
