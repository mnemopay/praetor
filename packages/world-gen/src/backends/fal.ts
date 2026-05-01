import type { ModelBackend, ModelRequest, ModelResult } from "../types.js";
import { callJson, pickUrl } from "./trellis2.js";

/**
 * fal.ai sam-3/3d-objects — Meta SAM-3 segments the input image, then a
 * dedicated 3D head reconstructs a GLB. Image-only — fal returns 400 on
 * pure text prompts. This backend declares itself unavailable for text-only
 * requests so the selector can fall through.
 *
 *   - FAL_API_KEY: a fal API key
 *   - FAL_MODEL: optional override (default `fal-ai/sam-3/3d-objects`)
 */
export interface FalConfig {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export class FalSam3dBackend implements ModelBackend {
  readonly name = "fal-sam-3d";
  constructor(private cfg: FalConfig = readEnv()) {}
  static fromEnv(env: NodeJS.ProcessEnv): FalSam3dBackend { return new FalSam3dBackend(readEnv(env)); }
  get available() { return Boolean(this.cfg.apiKey); }

  async generateModel(req: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    if (!this.cfg.apiKey) throw new Error("fal: FAL_API_KEY is not set");
    if (!req.referenceImageUrl) throw new Error("fal-sam-3d: requires referenceImageUrl (image-driven only)");
    const started = Date.now();
    const model = this.cfg.model ?? "fal-ai/sam-3/3d-objects";
    const r = await callJson(
      `https://fal.run/${model}`,
      { image_url: req.referenceImageUrl, prompt: req.prompt },
      { authorization: `Key ${this.cfg.apiKey}` },
      this.cfg.timeoutMs ?? 5 * 60_000,
      signal,
    );
    return {
      backend: this.name,
      glbUrl: pickUrl(r, ["model_url", "glb_url", "output_url", "url"]),
      thumbUrl: typeof r.preview_url === "string" ? r.preview_url : undefined,
      durationMs: Date.now() - started,
      raw: r,
    };
  }
}

function readEnv(env: NodeJS.ProcessEnv = process.env): FalConfig {
  return {
    apiKey: env.FAL_API_KEY,
    model: env.FAL_MODEL,
  };
}
