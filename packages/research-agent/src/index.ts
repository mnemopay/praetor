/**
 * @praetor/research-agent — Praetor's research agent.
 *
 * Composes a `NativePraetorEngine` with web search, source fetch,
 * synthesis, and knowledge-base ingest tools. Cost-aware via
 * `RESEARCH_PREFER` (`quality` default | `cost`).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { NativePraetorEngine, type AgentRunInput, type AgentRunResult } from "@praetor/agents";
import type { LlmRouter, RouteRequirements } from "@praetor/router";
import { ToolRegistry, type ToolCallContext } from "@praetor/tools";
import { InMemoryKnowledgeBase, type KnowledgeBase } from "@praetor/knowledge";
import type { PolicyEngine } from "@praetor/core";

import { registerWebSearch } from "./tools/web_search.js";
import { registerFetchUrl } from "./tools/fetch_url.js";
import { registerSynthesize } from "./tools/synthesize.js";
import { registerIngestKb } from "./tools/ingest_kb.js";

export interface ResearchAgentOptions {
  router: LlmRouter;
  tools: ToolRegistry;
  toolContext: ToolCallContext;
  /** Defaults to a fresh `InMemoryKnowledgeBase`. Pass MnemoPay-backed KB in production. */
  kb?: KnowledgeBase;
  policy?: PolicyEngine;
  route?: RouteRequirements;
  systemPrompt?: string;
  maxSteps?: number;
  env?: NodeJS.ProcessEnv;
}

export function loadResearchSystemPrompt(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "prompts", "research-system.txt"),
    resolve(here, "..", "src", "prompts", "research-system.txt"),
  ];
  for (const p of candidates) {
    try { return readFileSync(p, "utf8"); } catch { /* try next */ }
  }
  return "You are Praetor's research agent. Cite primary sources. Output structured Markdown with [name](url) citations.";
}

/** Register the research tool subset on a registry. */
export function registerResearchTools(reg: ToolRegistry, opts: { router: LlmRouter; kb?: KnowledgeBase; env?: NodeJS.ProcessEnv }): { kb: KnowledgeBase } {
  const kb = opts.kb ?? new InMemoryKnowledgeBase();
  registerWebSearch(reg, { env: opts.env });
  registerFetchUrl(reg, {});
  registerSynthesize(reg, { router: opts.router, env: opts.env });
  registerIngestKb(reg, { kb });
  return { kb };
}

export class ResearchAgent {
  readonly name = "research-agent";
  readonly kb: KnowledgeBase;
  private engine: NativePraetorEngine;

  constructor(opts: ResearchAgentOptions) {
    const { kb } = registerResearchTools(opts.tools, { router: opts.router, kb: opts.kb, env: opts.env });
    this.kb = kb;
    const env = opts.env ?? process.env;
    const route: RouteRequirements = opts.route ?? (
      env.RESEARCH_PREFER === "cost"
        ? { quality: "balanced", maxUsdPer1K: 1, preferTags: ["long-context"] }
        : { quality: "high" }
    );
    this.engine = new NativePraetorEngine(
      opts.router,
      opts.tools,
      opts.toolContext,
      opts.policy,
      route,
      opts.systemPrompt ?? loadResearchSystemPrompt(),
      opts.maxSteps ?? 25,
    );
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    return this.engine.run({ ...input, role: input.role ?? "research" });
  }
}

export { registerWebSearch, type SearchHit, parseDuckHtml } from "./tools/web_search.js";
export { registerFetchUrl } from "./tools/fetch_url.js";
export { registerSynthesize, type SynthesizeHit } from "./tools/synthesize.js";
export { registerIngestKb } from "./tools/ingest_kb.js";
