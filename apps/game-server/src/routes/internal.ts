import { Router, type Request, type Response, type NextFunction } from "express";
import type { JobEventType } from "../sse/hub.js";
import { emitJobEvent } from "../sse/hub.js";

function requireWorkerAuth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.INTERNAL_WORKER_TOKEN;
  const allowOpen =
    process.env.NODE_ENV === "test" ||
    (process.env.ALLOW_OPEN_INTERNAL === "1" && process.env.NODE_ENV !== "production");
  if (!token) {
    if (allowOpen) {
      next();
      return;
    }
    res.status(503).json({ ok: false, error: "INTERNAL_WORKER_TOKEN not configured" });
    return;
  }
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${token}`) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  next();
}

const VALID_EVENTS = new Set<JobEventType>(["thinking", "speakPartial", "done", "error"]);

export function createInternalJobsRouter(): Router {
  const router = Router();

  router.post("/:jobId/emit", requireWorkerAuth, async (req, res) => {
    const { jobId } = req.params;
    const type = req.body?.type as JobEventType;
    let data = req.body?.data;

    if (!VALID_EVENTS.has(type)) {
      res.status(400).json({ ok: false, error: "type must be thinking, speakPartial, done, or error" });
      return;
    }

    emitJobEvent(jobId, type, data ?? {});
    res.json({ ok: true });
  });

  return router;
}

export { requireWorkerAuth };
