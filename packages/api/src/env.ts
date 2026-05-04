/**
 * True when PRAETOR_DEV_MODE is "1" or "true". In this mode the API boots
 * without real Supabase credentials — the in-memory store and auth bypass
 * handle all requests instead. Never set this in production.
 */
export const DEV_MODE =
  process.env.PRAETOR_DEV_MODE === "1" || process.env.PRAETOR_DEV_MODE === "true";

/**
 * Resolve a required environment variable. In dev mode, variables that are
 * absent fall back to the supplied placeholder instead of throwing. In
 * production (DEV_MODE=false) the original hard-fail behaviour is preserved.
 */
function required(name: string, devPlaceholder: string): string {
  const value = process.env[name];
  if (value) return value;
  if (DEV_MODE) return devPlaceholder;
  throw new Error(`Missing required environment variable: ${name}`);
}

export const env = {
  port: Number(process.env.PORT ?? "8788"),
  host: process.env.HOST ?? "0.0.0.0",
  repoRoot: process.env.PRAETOR_REPO_ROOT ?? process.cwd(),
  supabaseUrl: required("SUPABASE_URL", "http://localhost:54321"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY", "praetor-dev-shim"),
  defaultBudgetUsd: Number(process.env.DEFAULT_MISSION_BUDGET_USD ?? "5"),
  /** Comma-separated list of allowed CORS origins. Localhost is always allowed in addition to this. Set to "*" to allow all (not recommended). */
  allowedOrigins: process.env.ALLOWED_ORIGINS,
  /** Where world-gen scenes published via publish_3d_scene live. Default: <repoRoot>/praetor-out/scenes */
  worldGenOutDir: process.env.WORLD_GEN_OUT_DIR,
};
