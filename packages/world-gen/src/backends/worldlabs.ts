import type { WorldBackend, WorldRequest, WorldResult } from "../types.js";
import { callJson } from "./trellis2.js";

/**
 * World Labs Marble — generative world model exposed via the World API
 * (launched January 21, 2026). Accepts text, image, panorama, or video as
 * input and returns 3D Gaussian Splat scenes streamable via Spark 2.0.
 *
 *   - WORLDLABS_API_KEY (required)
 *   - WORLDLABS_BASE_URL (optional; defaults to https://api.worldlabs.ai)
 *
 * Output shape includes both a streamable SPZ archive and an optional GLB
 * mesh export. Polling pattern follows World Labs' published spec.
 */
export interface WorldLabsConfig {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class WorldLabsBackend implements WorldBackend {
  readonly name = "worldlabs";
  constructor(private cfg: WorldLabsConfig = readEnv()) {}
  static fromEnv(env: NodeJS.ProcessEnv): WorldLabsBackend { return new WorldLabsBackend(readEnv(env)); }
  get available() { return Boolean(this.cfg.apiKey); }

  async generateWorld(req: WorldRequest, signal?: AbortSignal): Promise<WorldResult> {
    if (!this.cfg.apiKey) throw new Error("worldlabs: WORLDLABS_API_KEY is not set");
    const started = Date.now();
    const base = this.cfg.baseUrl ?? "https://api.worldlabs.ai";
    const headers = { authorization: `Bearer ${this.cfg.apiKey}` };

    // Choose the right input modality
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      detail: req.detail ?? "standard",
      seed: req.seed ?? null,
    };
    if (req.referenceImageUrl) body.image_url = req.referenceImageUrl;
    if (req.panoramaUrl) body.panorama_url = req.panoramaUrl;
    if (req.videoUrl) body.video_url = req.videoUrl;

    const submit = await callJson(`${base}/v1/worlds`, body, headers, this.cfg.timeoutMs ?? 60_000, signal);
    const id = submit.id ?? submit.world_id;
    if (!id) throw new Error("worldlabs: submit response missing id");

    const deadline = Date.now() + (this.cfg.timeoutMs ?? 10 * 60_000);
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("worldlabs: aborted");
      await sleep(2000);
      const r = await fetch(`${base}/v1/worlds/${id}`, { headers });
      if (!r.ok) throw new Error(`worldlabs poll ${r.status}`);
      const data = (await r.json()) as any;
      const status = data.status ?? data.state;
      if (status === "completed" || status === "succeeded") {
        return {
          backend: this.name,
          spzUrl: data.outputs?.spz_url ?? data.spz_url,
          plyUrl: data.outputs?.ply_url ?? data.ply_url,
          glbUrl: data.outputs?.glb_url ?? data.glb_url,
          thumbUrl: data.outputs?.thumb_url ?? data.preview_url,
          durationMs: Date.now() - started,
          raw: data,
        };
      }
      if (status === "failed" || status === "error") {
        throw new Error(`worldlabs world failed: ${JSON.stringify(data).slice(0, 300)}`);
      }
    }
    throw new Error("worldlabs: timed out");
  }
}

function readEnv(env: NodeJS.ProcessEnv = process.env): WorldLabsConfig {
  return {
    apiKey: env.WORLDLABS_API_KEY,
    baseUrl: env.WORLDLABS_BASE_URL,
  };
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
