import type { Handler, PraetorRequest } from "./http.js";
import { supabaseAdmin } from "./supabase.js";
import { DEV_MODE } from "./env.js";
import type { ApiUser } from "./types.js";
import { timingSafeEqual } from "node:crypto";

export interface AuthedRequest extends PraetorRequest {
  user?: ApiUser;
}

/**
 * Deterministic dev user returned when PRAETOR_DEV_MODE=1 and any valid
 * Bearer token is present. Not a real identity — only used for local
 * end-to-end testing without a Supabase project.
 */
const DEV_USER: ApiUser = { id: "dev-user", email: "dev@praetor.local" };

export const authMiddleware: Handler = async (req, res, next) => {
  const auth = req.header("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ ok: false, error: "Missing bearer token" });
    return;
  }
  const token = auth.slice(7);

  // ── Dev-mode bypass ──────────────────────────────────────────────────────
  // When PRAETOR_DEV_MODE is active, any non-empty token authenticates as the
  // canonical dev user. The token is intentionally not validated — that is the
  // point of dev mode. Production must never set PRAETOR_DEV_MODE.
  if (DEV_MODE) {
    (req as AuthedRequest).user = DEV_USER;
    next();
    return;
  }

  // ── Service-token bypass (production-safe) ──────────────────────────────
  // For automated callers (cron jobs, dogfood loops, scheduled charters) that
  // can't carry a per-user Supabase JWT. Set PRAETOR_SERVICE_TOKEN on the api
  // server. The token authenticates as a fixed service-user (id "praetor-service").
  // Validates with timingSafeEqual to prevent timing attacks.
  const svcToken = process.env.PRAETOR_SERVICE_TOKEN;
  if (svcToken && token.length > 16 && token.length === svcToken.length) {
    const a = Buffer.from(token, "utf8");
    const b = Buffer.from(svcToken, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) {
      // Stable UUID for the service account — must exist in public.users (see sql/0003_service_user.sql).
      (req as AuthedRequest).user = { id: "00000000-0000-0000-0000-000000000001", email: "service@praetor.local" };
      next();
      return;
    }
  }

  // ── Production path ──────────────────────────────────────────────────────
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ ok: false, error: "Invalid token" });
    return;
  }
  (req as AuthedRequest).user = { id: data.user.id, email: data.user.email };
  next();
};
