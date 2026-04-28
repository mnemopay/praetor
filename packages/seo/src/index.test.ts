import { describe, it, expect } from "vitest";
import { renderPage, renderSite, productSchema } from "./index.js";

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

  it("renders a full site with sitemap, robots, ai.txt, llms.txt", () => {
    const site = renderSite({
      origin: "https://praetor.dev",
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
    expect((s as any).offers["@type"]).toBe("Offer");
  });
});
