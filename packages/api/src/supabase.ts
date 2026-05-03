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
 * For durable storage in production, ship `@praetor/store-supabase` (or
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

/** Returns the single in-memory store client. Name kept for API compatibility
 * with prior call sites — there is no Supabase here. */
export function supabaseAdmin(): PraetorStoreClient {
  return (singleton ??= new PraetorStoreClient());
}

/** Public-facing alias — new code should use this. */
export const praetorStore = supabaseAdmin;
