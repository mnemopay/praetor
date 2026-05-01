import type { WorldBackend, WorldRequest, WorldResult } from "../types.js";

/**
 * World Labs Marble — generative world model exposed via the World API
 * (launched January 21, 2026). Real spec at https://docs.worldlabs.ai/api
 *
 * Endpoint shape:
 *   POST /marble/v1/worlds:generate -> { operation_id }
 *   GET  /marble/v1/operations/:id  -> { done, response: World }
 *   GET  /marble/v1/worlds/:world_id (for fresh fetch)
 *
 * Auth: WLT-Api-Key header (NOT Authorization: Bearer).
 *
 * Env:
 *   - WORLDLABS_API_KEY (required)
 *   - WORLDLABS_BASE_URL (optional; defaults to https://api.worldlabs.ai — must NOT include /v1)
 *   - WORLDLABS_MODEL    (optional; defaults to "marble-1.1"; "marble-1.1-plus" for largest)
 */
export interface WorldLabsConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Total wall-clock budget for one world. Real generation takes ~5min. */
  timeoutMs?: number;
  /** Polling interval. */
  pollMs?: number;
}

export class WorldLabsBackend implements WorldBackend {
  readonly name = "worldlabs";
  constructor(private cfg: WorldLabsConfig = readEnv()) {}
  static fromEnv(env: NodeJS.ProcessEnv): WorldLabsBackend { return new WorldLabsBackend(readEnv(env)); }
  get available() { return Boolean(this.cfg.apiKey); }

  async generateWorld(req: WorldRequest, signal?: AbortSignal): Promise<WorldResult> {
    if (!this.cfg.apiKey) throw new Error("worldlabs: WORLDLABS_API_KEY is not set");

    const started = Date.now();
    const base = (this.cfg.baseUrl ?? "https://api.worldlabs.ai").replace(/\/+$/, "");
    const headers = {
      "WLT-Api-Key": this.cfg.apiKey,
      "Content-Type": "application/json",
    } as const;
    const model = this.cfg.model ?? "marble-1.1";

    // Build a world_prompt union — type chosen from which inputs are present.
    let world_prompt: Record<string, unknown>;
    if (req.videoUrl) {
      world_prompt = { type: "video", video_url: req.videoUrl, text_prompt: req.prompt };
    } else if (req.panoramaUrl) {
      world_prompt = { type: "panorama", panorama_url: req.panoramaUrl, text_prompt: req.prompt };
    } else if (req.referenceImageUrl) {
      world_prompt = { type: "image", image_url: req.referenceImageUrl, text_prompt: req.prompt };
    } else {
      world_prompt = { type: "text", text_prompt: req.prompt };
    }

    const body: Record<string, unknown> = {
      world_prompt,
      model,
      display_name: truncate(req.prompt, 60),
    };
    if (typeof req.seed === "number") body.seed = req.seed;

    // 1) Submit
    const submitUrl = `${base}/marble/v1/worlds:generate`;
    const submitRes = await fetch(submitUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!submitRes.ok) {
      const text = await submitRes.text().catch(() => "");
      throw new Error(`worldlabs submit ${submitRes.status}: ${text.slice(0, 400)}`);
    }
    const submitJson = (await submitRes.json()) as any;
    const operationId: string | undefined = submitJson.operation_id ?? submitJson.operationId;
    if (!operationId) {
      throw new Error(`worldlabs: submit response missing operation_id: ${JSON.stringify(submitJson).slice(0, 300)}`);
    }

    // The submit response itself may already be done=true with a snapshot
    if (submitJson.done && submitJson.response) {
      return shapeResult(this.name, started, submitJson.response);
    }

    // 2) Poll the operation
    const totalBudget = this.cfg.timeoutMs ?? 8 * 60_000;
    const pollMs = this.cfg.pollMs ?? 5_000;
    const deadline = Date.now() + totalBudget;
    let polls = 0;

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("worldlabs: aborted");
      await sleep(pollMs);
      polls += 1;

      const opUrl = `${base}/marble/v1/operations/${operationId}`;
      const r = await fetch(opUrl, { headers: { "WLT-Api-Key": this.cfg.apiKey }, signal });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`worldlabs poll ${r.status}: ${text.slice(0, 400)}`);
      }
      const op = (await r.json()) as any;

      if (op.done) {
        if (op.error && (op.error.message || op.error.code)) {
          throw new Error(`worldlabs world failed: ${JSON.stringify(op.error).slice(0, 300)}`);
        }
        // Sometimes response is a string sentinel; only treat object as a snapshot
        if (op.response && typeof op.response === "object") {
          return shapeResult(this.name, started, op.response, { operationId, polls });
        }
        // done=true but no response object — fall back to GET /worlds/:id if we know it
        const worldId: string | undefined = op.response?.world_id ?? op.world_id;
        if (worldId) {
          const wr = await fetch(`${base}/marble/v1/worlds/${worldId}`, { headers: { "WLT-Api-Key": this.cfg.apiKey }, signal });
          if (wr.ok) {
            const world = await wr.json();
            return shapeResult(this.name, started, world, { operationId, polls });
          }
        }
        throw new Error(`worldlabs: operation done but no response payload: ${JSON.stringify(op).slice(0, 300)}`);
      }
    }
    throw new Error(`worldlabs: timed out after ${Math.round((Date.now() - started) / 1000)}s (operation ${operationId} still running)`);
  }
}

function shapeResult(
  name: string,
  started: number,
  world: any,
  extra: Record<string, unknown> = {}
): WorldResult {
  // assets.splats.spz_urls is an object map { quality_or_chunk: url }; pick first.
  const spzMap = world?.assets?.splats?.spz_urls ?? {};
  const spzUrl = pickFirstUrl(spzMap);
  const plyUrl = pickFirstUrl(world?.assets?.splats?.ply_urls ?? {});
  const glbUrl = world?.assets?.mesh?.collider_mesh_url ?? world?.assets?.mesh?.glb_url;
  const thumbUrl = world?.assets?.thumbnail_url ?? world?.assets?.imagery?.pano_url;

  return {
    backend: name,
    spzUrl,
    plyUrl,
    glbUrl,
    thumbUrl,
    durationMs: Date.now() - started,
    raw: { ...extra, world_id: world?.world_id, world_marble_url: world?.world_marble_url, model: world?.model, assets: world?.assets },
  };
}

function pickFirstUrl(obj: unknown): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function readEnv(env: NodeJS.ProcessEnv = process.env): WorldLabsConfig {
  return {
    apiKey: env.WORLDLABS_API_KEY,
    baseUrl: env.WORLDLABS_BASE_URL,
    model: env.WORLDLABS_MODEL,
  };
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
