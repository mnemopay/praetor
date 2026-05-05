/**
 * @kpanks/3d — Praetor-native image-to-3D + text-to-3D runtime.
 *
 * Per `feedback_praetor_native_tools.md`, the default backend is Microsoft
 * TRELLIS (MIT, image -> GLB mesh + PBR textures) hosted on Replicate. The
 * facade owns audit + activity-bus emission + license-family checks; raw
 * mesh generation is delegated to a Praetor3DAdapter.
 *
 * Three adapters ship today:
 *
 *   1. ReplicateTrellisAdapter — calls Replicate's `firtoz/trellis` model
 *      (~$0.035/run, ~25s on A100). Returns a GLB URL plus preview renders.
 *      License family: apache_or_mit (TRELLIS itself; the hosting is
 *      proprietary infrastructure but the model + outputs are MIT).
 *
 *   2. HuggingFaceTrellisAdapter — for charters that have a HuggingFace
 *      Inference Endpoint pointing at TRELLIS. Same outputs, sovereign-mode
 *      compatible.
 *
 *   3. MockAdapter — synthetic GLB blob for tests / fall-back when no
 *      backend is configured.
 *
 * The facade exposes:
 *
 *   const studio = new Praetor3D({ adapter: new ReplicateTrellisAdapter({ token }) });
 *   const result = await studio.imageTo3D({ imageUrl, simplify: 0.95, textureSize: 1024 });
 *   // result.glbUrl, result.previewUrls, result.backend, result.costUsd, result.licenseFamily
 */

import type { ActivityBus } from "@kpanks/core";

export type LicenseFamily = "apache_or_mit" | "proprietary" | "restricted";

export type ThreeDBackend =
  | "replicate-trellis"
  | "huggingface-trellis"
  | "self-hosted-trellis"
  | "mock";

export interface ImageTo3DRequest {
  /** HTTPS URL to a PNG / JPEG. Charters that have a Buffer should host it
   * via the same upload primitive UGC uses (presigned S3 / supabase storage)
   * before calling — adapters never accept raw bytes to keep request shape
   * cheap to log + audit. */
  imageUrl: string;
  /** Optional text prompt for hybrid image+text models. Ignored on TRELLIS-image. */
  textPrompt?: string;
  /** Mesh simplification 0–1. 0.95 = aggressive (default); 0 = full density. */
  simplify?: number;
  /** Texture size in pixels (256, 512, 1024 typical). Default 1024. */
  textureSize?: number;
  /** Random seed for deterministic re-runs. */
  seed?: number;
  /** Override the backend selected by the runtime. */
  backend?: ThreeDBackend;
  /** Pass-through options to the adapter. */
  options?: Record<string, unknown>;
}

export interface TextTo3DRequest {
  /** Text prompt — TRELLIS-text-base/large/xlarge models. */
  prompt: string;
  simplify?: number;
  textureSize?: number;
  seed?: number;
  backend?: ThreeDBackend;
  options?: Record<string, unknown>;
}

export interface ThreeDResult {
  /** URL to the generated GLB (mesh + PBR textures embedded). */
  glbUrl: string;
  /** Multi-angle preview render URLs (front / back / 3/4 view typical). */
  previewUrls: string[];
  /** Backend that produced the asset. */
  backend: ThreeDBackend;
  /** License family of the underlying model — charters can refuse non-permissive backends. */
  licenseFamily: LicenseFamily;
  /** Best-effort wallclock for the run in seconds. */
  durationSec: number;
  /** Estimated cost in USD if the backend reports it; undefined for free / self-hosted. */
  costUsd?: number;
  /** Adapter-specific id (e.g. Replicate prediction id) for audit / re-fetch. */
  adapterId?: string;
}

export interface Praetor3DAdapter {
  readonly backend: ThreeDBackend;
  readonly licenseFamily: LicenseFamily;
  readonly displayName: string;
  imageTo3D(req: ImageTo3DRequest): Promise<ThreeDResult>;
  textTo3D?(req: TextTo3DRequest): Promise<ThreeDResult>;
}

