import { describe, it, expect } from "vitest";
import {
  renderPage,
  renderSite,
  productSchema,
  articleSchema,
  faqSchema,
  breadcrumbSchema,
  softwareApplicationSchema,
  generateOgImageUrl,
} from "./index.js";

describe("Praetor SEO/GEO pack", () => {
  it("renders a page with ai:description and canonical", () => {
    const r = renderPage({
      slug: "intro",
      title: "Intro",
      description: "What Praetor is.",
      aiDescription: "Mission runtime for autonomous agents.",
      bodyMarkdown: "Hello world.",
    }, "https://praetor.dev");
    expect(r.html).toContain('name="ai:description"');
    expect(r.html).toContain('rel="canonical"');
    expect(r.html).toContain("https://praetor.dev/intro");
  });

  it("emits hreflang, breadcrumbs, FAQs, and Article schema when supplied", () => {
    const r = renderPage({
      slug: "guide",
      title: "Guide",
      description: "How to use Praetor.",
      aiDescription: "How-to.",
      bodyMarkdown: "...",
      hreflang: { en: "https://praetor.dev/guide", fr: "https://praetor.dev/fr/guide" },
      breadcrumbs: [{ name: "Home", url: "https://praetor.dev" }, { name: "Guide", url: "https://praetor.dev/guide" }],
      faqs: [{ question: "What is Praetor?", answer: "A mission runtime." }],
      author: { name: "Praetor team" },
      updatedAt: "2026-04-28T00:00:00Z",
    }, "https://praetor.dev");
    expect(r.html).toContain('hreflang="fr"');
    expect(r.html).toContain('"BreadcrumbList"');
    expect(r.html).toContain('"FAQPage"');
    expect(r.html).toContain('"Article"');
  });

  it("renders a full site with sitemap, robots, ai.txt, llms.txt, RSS, Atom, opensearch, security.txt", () => {
    const site = renderSite({
      origin: "https://praetor.dev",
      identity: {
        name: "Praetor",
        description: "Mission runtime for autonomous agents.",
        contactEmail: "security@praetor.dev",
        sameAs: ["https://github.com/mnemopay/praetor"],
      },
      pages: [
        { slug: "a", title: "A", description: "x", aiDescription: "x", bodyMarkdown: "" },
        { slug: "b", title: "B", description: "y", aiDescription: "y", bodyMarkdown: "" },
      ],
    });
    expect(site.pages).toHaveLength(2);
    expect(site.sitemapXml).toContain("https://praetor.dev/a");
    expect(site.robotsTxt).toContain("Sitemap:");
    expect(site.aiTxt).toContain("LLM-Friendly:");
    expect(site.llmsTxt).toContain("[A](https://praetor.dev/a)");
    expect(site.rssXml).toContain("<rss");
    expect(site.atomXml).toContain("<feed");
    expect(site.openSearchXml).toContain("OpenSearchDescription");
    expect(site.securityTxt).toContain("security@praetor.dev");
    expect(site.humansTxt).toContain("Praetor");
    expect(site.manifestJson).toContain("Praetor");
    expect(site.schemaJsonLd).toContain('"Organization"');
    expect(site.schemaJsonLd).toContain('"WebSite"');
  });

  it("emits a valid Product schema", () => {
    const s = productSchema({
      name: "Praetor",
      description: "Mission runtime.",
      url: "https://praetor.dev",
      brand: "Praetor",
      offers: { price: 0, priceCurrency: "USD" },
    });
    expect(s["@type"]).toBe("Product");
    expect((s as { offers: { "@type": string } }).offers["@type"]).toBe("Offer");
  });

  it("emits Article / FAQ / Breadcrumb / SoftwareApplication schemas", () => {
    const a = articleSchema(
      { slug: "x", title: "T", description: "D", aiDescription: "AI", bodyMarkdown: "", updatedAt: "2026-04-28T00:00:00Z", author: { name: "Jerry" } },
      "https://x/y",
    );
    expect(a["@type"]).toBe("Article");
    const f = faqSchema([{ question: "Q", answer: "A" }]);
    expect(f.mainEntity[0]["@type"]).toBe("Question");
    const b = breadcrumbSchema([{ name: "Home", url: "/" }]);
    expect(b.itemListElement[0].position).toBe(1);
    const sa = softwareApplicationSchema({
      name: "Praetor", description: "x", url: "https://praetor.dev",
    });
    expect(sa["@type"]).toBe("SoftwareApplication");
  });

  it("generates cost-free native OpenGraph images", () => {
    const url = generateOgImageUrl("Praetor native mission runtime");
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(url).not.toContain("pollinations");
  });
});
