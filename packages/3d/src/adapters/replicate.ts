/**
 * ReplicateTrellisAdapter — calls Microsoft TRELLIS via Replicate's
 * `firtoz/trellis` hosted endpoint. ~$0.035 per run on A100, ~25s.
 *
 * Replicate's API is poll-based: POST /predictions creates the run, GET
 * /predictions/{id} polls for completion. We implement both via the
 * provided fetch impl (defaults to globalThis.fetch) so charters can
 * inject a mock during tests.
 */

import type { ImageTo3DRequest, LicenseFamily, Praetor3DAdapter, ThreeDBackend, ThreeDResult } from "../index.js";

const REPLICATE_API = "https://api.replicate.com/v1";
/** Pinned to a known-stable version of firtoz/trellis. Override via opts.modelVersion. */
const DEFAULT_MODEL_VERSION = "e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c";

export interface ReplicateTrellisAdapterOptions {
  /** Replicate API token (from REPLICATE_API_TOKEN). */
  token: string;
  /** Override Replicate base URL (test fixtures, proxies, etc). */
  baseUrl?: string;
  /** Pinned firtoz/trellis version hash. */
  modelVersion?: string;
  /** Inject a fetch implementation (tests). */
  fetchImpl?: typeof fetch;
  /** Inject a sleep impl (tests skip the polling delay). */
  sleep?: (ms: number) => Promise<void>;
  /** Wallclock max for one run in ms. Default 5 minutes. */
  maxWaitMs?: number;
  /** Polling cadence in ms. Default 1500 (Replicate-recommended). */
  pollIntervalMs?: number;
}

export class ReplicateTrellisAdapter implements Praetor3DAdapter {
  readonly backend: ThreeDBackend = "replicate-trellis";
  readonly licenseFamily: LicenseFamily = "apache_or_mit";
  readonly displayName = "Microsoft TRELLIS via Replicate (firtoz/trellis)";

  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: ReplicateTrellisAdapterOptions) {
    if (!opts.token) throw new Error("ReplicateTrellisAdapter: token is required");
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async imageTo3D(req: ImageTo3DRequest): Promise<ThreeDResult> {
    const startedAt = Date.now();
    const baseUrl = (this.opts.baseUrl ?? REPLICATE_API).replace(/\/$/, "");
    const version = this.opts.modelVersion ?? DEFAULT_MODEL_VERSION;
    const maxWait = this.opts.maxWaitMs ?? 5 * 60_000;
    const pollInterval = this.opts.pollIntervalMs ?? 1500;

    const createRes = await this.fetchImpl(`${baseUrl}/predictions`, {
      method: "POST",
      headers: {
        authorization: `Token ${this.opts.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        version,
        input: {
          images: [req.imageUrl],
          ss_sampling_steps: req.options?.ssSamplingSteps ?? 12,
          slat_sampling_steps: req.options?.slatSamplingSteps ?? 12,
          mesh_simplify: req.simplify ?? 0.95,
          texture_size: req.textureSize ?? 1024,
          ...(req.seed !== undefined ? { seed: req.seed } : {}),
        },
      }),
    });

    if (!createRes.ok) {
      throw new Error(`replicate-trellis: create failed ${createRes.status} — ${await createRes.text()}`);
    }
    const created = (await createRes.json()) as ReplicatePrediction;

    let prediction = created;
    while (prediction.status !== "succeeded" && prediction.status !== "failed" && prediction.status !== "canceled") {
      if (Date.now() - startedAt > maxWait) {
        throw new Error(`replicate-trellis: run ${prediction.id} exceeded maxWaitMs ${maxWait}`);
      }
      await this.sleep(pollInterval);
      const pollRes = await this.fetchImpl(`${baseUrl}/predictions/${prediction.id}`, {
        headers: { authorization: `Token ${this.opts.token}` },
      });
      if (!pollRes.ok) {
        throw new Error(`replicate-trellis: poll failed ${pollRes.status} — ${await pollRes.text()}`);
      }
      prediction = (await pollRes.json()) as ReplicatePrediction;
    }

    if (prediction.status !== "succeeded") {
      throw new Error(`replicate-trellis: ${prediction.status} — ${prediction.error ?? "(no error message)"}`);
    }

    const output = prediction.output as ReplicateTrellisOutput | undefined;
    if (!output) {
      throw new Error(`replicate-trellis: prediction ${prediction.id} succeeded but returned empty output`);
    }
    const glbUrl = output.model_file ?? (Array.isArray(output) ? output[0] : "");
    const previews = output.color_video ? [output.color_video] : Array.isArray(output) ? output.slice(1) : [];
    if (!glbUrl) {
      throw new Error(`replicate-trellis: prediction ${prediction.id} returned no GLB URL`);
    }

    return {
      glbUrl,
      previewUrls: previews,
      backend: this.backend,
      licenseFamily: this.licenseFamily,
      durationSec: (Date.now() - startedAt) / 1000,
      costUsd: 0.035,
      adapterId: prediction.id,
    };
  }
}

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: string | null;
}

interface ReplicateTrellisOutput {
  model_file?: string;
  color_video?: string;
}
