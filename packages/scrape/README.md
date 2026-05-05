# @kpanks/scrape

Native scraping for Praetor charters. SSRF-safe HTTP client by default
(blocks RFC1918, 169.254.x cloud metadata, link-local, IPv4-mapped
loopback), JSON-LD extractor, sitemap walker, X.com syndication path,
robots.txt-aware. Crawl4AI / Playwright / Firecrawl ship as opt-in
adapters; the native `fetch` path is the default.

## Install

```bash
npm install @kpanks/scrape
```

## Usage

```ts
import { Scraper, FetchAdapter } from "@kpanks/scrape";

const scraper = new Scraper();
const r = await scraper.scrape({ url: "https://example.com" });
// r.body, r.text (readable extraction), r.jsonLd, r.evidence, r.warnings
```

## SSRF guard

`nativeHttpFetch` denies internal targets by default. Each redirect's
`Location` is re-validated; `Cookie` / `Authorization` / `x-csrf-token`
are stripped on cross-origin redirects. Set `allowInternal: true` on
the request to opt in for legitimate localhost dev work.

## Backends

| Backend | When |
|---|---|
| `fetch` | Default. Static HTML, JSON, sitemaps, robots, llms.txt. |
| `crawl4ai` | JS-rendered pages via self-hosted Crawl4AI service. |
| `playwright` | When you bring your own Playwright launcher. |
| `playwright-mcp` | Bridge to a running playwright-mcp server. |
| `firecrawl` | Paid escape hatch; charges through MnemoPay. |

## License

Apache 2.0.
