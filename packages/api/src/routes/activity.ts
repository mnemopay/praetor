import type { Router, Request, Response } from "express";
import express from "express";
import type { ActivityEvent } from "@praetor/core";
import type { AuthedRequest } from "../auth.js";
import { authMiddleware } from "../auth.js";
import { getActivityBus } from "../activity.js";
import { getMissionForUser, getRecentActivity } from "../db.js";
import { supabaseAdmin } from "../supabase.js";

/**
 * Server-Sent Events for the live activity feed.
 *
 *   GET /api/v1/activity/live              -> all events for the caller's missions
 *   GET /api/v1/missions/:id/events        -> events scoped to one mission, with
 *                                              the last 50 persisted events
 *                                              prepended for reconnect.
 *
 * Browsers cannot set headers on `EventSource`, so the bearer token may be
 * passed as a `?token=` query parameter as a documented fallback. Keep
 * this in mind when deploying behind a proxy that logs URLs.
 */

export function createActivityRouter(): Router {
  const router = express.Router();

  // Per-mission events with backlog and live tail.
  router.get("/missions/:id/events", queryTokenAuth, authMiddleware, async (req: AuthedRequest, res: Response) => {
    const missionId = String(req.params.id ?? "");
    const userId = req.user?.id;
    if (!userId) { res.status(401).end(); return; }

    const mission = await getMissionForUser(missionId, userId).catch(() => null);
    if (!mission) {
      res.status(404).json({ ok: false, error: "Mission not found" });
      return;
    }

    setupSseHeaders(res);

    // Reconnect backlog: send the last 50 persisted events first.
    try {
      const recent = await getRecentActivity(userId, missionId, 50);
      for (const e of recent) sendEvent(res, e);
    } catch {
      // Non-fatal: keep the stream open even without backlog.
    }

    const bus = getActivityBus();
    const unsub = bus.subscribe((e: ActivityEvent) => {
      if (e.missionId !== missionId) return;
      sendEvent(res, e);
    });

    const ka = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { /* peer gone */ }
    }, 15_000);

    req.on("close", () => {
      clearInterval(ka);
      unsub();
    });
  });

  // All-missions live tail for the caller.
  router.get("/activity/live", queryTokenAuth, authMiddleware, async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).end(); return; }

    setupSseHeaders(res);

    const ownerCache = new Map<string, string | null>();
    const bus = getActivityBus();
    const unsub = bus.subscribe((e: ActivityEvent) => {
      // Only forward events that belong to one of the caller's missions.
      // Resolve mission owner once per missionId — best-effort cache.
      void (async () => {
        let owner = ownerCache.get(e.missionId);
        if (owner === undefined) {
          owner = await resolveOwner(e.missionId);
          ownerCache.set(e.missionId, owner);
        }
        if (owner === userId) sendEvent(res, e);
      })();
    });

    const ka = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { /* peer gone */ }
    }, 15_000);

    req.on("close", () => {
      clearInterval(ka);
      unsub();
    });
  });

  return router;
}

/** Promotes a `?token=` query string into an `Authorization: Bearer <token>` header so authMiddleware can run. */
function queryTokenAuth(req: Request, _res: Response, next: () => void): void {
  if (!req.headers.authorization && typeof req.query.token === "string" && req.query.token) {
    (req.headers as Record<string, string>).authorization = `Bearer ${req.query.token}`;
  }
  next();
}

function setupSseHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(": ping\n\n");
}

function sendEvent(res: Response, e: ActivityEvent): void {
  try {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  } catch {
    // Peer gone; the close handler will clean up.
  }
}

async function resolveOwner(missionId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from("missions").select("user_id").eq("id", missionId).maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
}
