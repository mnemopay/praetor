import { ToolRegistry } from "@praetor/tools";
import type { KnowledgeBase } from "@praetor/knowledge";
import { chunkText } from "@praetor/knowledge";

/**
 * ingest_kb — drop gathered text into a `@praetor/knowledge` knowledge
 * base so future missions can recall what this run learned.
 */

export interface IngestOptions {
  kb: KnowledgeBase;
}

export function registerIngestKb(reg: ToolRegistry, opts: IngestOptions): void {
  const tags = ["research", "knowledge"] as const;
  const allowedRoles = ["research"] as const;

  reg.register<{ source: string; title: string; text: string }, { chunks: number; source: string }>(
    {
      name: "ingest_kb",
      description: "Chunk a piece of gathered text and add it to the research knowledge base.",
      schema: {
        type: "object",
        properties: {
          source: { type: "string", description: "Stable id for the source — usually the URL." },
          title: { type: "string" },
          text: { type: "string" },
        },
        required: ["source", "title", "text"],
      },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "knowledge_ingest", risk: ["filesystem"], approval: "never", sandbox: "none", production: "needs-live-test", costEffective: true },
    },
    async ({ source, title, text }) => {
      const chunks = chunkText(text).map((t, i) => ({
        id: `${source}#${i}`,
        text: t,
        source,
        metadata: { title },
      }));
      const r = await opts.kb.ingest(chunks);
      return { chunks: r.ingested, source };
    },
  );
}
