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

import type { LlmRouter, RouteRequirements } from "@praetor/router";

/**
 * LlmAgent — issues a single chat completion via Praetor's router.
 * The router picks a provider based on charter route requirements; the agent
 * returns the model's text as the first output and reports real USD spend.
 */
export class LlmAgent implements AgentAdapter {
  readonly name = "llm";
  constructor(
    private router: LlmRouter,
    private route: RouteRequirements = { quality: "fast" },
    private systemPrompt = "You are Praetor, a mission runtime. Return concise, useful output for the goal.",
  ) {}
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const r = await this.router.chat(
      {
        messages: [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: input.goal },
        ],
        maxTokens: 256,
      },
      this.route,
    );
    if (r.costUsd > input.budgetUsd) {
      throw new Error(`LlmAgent: cost ${r.costUsd.toFixed(4)} exceeds budget ${input.budgetUsd}`);
    }
    return {
      outputs: [r.text, ...input.outputs],
      spentUsd: r.costUsd,
    };
  }
}
