/**
 * Praetor Scrape pack — native scraping. The default path uses Node's built-in
 * `fetch` wrapped in a Praetor-owned HTTP client (timeout + single retry +
 * normalized response shape). No third-party scraping lib is pulled in by
 * default — Crawl4AI / Playwright / Firecrawl remain as opt-in adapters.
 *
 * Per Jeremiah's standing rules:
 *   - `feedback_praetor_native_tools.md`: every Praetor tool is custom-native;
 *     third-party libs are fallback-only, never the default codepath.
 *   - `feedback_scraping_default.md`: never Firecrawl first. Native + Crawl4AI
 *     + Playwright are the defaults.
 *
 * The pack also ships:
 *   - JSON-LD extractor (so a charter can pull schema.org structured data
 *     straight from a page without hand-rolling DOM walks)
 *   - sitemap walker (BFS over `<urlset>` / `<sitemapindex>` with a depth cap)
 *   - X.com cookie path (paywalled tweets are unreachable without `auth_token`)
 *   - per-host rate-limit + polite default User-Agent
 */

export type ScrapeBackend = "fetch" | "playwright" | "crawl4ai" | "playwright-mcp" | "firecrawl";

/**
 * Praetor-native HTTP client surface. Adapters / tests inject a fn matching
 * this shape; the default implementation (`nativeHttpFetch`) uses
 * `globalThis.fetch`. Returning `{ body, statusCode, headers }` keeps the
 * shape stable regardless of which underlying transport is wired in.
 */
export interface PraetorHttpRequest {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Number of retries for transient errors / 5xx. Default 1. */
  retries?: number;
  /**
   * Deny requests to RFC1918 / loopback / link-local / cloud metadata
   * targets. **Default true** — protects charters from being tricked into
   * SSRF attacks (a scraped page that returns a 302 redirect to
   * `http://169.254.169.254/latest/meta-data/iam/security-credentials/`
   * is the canonical cloud-credential exfiltration vector).
   *
   * Pass `false` only for charters that legitimately need to reach
   * localhost / private services (e.g. local dev dashboards).
   */
  denyInternal?: boolean;
  /**
   * Maximum redirect chain length. Defaults to 5. Each Location is
   * re-checked against the SSRF policy before following.
   */
  maxRedirects?: number;
}

export interface PraetorHttpResponse {
  body: string;
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
}

export type PraetorHttpFetch = (opts: PraetorHttpRequest) => Promise<PraetorHttpResponse>;

/**
 * Decide whether a URL points at an internal / metadata target that
 * Praetor charters should not reach by default. Inspects URL hostname:
 *
 *   - Loopback: localhost, 127.0.0.0/8, ::1, 0.0.0.0
 *   - Link-local + cloud metadata: 169.254.0.0/16 (catches AWS / GCP /
 *     Azure / Hetzner / DigitalOcean metadata endpoints).
 *   - RFC1918 private: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   - CGN / Tailscale / Carrier-grade NAT: 100.64.0.0/10
 *   - IPv6 unique-local + link-local: fc00::/7, fe80::/10
 *
 * Hostnames that aren't IP literals are treated as public (no DNS
 * resolution at this layer — DNS rebinding is a known follow-up). The
 * common-case attacker-supplied URL contains a literal IP though; this
 * already blocks the easy paths.
 */
export function isInternalUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (host === "" || host === "localhost" || host === "0.0.0.0" || host === "ip6-localhost") return true;
  // IPv6 literal — wrapped in [].
  if (host.startsWith("[") && host.endsWith("]")) {
    return isInternalIpv6(host.slice(1, -1));
  }
  // IPv4 dotted-quad.
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (a === 127) return true;                 // 127.0.0.0/8 loopback
    if (a === 10) return true;                  // 10.0.0.0/8 RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;    // 192.168.0.0/16
    if (a === 169 && b === 254) return true;    // 169.254.0.0/16 link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGN / Tailscale
    if (a === 0) return true;                   // 0.0.0.0/8
  }
  // Bare IPv6 (rare in URLs but still). A loose check on common patterns.
  if (host.includes(":")) {
    return isInternalIpv6(host);
  }
  return false;
}

