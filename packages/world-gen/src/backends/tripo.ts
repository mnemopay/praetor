import type { ModelBackend, ModelRequest, ModelResult } from "../types.js";
import { callJson } from "./trellis2.js";

/**
 * Tripo AI — fastest hosted text-to-GLB. Used as the "draft" tier when speed
 * matters more than fidelity. Their public REST API ships sync via the
 * `model/v2/text-to-model` and `model/v2/image-to-model` endpoints.
 *
 *   - TRIPO_API_KEY (required)
 *   - TRIPO_BASE_URL (optional; defaults to https://api.tripo3d.ai/v2/openapi)
 */
export interface TripoConfig {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class TripoBackend implements ModelBackend {
  readonly name = "tripo";
  constructor(private cfg: TripoConfig = readEnv()) {}
  static fromEnv(env: NodeJS.ProcessEnv): TripoBackend { return new TripoBackend(readEnv(env)); }
  get available() { return Boolean(this.cfg.apiKey); }

  async generateModel(req: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    if (!this.cfg.apiKey) throw new Error("tripo: TRIPO_API_KEY is not set");
    const started = Date.now();
    const base = this.cfg.baseUrl ?? "https://api.tripo3d.ai/v2/openapi";
    const headers = { authorization: `Bearer ${this.cfg.apiKey}` };
    // 1) submit task
    const path = req.referenceImageUrl ? "/task/image_to_model" : "/task/text_to_model";
    const submitBody: Record<string, unknown> = req.referenceImageUrl
      ? { image: req.referenceImageUrl, prompt: req.prompt }
      : { prompt: req.prompt };
    if (req.seed != null) submitBody.seed = req.seed;
    submitBody.model_version = "v2.0-20240919";
    submitBody.face_limit = req.detail === "draft" ? 5_000 : req.detail === "high" ? 30_000 : 10_000;
    const submit = await callJson(`${base}${path}`, submitBody, headers, this.cfg.timeoutMs ?? 60_000, signal);
    const taskId = submit.data?.task_id ?? submit.task_id;
    if (!taskId) throw new Error(`tripo: missing task_id in submit response`);
    // 2) poll until done
    const deadline = Date.now() + (this.cfg.timeoutMs ?? 5 * 60_000);
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("tripo: aborted");
      await sleep(1500);
      const r = await fetch(`${base}/task/${taskId}`, { headers });
      if (!r.ok) throw new Error(`tripo poll ${r.status}`);
      const json = (await r.json()) as any;
      const data = json.data ?? json;
      const status = data.status ?? data.state;
      if (status === "success" || status === "completed") {
        const glbUrl = data.result?.pbr_model?.url
          ?? data.result?.model?.url
          ?? data.output?.glb_url
          ?? data.output?.url;
        if (!glbUrl) throw new Error("tripo: response had no GLB url");
        return {
          backend: this.name,
          glbUrl,
          thumbUrl: data.result?.rendered_image?.url,
          durationMs: Date.now() - started,
          raw: data,
        };
      }
      if (status === "failed" || status === "error") {
        throw new Error(`tripo task failed: ${JSON.stringify(data).slice(0, 300)}`);
      }
    }
    throw new Error("tripo: timed out");
  }
}

function readEnv(env: NodeJS.ProcessEnv = process.env): TripoConfig {
  return {
    apiKey: env.TRIPO_API_KEY,
    baseUrl: env.TRIPO_BASE_URL,
  };
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
