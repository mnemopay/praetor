/**
 * Real Supabase client wrapper. Only loaded when SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY are set. Uses dynamic import so the
 * @supabase/supabase-js peer dep doesn't have to be installed when the
 * api runs in PRAETOR_DEV_MODE.
 *
 * Set these on the praetor-api Fly app to switch from in-memory to
 * real persistence:
 *
 *   fly secrets set \
 *     SUPABASE_URL=https://<your-project>.supabase.co \
 *     SUPABASE_SERVICE_ROLE_KEY=<service-role-key-from-supabase-dashboard> \
 *     -a praetor-api
 *   fly secrets unset PRAETOR_DEV_MODE -a praetor-api
 *   fly deploy --remote-only --config packages/api/fly.toml --dockerfile ./Dockerfile
 *
 * Required Supabase tables (run in your Supabase SQL editor):
 *   See packages/api/sql/0001_init.sql
 *
 * The real Supabase client returns the SAME PostgREST chainable shape
 * the in-memory shim already exposes, so every existing call site keeps
 * working. The auth surface (`.auth.getUser`, `.signInWithPassword`,
 * etc.) maps to Supabase's real auth.
 */

let realClient: unknown = null;

export async function loadRealSupabase(): Promise<unknown | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (realClient) return realClient;
  try {
    // Avoid bundling supabase-js when env vars aren't set.
    // The api package declares it as an optional peer in package.json so
    // npm install doesn't fail when a downstream consumer skips it.
    const supabase = await import("@supabase/supabase-js" as string).catch(() => null);
    if (!supabase) {
      console.warn("[praetor-api] SUPABASE_URL set but @supabase/supabase-js not installed — falling back to in-memory store. Run: npm install @supabase/supabase-js");
      return null;
    }
    const createClient = (supabase as { createClient: (url: string, key: string, opts?: unknown) => unknown }).createClient;
    realClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log("[praetor-api] real Supabase client active —", url);
    return realClient;
  } catch (err) {
    console.error("[praetor-api] failed to init real Supabase client:", (err as Error).message);
    return null;
  }
}

export function isRealSupabaseConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