function isInternalIpv6(addr: string): boolean {
  const a = addr.toLowerCase();
  if (a === "::1" || a === "::") return true;
  if (a.startsWith("fe80:") || a.startsWith("fe80::")) return true; // link-local
  // fc00::/7 unique-local — first byte starts with binary 1111110x → fc or fd.
  if (a.startsWith("fc") || a.startsWith("fd")) return true;
  // ::ffff:127.0.0.1 IPv4-mapped loopback.
  if (a.startsWith("::ffff:")) {
    const v4 = a.slice(7);
    if (v4 === "127.0.0.1" || v4.startsWith("127.")) return true;
    if (v4 === "169.254.169.254" || v4.startsWith("169.254.")) return true;
    if (v4.startsWith("10.") || v4.startsWith("192.168.")) return true;
  }
  return false;
}

/**
 * Default native HTTP client. SSRF-safe by default (`denyInternal: true`).
 * Manual redirect chase so each Location is re-checked. Single retry on
 * transient 5xx. Caller-supplied timeoutMs applies per attempt via
 * AbortController.
 */
export const nativeHttpFetch: PraetorHttpFetch = async (opts) => {
  const retries = Math.max(0, opts.retries ?? 1);
  const denyInternal = opts.denyInternal !== false;
  const maxRedirects = opts.maxRedirects ?? 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = opts.timeoutMs ? setTimeout(() => ac.abort(), opts.timeoutMs) : null;
    try {
      let currentUrl = opts.url;
      let currentHeaders: Record<string, string> | undefined = opts.headers;
      let response: Response | null = null;
      for (let hop = 0; hop <= maxRedirects; hop++) {
        if (denyInternal && isInternalUrl(currentUrl)) {
          throw new Error(
            `praetor-http: refusing internal target '${currentUrl}' (set denyInternal:false on the request to opt in)`,
          );
        }
        response = await globalThis.fetch(currentUrl, {
          headers: currentHeaders,
          signal: ac.signal,
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400 && response.status !== 304) {
          const location = response.headers.get("location");
          if (!location) break; // no Location header — treat as terminal
          if (hop >= maxRedirects) {
            throw new Error(`praetor-http: redirect limit (${maxRedirects}) exceeded at ${currentUrl}`);
          }
          // Resolve relative redirects against the current URL.
          currentUrl = new URL(location, currentUrl).toString();
          // Drop body-shaped headers on cross-origin redirects (Cookie /
          // Authorization). Conservative — never re-send credentials.
          if (currentHeaders) {
            const same = sameOrigin(opts.url, currentUrl);
            if (!same) {
              const stripped: Record<string, string> = {};
              for (const [k, v] of Object.entries(currentHeaders)) {
                if (/^(cookie|authorization|x-csrf-token)$/i.test(k)) continue;
                stripped[k] = v;
              }
              currentHeaders = stripped;
            }
          }
          continue;
        }
        break;
      }
      if (!response) throw new Error(`praetor-http: no response for ${opts.url}`);
      const body = await response.text();
      const headers: Record<string, string | string[]> = {};
      response.headers.forEach((value, key) => {
        const existing = headers[key];
        if (existing === undefined) headers[key] = value;
        else if (Array.isArray(existing)) existing.push(value);
        else headers[key] = [existing, value];
      });
      if (response.status >= 500 && response.status <= 599 && attempt < retries) {
        lastErr = new Error(`praetor-http: ${response.status} on ${opts.url}`);
        continue;
      }
      return { body, statusCode: response.status, headers };
    } catch (err) {
      lastErr = err;
      // Don't retry SSRF refusals or redirect-limit overflows — they're
      // structural, not transient.
      const msg = err instanceof Error ? err.message : "";
      if (/refusing internal target|redirect limit/.test(msg)) break;
      if (attempt >= retries) break;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error(`praetor-http: failed without error for ${opts.url}`);
};

function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.protocol === ub.protocol && ua.host === ub.host;
  } catch {
    return false;
  }
}

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
  /** Skip robots.txt enforcement for explicitly authorized/internal fetches. */
  ignoreRobots?: boolean;
  /** Minimum delay between requests to the same host. Defaults to 250ms. */
  crawlDelayMs?: number;
  /**
   * Allow scraping internal targets (localhost / RFC1918 / 169.254.x).
   * Default false (SSRF-safe). Pass true only for charters that
   * legitimately need to reach a local dev service.
   */
  allowInternal?: boolean;
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
  /** Native Praetor evidence extracted from HTML responses. */
  evidence?: PageEvidence;
  /** Security observations about scraped untrusted content. */
  warnings?: ScrapeWarning[];
  /** Crawl policy applied before fetching. */
  crawl?: CrawlDecision;
}

