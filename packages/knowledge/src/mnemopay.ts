/**
 * Real MnemoPay-backed knowledge backends for Praetor.
 *
 *   - `MnemoPayHttpClient` speaks MnemoPay's REST recall surface
 *     (POST /v1/memory/remember, /recall, /forget, /size). Auth via API key
 *     header. No SDK dep — fetch only — so this stays usable from edge runtimes.
 *
 *   - `ThreeTierKnowledgeBase` layers Letta-style working / episodic / semantic
 *     memory on top of any `MnemoPayRecallClient`. Ingests route by tier
 *     (default: semantic). Queries fan out across all three tiers and merge
 *     by score. This is the layer Praetor charters get out-of-the-box.
 *
 *   - `defaultKnowledgeBase(missionId)` is the resolver Praetor's runtime calls.
 *     Returns MnemoPay 3-tier when MNEMOPAY_API_KEY is set, falls back to the
 *     in-memory bigram KB so unit tests don't need network.
 */

import {
  InMemoryKnowledgeBase,
  MnemoPayKnowledgeBase,
  type KnowledgeBase,
  type KnowledgeChunk,
  type KnowledgeHit,
  type MnemoPayRecallClient,
} from "./index.js";

export type MemoryTier = "working" | "episodic" | "semantic";
export const TIERS: readonly MemoryTier[] = ["working", "episodic", "semantic"];

export interface MnemoPayHttpOptions {
  baseUrl?: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export class MnemoPayHttpClient implements MnemoPayRecallClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetch: typeof fetch;

  constructor(opts: MnemoPayHttpOptions) {
    this.baseUrl = (opts.baseUrl ?? "https://api.mnemopay.com").replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.fetch = opts.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetch !== "function") {
      throw new Error("MnemoPayHttpClient: no global fetch — pass fetchImpl explicitly");
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MnemoPay ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  remember(args: { id: string; text: string; namespace: string; metadata?: Record<string, unknown> }) {
    return this.post<void>("/v1/memory/remember", args);
  }
  recall(args: { query: string; namespace: string; topK: number }) {
    return this.post<{ id: string; text: string; score: number; metadata?: Record<string, unknown> }[]>(
      "/v1/memory/recall",
      args,
    );
  }
  forget(args: { id: string; namespace: string }) {
    return this.post<{ removed: boolean }>("/v1/memory/forget", args);
  }
  size(args: { namespace: string }) {
    return this.post<{ count: number }>("/v1/memory/size", args).then((r) => r.count);
  }
}

/**
 * MnemoPayMcpRestClient — adapter for the *currently deployed* MCP REST surface
 * at https://mnemopay-mcp.fly.dev (or any MnemoPay MCP server). The MCP server
 * exposes `/api/:tool` which routes to the same tool handlers used over JSON-RPC,
 * but the recall response is a *formatted string* tuned for LLM consumption.
 *
 * This client:
 *   - Hits the live `/api/remember`, `/api/recall`, `/api/forget` endpoints
 *   - Auth via `Authorization: Bearer <MNEMOPAY_MCP_TOKEN>`
 *   - Parses recall's string response back into structured hits so it can plug
 *     into Praetor's `MnemoPayRecallClient` contract
 *
 * Use this when you want Praetor to talk to a real, deployed MnemoPay MCP today.
 * Use `MnemoPayHttpClient` (above) when a structured /v1/memory/* surface exists.
 */
export class MnemoPayMcpRestClient implements MnemoPayRecallClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetch: typeof fetch;

