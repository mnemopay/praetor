/**
 * @praetor/coding-agent — Praetor's coding agent.
 *
 * Provides a curated tool subset (file ops, git, tests, command exec)
 * preregistered with the role gate `coding`, so the LLM only sees the
 * tools relevant to a coding mission.
 *
 * Usage:
 *
 *     import { CodingAgent } from "@praetor/coding-agent";
 *     const agent = new CodingAgent({
 *       repoRoot: "/abs/path/to/repo",
 *       router, tools, toolContext, policy,
 *     });
 *     await agent.run({ goal: "Add a /healthz route", outputs: [], budgetUsd: 1 });
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { NativePraetorEngine, type AgentRunInput, type AgentRunResult } from "@praetor/agents";
import type { LlmRouter, RouteRequirements } from "@praetor/router";
import { ToolRegistry, type ToolCallContext } from "@praetor/tools";
import type { PolicyEngine } from "@praetor/core";

import { registerFileTools } from "./tools/file_tools.js";
import { registerGitTools } from "./tools/git_tools.js";
import { registerTestTools } from "./tools/test_tools.js";

export interface CodingAgentOptions {
  repoRoot: string;
  router: LlmRouter;
  tools: ToolRegistry;
  toolContext: ToolCallContext;
  policy?: PolicyEngine;
  route?: RouteRequirements;
  systemPrompt?: string;
  maxSteps?: number;
}

/** Loads the bundled coding system prompt. */
export function loadCodingSystemPrompt(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src layout: <pkg>/src/index.ts -> <pkg>/src/prompts/coding-system.txt
  // dist layout: <pkg>/dist/index.js -> <pkg>/dist/prompts/coding-system.txt
  const candidates = [
    resolve(here, "prompts", "coding-system.txt"),
    resolve(here, "..", "src", "prompts", "coding-system.txt"),
  ];
  for (const p of candidates) {
    try { return readFileSync(p, "utf8"); } catch { /* try next */ }
  }
  // Fallback: keep the agent runnable even if the prompt file is missing.
  return "You are Praetor's coding agent. Read before you write. Run tests after every change.";
}

/** Registers the coding tool subset on the supplied registry. Idempotent-safe (registry will throw if already present). */
export function registerCodingTools(reg: ToolRegistry, repoRoot: string): void {
  registerFileTools(reg, { repoRoot });
  registerGitTools(reg, { repoRoot });
  registerTestTools(reg, { repoRoot });
}

export class CodingAgent {
  readonly name = "coding-agent";
  private engine: NativePraetorEngine;

  constructor(opts: CodingAgentOptions) {
    registerCodingTools(opts.tools, opts.repoRoot);
    const route: RouteRequirements = opts.route ?? { quality: "balanced", preferTags: ["coding"] };
    this.engine = new NativePraetorEngine(
      opts.router,
      opts.tools,
      opts.toolContext,
      opts.policy,
      route,
      opts.systemPrompt ?? loadCodingSystemPrompt(),
      opts.maxSteps ?? 25,
    );
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    return this.engine.run({ ...input, role: input.role ?? "coding" });
  }
}

export { registerFileTools } from "./tools/file_tools.js";
export { registerGitTools } from "./tools/git_tools.js";
export { registerTestTools } from "./tools/test_tools.js";
