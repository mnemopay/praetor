import type { Charter } from "./charter.js";

export interface MissionResult {
  charterName: string;
  status: "ok" | "halted" | "error";
  spentUsd: number;
  outputs: string[];
  auditDigest: string;
  startedAt: string;
  finishedAt: string;
}

export interface MissionContext {
  charter: Charter;
  payments: { reserve: (usd: number) => Promise<{ holdId: string }>; settle: (holdId: string, usd: number) => Promise<void> };
  agents: { run: (charter: Charter) => Promise<{ outputs: string[]; spentUsd: number }> };
  audit: { record: (event: string, data: Record<string, unknown>) => void; finalize: () => string };
}

export async function runMission(ctx: MissionContext): Promise<MissionResult> {
  const startedAt = new Date().toISOString();
  ctx.audit.record("mission.start", { charter: ctx.charter.name, budget: ctx.charter.budget });
  const hold = await ctx.payments.reserve(ctx.charter.budget.maxUsd);
  ctx.audit.record("budget.reserved", { holdId: hold.holdId, maxUsd: ctx.charter.budget.maxUsd });
  let result;
  try {
    result = await ctx.agents.run(ctx.charter);
  } catch (e) {
    ctx.audit.record("mission.error", { error: (e as Error).message });
    return {
      charterName: ctx.charter.name,
      status: "error",
      spentUsd: 0,
      outputs: [],
      auditDigest: ctx.audit.finalize(),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
  await ctx.payments.settle(hold.holdId, result.spentUsd);
  ctx.audit.record("mission.complete", { outputs: result.outputs.length, spentUsd: result.spentUsd });
  return {
    charterName: ctx.charter.name,
    status: "ok",
    spentUsd: result.spentUsd,
    outputs: result.outputs,
    auditDigest: ctx.audit.finalize(),
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
