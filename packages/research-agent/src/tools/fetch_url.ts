import { ToolRegistry } from "@praetor/tools";
import { FetchAdapter } from "@praetor/scrape";

/**
 * fetch_url — wrapper around @praetor/scrape's FetchAdapter so the
 * research agent can pull primary sources without standing up its own
 * HTTP client. Returns plain text + JSON-LD when present.
 */

export interface FetchToolOptions {
  /** Override the default UA string. */
  userAgent?: string;
  timeoutMs?: number;
}

export function registerFetchUrl(reg: ToolRegistry, opts: FetchToolOptions = {}): void {
  const adapter = new FetchAdapter();
  const tags = ["research", "free", "fetch"] as const;
  const allowedRoles = ["research"] as const;

  reg.register<{ url: string }, { url: string; status: number; contentType: string; text: string; jsonLd?: Record<string, unknown>[] }>(
    {
      name: "fetch_url",
      description: "Fetch a URL and return readable text plus any embedded JSON-LD blocks.",
      schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "url_fetch_evidence", risk: ["network"], approval: "never", sandbox: "remote-provider", production: "needs-live-test", costEffective: true, note: "Backed by Praetor scraper abstraction; native crawler is the production default target." },
    },
    async ({ url }) => {
      const result = await adapter.fetch({ url, userAgent: opts.userAgent, timeoutMs: opts.timeoutMs });
      return {
        url: result.url,
        status: result.status,
        contentType: result.contentType,
        text: result.text ?? result.body.slice(0, 100_000),
        jsonLd: result.jsonLd,
      };
    },
  );
}
