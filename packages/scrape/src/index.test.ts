import { describe, it, expect, vi } from "vitest";
import {
  extractJsonLd,
  extractSitemapLocs,
  stripHtml,
  xCookie,
  Scraper,
  FetchAdapter,
  Crawl4AIAdapter,
  PlaywrightMcpAdapter,
  defaultScraper,
  parseXStatusUrl,
} from "./index.js";

describe("Praetor scrape pack", () => {
  it("extracts JSON-LD blocks from HTML", () => {
    const html = `
      <html><head>
      <script type="application/ld+json">{"@type":"Product","name":"X"}</script>
      <script type="application/ld+json">[{"@type":"Article","name":"A"},{"@type":"FAQPage"}]</script>
      <script type="application/ld+json">not json — should be skipped</script>
      </head></html>`;
    const blocks = extractJsonLd(html);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ "@type": "Product", name: "X" });
    expect(blocks[2]).toEqual({ "@type": "FAQPage" });
  });

  it("walks sitemap-style XML", () => {
    const xml = `<urlset>
      <url><loc>https://praetor.dev/a</loc></url>
      <url><loc>https://praetor.dev/b</loc></url>
    </urlset>`;
    expect(extractSitemapLocs(xml)).toEqual([
      "https://praetor.dev/a",
      "https://praetor.dev/b",
    ]);
  });

  it("strips HTML tags + decodes entities", () => {
    const html = `<p>Hello &amp; <b>world</b><script>bad</script></p>`;
    expect(stripHtml(html)).toBe("Hello & world");
  });

  it("builds an X.com cookie header pair", () => {
    const h = xCookie({ authToken: "abc", ct0: "xyz" });
    expect(h.Cookie).toContain("auth_token=abc");
    expect(h.Cookie).toContain("ct0=xyz");
    expect(h["x-csrf-token"]).toBe("xyz");
  });

  it("Crawl4AIAdapter posts to /crawl and surfaces markdown as text", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ results: [{ html: "<p>x</p>", cleaned_html: "<p>clean</p>", markdown: "# md", status_code: 200 }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;
    const a = new Crawl4AIAdapter({ baseUrl: "http://c4ai.test", apiKey: "k", fetchImpl });
    const r = await a.fetch({ url: "https://praetor.dev" });
    expect(r.body).toBe("<p>clean</p>");
    expect(r.text).toBe("# md");
    expect(r.backend).toBe("crawl4ai");
  });

  it("PlaywrightMcpAdapter calls navigate then snapshot via the bridge", async () => {
    const calls: { name: string; args: unknown }[] = [];
    const bridge = {
      callTool: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === "browser_snapshot") return { html: "<h1>hi</h1>", text: "hi", status: 200 };
        return null;
      },
    };
    const a = new PlaywrightMcpAdapter(bridge);
    const r = await a.fetch({ url: "https://praetor.dev" });
    expect(calls.map((c) => c.name)).toEqual(["browser_navigate", "browser_snapshot"]);
    expect(r.text).toBe("hi");
    expect(r.backend).toBe("playwright-mcp");
  });

  it("defaultScraper picks Crawl4AI when CRAWL4AI_URL is set", async () => {
    const s = defaultScraper({ CRAWL4AI_URL: "http://c4ai.test" } as unknown as NodeJS.ProcessEnv);
    expect(s).toBeInstanceOf(Scraper);
  });

  it("parseXStatusUrl picks up x.com / twitter.com / fxtwitter status IDs", () => {
    expect(parseXStatusUrl("https://x.com/_fojcik/status/2049078294637596803?s=20")).toEqual({ id: "2049078294637596803" });
    expect(parseXStatusUrl("https://twitter.com/foo/status/12345")).toEqual({ id: "12345" });
    expect(parseXStatusUrl("https://fxtwitter.com/foo/status/9999/photo/1")).toEqual({ id: "9999" });
    expect(parseXStatusUrl("https://x.com/foo")).toBeNull();
    expect(parseXStatusUrl("not a url")).toBeNull();
  });

  it("FetchAdapter rewrites x.com status URLs to the public syndication endpoint", async () => {
    const calls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      return new Response(
        JSON.stringify({ text: "hello world", user: { screen_name: "_fojcik", name: "Dominik" }, created_at: "2026-04-28T10:48:30.000Z", favorite_count: 599, conversation_count: 19 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    try {
      const a = new FetchAdapter();
      const r = await a.fetch({ url: "https://x.com/_fojcik/status/2049078294637596803?s=20" });
      expect(calls[0]).toContain("cdn.syndication.twimg.com/tweet-result?id=2049078294637596803");
      expect(r.text).toContain("@_fojcik");
      expect(r.text).toContain("hello world");
      expect(r.status).toBe(200);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("scrape() routes through the requested backend", async () => {
    const calls: string[] = [];
    const fakeFetch = new FetchAdapter();
    fakeFetch.fetch = async (req) => {
      calls.push(req.url);
      return {
        url: req.url,
        status: 200,
        contentType: "text/html",
        body: "<html><body>ok</body></html>",
        fetchedAt: new Date().toISOString(),
        backend: "fetch",
      };
    };
    const s = new Scraper({ fetch: fakeFetch });
    const r = await s.scrape({ url: "https://praetor.dev/x" });
    expect(r.status).toBe(200);
    expect(calls).toEqual(["https://praetor.dev/x"]);
  });
});