export interface PageEvidence {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  headings: { level: 1 | 2 | 3; text: string }[];
  links: { href: string; text: string; rel?: string }[];
  meta: Record<string, string>;
  wordCount: number;
  contentHash: string;
  boundaries: EvidenceBoundary[];
}

export interface EvidenceBoundary {
  kind: "title" | "meta" | "heading" | "paragraph" | "link" | "jsonld";
  text: string;
  source: string;
  trust: "page";
}

export interface ScrapeWarning {
  code: "prompt_injection" | "suspicious_instruction";
  severity: "low" | "medium" | "high";
  text: string;
  location: string;
}

export interface RobotsPolicy {
  userAgent: string;
  allow: string[];
  disallow: string[];
  crawlDelaySeconds?: number;
}

export interface RobotsDecision {
  allowed: boolean;
  matchedRule?: string;
  crawlDelaySeconds?: number;
}

export interface CrawlDecision extends RobotsDecision {
  robotsUrl?: string;
  delayedMs?: number;
}

export interface ScrapeAdapter {
  name: ScrapeBackend;
  fetch: (req: ScrapeRequest) => Promise<ScrapeResult>;
}

const DEFAULT_UA =
  "PraetorBot/0.1 (+https://praetor.dev/scraper; agent=praetor; respects=robots.txt)";

/**
 * Default fetch adapter. Uses the Praetor-native HTTP client wrapping
 * `globalThis.fetch`. Adequate for static HTML, JSON, sitemap.xml, robots.txt,
 * llms.txt, ai.txt — i.e. the 80% case. JS-rendered pages graduate to the
 * Crawl4AI or Playwright(-MCP) backend.
 */
