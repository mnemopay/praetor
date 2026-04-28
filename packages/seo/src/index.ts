/**
 * Praetor SEO/GEO pack — programmatic page generation that satisfies both
 * traditional search crawlers and the AI-crawler conventions emerging in
 * 2025-2026. Mirrors what is already deployed on mnemopay.com and
 * getbizsuite.com but adds the structured-data and feed surfaces needed for a
 * standalone runtime. 15+ surfaces in the box:
 *
 *   1.  ai:description meta             9.  llms.txt
 *   2.  description meta               10.  hreflang link tags
 *   3.  canonical link                 11.  Article JSON-LD
 *   4.  og:* meta                      12.  FAQPage JSON-LD
 *   5.  twitter:card meta              13.  BreadcrumbList JSON-LD
 *   6.  Product JSON-LD                14.  Organization / WebSite JSON-LD
 *   7.  sitemap.xml                    15.  RSS 2.0 + Atom 1.0 feeds
 *   8.  robots.txt + ai.txt            16.  opensearch.xml + security.txt + humans.txt
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
  /** Optional alternate-language URLs keyed by hreflang code. */
  hreflang?: Record<string, string>;
  /** Optional breadcrumb trail rendered as JSON-LD BreadcrumbList. */
  breadcrumbs?: { name: string; url: string }[];
  /** Optional FAQ block rendered as JSON-LD FAQPage. */
  faqs?: { question: string; answer: string }[];
  /** Optional last-modified ISO 8601 — used in sitemap.xml + feeds. */
  updatedAt?: string;
  /** Optional author block — used in Article schema + feeds. */
  author?: { name: string; url?: string };
}

export interface RenderedPage {
  slug: string;
  html: string;
  sitemapEntry: string;
}

export interface SiteIdentity {
  name: string;
  description?: string;
  /** Logo URL emitted into Organization JSON-LD. */
  logo?: string;
  /** Contact email surfaced via security.txt + humans.txt. */
  contactEmail?: string;
  /** Social-profile URLs emitted into Organization sameAs array. */
  sameAs?: string[];
}

export interface SiteManifest {
  origin: string;
  pages: SeoPage[];
  identity?: SiteIdentity;
  /** Default language (used for hreflang x-default fallback). */
  defaultLang?: string;
  /** Override the security.txt expiry (defaults to +1 year). */
  securityExpiresAt?: string;
}

export interface RenderedSite {
  pages: RenderedPage[];
  sitemapXml: string;
  robotsTxt: string;
  aiTxt: string;
  llmsTxt: string;
  rssXml: string;
  atomXml: string;
  openSearchXml: string;
  securityTxt: string;
  humansTxt: string;
  manifestJson: string;
  /** Site-wide JSON-LD (Organization + WebSite). */
  schemaJsonLd: string;
}

export function renderPage(p: SeoPage, origin = ""): RenderedPage {
  const canonical = p.canonical ?? `${origin}/${p.slug}`;
  const meta: string[] = [
    `<meta name="description" content="${escapeAttr(p.description)}"/>`,
    `<meta name="ai:description" content="${escapeAttr(p.aiDescription)}"/>`,
    `<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large"/>`,
    `<link rel="canonical" href="${escapeAttr(canonical)}"/>`,
    `<meta property="og:title" content="${escapeAttr(p.title)}"/>`,
    `<meta property="og:description" content="${escapeAttr(p.description)}"/>`,
    `<meta property="og:url" content="${escapeAttr(canonical)}"/>`,
    p.image ? `<meta property="og:image" content="${escapeAttr(p.image)}"/>` : "",
    `<meta name="twitter:card" content="${p.image ? "summary_large_image" : "summary"}"/>`,
  ];
  if (p.hreflang) {
    for (const [lang, href] of Object.entries(p.hreflang)) {
      meta.push(`<link rel="alternate" hreflang="${escapeAttr(lang)}" href="${escapeAttr(href)}"/>`);
    }
  }
  const ldBlocks: string[] = [];
  if (p.schema) ldBlocks.push(JSON.stringify(p.schema));
  if (p.breadcrumbs?.length) ldBlocks.push(JSON.stringify(breadcrumbSchema(p.breadcrumbs)));
  if (p.faqs?.length) ldBlocks.push(JSON.stringify(faqSchema(p.faqs)));
  if (p.author && p.updatedAt) {
    ldBlocks.push(JSON.stringify(articleSchema(p, canonical)));
  }
  for (const block of ldBlocks) {
    meta.push(`<script type="application/ld+json">${block}</script>`);
  }
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeAttr(p.title)}</title>
${meta.filter(Boolean).join("\n")}
</head><body>
${markdownToHtml(p.bodyMarkdown)}
</body></html>`;
  const sitemapEntry = p.updatedAt
    ? `<url><loc>${escapeAttr(canonical)}</loc><lastmod>${escapeAttr(p.updatedAt)}</lastmod></url>`
    : `<url><loc>${escapeAttr(canonical)}</loc></url>`;
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
  const rssXml = renderRss(site);
  const atomXml = renderAtom(site);
  const openSearchXml = renderOpenSearch(site);
  const securityTxt = renderSecurityTxt(site);
  const humansTxt = renderHumansTxt(site);
  const manifestJson = JSON.stringify(renderWebManifest(site), null, 2);
  const schemaJsonLd = renderSiteSchema(site);
  return {
    pages,
    sitemapXml,
    robotsTxt,
    aiTxt,
    llmsTxt,
    rssXml,
    atomXml,
    openSearchXml,
    securityTxt,
    humansTxt,
    manifestJson,
    schemaJsonLd,
  };
}

/* ---------- JSON-LD helpers ---------------------------------------------- */

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

export function articleSchema(p: SeoPage, canonical: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: p.title,
    description: p.description,
    mainEntityOfPage: canonical,
    image: p.image,
    datePublished: p.updatedAt,
    dateModified: p.updatedAt,
    author: p.author
      ? { "@type": "Person", name: p.author.name, url: p.author.url }
      : undefined,
  };
}

export function faqSchema(faqs: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}

export function breadcrumbSchema(crumbs: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}

export function softwareApplicationSchema(args: {
  name: string;
  description: string;
  url: string;
  category?: string;
  offers?: { price: number; priceCurrency: string };
}) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: args.name,
    description: args.description,
    url: args.url,
    applicationCategory: args.category ?? "BusinessApplication",
    operatingSystem: "Any",
    ...(args.offers
      ? { offers: { "@type": "Offer", price: args.offers.price, priceCurrency: args.offers.priceCurrency } }
      : {}),
  };
}

/* ---------- site-level emitters ----------------------------------------- */

function renderSiteSchema(site: SiteManifest): string {
  const id = site.identity ?? { name: hostname(site.origin) };
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: id.name,
    url: site.origin,
    description: id.description,
    logo: id.logo,
    sameAs: id.sameAs,
  };
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: id.name,
    url: site.origin,
    potentialAction: {
      "@type": "SearchAction",
      target: `${site.origin}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
  return [JSON.stringify(org), JSON.stringify(website)]
    .map((b) => `<script type="application/ld+json">${b}</script>`)
    .join("\n");
}

