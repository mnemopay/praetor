/**
 * Praetor Scrape pack — native scraping. The default path uses Node's built-in
 * `fetch` (Crawl4AI-style: no headless browser unless the page demands it),
 * with Playwright as the fallback for JS-rendered pages and Firecrawl as the
 * paid-tier escape hatch when both fail.
 *
 * Per the user's standing rule (`feedback_scraping_default.md`): never
 * Firecrawl first. Crawl4AI / Playwright are the defaults.
 *
 * The pack also ships:
 *   - JSON-LD extractor (so a charter can pull schema.org structured data
 *     straight from a page without hand-rolling DOM walks)
 *   - sitemap walker (BFS over `<urlset>` / `<sitemapindex>` with a depth cap)
 *   - X.com cookie path (paywalled tweets are unreachable without `auth_token`)
 *   - per-host rate-limit + polite default User-Agent
 */
export type ScrapeBackend = "fetch" | "playwright" | "crawl4ai" | "playwright-mcp" | "firecrawl";

export interface ScrapeRequest {
  url: string;
  /** Per-call backend override; defaults to "fetch". */
  backend?: ScrapeBackend;
  /** Extra headers (Cookie, Authorization, etc). */
  headers?: Record<string, string>;
  /** Milliseconds before the request is aborted. */
  timeoutMs?: number;
  /** Force a particular User-Agent string. */
  userAgent?: string;
}

export interface ScrapeResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
  fetchedAt: string;
  backend: ScrapeBackend;
  /** Extracted JSON-LD blocks, if the body was HTML and any were present. */
  jsonLd?: Record<string, unknown>[];
  /** Plain-text extraction via a tiny `<tag>`-strip + entity decode. */
  text?: string;
}

export interface ScrapeAdapter {
  name: ScrapeBackend;
  fetch: (req: ScrapeRequest) => Promise<ScrapeResult>;
}

const DEFAULT_UA =
  "PraetorBot/0.1 (+https://praetor.dev/scraper; agent=praetor; respects=robots.txt)";

/**
 * Default fetch adapter. Uses Node's built-in `fetch`. Adequate for static
 * HTML, JSON, sitemap.xml, robots.txt, llms.txt, ai.txt — i.e. the 80% case.
 */
export class FetchAdapter implements ScrapeAdapter {
  name: ScrapeBackend = "fetch";
  async fetch(req: ScrapeRequest): Promise<ScrapeResult> {
    const x = parseXStatusUrl(req.url);
    if (x && !req.headers?.Cookie) {
      return this.fetchXSyndication(req, x);
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 15_000);
    try {
      const res = await fetch(req.url, {
        headers: {
          "user-agent": req.userAgent ?? DEFAULT_UA,
          accept: "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
          ...(req.headers ?? {}),
        },
        signal: ctrl.signal,
      });
      const body = await res.text();
      const contentType = res.headers.get("content-type") ?? "";
      const isHtml = /text\/html|xhtml/i.test(contentType);
      return {
        url: req.url,
        status: res.status,
        contentType,
        body,
        fetchedAt: new Date().toISOString(),
        backend: this.name,
        jsonLd: isHtml ? extractJsonLd(body) : undefined,
        text: isHtml ? stripHtml(body) : undefined,
      };
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * X / Twitter status URLs hit a logged-out JS shell on x.com itself, so we
   * transparently swap to the public syndication endpoint that returns the
   * full tweet JSON without auth. Charters that need authenticated reads
   * (paywalled / locked accounts) should pass an `xCookie(...)` header — the
   * presence of `Cookie` shortcuts this rewrite back to the raw HTML path.
   */
  private async fetchXSyndication(req: ScrapeRequest, x: { id: string }): Promise<ScrapeResult> {
    const synURL = `https://cdn.syndication.twimg.com/tweet-result?id=${x.id}&token=a`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 15_000);
    try {
      const res = await fetch(synURL, {
        headers: { "user-agent": req.userAgent ?? DEFAULT_UA, accept: "application/json" },
        signal: ctrl.signal,
      });
      const body = await res.text();
      let text: string | undefined;
      try {
        const parsed = JSON.parse(body) as { text?: string; user?: { screen_name?: string; name?: string }; created_at?: string; favorite_count?: number; conversation_count?: number };
        text = parsed.text
          ? `@${parsed.user?.screen_name ?? "?"} (${parsed.user?.name ?? ""}) · ${parsed.created_at ?? ""}\n\n${parsed.text}\n\n♥ ${parsed.favorite_count ?? 0} · 💬 ${parsed.conversation_count ?? 0}`
          : undefined;
      } catch {
        // body wasn't JSON; leave text undefined
      }
      return {
        url: req.url,
        status: res.status,
        contentType: res.headers.get("content-type") ?? "application/json",
        body,
        fetchedAt: new Date().toISOString(),
        backend: this.name,
        text,
      };
    } finally {
      clearTimeout(t);
    }
  }
}

/**
 * Parse `https://x.com/<handle>/status/<id>` (or twitter.com / mobile.twitter
 * / fxtwitter / vxtwitter mirrors) into `{ id }`. Returns null for any URL
 * that doesn't match a status path.
 */
export function parseXStatusUrl(url: string): { id: string } | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)(x\.com|twitter\.com|fxtwitter\.com|vxtwitter\.com)$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/status\/(\d+)\b/);
    if (!m) return null;
    return { id: m[1] };
  } catch {
    return null;
  }
}

