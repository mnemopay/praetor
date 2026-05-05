# @kpanks/design

PraetorTokens + PraetorRenderer + PraetorVisualQA — the Praetor design
system as one package. Charter authors describe a scene with typed
tokens; the renderer emits the right artifact for the requested target
(html, markdown, og-image, email-html, react-remotion, hyperframes-html,
video-mp4, three-scene, claude-skill); the QA suite fails any output
that violates DESIGN.md.

## Install

```bash
npm install @kpanks/design
```

## Token system

```ts
import { tokens, tokensToCssVariables } from "@kpanks/design";

const css = tokensToCssVariables(); // -> :root { --bg: #050510; ... }
tokens.color.accent;                 // "#a5b4fc"
tokens.motion.ease;                  // "cubic-bezier(0.22, 1, 0.36, 1)"
```

Subpath import is also supported (and is what generated Remotion
output uses):

```ts
import { tokens } from "@kpanks/design/tokens";
```

## Render a scene

```ts
import {
  render,
  defaultAccessibility,
  defaultResponsive,
  tokens,
  type PraetorScene,
} from "@kpanks/design";

const scene: PraetorScene = {
  id: "hero",
  tokens,
  layers: [
    {
      id: "headline",
      kind: "html",
      zIndex: 1,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["Native"] },
          { kind: "h1", children: ["Praetor runs your charters."] },
          { kind: "cta-pill", props: { href: "/start" }, children: ["Run a charter"] },
        ],
      },
    },
  ],
  accessibility: defaultAccessibility(),
  responsive: defaultResponsive(),
  assets: [],
  targets: ["html", "markdown", "og-image", "email-html"],
};

const result = render(scene, "html");
// result.files: DesignFile[]    — emitted artifacts
// result.warnings: RenderWarning[] — voice / ease / missing-token diagnostics
```

## Visual QA

```ts
import { audit, passes, formatFindings } from "@kpanks/design";

const findings = audit({ body: html, kind: "html" });
if (!passes({ body: html, kind: "html" })) {
  console.error(formatFindings(findings));
  process.exit(1);
}
```

The audit fails (severity `fatal`) on:

1. Forbidden voice (`revolutionize`, `next-gen`, `AI-powered`, …)
2. Non-Praetor ease curves
3. Tailwind utility classes / shadcn / Radix hints
4. Forbidden fonts (Roboto, Open Sans, …)
5. Square buttons (DESIGN.md mandates pills only)
6. Transitions without a `prefers-reduced-motion` override
7. Light-theme background leaks

## Design pack helpers

`DesignPack` exposes ad-hoc emitters for Spline, HTML-in-Canvas-3D,
Hypeframes, Remotion, and the UGC pipeline. Use it when you need a
single-shot artifact rather than a full PraetorScene.

```ts
import { DesignPack } from "@kpanks/design";

const pack = new DesignPack();
pack.renderSplinePreset("godly-3d-orb");
pack.renderHtmlInCanvas3D({ title: "BizSuite", cards: [...], rings: true });
```

## License

Apache-2.0.
