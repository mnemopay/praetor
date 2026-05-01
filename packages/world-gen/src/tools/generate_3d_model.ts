import type { AuditHook, MeterHook, ModelRequest, ModelResult } from "../types.js";
import type { WorldGenSelector } from "../backends/selector.js";

export interface GenerateModelArgs {
  prompt: string;
  referenceImageUrl?: string;
  detail?: "draft" | "standard" | "high";
  backend?: string;
  seed?: number;
}

export interface GenerateModelDeps {
  selector: WorldGenSelector;
  meter?: MeterHook;
  audit?: AuditHook;
  missionId?: string;
}

const SKU_BY_DETAIL: Record<"draft" | "standard" | "high", { sku: string; estUsd: number }> = {
  draft: { sku: "world_gen.model.draft", estUsd: 0.05 },
  standard: { sku: "world_gen.model.standard", estUsd: 0.15 },
  high: { sku: "world_gen.model.high", estUsd: 0.40 },
};

/** Run the tool. Throws on failure; emits audit + meter events around the call. */
export async function generate_3d_model(args: GenerateModelArgs, deps: GenerateModelDeps): Promise<ModelResult> {
  const detail = args.detail ?? "standard";
  const { sku, estUsd } = SKU_BY_DETAIL[detail];
  const backend = deps.selector.pickModelBackend(args.backend);
  const req: ModelRequest = {
    prompt: args.prompt,
    referenceImageUrl: args.referenceImageUrl,
    detail,
    backend: args.backend,
    seed: args.seed,
  };

  const hold = deps.meter ? await deps.meter.charge({ sku, estUsd, missionId: deps.missionId }) : null;
  try {
    const result = await backend.generateModel(req);
    if (hold) await hold.settle(result.costUsd ?? estUsd);
    deps.audit?.({
      type: "world_gen.model",
      backend: backend.name,
      prompt: args.prompt,
      durationMs: result.durationMs,
      costUsd: result.costUsd ?? estUsd,
      resultUrl: result.glbUrl,
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
