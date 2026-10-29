import type { Request, Response } from "express";
import { HttpError } from "./errors.ts";

/** The browser asked for server-sent events rather than one JSON answer. */
export const wantsEvents = (req: Request): boolean => /\btext\/event-stream\b/.test(req.get("accept") ?? "");

export interface EventStream {
  send(event: string, data: unknown): void;
  /** Report a failure as an `error` event (a player-safe message) and log what the player can't see. */
  fail(error: unknown, fallback: string): void;
  close(): void;
}

/**
 * Start a server-sent event stream. A comment every 15 s keeps proxies (nginx closes an
 * idle upstream after 60 s by default) from cutting a long model call.
 */
export function openEventStream(res: Response, log: (message: string) => void, tag: string): EventStream {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  const stop = () => clearInterval(heartbeat);
  res.on("close", stop);
  return {
    send(event, data) {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    fail(error, fallback) {
      if (!(error instanceof HttpError) || error.status >= 500) log(`[${tag}] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      const safe = error instanceof HttpError ? error : new HttpError(500, "internal", fallback);
      this.send("error", { error: safe.code, message: safe.message, status: safe.status });
    },
    close() {
      stop();
      if (!res.writableEnded) res.end();
    },
  };
}
