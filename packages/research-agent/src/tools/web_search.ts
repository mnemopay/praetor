import { ToolRegistry } from "@praetor/tools";

/**
 * Web search tool — normalized hits across Brave Search (paid) and the
 * free DuckDuckGo HTML endpoint. Brave is preferred when a key is set;
 * DuckDuckGo is the default free path. If `WORLD_GEN_REQUIRE_LIVE` is
 * set and neither path returns hits, the tool throws so the caller knows
 * to surface a real error instead of silent zero-results.
 *
 * Hits are uniform regardless of backend:
 *   { title, url, snippet }
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOptions {
  env?: NodeJS.ProcessEnv;
  /** Override fetch — used in tests to intercept network calls. */
  fetchImpl?: typeof fetch;
}

export function registerWebSearch(reg: ToolRegistry, opts: WebSearchOptions = {}): void {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tags = ["research", "free"] as const;
  const allowedRoles = ["research"] as const;

  reg.register<{ query: string; limit?: number }, { backend: string; hits: SearchHit[] }>(
    {
      name: "search_web",
      description: "Search the web. Returns title/url/snippet hits. Uses Brave when BRAVE_API_KEY is set, otherwise DuckDuckGo HTML.",
      schema: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "integer" } },
        required: ["query"],
      },
      tags, allowedRoles,
      metadata: { origin: "adapter", capability: "web_search", risk: ["network"], approval: "never", sandbox: "remote-provider", production: "needs-live-test", costEffective: true, note: "Cost mode prefers DuckDuckGo; Brave is optional quality adapter." },
    },
    async ({ query, limit }) => {
      const requireLive = env.WORLD_GEN_REQUIRE_LIVE === "true";
      const cap = typeof limit === "number" ? limit : 10;
      const prefer: "quality" | "cost" = env.RESEARCH_PREFER === "cost" ? "cost" : "quality";

      // In quality mode, try Brave first; in cost mode, free first.
      const tryBrave = async (): Promise<{ backend: string; hits: SearchHit[] } | null> => {
        if (!env.BRAVE_API_KEY) return null;
        const hits = await braveSearch(query, env.BRAVE_API_KEY, cap, fetchImpl);
        return { backend: "brave", hits };
      };
      const tryDuck = async (): Promise<{ backend: string; hits: SearchHit[] } | null> => {
        const hits = await duckSearch(query, cap, fetchImpl);
        return { backend: "duckduckgo", hits };
      };

      const order = prefer === "cost" ? [tryDuck, tryBrave] : [tryBrave, tryDuck];
      for (const step of order) {
        const out = await step().catch(() => null);
        if (out && out.hits.length > 0) return out;
      }
      if (requireLive) throw new Error("search_web: no live backend returned hits");
      return { backend: "none", hits: [] };
    },
  );
}

async function braveSearch(query: string, apiKey: string, limit: number, fetchImpl: typeof fetch): Promise<SearchHit[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const res = await fetchImpl(url, {
    headers: {
      "X-Subscription-Token": apiKey,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`brave: ${res.status}`);
  const j = await res.json() as { web?: { results?: { title: string; url: string; description: string }[] } };
  const items = j.web?.results ?? [];
  return items.slice(0, limit).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
}

async function duckSearch(query: string, limit: number, fetchImpl: typeof fetch): Promise<SearchHit[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchImpl(url, {
    headers: {
      "User-Agent": "PraetorBot/0.1 (research-agent)",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`duckduckgo: ${res.status}`);
  const html = await res.text();
  return parseDuckHtml(html, limit);
}

/** Tiny HTML extractor for DuckDuckGo's HTML interface. Robust to layout drift. */
export function parseDuckHtml(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const titles: { url: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && titles.length < limit) {
    titles.push({ url: cleanDuckUrl(m[1]), title: stripTags(m[2]) });
  }
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) && snippets.length < limit) {
    snippets.push(stripTags(m[1]));
  }
  for (let i = 0; i < titles.length; i++) {
    hits.push({ title: titles[i].title, url: titles[i].url, snippet: snippets[i] ?? "" });
  }
  return hits;
}

function cleanDuckUrl(href: string): string {
  // DuckDuckGo wraps results in /l/?uddg=ENCODED. Decode when we see it.
  try {
    if (href.startsWith("//duckduckgo.com/l/?")) href = "https:" + href;
    const u = new URL(href);
    const ud = u.searchParams.get("uddg");
    if (ud) return decodeURIComponent(ud);
    return href;
  } catch {
    return href;
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
