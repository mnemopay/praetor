export interface AgentRunInput {
  goal: string;
  outputs: string[];
  budgetUsd: number;
}

export interface AgentRunResult {
  outputs: string[];
  spentUsd: number;
}

export interface AgentAdapter {
  readonly name: string;
  run: (input: AgentRunInput) => Promise<AgentRunResult>;
}

/**
 * EchoAgent — the smallest possible agent: returns the goal as the output.
 * Useful for runtime tests and as a control-group baseline.
 */
export class EchoAgent implements AgentAdapter {
  readonly name = "echo";
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    return { outputs: [input.goal, ...input.outputs], spentUsd: 0 };
  }
}

/**
 * OpenClawAgent and HermesAgent are placeholders that wire to the user's existing
 * NovaClaw stack in WSL. Implementations land in week 2 — see docs/ROADMAP.md.
 */
export class OpenClawAgent implements AgentAdapter {
  readonly name = "openclaw";
  async run(_input: AgentRunInput): Promise<AgentRunResult> {
    throw new Error("OpenClawAgent: not yet implemented — see docs/ROADMAP.md");
  }
}

export class HermesAgent implements AgentAdapter {
  readonly name = "hermes";
  async run(_input: AgentRunInput): Promise<AgentRunResult> {
    throw new Error("HermesAgent: not yet implemented — see docs/ROADMAP.md");
  }
}
