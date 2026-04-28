import { describe, it, expect } from "vitest";
import {
  extractJsonLd,
  extractSitemapLocs,
  stripHtml,
  xCookie,
  Scraper,
  FetchAdapter,
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
