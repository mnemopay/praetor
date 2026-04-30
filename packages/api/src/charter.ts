import type { Charter } from "@praetor/core";

export interface MissionInput {
  goal: string;
  budgetUsd?: number;
  outputs?: string[];
  plugins?: string[];
}

export function buildCharter(input: MissionInput): Charter {
  return {
    name: `SaaS Mission ${Date.now()}`,
    goal: input.goal,
    budget: {
      maxUsd: input.budgetUsd ?? 5,
      approvalThresholdUsd: 0,
    },
    agents: [{ role: "developer" }],
    outputs: input.outputs && input.outputs.length > 0 ? input.outputs : ["result"],
    plugins: input.plugins ?? [],
  };
}
