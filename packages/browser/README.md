# @praetor/browser

DOM-first browser agent runtime for Praetor charters. Spawns / drives a real
Chromium via Chrome DevTools Protocol, returns a token-efficient compressed
accessibility tree on `snapshot()`, and emits `tool.start` / `tool.end`
events on the charter's ActivityBus.

## Install

```bash
npm install @praetor/browser
# Optional peer for the Playwright adapter:
npm install playwright-core
```

## Usage

```ts
import { PraetorBrowser, PlaywrightAdapter } from "@praetor/browser";

const browser = new PraetorBrowser();
browser.attachAdapter(new PlaywrightAdapter());

await browser.navigate("https://example.com");
const snap = await browser.snapshot();        // url, title, a11y tree, refs
await browser.click({ selector: "button.submit", label: "Submit" });
const png = await browser.screenshot({ fullPage: true });

await browser.close();
```

## Adapters

| Adapter | Notes |
|---|---|
| `PlaywrightAdapter` | Default. Lazy-loads `playwright-core`. |
| `MockBrowserAdapter` | Canned responses for tests. |
| `SandboxedBrowserAdapter` | Scaffold for CDP-over-Docker (browser inside a Praetor sandbox). |

The sandboxed adapter throws "not yet implemented" until the published
Praetor Chromium image lands; see the source for the full design.

## License

Apache 2.0.
