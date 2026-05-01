import type { ModelBackend, ModelRequest, ModelResult } from "../types.js";
import { callJson, pickUrl, runReplicate } from "./trellis2.js";

/**
 * Hunyuan3D 2.1 — Tencent's flow-based diffusion text/image -> 3D model.
 * Dual-stage pipeline (Hunyuan3D-DiT geometry + Hunyuan3D-Paint PBR).
 *
 *   - HUNYUAN3D_ENDPOINT: a self-hosted Hunyuan3D server (e.g. runpod box).
 *   - REPLICATE_API_TOKEN + HUNYUAN3D_REPLICATE_MODEL: Replicate fallback.
 */
export interface Hunyuan3dConfig {
  endpoint?: string;
  endpointHeaders?: Record<string, string>;
  replicateToken?: string;
  replicateModel?: string;
  timeoutMs?: number;
}

const DEFAULT_REPLICATE_MODEL = "tencent/hunyuan3d-2";

export class Hunyuan3dBackend implements ModelBackend {
  readonly name = "hunyuan3d";
  constructor(private cfg: Hunyuan3dConfig = readEnv()) {}
  static fromEnv(env: NodeJS.ProcessEnv): Hunyuan3dBackend { return new Hunyuan3dBackend(readEnv(env)); }
  get available() { return Boolean(this.cfg.endpoint || this.cfg.replicateToken); }

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
        thumbUrl: typeof r.thumb_url === "string" ? r.thumb_url : undefined,
        durationMs: Date.now() - started,
        raw: r,
      };
    }
    const out = await runReplicate(
      this.cfg.replicateToken!,
      this.cfg.replicateModel ?? DEFAULT_REPLICATE_MODEL,
      {
        caption: req.prompt,
        image: req.referenceImageUrl ?? undefined,
        seed: req.seed,
        steps: req.detail === "high" ? 50 : 30,
      },
      this.cfg.timeoutMs ?? 5 * 60_000,
      signal,
    );
    const glbUrl = pickGlbFromOutput(out.output);
    return {
      backend: this.name,
      glbUrl,
      durationMs: Date.now() - started,
      raw: { replicateOutput: out },
    };
  }
}

function readEnv(env: NodeJS.ProcessEnv = process.env): Hunyuan3dConfig {
  return {
    endpoint: env.HUNYUAN3D_ENDPOINT,
    endpointHeaders: env.HUNYUAN3D_AUTH ? { authorization: env.HUNYUAN3D_AUTH } : undefined,
    replicateToken: env.REPLICATE_API_TOKEN,
    replicateModel: env.HUNYUAN3D_REPLICATE_MODEL,
  };
}

function pickGlbFromOutput(v: unknown): string {
  const all = flatten(v).filter((s) => typeof s === "string") as string[];
  const glb = all.find((s) => s.endsWith(".glb") || s.endsWith(".gltf"));
  if (glb) return glb;
  if (all[0]) return all[0];
  throw new Error("hunyuan3d returned no GLB url");
}
function flatten(v: unknown): unknown[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(flatten);
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).flatMap(flatten);
  return [v];
}