function renderRss(site: SiteManifest): string {
  const id = site.identity?.name ?? hostname(site.origin);
  const items = site.pages
    .map(
      (p) => `<item>
  <title>${escapeXml(p.title)}</title>
  <link>${escapeXml(`${site.origin}/${p.slug}`)}</link>
  <guid>${escapeXml(`${site.origin}/${p.slug}`)}</guid>
  <description>${escapeXml(p.description)}</description>
  ${p.updatedAt ? `<pubDate>${escapeXml(new Date(p.updatedAt).toUTCString())}</pubDate>` : ""}
</item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${escapeXml(id)}</title>
<link>${escapeXml(site.origin)}</link>
<description>${escapeXml(site.identity?.description ?? "")}</description>
${items}
</channel></rss>`;
}

function renderAtom(site: SiteManifest): string {
  const id = site.identity?.name ?? hostname(site.origin);
  const updated = new Date().toISOString();
  const entries = site.pages
    .map(
      (p) => `<entry>
  <title>${escapeXml(p.title)}</title>
  <link href="${escapeXml(`${site.origin}/${p.slug}`)}"/>
  <id>${escapeXml(`${site.origin}/${p.slug}`)}</id>
  <updated>${escapeXml(p.updatedAt ?? updated)}</updated>
  <summary>${escapeXml(p.description)}</summary>
</entry>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>${escapeXml(id)}</title>
<link href="${escapeXml(site.origin)}"/>
<id>${escapeXml(site.origin)}</id>
<updated>${escapeXml(updated)}</updated>
${entries}
</feed>`;
}

function renderOpenSearch(site: SiteManifest): string {
  const id = site.identity?.name ?? hostname(site.origin);
  return `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>${escapeXml(id)}</ShortName>
  <Description>${escapeXml(site.identity?.description ?? id)}</Description>
  <Url type="text/html" template="${escapeXml(site.origin)}/?q={searchTerms}"/>
</OpenSearchDescription>`;
}

function renderSecurityTxt(site: SiteManifest): string {
  const expires = site.securityExpiresAt ?? new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  const contact = site.identity?.contactEmail;
  const lines: string[] = [];
  if (contact) lines.push(`Contact: mailto:${contact}`);
  lines.push(`Expires: ${expires}`);
  lines.push(`Preferred-Languages: ${site.defaultLang ?? "en"}`);
  lines.push(`Canonical: ${site.origin}/.well-known/security.txt`);
  return lines.join("\n") + "\n";
}

function renderHumansTxt(site: SiteManifest): string {
  const id = site.identity?.name ?? hostname(site.origin);
  return `/* humans.txt — ${id} */
/* TEAM */
${site.identity?.contactEmail ? `Contact: ${site.identity.contactEmail}` : ""}
/* SITE */
Last update: ${new Date().toISOString()}
Standards: HTML5, ai.txt, llms.txt, JSON-LD
Built with: Praetor
`;
}

function renderWebManifest(site: SiteManifest): Record<string, unknown> {
  const id = site.identity?.name ?? hostname(site.origin);
  return {
    name: id,
    short_name: id,
    description: site.identity?.description,
    start_url: site.origin,
    display: "standalone",
    icons: site.identity?.logo
      ? [{ src: site.identity.logo, sizes: "512x512", type: "image/png" }]
      : [],
  };
}

/* ---------- string helpers ---------------------------------------------- */

function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function markdownToHtml(md: string) {
  return md.split(/\n{2,}/).map((p) => `<p>${escapeAttrText(p)}</p>`).join("\n");
}
function escapeAttrText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function hostname(origin: string) {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}
