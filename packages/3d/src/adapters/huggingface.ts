/**
 * HuggingFaceTrellisAdapter — points at a self-deployed HuggingFace
 * Inference Endpoint running TRELLIS. Sovereign-mode compatible: charters
 * can deploy their own endpoint and refuse paid SaaS by passing
 * `allowedLicenseFamilies: ["apache_or_mit"]` to Praetor3D.
 *
 * The endpoint is expected to follow HuggingFace's standard inference
 * protocol — POST a JSON body with `inputs` (image URL or base64) and
 * receive back a binary GLB or a JSON envelope with a signed URL.
 */

import type { ImageTo3DRequest, LicenseFamily, Praetor3DAdapter, ThreeDBackend, ThreeDResult } from "../index.js";

export interface HuggingFaceTrellisAdapterOptions {
  /** Full inference endpoint URL (e.g. https://abc.us-east-1.aws.endpoints.huggingface.cloud). */
  endpointUrl: string;
  /** HF API token. */
  token: string;
  fetchImpl?: typeof fetch;
  /** Wallclock cap. Default 5 min. */
  maxWaitMs?: number;
}

export class HuggingFaceTrellisAdapter implements Praetor3DAdapter {
  readonly backend: ThreeDBackend = "huggingface-trellis";
  readonly licenseFamily: LicenseFamily = "apache_or_mit";
  readonly displayName = "Microsoft TRELLIS via HuggingFace Inference Endpoint";

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: HuggingFaceTrellisAdapterOptions) {
    if (!opts.endpointUrl) throw new Error("HuggingFaceTrellisAdapter: endpointUrl is required");
    if (!opts.token) throw new Error("HuggingFaceTrellisAdapter: token is required");
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async imageTo3D(req: ImageTo3DRequest): Promise<ThreeDResult> {
    const startedAt = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.opts.maxWaitMs ?? 5 * 60_000);
    try {
      const res = await this.fetchImpl(this.opts.endpointUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.opts.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          inputs: req.imageUrl,
          parameters: {
            simplify: req.simplify ?? 0.95,
            texture_size: req.textureSize ?? 1024,
            ...(req.seed !== undefined ? { seed: req.seed } : {}),
          },
        }),
        signal: ac.signal,
      });
      if (!res.ok) {
        throw new Error(`hf-trellis: ${res.status} — ${await res.text()}`);
      }
      const body = (await res.json()) as { glbUrl?: string; previews?: string[] };
      if (!body.glbUrl) {
        throw new Error("hf-trellis: response missing glbUrl");
      }
      return {
        glbUrl: body.glbUrl,
        previewUrls: body.previews ?? [],
        backend: this.backend,
        licenseFamily: this.licenseFamily,
        durationSec: (Date.now() - startedAt) / 1000,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
