import type { Handler, PraetorRequest } from "./http.js";
import { supabaseAdmin } from "./supabase.js";
import { DEV_MODE } from "./env.js";
import type { ApiUser } from "./types.js";

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

  // ── Production path ──────────────────────────────────────────────────────
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ ok: false, error: "Invalid token" });
    return;
  }
  (req as AuthedRequest).user = { id: data.user.id, email: data.user.email };
  next();
};
