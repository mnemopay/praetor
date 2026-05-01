import type { AuditHook, MeterHook, WorldRequest, WorldResult } from "../types.js";
import type { WorldGenSelector } from "../backends/selector.js";

export interface GenerateWorldArgs {
  prompt: string;
  referenceImageUrl?: string;
  panoramaUrl?: string;
  videoUrl?: string;
  detail?: "draft" | "standard" | "high";
  backend?: string;
  seed?: number;
}

export interface GenerateWorldDeps {
  selector: WorldGenSelector;
  meter?: MeterHook;
  audit?: AuditHook;
  missionId?: string;
}

const SKU_BY_DETAIL: Record<"draft" | "standard" | "high", { sku: string; estUsd: number }> = {
  draft: { sku: "world_gen.world.draft", estUsd: 0.30 },
  standard: { sku: "world_gen.world.standard", estUsd: 1.20 },
  high: { sku: "world_gen.world.high", estUsd: 3.00 },
};

export async function generate_3d_world(args: GenerateWorldArgs, deps: GenerateWorldDeps): Promise<WorldResult> {
  const detail = args.detail ?? "standard";
  const { sku, estUsd } = SKU_BY_DETAIL[detail];
  const backend = deps.selector.pickWorldBackend(args.backend);
  const req: WorldRequest = {
    prompt: args.prompt,
    referenceImageUrl: args.referenceImageUrl,
    panoramaUrl: args.panoramaUrl,
    videoUrl: args.videoUrl,
    detail,
    backend: args.backend,
    seed: args.seed,
  };

  const hold = deps.meter ? await deps.meter.charge({ sku, estUsd, missionId: deps.missionId }) : null;
  try {
    const result = await backend.generateWorld(req);
    if (hold) await hold.settle(result.costUsd ?? estUsd);
    deps.audit?.({
      type: "world_gen.world",
      backend: backend.name,
      prompt: args.prompt,
      durationMs: result.durationMs,
      costUsd: result.costUsd ?? estUsd,
      resultUrl: result.spzUrl ?? result.glbUrl,
    });
    return result;
  } catch (err) {
    if (hold) await hold.release();
    deps.audit?.({
      type: "world_gen.error",
      backend: backend.name,
      prompt: args.prompt,
      durationMs: 0,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
