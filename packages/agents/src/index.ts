export interface AgentRunInput {
  goal: string;
  outputs: string[];
  budgetUsd: number;
  steps?: { action: string; args?: Record<string, unknown> }[];
  signal?: AbortSignal;
  agents?: import("@praetor/core").CharterAgent[];
  role?: string;
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

import type { PolicyEngine } from "@praetor/core";

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
    private policy?: PolicyEngine,
    private route: RouteRequirements = { quality: "fast" },
    private systemPrompt = "You are Praetor, a mission runtime. Use tools to achieve the goal.",
    private maxSteps = 15
  ) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    let spentUsd = 0;
    
    // Deterministic Execution Mode (Executable Charters)
    if (input.steps && input.steps.length > 0) {
      const outputs = [];
      for (const step of input.steps) {
        if (input.signal?.aborted) throw new Error("Mission aborted via kill switch");
        
        if (this.policy) {
          const evalRes = this.policy.evaluate(step.action, step.args || {});
          if (!evalRes.allowed) throw new Error(`Policy Denied: ${evalRes.reason}`);
        }
        
        const res = await this.tools.call(step.action, step.args || {}, { ...this.toolContext, role: input.role });
        outputs.push(`Executed ${step.action}: ${JSON.stringify(res)}`);
      }
      return { outputs: [...outputs, ...input.outputs], spentUsd };
    }

    const messages: ChatMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: input.goal },
    ];

    const availableTools = this.tools.list(input.role).map(t => ({
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

      // Split Think from Do: Validate the entire plan against PolicyEngine before any execution
      if (this.policy) {
        for (const call of r.toolCalls) {
          try {
            const args = JSON.parse(call.function.arguments);
            const evalRes = this.policy.evaluate(call.function.name, args);
            if (!evalRes.allowed) {
              throw new Error(`Policy Check Failed: ${evalRes.reason} on tool ${call.function.name}`);
            }
          } catch (err: any) {
            messages.push({ role: "tool", tool_call_id: call.id, content: `Error during plan validation: ${err.message}` });
            throw new Error(`Agent emitted a plan that violates policy: ${err.message}`);
          }
        }
      }

      // Execution phase
      for (const call of r.toolCalls) {
        if (input.signal?.aborted) throw new Error("Mission aborted via kill switch");
        try {
          const args = JSON.parse(call.function.arguments);
          const result = await this.tools.call(call.function.name, args, { ...this.toolContext, role: input.role });
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

/**
 * CoordinatorAgent — manages multiple sub-agents based on the charter.
 */
export class CoordinatorAgent implements AgentAdapter {
  readonly name = "coordinator";
  constructor(
    private router: LlmRouter,
    private tools: ToolRegistry,
    private toolContext: ToolCallContext,
    private policy?: PolicyEngine,
    private route: RouteRequirements = { quality: "fast" }
  ) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    if (!input.agents || input.agents.length === 0) {
      // Fallback to native praetor if no agents specified
      const engine = new NativePraetorEngine(this.router, this.tools, this.toolContext, this.policy, this.route);
      return engine.run(input);
    }

    let spentUsd = 0;
    const outputs = [...input.outputs];
    let currentGoal = input.goal;

    // Sequential coordination for now: each agent takes the goal and outputs of the previous
    for (const agentDef of input.agents) {
      if (input.signal?.aborted) throw new Error("Mission aborted");
      
      const systemPrompt = `You are a ${agentDef.role} agent. Your skills are: ${agentDef.skills?.join(", ")}. Accomplish your part of the goal.`;
      
      const subEngine = new NativePraetorEngine(
        this.router, 
        this.tools, 
        this.toolContext, 
        this.policy, 
        this.route, 
        systemPrompt
      );

      const subInput: AgentRunInput = {
        ...input,
        goal: currentGoal,
        outputs,
        budgetUsd: input.budgetUsd - spentUsd,
        role: agentDef.role,
        // Steps are only passed to the first agent or if explicitly mapped in the future
        steps: undefined 
      };

      const result = await subEngine.run(subInput);
      spentUsd += result.spentUsd;
      
      // The last output from the sub-agent becomes context for the next
      outputs.push(`[${agentDef.role} completed]: ${result.outputs[0]}`);
      currentGoal = `Previous agent output: ${result.outputs[0]}\n\nOriginal Goal: ${input.goal}`;
    }

    return { outputs, spentUsd };
  }
}
