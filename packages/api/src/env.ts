function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? "8788"),
  host: process.env.HOST ?? "0.0.0.0",
  repoRoot: process.env.PRAETOR_REPO_ROOT ?? process.cwd(),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  defaultBudgetUsd: Number(process.env.DEFAULT_MISSION_BUDGET_USD ?? "5"),
  /** Comma-separated list of allowed CORS origins. Localhost is always allowed in addition to this. Set to "*" to allow all (not recommended). */
  allowedOrigins: process.env.ALLOWED_ORIGINS,
};
