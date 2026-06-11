/**
 * Poll game-server /health + web UI until dev stack is ready (or timeout).
 * Web uses localhost (Vite may bind IPv6-only).
 */

const DEFAULT_GS =
  process.env.GAME_SERVER_URL ||
  `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "2567"}`;
const DEFAULT_WEB = process.env.WEB_URL || "http://localhost:5173";

/**
 * @param {{ gameServerUrl?: string; webUrl?: string; timeoutMs?: number; intervalMs?: number }} [opts]
 * @returns {Promise<{ gameServerUrl: string; webUrl: string }>}
 */
export async function waitForDevStack(opts = {}) {
  const gameServerUrl = opts.gameServerUrl ?? DEFAULT_GS;
  const webUrl = opts.webUrl ?? DEFAULT_WEB;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const intervalMs = opts.intervalMs ?? 1500;
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";

  while (Date.now() < deadline) {
    try {
      const hres = await fetch(`${gameServerUrl}/health`);
      if (!hres.ok) throw new Error(`game-server health ${hres.status}`);
      const body = await hres.json().catch(() => ({}));
      if (body.service !== "game-server" && body.status !== "ok" && body.ok !== true) {
        throw new Error("unexpected game-server health body");
      }

      const wres = await fetch(webUrl, { redirect: "follow" });
      if (!wres.ok) throw new Error(`web ${wres.status}`);

      return { gameServerUrl, webUrl };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  throw new Error(
    `dev stack not ready after ${timeoutMs}ms (gs=${gameServerUrl}, web=${webUrl}): ${lastErr}`,
  );
}
