import { ToolRegistry } from "@praetor/tools";
import type { LlmRouter, RouteRequirements } from "@praetor/router";

/**
 * synthesize — collapse a list of source hits + optional excerpts into a
 * structured Markdown report with inline citations.
 *
 * Cost-aware:
 *   RESEARCH_PREFER=quality (default) -> high-quality model (e.g. Sonnet)
 *   RESEARCH_PREFER=cost              -> cheapest balanced model
 */

export interface SynthesizeHit {
  title: string;
  url: string;
  snippet?: string;
  excerpt?: string;
}

export interface SynthesizeOptions {
  router: LlmRouter;
  env?: NodeJS.ProcessEnv;
}

export function registerSynthesize(reg: ToolRegistry, opts: SynthesizeOptions): void {
  const env = opts.env ?? process.env;
  const tags = ["research", "synthesize"] as const;
  const allowedRoles = ["research"] as const;

  reg.register<{ goal: string; hits: SynthesizeHit[] }, { report: string; model: string; costUsd: number }>(
    {
      name: "synthesize",
      description: "Merge source hits into a Markdown report with [title](url) citations.",
      schema: {
        type: "object",
        properties: {
          goal: { type: "string" },
          hits: { type: "array" },
        },
        required: ["goal", "hits"],
      },
      tags, allowedRoles,
      costUsd: 0.002,
      metadata: { origin: "adapter", capability: "research_synthesis", risk: ["spend"], approval: "on-cost", sandbox: "remote-provider", production: "needs-live-test", costEffective: true, note: "Uses Praetor router so low-cost/open-weight providers can be preferred by policy." },
    },
    async ({ goal, hits }) => {
      const route: RouteRequirements = env.RESEARCH_PREFER === "cost"
        ? { quality: "balanced", maxUsdPer1K: 1 }
        : { quality: "high" };
      const sourcesBlock = hits.map((h, i) => {
        const excerpt = h.excerpt ? `\n   excerpt: ${truncate(h.excerpt, 1200)}` : "";
        return `[${i + 1}] ${h.title}\n   url: ${h.url}\n   snippet: ${h.snippet ?? ""}${excerpt}`;
      }).join("\n\n");

      const messages = [
        {
          role: "system" as const,
          content: "You are a research analyst. Output Markdown only. Cite sources inline as [Source title](url). Never invent URLs — only cite from the provided sources.",
        },
        {
          role: "user" as const,
          content: `Research goal:\n${goal}\n\nSources:\n${sourcesBlock}\n\nProduce a structured Markdown report.`,
        },
      ];

      const r = await opts.router.chat({ messages, maxTokens: 1500 }, route);
      return { report: r.text, model: r.model, costUsd: r.costUsd };
    },
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
