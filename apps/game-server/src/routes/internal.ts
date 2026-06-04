import { Router, type Request, type Response, type NextFunction } from "express";
import type { JobEventType } from "../sse/hub.js";
import { checkReply } from "../lib/gateway-client.js";
import { emitJobEvent } from "../sse/hub.js";

function requireWorkerAuth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (token) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${token}`) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
  }
  next();
}

const VALID_EVENTS = new Set<JobEventType>(["thinking", "done", "error"]);

export function createInternalJobsRouter(): Router {
  const router = Router();

  router.post("/:jobId/emit", requireWorkerAuth, async (req, res) => {
    const { jobId } = req.params;
    const type = req.body?.type as JobEventType;
    let data = req.body?.data;

    if (!VALID_EVENTS.has(type)) {
      res.status(400).json({ ok: false, error: "type must be thinking, done, or error" });
      return;
    }

    if (type === "done" && data && typeof data === "object") {
      const raw =
        typeof data.reply === "string"
          ? data.reply
          : typeof data.text === "string"
            ? data.text
            : null;
      if (raw) {
        const guarded = await checkReply(raw);
        data = { ...data, reply: guarded, text: guarded };
      }
    }

    emitJobEvent(jobId, type, data ?? {});
    res.json({ ok: true });
  });

  return router;
}

export { requireWorkerAuth };
