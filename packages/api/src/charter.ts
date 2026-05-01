import type { Charter, CharterRole } from "@praetor/core";

export type AgentChoice = "native" | "coding" | "research" | "world-gen";

export interface MissionInput {
  goal: string;
  budgetUsd?: number;
  outputs?: string[];
  plugins?: string[];
  /** Which agent personality runs the mission. Defaults to "native". */
  agent?: AgentChoice;
}

const ROLE_BY_AGENT: Record<AgentChoice, CharterRole> = {
  native: "developer",
  coding: "coding",
  research: "research",
  "world-gen": "world-gen",
};

export function buildCharter(input: MissionInput): Charter {
  const agent: AgentChoice = input.agent ?? "native";
  const role: CharterRole = ROLE_BY_AGENT[agent] ?? "developer";
  return {
    name: `SaaS Mission ${Date.now()}`,
    goal: input.goal,
    budget: {
      maxUsd: input.budgetUsd ?? 5,
      approvalThresholdUsd: 0,
    },
    agents: [{ role }],
    outputs: input.outputs && input.outputs.length > 0 ? input.outputs : ["result"],
    plugins: input.plugins ?? [],
  };
}
