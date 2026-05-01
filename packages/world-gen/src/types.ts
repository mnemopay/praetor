/**
 * Praetor World-Gen — public type surface.
 *
 * Every backend (TRELLIS-2, Hunyuan3D, Tripo, fal sam-3d, World Labs Marble,
 * Tencent HY-World 2.0, mock) implements the same two interfaces. The tools
 * exposed in the registry don't know which backend they're talking to —
 * `selectBackend()` resolves one from env vars at call time.
 */

/* ---------- model generation ---------- */

export type ModelDetail = "draft" | "standard" | "high";

export interface ModelRequest {
  /** Free-text description of the object to model. */
  prompt: string;
  /** Optional reference image (URL). When set, the request becomes image-to-3D. */
  referenceImageUrl?: string;
  /** Optional second-pass quality target. */
  detail?: ModelDetail;
  /** Optional explicit backend override ("trellis2"|"hunyuan3d"|"tripo"|"fal"|"mock"). */
  backend?: string;
  /** Optional seed for deterministic re-rolls. */
  seed?: number;
}

export interface ModelResult {
  /** Backend that produced the model. */
  backend: string;
  /** Public/CDN URL to the GLB file. */
  glbUrl: string;
  /** Optional preview thumbnail. */
  thumbUrl?: string;
  /** Optional polygon count. */
  polyCount?: number;
  /** Optional texture resolution in px (square). */
  textureRes?: number;
  /** Wall-clock ms the backend spent generating. */
  durationMs: number;
  /** Optional cost in USD (pre-margin). */
  costUsd?: number;
  /** Free-form per-backend metadata. */
  raw?: Record<string, unknown>;
}

/* ---------- world generation ---------- */

export interface WorldRequest {
  /** Free-text description of the scene to generate. */
  prompt: string;
  /** Optional single reference image URL. */
  referenceImageUrl?: string;
  /** Optional 360° equirectangular panorama URL. */
  panoramaUrl?: string;
  /** Optional reference video URL (used by World Labs Marble + HY-World 2.0). */
  videoUrl?: string;
  /** Optional explicit backend ("hyworld"|"worldlabs"|"mock"). */
  backend?: string;
  /** Optional render quality: draft is faster + cheaper. */
  detail?: ModelDetail;
  /** Optional seed. */
  seed?: number;
}

export interface WorldResult {
  backend: string;
  /** Streaming-friendly splat archive (SPZ) URL. */
  spzUrl?: string;
  /** Raw splat URL (PLY). */
  plyUrl?: string;
  /** Mesh export URL (GLB) — every modern world model ships one. */
  glbUrl?: string;
  /** Optional thumbnail / panorama preview. */
  thumbUrl?: string;
  /** Wall-clock ms. */
  durationMs: number;
  /** Optional cost in USD. */
  costUsd?: number;
  /** Free-form per-backend metadata (model name, version, splat count, etc.). */
  raw?: Record<string, unknown>;
}

/* ---------- backend interface ---------- */

export interface ModelBackend {
  readonly name: string;
  /** Cheap test ("does this backend have credentials configured right now?"). */
  readonly available: boolean;
  /** Generate a 3D model. Implementations must respect AbortSignal when given one. */
  generateModel(req: ModelRequest, signal?: AbortSignal): Promise<ModelResult>;
}

export interface WorldBackend {
  readonly name: string;
  readonly available: boolean;
  generateWorld(req: WorldRequest, signal?: AbortSignal): Promise<WorldResult>;
}

/* ---------- billing hook (optional) ---------- */

/**
 * Optional metering callback. The CLI registry passes one of these so each
 * tool invocation charges through MnemoPay/Stripe before doing real work.
 *
 * `charge` returns a release callback that the tool calls on failure to
 * refund the hold. On success the tool calls `settle` with the actual cost.
 */
export interface MeterHook {
  charge(args: { sku: string; estUsd: number; missionId?: string }): Promise<{
    settle(actualUsd: number): Promise<void>;
    release(): Promise<void>;
  }>;
}

/* ---------- audit hook (optional) ---------- */

export interface WorldGenAuditEvent {
  type: "world_gen.model" | "world_gen.world" | "world_gen.error";
  backend: string;
  prompt: string;
  durationMs: number;
  costUsd?: number;
  resultUrl?: string;
  error?: string;
}

export type AuditHook = (event: WorldGenAuditEvent) => void;