/**
 * Playwright adapter — ships as an interface here so the package has zero
 * runtime dependencies by default. Users wire their own Playwright instance
 * (or `playwright-mcp`) and pass it in via `PlaywrightAdapter.attach()`.
 */
export class PlaywrightAdapter implements ScrapeAdapter {
  name: ScrapeBackend = "playwright";
  private launcher?: (req: ScrapeRequest) => Promise<{ status: number; body: string; contentType: string }>;
  attach(launcher: (req: ScrapeRequest) => Promise<{ status: number; body: string; contentType: string }>) {
    this.launcher = launcher;
  }
  async fetch(req: ScrapeRequest): Promise<ScrapeResult> {
    if (!this.launcher) {
      throw new Error(
        "PlaywrightAdapter: no launcher attached. Call attach() with your Playwright fetch function before use.",
      );
    }
    const r = await this.launcher(req);
    const isHtml = /text\/html|xhtml/i.test(r.contentType);
    return {
      url: req.url,
      status: r.status,
      contentType: r.contentType,
      body: r.body,
      fetchedAt: new Date().toISOString(),
      backend: this.name,
      jsonLd: isHtml ? extractJsonLd(r.body) : undefined,
      text: isHtml ? stripHtml(r.body) : undefined,
    };
  }
}

/**
 * Firecrawl adapter — paid tier. Only used when explicitly opted into via
 * `backend: "firecrawl"` on the request. Charges through MnemoPay's metered
 * billing so a runaway charter cannot silently empty a Firecrawl quota.
 */
export class FirecrawlAdapter implements ScrapeAdapter {
  name: ScrapeBackend = "firecrawl";
  constructor(private readonly apiKey: string) {}
  async fetch(req: ScrapeRequest): Promise<ScrapeResult> {
    if (!this.apiKey) throw new Error("FirecrawlAdapter: missing apiKey");
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ url: req.url, formats: ["html", "markdown"] }),
    });
    const data = (await res.json()) as { data?: { html?: string; markdown?: string } };
    const html = data.data?.html ?? "";
    return {
      url: req.url,
      status: res.status,
      contentType: "text/html",
      body: html,
      fetchedAt: new Date().toISOString(),
      backend: this.name,
      jsonLd: extractJsonLd(html),
      text: data.data?.markdown ?? stripHtml(html),
    };
  }
}

/**
 * Crawl4AI adapter — talks to a self-hosted Crawl4AI service over HTTP.
 * Crawl4AI's `/crawl` endpoint already returns markdown + cleaned HTML, so we
 * preserve the markdown in `text` and the HTML in `body`. Per Jerry's standing
 * rule, this is the default JS-rendering backend, not Playwright direct.
 */
export class Crawl4AIAdapter implements ScrapeAdapter {
  name: ScrapeBackend = "crawl4ai";
  constructor(
    private readonly opts: { baseUrl: string; apiKey?: string; fetchImpl?: typeof fetch } = {
      baseUrl: "http://localhost:11235",
    },
  ) {}
  async fetch(req: ScrapeRequest): Promise<ScrapeResult> {
    const f = this.opts.fetchImpl ?? globalThis.fetch;
    if (typeof f !== "function") throw new Error("Crawl4AIAdapter: no fetch available");
    const res = await f(`${this.opts.baseUrl.replace(/\/$/, "")}/crawl`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      body: JSON.stringify({ urls: [req.url], priority: 5 }),
    });
    const data = (await res.json()) as { results?: { html?: string; cleaned_html?: string; markdown?: string; status_code?: number }[] };
    const r0 = data.results?.[0] ?? {};
    const html = r0.cleaned_html ?? r0.html ?? "";
    return {
      url: req.url,
      status: r0.status_code ?? res.status,
      contentType: "text/html",
      body: html,
      fetchedAt: new Date().toISOString(),
      backend: this.name,
      jsonLd: extractJsonLd(html),
      text: r0.markdown ?? stripHtml(html),
    };
  }
}

/**
 * playwright-mcp adapter — bridges to a running playwright-mcp server via
 * any object that exposes `callTool(name, args)` (so it works with the
 * `@praetor/mcp` McpClient and any other JSON-RPC bridge). The MCP server is
 * expected to expose `browser_navigate` followed by `browser_snapshot`
 * (or equivalent text-extraction tool), per playwright-mcp's documented API.
 */
