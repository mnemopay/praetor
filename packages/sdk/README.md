# @kpanks/sdk

Aggregate SDK for the Praetor API economy. Re-exports the most common
package surfaces so a downstream consumer can `import { … } from
"@kpanks/sdk"` without picking through every namespaced package.

## Install

```bash
npm install @kpanks/sdk
```

## Usage

```ts
import {
  Praetor3D,
  PraetorBrowser,
  PraetorVoice,
  Scraper,
  Article12AuditChain,
} from "@kpanks/sdk";
```

For fine-grained control / smaller bundles, depend on the individual
packages directly (`@kpanks/browser`, `@kpanks/scrape`, etc.).

## License

Apache 2.0.
