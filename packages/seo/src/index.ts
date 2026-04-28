/**
 * Praetor SEO/GEO pack — programmatic page generation that satisfies both
 * traditional search crawlers and the AI-crawler conventions emerging in
 * 2025-2026 (ai.txt, llms.txt, ai:description meta, JSON-LD structured data).
 * Mirrors what is already deployed on mnemopay.com and getbizsuite.com.
 */
export interface SeoPage {
  slug: string;
  title: string;
  description: string;
  /** Tighter, agent-readable summary surfaced via <meta name="ai:description">. */
  aiDescription: string;
  bodyMarkdown: string;
  /** Optional JSON-LD payload — emitted as a <script type="application/ld+json">. */
  schema?: Record<string, unknown>;
  /** Canonical URL — defaults to `/${slug}` rooted at site origin. */
  canonical?: string;
  /** Image URL for og:image / twitter:image. */
  image?: string;
}

export interface RenderedPage {
  slug: string;
  html: string;
  sitemapEntry: string;
}

export interface SiteManifest {
  origin: string;
  pages: SeoPage[];
}

export interface RenderedSite {
  pages: RenderedPage[];
  sitemapXml: string;
  robotsTxt: string;
  aiTxt: string;
  llmsTxt: string;
}

export function renderPage(p: SeoPage, origin = ""): RenderedPage {
  const canonical = p.canonical ?? `${origin}/${p.slug}`;
  const meta = [
    `<meta name="description" content="${escapeAttr(p.description)}"/>`,
    `<meta name="ai:description" content="${escapeAttr(p.aiDescription)}"/>`,
    `<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large"/>`,
    `<link rel="canonical" href="${escapeAttr(canonical)}"/>`,
    `<meta property="og:title" content="${escapeAttr(p.title)}"/>`,
    `<meta property="og:description" content="${escapeAttr(p.description)}"/>`,
    `<meta property="og:url" content="${escapeAttr(canonical)}"/>`,
    p.image ? `<meta property="og:image" content="${escapeAttr(p.image)}"/>` : "",
    `<meta name="twitter:card" content="${p.image ? "summary_large_image" : "summary"}"/>`,
    p.schema ? `<script type="application/ld+json">${JSON.stringify(p.schema)}</script>` : "",
  ].filter(Boolean).join("\n");
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeAttr(p.title)}</title>
${meta}
</head><body>
${markdownToHtml(p.bodyMarkdown)}
</body></html>`;
  const sitemapEntry = `<url><loc>${escapeAttr(canonical)}</loc></url>`;
  return { slug: p.slug, html, sitemapEntry };
}

export function renderSite(site: SiteManifest): RenderedSite {
  const pages = site.pages.map((p) => renderPage(p, site.origin));
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => p.sitemapEntry).join("\n")}
</urlset>`;
  const robotsTxt = `User-agent: *
Allow: /
Sitemap: ${site.origin}/sitemap.xml
`;
  const aiTxt = `# ai.txt — agent crawler conventions
User-agent: *
Allow: /
Crawl-delay: 1
Sitemap: ${site.origin}/sitemap.xml
LLM-Friendly: ${site.origin}/llms.txt
`;
  const llmsTxt = `# ${site.origin} — LLM-friendly index
${site.pages.map((p) => `- [${p.title}](${site.origin}/${p.slug}) — ${p.aiDescription}`).join("\n")}
`;
  return { pages, sitemapXml, robotsTxt, aiTxt, llmsTxt };
}

/**
 * Helper: emit a JSON-LD `Product` schema. Saves charters from hand-rolling.
 */
export function productSchema(args: {
  name: string;
  description: string;
  url: string;
  brand: string;
  offers?: { price: number; priceCurrency: string };
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: args.name,
    description: args.description,
    url: args.url,
    brand: { "@type": "Brand", name: args.brand },
    ...(args.offers
      ? {
          offers: {
            "@type": "Offer",
            price: args.offers.price,
            priceCurrency: args.offers.priceCurrency,
            url: args.url,
          },
        }
      : {}),
  };
}

function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function markdownToHtml(md: string) {
  return md.split(/\n{2,}/).map((p) => `<p>${escapeAttrText(p)}</p>`).join("\n");
}
function escapeAttrText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
