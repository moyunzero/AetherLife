import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { clearJobSubscribers, emitJobEvent, subscribeJobEvents } from "./hub.js";

describe("sse hub", () => {
  beforeEach(() => {
    clearJobSubscribers();
  });

  it("replays buffered events when client connects after worker emit", () => {
    const jobId = "replay-job";
    emitJobEvent(jobId, "error", { message: "missing API key" });

    const writes: string[] = [];
    const res = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn((chunk: string) => {
        writes.push(chunk);
      }),
      on: vi.fn(),
    } as unknown as Response;
    const req = { on: vi.fn() } as unknown as Request;

    subscribeJobEvents(req, res, jobId);

    const body = writes.join("");
    expect(body).toContain("event: error");
    expect(body).toContain("missing API key");
  });
});
