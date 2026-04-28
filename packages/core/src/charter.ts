export interface CharterBudget {
  maxUsd: number;
  approvalThresholdUsd: number;
}

export interface CharterAgent {
  role: "architect" | "developer" | "auditor" | "designer" | "marketer";
  model?: string;
  skills?: string[];
}

export interface Charter {
  name: string;
  goal: string;
  budget: CharterBudget;
  agents: CharterAgent[];
  outputs: string[];
  compliance?: {
    article12?: boolean;
    auditLogPath?: string;
  };
}

export function validateCharter(c: unknown): Charter {
  if (!c || typeof c !== "object") {
    throw new Error("charter: not an object");
  }
  const ch = c as Partial<Charter>;
  if (!ch.name || typeof ch.name !== "string") throw new Error("charter.name required");
  if (!ch.goal || typeof ch.goal !== "string") throw new Error("charter.goal required");
  if (!ch.budget || typeof ch.budget.maxUsd !== "number") {
    throw new Error("charter.budget.maxUsd required");
  }
  if (!Array.isArray(ch.agents) || ch.agents.length === 0) {
    throw new Error("charter.agents must be a non-empty array");
  }
  if (!Array.isArray(ch.outputs)) throw new Error("charter.outputs must be an array");
  return ch as Charter;
}
