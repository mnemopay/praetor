/**
 * Praetor SEO/GEO pack — programmatic page generation that satisfies both
 * traditional search crawlers and AI-crawler conventions (ai.txt, ai:description
 * meta, llm-friendly structured data). Mirrors what is already deployed on
 * mnemopay.com and getbizsuite.com.
 */
export interface SeoPage {
  slug: string;
  title: string;
  description: string;
  aiDescription: string;
  bodyMarkdown: string;
  schema?: Record<string, unknown>;
}

export interface RenderedPage {
  slug: string;
  html: string;
  sitemap: string;
}

export function renderPage(p: SeoPage): RenderedPage {
  const meta = [
    `<meta name="description" content="${escapeAttr(p.description)}"/>`,
    `<meta name="ai:description" content="${escapeAttr(p.aiDescription)}"/>`,
    `<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large"/>`,
    p.schema ? `<script type="application/ld+json">${JSON.stringify(p.schema)}</script>` : "",
  ].filter(Boolean).join("\n");
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>${escapeAttr(p.title)}</title>
${meta}
</head><body>
${markdownToHtml(p.bodyMarkdown)}
</body></html>`;
  const sitemap = `<url><loc>/${p.slug}</loc></url>`;
  return { slug: p.slug, html, sitemap };
}

function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function markdownToHtml(md: string) {
  // Intentionally trivial — week 3 swaps in a real markdown renderer.
  return md.split(/\n{2,}/).map((p) => `<p>${escapeAttr(p)}</p>`).join("\n");
}
