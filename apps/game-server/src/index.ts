import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { safeParseGameAction } from "@aetherlife/game-actions";
import { DEFAULT_PORTS } from "@aetherlife/shared";

function formatZodError(error: { issues: Array<{ path: (string | number)[]; message: string }> }) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function createApp(): Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "game-server" });
  });

  app.post(
    "/actions/validate",
    express.json({ limit: "16kb" }),
    (req, res) => {
      const parsed = safeParseGameAction(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: formatZodError(parsed.error) });
        return;
      }
      res.json({ ok: true, action: parsed.data });
    },
  );

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

export function startServer(port = Number(process.env.GAME_SERVER_PORT) || DEFAULT_PORTS.gameServer) {
  const app = createApp();
  return app.listen(port, () => {
    console.log(`game-server listening on ${port}`);
  });
}

import { fileURLToPath } from "node:url";

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) &&
  process.env.NODE_ENV !== "test";

if (isMain && process.env.VITEST !== "true") {
  startServer();
}