  constructor(opts: { baseUrl?: string; token: string; fetchImpl?: typeof fetch }) {
    this.baseUrl = (opts.baseUrl ?? "https://mnemopay-mcp.fly.dev").replace(/\/$/, "");
    this.token = opts.token;
    this.fetch = opts.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetch !== "function") {
      throw new Error("MnemoPayMcpRestClient: no global fetch — pass fetchImpl explicitly");
    }
  }

  private async call<T>(tool: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.fetch(`${this.baseUrl}/api/${tool}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MnemoPay MCP ${tool} ${res.status}: ${text.slice(0, 200)}`);
    }
    const wrapped = (await res.json()) as { ok?: boolean; result?: T; error?: string };
    if (wrapped.ok === false) throw new Error(`MnemoPay MCP ${tool}: ${wrapped.error ?? "unknown error"}`);
    return wrapped.result as T;
  }

  async remember(args: { id: string; text: string; namespace: string; metadata?: Record<string, unknown> }) {
    // MCP "remember" tool takes content + tags; we pack id/namespace into tags so they round-trip.
    const tags = [
      `id:${args.id}`,
      `ns:${args.namespace}`,
      ...((args.metadata?.tags as string[] | undefined) ?? []),
    ];
    await this.call("remember", { content: args.text, tags });
  }

  async recall(args: { query: string; namespace: string; topK: number }) {
    const r = await this.call<unknown>("recall", { query: args.query, limit: args.topK });
    // The MCP wrapper does JSON.parse on the tool string when possible; recall
    // returns either an "No memories found." string or a multi-line text block.
    if (typeof r === "string") {
      if (r.startsWith("No memories")) return [];
      return parseRecallText(r, args.namespace);
    }
    if (Array.isArray(r)) {
      // Some hosted MnemoPay variants already return structured hits.
      return r.map((m, i) => ({
        id: (m as { id?: string }).id ?? `mnemopay:${i}`,
        text: (m as { content?: string; text?: string }).content ?? (m as { text?: string }).text ?? "",
        score: typeof (m as { score?: unknown }).score === "number" ? (m as { score: number }).score : 0,
        metadata: (m as { metadata?: Record<string, unknown> }).metadata,
      }));
    }
    return [];
  }

  async forget(args: { id: string; namespace: string }): Promise<{ removed: boolean }> {
    const r = await this.call<string>("forget", { id: args.id });
    return { removed: typeof r === "string" && r.includes("deleted") };
  }

  async size(_args: { namespace: string }): Promise<number> {
    // No size endpoint on MCP REST; return -1 sentinel and let callers ignore.
    return -1;
  }
}

/**
 * Parse the MCP recall tool's formatted text:
 *   "1. [score:0.92, importance:0.50] some content"
 *   "2. [score:0.81, importance:0.40] more content"
 */
export function parseRecallText(text: string, namespace: string): { id: string; text: string; score: number; metadata?: Record<string, unknown> }[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const re = /^(\d+)\.\s*\[score:([\d.]+),\s*importance:([\d.]+)\]\s*(.+)$/;
  const hits: { id: string; text: string; score: number; metadata?: Record<string, unknown> }[] = [];
  for (const line of lines) {
    const m = re.exec(line);
    if (!m) continue;
    const idx = Number(m[1]);
    const score = Number(m[2]);
    const importance = Number(m[3]);
    const content = m[4];
    hits.push({
      id: `${namespace}:${idx}`,
      text: content,
      score,
      metadata: { importance },
    });
  }
  return hits;
}

export interface ThreeTierOptions {
  /** Mission or charter id used to namespace this KB. */
  missionId: string;
  client: MnemoPayRecallClient;
  /** Default tier for ingests that don't carry an explicit `tier` field. */
  defaultTier?: MemoryTier;
}

/**
 * Letta-style three-tier wrapper. Tier is selected by:
 *   1. chunk.metadata.tier if present
 *   2. options.defaultTier (default = "semantic")
 * Queries hit all three tiers in parallel; results are merged and re-ranked by
 * score. Working memory carries a stronger weight than semantic so recent
 * scratch dominates when both score the same.
 */
export class ThreeTierKnowledgeBase implements KnowledgeBase {
  private readonly tiers: Record<MemoryTier, MnemoPayKnowledgeBase>;
  private readonly defaultTier: MemoryTier;
  private readonly tierOf = new Map<string, MemoryTier>();

  constructor(opts: ThreeTierOptions) {
    this.defaultTier = opts.defaultTier ?? "semantic";
    this.tiers = {
      working: new MnemoPayKnowledgeBase(opts.client, `${opts.missionId}:working`),
      episodic: new MnemoPayKnowledgeBase(opts.client, `${opts.missionId}:episodic`),
      semantic: new MnemoPayKnowledgeBase(opts.client, `${opts.missionId}:semantic`),
    };
  }

