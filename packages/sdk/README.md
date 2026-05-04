# @praetor/sdk

Aggregate SDK for the Praetor API economy. Re-exports the most common
package surfaces so a downstream consumer can `import { … } from
"@praetor/sdk"` without picking through every namespaced package.

## Install

```bash
npm install @praetor/sdk
```

## Usage

```ts
import {
  Praetor3D,
  PraetorBrowser,
  PraetorVoice,
  Scraper,
  Article12AuditChain,
} from "@praetor/sdk";
```

For fine-grained control / smaller bundles, depend on the individual
packages directly (`@praetor/browser`, `@praetor/scrape`, etc.).

## License

Apache 2.0.
