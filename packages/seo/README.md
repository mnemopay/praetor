# @kpanks/seo

GEO/SEO emission pack for Praetor charters. Declarative input, 15+
output surfaces:

- `sitemap.xml`, `robots.txt`, `ai.txt`, `llms.txt`, `ai:description`
- Open Graph + Twitter card tags
- JSON-LD: `Article`, `FAQPage`, `BreadcrumbList`, `Organization`,
  `WebSite`, `SoftwareApplication`
- `hreflang` annotations
- RSS / Atom, `opensearch.xml`, `security.txt`, `humans.txt`

## Install

```bash
npm install @kpanks/seo
```

## Usage

```ts
import { emit } from "@kpanks/seo";

const surfaces = emit({
  site: { name: "Linger", url: "https://linger.chat" },
  pages: [...],
  organization: { name: "J&B Enterprise LLC" },
});
// surfaces.sitemap, surfaces.robots, surfaces.aiTxt, …
```

## License

Apache 2.0.