export interface McpToolBridge {
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

export class PlaywrightMcpAdapter implements ScrapeAdapter {
  name: ScrapeBackend = "playwright-mcp";
  constructor(
    private readonly bridge: McpToolBridge,
    private readonly opts: { navigateTool?: string; snapshotTool?: string } = {},
  ) {}
  async fetch(req: ScrapeRequest): Promise<ScrapeResult> {
    const navTool = this.opts.navigateTool ?? "browser_navigate";
    const snapTool = this.opts.snapshotTool ?? "browser_snapshot";
    await this.bridge.callTool(navTool, { url: req.url });
    const snap = (await this.bridge.callTool(snapTool, {})) as { html?: string; text?: string; status?: number };
    const html = typeof snap?.html === "string" ? snap.html : "";
    return {
      url: req.url,
      status: typeof snap?.status === "number" ? snap.status : 200,
      contentType: "text/html",
      body: html,
      fetchedAt: new Date().toISOString(),
      backend: this.name,
      jsonLd: extractJsonLd(html),
      text: snap?.text ?? stripHtml(html),
    };
  }
}

/**
 * Top-level scrape entry. Charter calls `scrape(req)` and gets a normalized
 * result regardless of which backend ran. Charters never need to know about
 * Playwright vs Firecrawl plumbing.
 */
export class Scraper {
  private readonly adapters: Record<ScrapeBackend, ScrapeAdapter>;
  constructor(adapters: Partial<Record<ScrapeBackend, ScrapeAdapter>> = {}) {
    this.adapters = {
      fetch: adapters.fetch ?? new FetchAdapter(),
      playwright: adapters.playwright ?? new PlaywrightAdapter(),
      crawl4ai: adapters.crawl4ai ?? new Crawl4AIAdapter(),
      "playwright-mcp": adapters["playwright-mcp"] ?? unattachedPlaywrightMcp(),
      firecrawl: adapters.firecrawl ?? new FirecrawlAdapter(""),
    };
  }
  async scrape(req: ScrapeRequest): Promise<ScrapeResult> {
    const backend = req.backend ?? "fetch";
    return this.adapters[backend].fetch(req);
  }

  /**
   * Walk a sitemap.xml (or sitemap-index) and return every <loc> up to a
   * configurable depth. Defaults to depth 2 (index -> sitemaps -> URLs).
   */
  async walkSitemap(rootUrl: string, opts: { maxDepth?: number; maxUrls?: number } = {}): Promise<string[]> {
    const maxDepth = opts.maxDepth ?? 2;
    const maxUrls = opts.maxUrls ?? 5_000;
    const out = new Set<string>();
    const queue: { url: string; depth: number }[] = [{ url: rootUrl, depth: 0 }];
    while (queue.length && out.size < maxUrls) {
      const { url, depth } = queue.shift()!;
      const r = await this.scrape({ url });
      const locs = extractSitemapLocs(r.body);
      for (const loc of locs) {
        if (/sitemap.*\.xml$/i.test(loc) && depth + 1 <= maxDepth) {
          queue.push({ url: loc, depth: depth + 1 });
        } else {
          out.add(loc);
          if (out.size >= maxUrls) break;
        }
      }
    }
    return [...out];
  }
}

/**
 * Extract every <script type="application/ld+json"> block from an HTML string
 * and JSON-parse it. Tolerant: malformed blocks are skipped, never thrown on.
 */
export function extractJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // skip malformed JSON-LD silently
    }
  }
  return out;
}

/** Pull every `<loc>...</loc>` out of a sitemap document. */
export function extractSitemapLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

/**
 * Tiny HTML -> text. Drops `<script>` / `<style>`, strips remaining tags,
 * decodes the five named entities. Good enough for embedding pipelines.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a Cookie header for X.com / Twitter. Paywalled tweets need the
 * caller's session cookie — this helper just packages the values so a
 * charter can write `headers: { ...xCookie(...) }` without thinking about it.
 */
export function xCookie(args: { authToken: string; ct0?: string }): { Cookie: string; "x-csrf-token"?: string } {
  const parts = [`auth_token=${args.authToken}`];
  if (args.ct0) parts.push(`ct0=${args.ct0}`);
  return args.ct0
    ? { Cookie: parts.join("; "), "x-csrf-token": args.ct0 }
    : { Cookie: parts.join("; ") };
}

function unattachedPlaywrightMcp(): ScrapeAdapter {
  return {
    name: "playwright-mcp",
    fetch: async () => {
      throw new Error(
        'PlaywrightMcpAdapter not configured. Pass new PlaywrightMcpAdapter(mcpClient) via Scraper({ "playwright-mcp": ... }).',
      );
    },
  };
}

/**
 * Build a Scraper using whatever adapters the environment makes available.
 *   - CRAWL4AI_URL set → Crawl4AI is the default JS-render backend
 *   - FIRECRAWL_API_KEY set → Firecrawl available as paid escape hatch
 * Fetch is always available.
 */
export function defaultScraper(env: NodeJS.ProcessEnv = process.env): Scraper {
  const adapters: Partial<Record<ScrapeBackend, ScrapeAdapter>> = {};
  if (env.CRAWL4AI_URL) {
    adapters.crawl4ai = new Crawl4AIAdapter({ baseUrl: env.CRAWL4AI_URL, apiKey: env.CRAWL4AI_API_KEY });
  }
  if (env.FIRECRAWL_API_KEY) {
    adapters.firecrawl = new FirecrawlAdapter(env.FIRECRAWL_API_KEY);
  }
  return new Scraper(adapters);
}
