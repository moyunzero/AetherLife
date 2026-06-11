import { Router, type Request, type Response, type NextFunction } from "express";
import type { JobEventType } from "../sse/hub.js";
import { emitJobEvent } from "../sse/hub.js";

/**
 * Ensures a request is authorized as an internal worker and rejects unauthorized requests.
 *
 * If the `INTERNAL_WORKER_TOKEN` environment variable is set, the middleware requires the `Authorization` header to equal `Bearer <token>`. On mismatch it responds with HTTP 401 and JSON `{ ok: false, error: "unauthorized" }`; otherwise it calls `next()` to continue the middleware chain.
 */
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

const VALID_EVENTS = new Set<JobEventType>(["thinking", "speakPartial", "done", "error"]);

/**
 * Create an Express router that exposes an authenticated internal endpoint for emitting job events.
 *
 * The router registers POST /:jobId/emit which validates the provided event `type` (must be one of
 * `thinking`, `speakPartial`, `done`, or `error`), accepts optional `data`, emits the job event, and
 * returns a JSON success response when the event is emitted.
 *
 * @returns An Express Router with the POST /:jobId/emit route that validates and emits job events.
 */
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
