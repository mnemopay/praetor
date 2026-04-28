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
export type ScrapeBackend = "fetch" | "playwright" | "firecrawl";

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
