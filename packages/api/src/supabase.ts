import { createRequire } from "node:module";
const _req = createRequire(import.meta.url);

/**
 * In-memory PostgREST-shape store + auth — Praetor's native replacement for
 * the Supabase SDK. Same chainable surface (.from().insert/update/select/
 * eq/order/limit/single/maybeSingle, .auth.getUser/getSession/...) so every
 * existing call site keeps working unchanged.
 *
 * Why: per Praetor doctrine — every tool in the registry should be a Praetor
 * tool. Supabase was an arbitrary backend choice. The api package now boots
 * with zero infra; missions persist for the lifetime of the process.
 *
 * For durable storage in production, ship `@kpanks/store-supabase` (or
 * `-postgres`, `-sqlite`, `-mnemopay-recall`) as opt-in adapters tagged
 * origin: "adapter".
 */

type Row = Record<string, unknown>;

interface QueryResult { data: any; error: null | { message: string; code?: string } }
type Filter = (r: Row) => boolean;

class Query implements PromiseLike<QueryResult> {
  private filters: Filter[] = [];
  private inserts: Row[] | null = null;
  private updates: Row | null = null;
  private orderCol: string | null = null;
  private orderDesc = false;
  private limitN: number | null = null;
  private mode: "single" | "maybeSingle" | "many" = "many";

  constructor(private table: string, private rows: Row[]) {}

  insert(row: Row | Row[]): this {
    this.inserts = Array.isArray(row) ? row : [row];
    return this;
  }
  update(patch: Row): this { this.updates = patch; return this; }
  select(_cols: string = "*"): this { return this; } // projection ignored — return whole row
  eq(col: string, val: unknown): this { this.filters.push((r) => r[col] === val); return this; }
  in(col: string, vals: unknown[]): this {
    const set = new Set(vals);
    this.filters.push((r) => set.has(r[col]));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.orderDesc = opts?.ascending === false;
    return this;
  }
  limit(n: number): this { this.limitN = n; return this; }
  single(): Promise<QueryResult> { this.mode = "single"; return this.exec(); }
  maybeSingle(): Promise<QueryResult> { this.mode = "maybeSingle"; return this.exec(); }

  then<TResult1 = QueryResult, TResult2 = never>(
    onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onFulfilled, onRejected);
  }

  private async exec(): Promise<QueryResult> {
    const now = new Date().toISOString();

    if (this.inserts) {
      const stamped = this.inserts.map((r) => ({ ...r, created_at: r.created_at ?? now }));
      this.rows.push(...stamped);
      const data = this.mode === "single" || this.mode === "maybeSingle" ? stamped[0] ?? null : stamped;
      return { data, error: null };
    }

    if (this.updates) {
      const updated: Row[] = [];
      for (const row of this.rows) {
        if (this.filters.every((f) => f(row))) {
          Object.assign(row, this.updates);
          updated.push(row);
        }
      }
      const data = this.mode === "single" || this.mode === "maybeSingle" ? updated[0] ?? null : updated;
      return { data, error: null };
    }

    let rows = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      const col = this.orderCol;
      const desc = this.orderDesc;
      rows = [...rows].sort((a, b) => {
        const ka = a[col] as string | number;
        const kb = b[col] as string | number;
        if (ka < kb) return desc ? 1 : -1;
        if (ka > kb) return desc ? -1 : 1;
        return 0;
      });
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);

    if (this.mode === "single") {
      if (rows.length === 0) return { data: null, error: { message: "No rows found" } };
      return { data: rows[0], error: null };
    }
    if (this.mode === "maybeSingle") {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }
}

interface PraetorAuthUser { id: string; email: string }
interface PraetorSession { user: PraetorAuthUser; access_token: string }

class PraetorStoreClient {
  private tables = new Map<string, Row[]>();

  from(table: string): Query {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return new Query(table, this.tables.get(table)!);
  }

  auth = {
    /** Tokens shaped `dev:<userId>` map to that user. Anything else → "dev-user". */
    async getUser(token: string | undefined): Promise<{ data: { user: PraetorAuthUser | null }; error: null }> {
      if (!token) return { data: { user: null }, error: null };
      const match = /^(?:Bearer\s+)?dev:([\w@.-]+)$/.exec(token);
      const id = match?.[1] ?? "dev-user";
      return { data: { user: { id, email: id.includes("@") ? id : `${id}@praetor.dev` } }, error: null };
    },
    async getSession(): Promise<{ data: { session: PraetorSession | null } }> {
      return { data: { session: { user: { id: "dev-user", email: "dev@praetor.dev" }, access_token: "dev:dev-user" } } };
    },
    onAuthStateChange(_cb: (evt: string, session: PraetorSession | null) => void) {
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async signInWithPassword({ email }: { email: string; password: string }) {
      return { data: { user: { id: email, email }, session: { user: { id: email, email }, access_token: `dev:${email}` } }, error: null };
    },
    async signUp({ email }: { email: string; password: string }) {
      return { data: { user: { id: email, email }, session: { user: { id: email, email }, access_token: `dev:${email}` } }, error: null };
    },
    async signOut(): Promise<{ error: null }> { return { error: null }; },
  };
}

let singleton: PraetorStoreClient | null = null;
// Cast as PraetorStoreClient even when it's actually the real Supabase
// client — the two are structurally compatible on the .from(...).select()
// /insert/update/eq/limit/single/maybeSingle chain that every caller uses.
let realClient: PraetorStoreClient | null = null;
let realInitTried = false;

/**
 * Returns the active store client.
 *
 * If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in the
 * environment, this returns a real `@supabase/supabase-js` client (loaded
 * synchronously via createRequire so the import-graph stays predictable
 * for the api server's startup path).
 *
 * Otherwise, it returns the in-memory PraetorStoreClient — same
 * PostgREST-shaped surface, lost on restart.
 *
 * The real Supabase client and the shim share enough of the `.from()` chain
 * that every existing call site keeps working unchanged. For surfaces
 * specific to one or the other (auth flows, RPC), branch on
 * `isRealSupabase()`.
 */
export function supabaseAdmin(): PraetorStoreClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    if (realClient) return realClient;
    if (!realInitTried) {
      realInitTried = true;
      try {
        // Use the top-level createRequire bound to this module's URL.
        // Bare `require()` would throw "require is not defined" in the ESM
        // bundle Fly runs (api outputs ESM despite the api/tsconfig).
        const supabase = _req("@supabase/supabase-js");
        realClient = supabase.createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        }) as PraetorStoreClient;
        // eslint-disable-next-line no-console
        console.log("[praetor-api] real Supabase client ACTIVE — writing to", url);
        return realClient;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[praetor-api] @supabase/supabase-js init failed:", (err as Error).message, (err as Error).stack);
      }
    }
  }
  return (singleton ??= new PraetorStoreClient());
}

/** True when the active store is the real Supabase client (env vars set
 * and the SDK installed). */
export function isRealSupabase(): boolean {
  return !!realClient;
}

/** Public-facing alias — new code should use this. */
export const praetorStore = supabaseAdmin;