  async ingest(chunks: KnowledgeChunk[]): Promise<{ ingested: number }> {
    const grouped: Record<MemoryTier, KnowledgeChunk[]> = { working: [], episodic: [], semantic: [] };
    for (const c of chunks) {
      const tier = pickTier(c.metadata) ?? this.defaultTier;
      grouped[tier].push(c);
      this.tierOf.set(c.id, tier);
    }
    let total = 0;
    for (const t of TIERS) {
      if (grouped[t].length) {
        const r = await this.tiers[t].ingest(grouped[t]);
        total += r.ingested;
      }
    }
    return { ingested: total };
  }

  async query(q: string, k = 5): Promise<KnowledgeHit[]> {
    const perTier = await Promise.all(TIERS.map((t) => this.tiers[t].query(q, k)));
    const merged: KnowledgeHit[] = [];
    for (let i = 0; i < TIERS.length; i++) {
      const weight = TIER_WEIGHT[TIERS[i]];
      for (const hit of perTier[i]) {
        merged.push({ chunk: hit.chunk, score: hit.score * weight });
      }
    }
    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, k);
  }

  async forget(id: string): Promise<{ removed: boolean }> {
    const tier = this.tierOf.get(id);
    if (tier) {
      const r = await this.tiers[tier].forget(id);
      if (r.removed) this.tierOf.delete(id);
      if (r.removed) return r;
    }
    for (const t of TIERS) {
      const r = await this.tiers[t].forget(id);
      if (r.removed) {
        this.tierOf.delete(id);
        return r;
      }
    }
    return { removed: false };
  }

  async size(): Promise<number> {
    const sizes = await Promise.all(TIERS.map((t) => this.tiers[t].size()));
    return sizes.reduce((a, b) => a + b, 0);
  }
}

const TIER_WEIGHT: Record<MemoryTier, number> = {
  working: 1.20,
  episodic: 1.05,
  semantic: 1.00,
};

function pickTier(metadata: Record<string, unknown> | undefined): MemoryTier | undefined {
  const t = metadata?.tier;
  if (typeof t !== "string") return undefined;
  return (TIERS as readonly string[]).includes(t) ? (t as MemoryTier) : undefined;
}

/**
 * Resolve the knowledge backend Praetor should use. Looks at:
 *   - MNEMOPAY_API_KEY  → MnemoPay HTTP client + 3-tier routing
 *   - MNEMOPAY_BASE_URL → override the API endpoint (sovereign / self-hosted)
 *
 * Falls back to in-memory so `praetor run` still works offline.
 */
export function defaultKnowledgeBase(opts: { missionId: string; env?: NodeJS.ProcessEnv } = { missionId: "default" }): KnowledgeBase {
  const env = opts.env ?? process.env;
  // 1. MnemoPay v1 structured API (when stood up at MNEMOPAY_BASE_URL).
  const v1Key = env.MNEMOPAY_API_KEY;
  const v1Base = env.MNEMOPAY_BASE_URL;
  if (v1Key && v1Base) {
    const client = new MnemoPayHttpClient({ apiKey: v1Key, baseUrl: v1Base });
    return new ThreeTierKnowledgeBase({ missionId: opts.missionId, client });
  }
  // 2. Live MnemoPay MCP REST surface (mnemopay-mcp.fly.dev or self-hosted).
  const mcpToken = env.MNEMOPAY_MCP_TOKEN;
  const mcpBase = env.MNEMOPAY_MCP_URL;
  if (mcpToken) {
    const client = new MnemoPayMcpRestClient({ token: mcpToken, baseUrl: mcpBase });
    return new ThreeTierKnowledgeBase({ missionId: opts.missionId, client });
  }
  // 3. Same env var name used historically by the SDK — accept either.
  if (v1Key) {
    const client = new MnemoPayMcpRestClient({ token: v1Key, baseUrl: mcpBase });
    return new ThreeTierKnowledgeBase({ missionId: opts.missionId, client });
  }
  // 4. Offline fallback so unit tests + air-gapped runs still work.
  return new InMemoryKnowledgeBase();
}
