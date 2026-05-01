import type { AuditHook, MeterHook, ModelRequest, ModelResult, WorldGenActivityBus } from "../types.js";
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
  /** Optional live activity bus — when present, the tool publishes
   *  tool.start / tool.end events. */
  bus?: WorldGenActivityBus;
}

const SKU_BY_DETAIL: Record<"draft" | "standard" | "high", { sku: string; estUsd: number }> = {
  draft: { sku: "world_gen.model.draft", estUsd: 0.05 },
  standard: { sku: "world_gen.model.standard", estUsd: 0.15 },
  high: { sku: "world_gen.model.high", estUsd: 0.40 },
};

/** Run the tool. Throws on failure; emits audit + meter + activity events around the call. */
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

  const eventId = newEventId();
  const missionId = deps.missionId ?? "";
  if (deps.bus && missionId) {
    deps.bus.publish({
      kind: "tool.start",
      missionId,
      eventId,
      toolName: "generate_3d_model",
      args: { prompt: args.prompt, detail, backend: backend.name },
      ts: new Date().toISOString(),
    });
  }

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
    if (deps.bus && missionId) {
      deps.bus.publish({
        kind: "tool.end",
        missionId,
        eventId,
        ok: true,
        result: { glbUrl: result.glbUrl, thumbUrl: result.thumbUrl, backend: result.backend },
        costUsd: result.costUsd ?? estUsd,
        ts: new Date().toISOString(),
      });
    }
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
    if (deps.bus && missionId) {
      deps.bus.publish({
        kind: "tool.end",
        missionId,
        eventId,
        ok: false,
        result: { error: err instanceof Error ? err.message : String(err) },
        ts: new Date().toISOString(),
      });
    }
    throw err;
  }
}

function newEventId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
