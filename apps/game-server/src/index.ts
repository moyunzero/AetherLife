import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { safeParseGameAction } from "@aetherlife/game-actions";
import { DEFAULT_PORTS } from "@aetherlife/shared";
import { createRoomsRouter, createInternalRoomsRouter } from "./routes/rooms.js";
import { createChatRouter } from "./routes/chat.js";
import { createNpcMemoryRouter } from "./routes/npc-memory.js";
import { createCollectiveStateRouter } from "./routes/collective-state.js";
import { createWorldHistoryRouter } from "./routes/world-history.js";
import { createInternalWorldHistoryRouter } from "./routes/internal-world-history.js";
import { createAuditRouter } from "./routes/audit.js";
import { createInternalJobsRouter } from "./routes/internal.js";
import { createInternalMemoriesRouter } from "./routes/internal-memories.js";
import { createInternalCollectiveRouter } from "./routes/internal-collective.js";
import {
  createInternalLoreMetricsRouter,
  createInternalLoreRouter,
} from "./routes/internal-lore.js";
import { createInternalAmbientIntentRouter } from "./routes/internal-ambient-intent.js";
import { createInternalNpcRelationshipsRouter } from "./routes/internal-npc-relationships.js";
import { createInternalWorldVoteTriggerRouter } from "./routes/internal-world-vote-trigger.js";
import { attachColyseus } from "./colyseus/server.js";

function formatZodError(error: { issues: Array<{ path: (string | number)[]; message: string }> }) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function createApp(): Express {
  const app = express();
  const json = express.json({ limit: "16kb" });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "game-server" });
  });

  app.post("/actions/validate", json, (req, res) => {
    const parsed = safeParseGameAction(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: formatZodError(parsed.error) });
      return;
    }
    res.json({ ok: true, action: parsed.data });
  });

  app.use("/rooms", json, createRoomsRouter());
  app.use("/rooms", json, createAuditRouter());
  app.use("/rooms", json, createNpcMemoryRouter());
  app.use("/rooms", json, createCollectiveStateRouter());
  app.use("/rooms", json, createWorldHistoryRouter());
  app.use("/rooms", json, createChatRouter());
  app.use("/internal/rooms", json, createInternalRoomsRouter());
  app.use("/internal/rooms", json, createInternalMemoriesRouter());
  app.use("/internal/rooms", json, createInternalCollectiveRouter());
  app.use("/internal/rooms", json, createInternalWorldHistoryRouter());
  app.use("/internal/rooms", json, createInternalAmbientIntentRouter());
  app.use("/internal/rooms", json, createInternalNpcRelationshipsRouter());
  app.use("/internal/rooms", json, createInternalWorldVoteTriggerRouter());
  app.use("/internal/jobs", json, createInternalJobsRouter());
  app.use("/internal/world", json, createInternalLoreRouter());
  app.use("/internal/metrics", json, createInternalLoreMetricsRouter());

  app.use(
    (
      err: Error & { type?: string; status?: number },
      _req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (err instanceof SyntaxError && "body" in err) {
        res.status(400).json({ ok: false, error: "Invalid JSON" });
        return;
      }
      if (err.type === "entity.too.large" || err.status === 413) {
        res.status(413).json({ ok: false, error: "Payload too large" });
        return;
      }
      next(err);
    },
  );

  return app;
}

export async function startServer(
  port = Number(process.env.GAME_SERVER_PORT) || DEFAULT_PORTS.gameServer,
) {
  const app = createApp();
  const { colyseus } = attachColyseus(app);
  await colyseus.listen(port);
  console.log(`game-server listening on ${port} (http+ws)`);
  return colyseus;
}

import { fileURLToPath } from "node:url";

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) &&
  process.env.NODE_ENV !== "test";

import { loadRootEnv } from "./load-env.js";

if (isMain && process.env.VITEST !== "true") {
  loadRootEnv();
  void startServer();
}