export interface Praetor3DOptions {
  adapter?: Praetor3DAdapter;
  bus?: ActivityBus;
  missionId?: string;
  auditSink?: { record: (type: string, data: Record<string, unknown>) => void };
  /** If set, the facade refuses to dispatch when adapter.licenseFamily is not in this list. */
  allowedLicenseFamilies?: readonly LicenseFamily[];
}

export class Praetor3D {
  private adapter: Praetor3DAdapter | null;
  constructor(private readonly opts: Praetor3DOptions = {}) {
    this.adapter = opts.adapter ?? null;
  }

  attachAdapter(adapter: Praetor3DAdapter): this {
    this.adapter = adapter;
    return this;
  }

  isAttached(): boolean {
    return this.adapter !== null;
  }

  async imageTo3D(req: ImageTo3DRequest): Promise<ThreeDResult> {
    return this.audited("image_to_3d", { imageUrl: req.imageUrl, simplify: req.simplify, textureSize: req.textureSize }, () =>
      this.requireAdapter().imageTo3D(req),
    );
  }

  async textTo3D(req: TextTo3DRequest): Promise<ThreeDResult> {
    const adapter = this.requireAdapter();
    if (!adapter.textTo3D) {
      throw new Error(`Praetor3D: adapter '${adapter.displayName}' does not implement textTo3D`);
    }
    return this.audited("text_to_3d", { prompt: req.prompt, simplify: req.simplify, textureSize: req.textureSize }, () =>
      adapter.textTo3D!(req),
    );
  }

  private requireAdapter(): Praetor3DAdapter {
    if (!this.adapter) {
      throw new Error(
        "Praetor3D: no adapter attached. Call attachAdapter() with ReplicateTrellisAdapter, HuggingFaceTrellisAdapter, or MockThreeDAdapter.",
      );
    }
    if (this.opts.allowedLicenseFamilies && !this.opts.allowedLicenseFamilies.includes(this.adapter.licenseFamily)) {
      throw new Error(
        `Praetor3D: adapter '${this.adapter.displayName}' has license family '${this.adapter.licenseFamily}', not in allowed list [${this.opts.allowedLicenseFamilies.join(", ")}]`,
      );
    }
    return this.adapter;
  }

  private async audited<T>(verb: string, data: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    const eventId = mintEventId();
    const ts = new Date().toISOString();
    this.opts.auditSink?.record(`3d.${verb}`, { eventId, ...data });
    if (this.opts.bus && this.opts.missionId) {
      this.opts.bus.publish({
        kind: "tool.start",
        missionId: this.opts.missionId,
        eventId,
        toolName: `3d_${verb}`,
        args: data,
        ts,
      });
    }
    try {
      const result = await fn();
      const endTs = new Date().toISOString();
      if (this.opts.bus && this.opts.missionId) {
        this.opts.bus.publish({
          kind: "tool.end",
          missionId: this.opts.missionId,
          eventId,
          ok: true,
          ts: endTs,
        });
      }
      return result;
    } catch (err) {
      const endTs = new Date().toISOString();
      if (this.opts.bus && this.opts.missionId) {
        this.opts.bus.publish({
          kind: "tool.end",
          missionId: this.opts.missionId,
          eventId,
          ok: false,
          result: { error: err instanceof Error ? err.message : String(err) },
          ts: endTs,
        });
      }
      throw err;
    }
  }
}

function mintEventId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export { ReplicateTrellisAdapter } from "./adapters/replicate.js";
export type { ReplicateTrellisAdapterOptions } from "./adapters/replicate.js";
export { HuggingFaceTrellisAdapter } from "./adapters/huggingface.js";
export type { HuggingFaceTrellisAdapterOptions } from "./adapters/huggingface.js";
export { MockThreeDAdapter } from "./adapters/mock.js";
