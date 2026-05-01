import type { ModelBackend, ModelRequest, ModelResult } from "../types.js";

/**
 * TRELLIS-2 — Microsoft Research's native 3D generative model. Outputs GLB
 * with PBR textures in ~10–30s. Two host modes:
 *
 * 1. Replicate (default) — set `REPLICATE_API_TOKEN`. Uses the public
 *    `firtoz/trellis` model on Replicate's serverless GPU pool.
 * 2. Self-hosted — set `TRELLIS2_ENDPOINT` to a server that accepts the same
 *    JSON shape `{prompt, image_url?, detail}` and returns `{glb_url, thumb_url}`.
 *    Drop-in for ComfyUI's Trellis 2 workflow exposed via REST.
 *
 * Either way the public API of this module stays the same — the registry
 * doesn't know which one ran.
 */
export interface Trellis2Config {
  replicateToken?: string;
  /** Override the Replicate model slug (e.g. for a private finetune). */
  replicateModel?: string;
  /** Optional self-hosted endpoint URL; takes precedence over Replicate. */
  endpoint?: string;
  /** Headers for the self-hosted endpoint. */
  endpointHeaders?: Record<string, string>;
  /** Per-call timeout in ms. Default 5 min. */
  timeoutMs?: number;
}

const DEFAULT_REPLICATE_MODEL = "firtoz/trellis:e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c";

export class Trellis2Backend implements ModelBackend {
  readonly name = "trellis2";
  constructor(private cfg: Trellis2Config = readEnv()) {}
  static fromEnv(env: NodeJS.ProcessEnv): Trellis2Backend { return new Trellis2Backend(readEnv(env)); }

  get available() {
    return Boolean(this.cfg.endpoint || this.cfg.replicateToken);
  }

  async generateModel(req: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    const started = Date.now();
    if (this.cfg.endpoint) {
      const r = await callJson(this.cfg.endpoint, {
        prompt: req.prompt,
        image_url: req.referenceImageUrl ?? null,
        detail: req.detail ?? "standard",
        seed: req.seed ?? null,
      }, this.cfg.endpointHeaders ?? {}, this.cfg.timeoutMs ?? 5 * 60_000, signal);
      return {
        backend: this.name,
        glbUrl: pickUrl(r, ["glb_url", "model_url", "output", "url"]),
        thumbUrl: pickUrl(r, ["thumb_url", "preview_url"]) || undefined,
        polyCount: typeof r.poly_count === "number" ? r.poly_count : undefined,
        textureRes: typeof r.texture_res === "number" ? r.texture_res : undefined,
        durationMs: Date.now() - started,
        raw: r,
      };
    }
    if (!this.cfg.replicateToken) {
      throw new Error("trellis2: no endpoint and no REPLICATE_API_TOKEN configured");
    }
    const out = await runReplicate(
      this.cfg.replicateToken,
      this.cfg.replicateModel ?? DEFAULT_REPLICATE_MODEL,
      {
        prompt: req.prompt,
        image: req.referenceImageUrl ?? undefined,
        seed: req.seed,
        // detail maps onto Replicate's `mesh_simplify` / `texture_size`
        texture_size: detailToTextureSize(req.detail ?? "standard"),
        mesh_simplify: detailToMeshSimplify(req.detail ?? "standard"),
      },
      this.cfg.timeoutMs ?? 5 * 60_000,
      signal,
    );
    const glbUrl = pickReplicateGlb(out);
    return {
      backend: this.name,
      glbUrl,
      thumbUrl: pickReplicateThumb(out) || undefined,
      durationMs: Date.now() - started,
      raw: { replicateOutput: out },
    };
  }
}

function readEnv(env: NodeJS.ProcessEnv = process.env): Trellis2Config {
  return {
    replicateToken: env.REPLICATE_API_TOKEN,
    replicateModel: env.TRELLIS2_REPLICATE_MODEL,
    endpoint: env.TRELLIS2_ENDPOINT,
    endpointHeaders: env.TRELLIS2_AUTH ? { authorization: env.TRELLIS2_AUTH } : undefined,
  };
}

/* ---------- shared helpers (also used by other backends) ---------- */

export async function callJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Record<string, any>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => ac.abort(), { once: true });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`POST ${url} -> ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as Record<string, any>;
  } finally {
    clearTimeout(timer);
  }
}

export function pickUrl(obj: Record<string, any>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  }
  throw new Error(`response missing one of: ${keys.join(", ")}`);
}

/**
 * Runs a Replicate prediction to completion. Replicate's standard async flow:
 * POST /predictions -> poll GET /predictions/:id until status is succeeded|failed|canceled.
 */
export async function runReplicate(
  token: string,
  model: string,
  input: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: string; output: unknown; metrics?: any; error?: string }> {
  const headers = { authorization: `Token ${token}`, "content-type": "application/json" };
  const [owner, rest] = model.includes(":") ? splitVersioned(model) : [null, model];
  const url = owner ? "https://api.replicate.com/v1/predictions" : `https://api.replicate.com/v1/models/${model}/predictions`;
  const body = owner ? { version: rest, input } : { input };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => ac.abort(), { once: true });
  try {
    const created = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ac.signal });
    if (!created.ok) {
      const text = await created.text().catch(() => "");
      throw new Error(`replicate POST ${created.status}: ${text.slice(0, 200)}`);
    }
    let pred = (await created.json()) as { id: string; status: string; output?: unknown; error?: string };
    while (pred.status !== "succeeded" && pred.status !== "failed" && pred.status !== "canceled") {
      await sleep(1500);
      const r = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, { headers, signal: ac.signal });
      if (!r.ok) throw new Error(`replicate poll ${r.status}`);
      pred = (await r.json()) as typeof pred;
    }
    if (pred.status !== "succeeded") {
      throw new Error(`replicate prediction ${pred.status}: ${pred.error ?? "unknown"}`);
    }
    return pred as { status: string; output: unknown };
  } finally {
    clearTimeout(timer);
  }
}

function splitVersioned(spec: string): [string, string] {
  const [owner, version] = spec.split(":");
  return [owner, version];
}

function pickReplicateGlb(out: { output: unknown }): string {
  // Replicate output shapes vary by model; prefer .glb urls in any string|array|object.
  const candidates = collectStrings(out.output).filter((s) => s.endsWith(".glb") || s.endsWith(".gltf"));
  if (candidates[0]) return candidates[0];
  // Some models return an object like { mesh: "...", texture: "..." }; pick first url.
  const all = collectStrings(out.output);
  if (all[0]) return all[0];
  throw new Error("replicate output had no GLB url");
}

function pickReplicateThumb(out: { output: unknown }): string | undefined {
  const candidates = collectStrings(out.output).filter((s) => /\.(png|jpg|jpeg|webp)$/i.test(s));
  return candidates[0];
}

function collectStrings(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(collectStrings);
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).flatMap(collectStrings);
  return [];
}

function detailToTextureSize(d: "draft" | "standard" | "high"): number {
  return d === "draft" ? 512 : d === "high" ? 2048 : 1024;
}

function detailToMeshSimplify(d: "draft" | "standard" | "high"): number {
  return d === "draft" ? 0.95 : d === "high" ? 0.85 : 0.9;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