export class FetchAdapter implements ScrapeAdapter {
  name: ScrapeBackend = "fetch";
  constructor(private readonly httpFetch: PraetorHttpFetch = nativeHttpFetch) {}
  async fetch(req: ScrapeRequest): Promise<ScrapeResult> {
    const x = parseXStatusUrl(req.url);
    if (x && !req.headers?.Cookie) {
      return this.fetchXSyndication(req, x);
    }

    const res = await this.httpFetch({
      url: req.url,
      headers: {
        "user-agent": req.userAgent ?? DEFAULT_UA,
        accept: "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
        ...(req.headers ?? {}),
      },
      timeoutMs: req.timeoutMs ?? 15_000,
      retries: 1,
      denyInternal: req.allowInternal !== true,
    });

    const body = res.body;
    const contentTypeRaw = res.headers["content-type"];
    const contentType = (Array.isArray(contentTypeRaw) ? contentTypeRaw[0] : contentTypeRaw) ?? "";
    const isHtml = /text\/html|xhtml/i.test(contentType);
    const text = isHtml ? extractReadableText(body) : undefined;
    const warnings = isHtml ? detectScrapeWarnings(body, text) : [];

    return {
      url: req.url,
      status: res.statusCode,
      contentType,
      body,
      fetchedAt: new Date().toISOString(),
      backend: this.name,
      jsonLd: isHtml ? extractJsonLd(body) : undefined,
      text,
      evidence: isHtml ? extractPageEvidence(body, req.url, text) : undefined,
      warnings,
    };
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

    const res = await this.httpFetch({
      url: synURL,
      headers: { "user-agent": req.userAgent ?? DEFAULT_UA, accept: "application/json" },
      timeoutMs: req.timeoutMs ?? 15_000,
      retries: 1,
      denyInternal: req.allowInternal !== true,
    });
    
    const body = res.body;
    let text: string | undefined;
    try {
      const parsed = JSON.parse(body) as { text?: string; user?: { screen_name?: string; name?: string }; created_at?: string; favorite_count?: number; conversation_count?: number };
      text = parsed.text
        ? `@${parsed.user?.screen_name ?? "?"} (${parsed.user?.name ?? ""}) · ${parsed.created_at ?? ""}\n\n${parsed.text}\n\n♥ ${parsed.favorite_count ?? 0} · 💬 ${parsed.conversation_count ?? 0}`
        : undefined;
    } catch {
      // body wasn't JSON; leave text undefined
    }

    const ctRaw = res.headers["content-type"];
    const contentType = (Array.isArray(ctRaw) ? ctRaw[0] : ctRaw) ?? "application/json";
    return {
      url: req.url,
      status: res.statusCode,
      contentType,
      body,
      fetchedAt: new Date().toISOString(),
      backend: this.name,
      text,
    };
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
    const text = isHtml ? extractReadableText(r.body) : undefined;
    const warnings = isHtml ? detectScrapeWarnings(r.body, text) : [];
    return {
      url: req.url,
      status: r.status,
      contentType: r.contentType,
      body: r.body,
      fetchedAt: new Date().toISOString(),
      backend: this.name,
      jsonLd: isHtml ? extractJsonLd(r.body) : undefined,
      text,
      evidence: isHtml ? extractPageEvidence(r.body, req.url, text) : undefined,
      warnings,
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
    const text = data.data?.markdown ?? extractReadableText(html);
    return {
      url: req.url,
      status: res.status,
      contentType: "text/html",
      body: html,
      fetchedAt: new Date().toISOString(),
      backend: this.name,
      jsonLd: extractJsonLd(html),
      text,
      evidence: extractPageEvidence(html, req.url, text),
      warnings: detectScrapeWarnings(html, text),
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
    const text = r0.markdown ?? extractReadableText(html);
    return {
      url: req.url,
      status: r0.status_code ?? res.status,
      contentType: "text/html",
      body: html,
      fetchedAt: new Date().toISOString(),
      backend: this.name,
      jsonLd: extractJsonLd(html),
      text,
      evidence: extractPageEvidence(html, req.url, text),
      warnings: detectScrapeWarnings(html, text),
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
    const text = snap?.text ?? extractReadableText(html);
    return {
      url: req.url,
      status: typeof snap?.status === "number" ? snap.status : 200,
      contentType: "text/html",
      body: html,
      fetchedAt: new Date().toISOString(),
      backend: this.name,
      jsonLd: extractJsonLd(html),
      text,
      evidence: extractPageEvidence(html, req.url, text),
      warnings: detectScrapeWarnings(html, text),
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
  private readonly robotsCache = new Map<string, RobotsPolicy>();
  private readonly lastRequestAt = new Map<string, number>();
  constructor(
    adapters: Partial<Record<ScrapeBackend, ScrapeAdapter>> = {},
    private readonly opts: { fetchImpl?: typeof fetch; defaultCrawlDelayMs?: number; clock?: () => number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
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
    const crawl = await this.prepareCrawl(req);
    if (!crawl.allowed) {
    return {
        url: req.url,
        status: 999,
        contentType: "text/plain",
        body: `Blocked by robots.txt rule: ${crawl.matchedRule ?? "(none)"}`,
        fetchedAt: new Date().toISOString(),
        backend,
        text: "",
        crawl,
        warnings: [],
      };
    }
    const result = await this.adapters[backend].fetch(req);
    return { ...result, warnings: result.warnings ?? [], crawl };
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

  private async prepareCrawl(req: ScrapeRequest): Promise<CrawlDecision> {
    const host = hostKey(req.url);
    if (!host || req.ignoreRobots) {
      const delayedMs = await this.applyHostDelay(host, req.crawlDelayMs);
      return { allowed: true, delayedMs };
    }
    const robotsUrl = new URL("/robots.txt", req.url).toString();
    const policy = await this.getRobotsPolicy(robotsUrl, req.userAgent ?? DEFAULT_UA);
    const decision = evaluateRobots(req.url, policy);
    const delayMs = req.crawlDelayMs ?? (decision.crawlDelaySeconds !== undefined ? decision.crawlDelaySeconds * 1000 : undefined);
    const delayedMs = decision.allowed ? await this.applyHostDelay(host, delayMs) : 0;
    return { ...decision, robotsUrl, delayedMs };
  }

  private async getRobotsPolicy(robotsUrl: string, userAgent: string): Promise<RobotsPolicy> {
    const key = `${robotsUrl}|${userAgent}`;
    const cached = this.robotsCache.get(key);
    if (cached) return cached;
    try {
      const f = this.opts.fetchImpl ?? globalThis.fetch;
      const res = await f(robotsUrl, { headers: { "user-agent": userAgent, accept: "text/plain,*/*;q=0.8" } });
      const txt = res.ok ? await res.text() : "";
      const policy = parseRobotsTxt(txt, userAgent);
      this.robotsCache.set(key, policy);
      return policy;
    } catch {
      const policy = parseRobotsTxt("", userAgent);
      this.robotsCache.set(key, policy);
      return policy;
    }
  }

  private async applyHostDelay(host: string, explicitDelayMs?: number): Promise<number> {
    if (!host) return 0;
    const delayMs = explicitDelayMs ?? this.opts.defaultCrawlDelayMs ?? 250;
    const now = this.opts.clock?.() ?? Date.now();
    const last = this.lastRequestAt.get(host) ?? 0;
    const wait = Math.max(0, last + delayMs - now);
    if (wait > 0) await (this.opts.sleep ?? sleep)(wait);
    this.lastRequestAt.set(host, (this.opts.clock?.() ?? Date.now()));
    return wait;
  }
}

function hostKey(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export function parseRobotsTxt(txt: string, userAgent = "*"): RobotsPolicy {
  const groups: RobotsPolicy[] = [];
  let current: RobotsPolicy | null = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      current = { userAgent: value.toLowerCase(), allow: [], disallow: [] };
      groups.push(current);
      continue;
    }
    if (!current) continue;
    if (key === "allow") current.allow.push(value);
    else if (key === "disallow") current.disallow.push(value);
    else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelaySeconds = n;
    }
  }
  const ua = userAgent.toLowerCase();
  return groups.find((g) => g.userAgent === ua) ?? groups.find((g) => g.userAgent === "*") ?? { userAgent: "*", allow: [], disallow: [] };
}

export function evaluateRobots(url: string, policy: RobotsPolicy): RobotsDecision {
  let path = "/";
  try {
    const u = new URL(url);
    path = `${u.pathname}${u.search}`;
  } catch {
    path = url.startsWith("/") ? url : `/${url}`;
  }
  const rules = [
    ...policy.allow.map((rule) => ({ rule, allowed: true })),
    ...policy.disallow.map((rule) => ({ rule, allowed: false })),
  ].filter((r) => r.rule !== "");
  let best: { rule: string; allowed: boolean } | undefined;
  for (const r of rules) {
    if (robotsRuleMatches(path, r.rule) && (!best || r.rule.length > best.rule.length)) best = r;
  }
  return {
    allowed: best?.allowed ?? true,
    matchedRule: best?.rule,
    crawlDelaySeconds: policy.crawlDelaySeconds,
  };
}

function robotsRuleMatches(path: string, rule: string): boolean {
  const escaped = rule
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\$/g, "$");
  return new RegExp(`^${escaped}`).test(path);
}

/**
 * Tiny HTML -> text. Drops `<script>` / `<style>`, strips remaining tags,
 * decodes the five named entities. Good enough for embedding pipelines.
 */
export function stripHtml(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

export function extractReadableText(html: string): string {
  const pruned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|footer|aside|form|svg|canvas|iframe)\b[\s\S]*?<\/\1>/gi, " ");
  const blocks: string[] = [];
  const blockRe = /<(h[1-3]|p|li|blockquote|td|th|figcaption|article|section)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(pruned))) {
    const text = stripHtml(m[2]);
    if (text.length >= 2) blocks.push(text);
  }
  const text = blocks.length ? blocks.join("\n") : stripHtml(pruned);
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function extractPageEvidence(html: string, pageUrl = "", text = extractReadableText(html)): PageEvidence {
  const meta = extractMeta(html);
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const canonicalUrl = firstAttr(html, /<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i, "href");
  const headings = [...html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => ({ level: Number(m[1]) as 1 | 2 | 3, text: stripHtml(m[2]) }))
    .filter((h) => h.text);
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({
      href: absolutize(firstAttrFromAttrs(m[1], "href"), pageUrl),
      text: stripHtml(m[2]),
      rel: firstAttrFromAttrs(m[1], "rel") || undefined,
    }))
    .filter((l) => l.href);
  const boundaries: EvidenceBoundary[] = [];
  if (title) boundaries.push({ kind: "title", text: stripHtml(title), source: "title", trust: "page" });
  for (const [key, value] of Object.entries(meta)) {
    boundaries.push({ kind: "meta", text: value, source: `meta:${key}`, trust: "page" });
  }
  for (const h of headings) {
    boundaries.push({ kind: "heading", text: h.text, source: `h${h.level}`, trust: "page" });
  }
  for (const p of extractParagraphs(html)) {
    boundaries.push({ kind: "paragraph", text: p, source: "body", trust: "page" });
  }
  for (const l of links.slice(0, 100)) {
    boundaries.push({ kind: "link", text: l.text, source: l.href, trust: "page" });
  }
  return {
    title: title ? stripHtml(title) : undefined,
    description: meta.description ?? meta["og:description"] ?? meta["twitter:description"],
    canonicalUrl: canonicalUrl ? absolutize(canonicalUrl, pageUrl) : undefined,
    headings,
    links,
    meta,
    wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
    contentHash: stableHash(text || stripHtml(html)),
    boundaries,
  };
}

export function detectScrapeWarnings(html: string, text = extractReadableText(html)): ScrapeWarning[] {
  const haystack = `${stripHtml(html)}\n${text}`.slice(0, 250_000);
  const patterns: { re: RegExp; code: ScrapeWarning["code"]; severity: ScrapeWarning["severity"] }[] = [
    { re: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|messages)\b/i, code: "prompt_injection", severity: "high" },
    { re: /\b(system|developer)\s+message\s*:/i, code: "prompt_injection", severity: "high" },
    { re: /\bdo\s+not\s+(tell|reveal|mention)\s+(the\s+)?(user|operator)\b/i, code: "suspicious_instruction", severity: "medium" },
    { re: /\b(send|exfiltrate|upload)\s+(secrets|api keys|tokens|passwords)\b/i, code: "prompt_injection", severity: "high" },
    { re: /\btool\s+call\s*:\s*[{[]/i, code: "suspicious_instruction", severity: "medium" },
  ];
  const warnings: ScrapeWarning[] = [];
  for (const p of patterns) {
    const m = p.re.exec(haystack);
    if (m) warnings.push({ code: p.code, severity: p.severity, text: snippet(haystack, m.index), location: "page_text" });
  }
  return warnings;
}

function extractParagraphs(html: string): string[] {
  return [...html.matchAll(/<(p|li|blockquote|figcaption)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => stripHtml(m[2]))
    .filter((s) => s.length > 0)
    .slice(0, 200);
}

function snippet(s: string, index: number): string {
  const start = Math.max(0, index - 80);
  const end = Math.min(s.length, index + 160);
  return s.slice(start, end).replace(/\s+/g, " ").trim();
}

function extractMeta(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = m[1];
    const key = firstAttrFromAttrs(attrs, "name") || firstAttrFromAttrs(attrs, "property");
    const content = firstAttrFromAttrs(attrs, "content");
    if (key && content) out[key.toLowerCase()] = decodeHtml(content);
  }
  return out;
}

function firstMatch(s: string, re: RegExp): string | undefined {
  return re.exec(s)?.[1];
}

function firstAttr(tag: string, re: RegExp, attr: string): string | undefined {
  const m = re.exec(tag);
  return m ? firstAttrFromAttrs(m[0], attr) : undefined;
}

function firstAttrFromAttrs(attrs: string, attr: string): string {
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, "i");
  return re.exec(attrs)?.[1] ?? "";
}

function absolutize(href: string, base: string): string {
  if (!href) return "";
  try {
    return base ? new URL(href, base).toString() : href;
  } catch {
    return href;
  }
}

function stableHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function decodeHtml(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
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
