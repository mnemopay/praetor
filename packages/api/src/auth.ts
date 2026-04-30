import type { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "./supabase.js";
import type { ApiUser } from "./types.js";

export interface AuthedRequest extends Request {
  user?: ApiUser;
}

export async function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const auth = req.header("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ ok: false, error: "Missing bearer token" });
    return;
  }
  const token = auth.slice(7);
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ ok: false, error: "Invalid token" });
    return;
  }
  req.user = { id: data.user.id, email: data.user.email };
  next();
}
