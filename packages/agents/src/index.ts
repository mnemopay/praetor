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

import type { LlmRouter, RouteRequirements, ChatMessage } from "@praetor/router";
import type { ToolRegistry, ToolCallContext } from "@praetor/tools";

/**
 * NativePraetorEngine — the core agentic loop of Praetor.
 * Replaces OpenClaw/Hermes stubs.
 */
export class NativePraetorEngine implements AgentAdapter {
  readonly name = "native-praetor";
  constructor(
    private router: LlmRouter,
    private tools: ToolRegistry,
    private toolContext: ToolCallContext,
    private route: RouteRequirements = { quality: "fast" },
    private systemPrompt = "You are Praetor, a mission runtime. Use tools to achieve the goal.",
    private maxSteps = 15
  ) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    let spentUsd = 0;
    const messages: ChatMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: input.goal },
    ];

    const availableTools = this.tools.list().map(t => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.schema as unknown as Record<string, unknown>,
      }
    }));

    for (let step = 0; step < this.maxSteps; step++) {
      if (spentUsd > input.budgetUsd) {
        throw new Error(`NativePraetorEngine: cost ${spentUsd.toFixed(4)} exceeds budget ${input.budgetUsd}`);
      }

      const r = await this.router.chat(
        { messages, maxTokens: 1024, tools: availableTools.length > 0 ? availableTools : undefined },
        this.route
      );
      spentUsd += r.costUsd;

      messages.push({
        role: "assistant",
        content: r.text,
        tool_calls: r.toolCalls
      });

      if (!r.toolCalls || r.toolCalls.length === 0) {
        return { outputs: [r.text, ...input.outputs], spentUsd };
      }

      for (const call of r.toolCalls) {
        try {
          const args = JSON.parse(call.function.arguments);
          const result = await this.tools.call(call.function.name, args, this.toolContext);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: typeof result === "string" ? result : JSON.stringify(result)
          });
        } catch (e) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `Error: ${(e as Error).message}`
          });
        }
      }
    }
    throw new Error(`NativePraetorEngine: max steps (${this.maxSteps}) reached.`);
  }
}

/**
 * LlmAgent — issues a single chat completion via Praetor's router.
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
