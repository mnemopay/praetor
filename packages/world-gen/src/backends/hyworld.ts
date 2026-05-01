import type { WorldBackend, WorldRequest, WorldResult } from "../types.js";
import { callJson, pickUrl } from "./trellis2.js";

/**
 * Tencent HY-World 2.0 — open-source world model. Outputs both meshes (GLB)
 * and 3D Gaussian Splats from text/image/video. Self-hosted only — point
 * `HYWORLD_ENDPOINT` at the inference server you stood up (the project ships
 * a reference Docker image; runs on H100/A100 class GPUs).
 *
 *   - HYWORLD_ENDPOINT (required)
 *   - HYWORLD_AUTH (optional Bearer/Token header)
 */
export interface HyWorldConfig {
  endpoint?: string;
  endpointHeaders?: Record<string, string>;
  timeoutMs?: number;
}

export class HyWorldBackend implements WorldBackend {
  readonly name = "hyworld";
  constructor(private cfg: HyWorldConfig = readEnv()) {}
  static fromEnv(env: NodeJS.ProcessEnv): HyWorldBackend { return new HyWorldBackend(readEnv(env)); }
  get available() { return Boolean(this.cfg.endpoint); }

  async generateWorld(req: WorldRequest, signal?: AbortSignal): Promise<WorldResult> {
    if (!this.cfg.endpoint) throw new Error("hyworld: HYWORLD_ENDPOINT is not set");
    const started = Date.now();
    const r = await callJson(
      this.cfg.endpoint,
      {
        prompt: req.prompt,
        image_url: req.referenceImageUrl ?? null,
        video_url: req.videoUrl ?? null,
        panorama_url: req.panoramaUrl ?? null,
        detail: req.detail ?? "standard",
        seed: req.seed ?? null,
      },
      this.cfg.endpointHeaders ?? {},
      this.cfg.timeoutMs ?? 15 * 60_000,
      signal,
    );
    return {
      backend: this.name,
      spzUrl: typeof r.spz_url === "string" ? r.spz_url : undefined,
      plyUrl: typeof r.ply_url === "string" ? r.ply_url : undefined,
      glbUrl: pickUrl(r, ["glb_url", "mesh_url", "model_url", "output", "url"]),
      thumbUrl: typeof r.thumb_url === "string" ? r.thumb_url : undefined,
      durationMs: Date.now() - started,
      // Self-hosted: no vendor charge.
      costUsd: 0,
      raw: r,
    };
  }
}

function readEnv(env: NodeJS.ProcessEnv = process.env): HyWorldConfig {
  return {
    endpoint: env.HYWORLD_ENDPOINT,
    endpointHeaders: env.HYWORLD_AUTH ? { authorization: env.HYWORLD_AUTH } : undefined,
  };
}
