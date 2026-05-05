/**
 * Public-surface contract: every primitive a charter author needs must be
 * importable from `@kpanks/design` (the package entry). If a re-export goes
 * missing, this fails loudly before downstream packages ever try to consume.
 *
 * Subpath imports (`@kpanks/design/tokens`, etc.) are exercised directly via
 * `./tokens.js`, `./visual-qa.js`, `./spec.js` — those are the same module
 * graph the package.json `exports` map advertises after build.
 */

import { describe, it, expect } from "vitest";
import * as designIndex from "./index.js";
import {
  PRAETOR_EASE,
  tokens,
  tokensToCssVariables,
  lintVoice,
  lintEase,
  render,
  audit,
  passes,
  formatFindings,
  defaultAccessibility,
  defaultResponsive,
  DesignPack,
  type PraetorScene,
  type PraetorTokens,
  type RendererTarget,
  type RenderResult,
  type RenderWarning,
  type DesignFile,
  type QaFinding,
  type QaInput,
} from "./index.js";

describe("public surface — token primitives", () => {
  it("PRAETOR_EASE is the canonical curve", () => {
    expect(PRAETOR_EASE).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
  });
  it("tokens has the expected shape", () => {
    expect(tokens.color.bg).toBe("#050510");
    expect(tokens.layout.pillRadiusPx).toBe(999);
    expect(tokens.motion.ease).toBe(PRAETOR_EASE);
  });
  it("tokensToCssVariables emits a :root block", () => {
    const css = tokensToCssVariables();
    expect(css.startsWith(":root {")).toBe(true);
    expect(css).toContain("--ease: cubic-bezier(0.22, 1, 0.36, 1)");
  });
  it("lintVoice / lintEase are exposed", () => {
    expect(lintVoice("Praetor runs your charters.")).toEqual([]);
    expect(lintVoice("Will revolutionize agents.")).toEqual(["revolutionize"]);
    expect(lintEase("a { transition: opacity 200ms var(--ease); }")).toEqual([]);
    expect(lintEase("a { transition: opacity 200ms ease-out; }").length).toBeGreaterThan(0);
  });
});

describe("public surface — renderer + visual-qa", () => {
  function scene(): PraetorScene {
    return {
      id: "surface-hero",
      tokens,
      layers: [
        {
          id: "hero",
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
      targets: ["html"],
    };
  }

  it("render(scene, 'html') yields a clean artifact that passes visual-qa", () => {
    const result: RenderResult = render(scene(), "html");
    expect(result.files).toHaveLength(1);
    const html = result.files[0]!.contents;
    expect(passes({ body: html, kind: "html" })).toBe(true);
    expect(audit({ body: html, kind: "html" }).filter((f) => f.severity === "fatal")).toEqual([]);
  });

  it("formatFindings folds findings into a printable block", () => {
    const findings: QaFinding[] = audit({
      body: '<style>body{background:#fff;}</style>',
      kind: "html",
    });
    const text = formatFindings(findings);
    expect(text).toContain("dark-only");
  });

  it("RendererTarget / DesignFile / RenderWarning types are exported (compile-time)", () => {
    const target: RendererTarget = "html";
    const file: DesignFile = { path: "x", contents: "y" };
    const warning: RenderWarning = { kind: "stub", message: "z" };
    expect(target).toBe("html");
    expect(file.path).toBe("x");
    expect(warning.kind).toBe("stub");
  });

  it("QaInput accepts every declared kind (compile-time)", () => {
    const inputs: QaInput[] = [
      { body: "", kind: "html" },
      { body: "", kind: "markdown" },
      { body: "", kind: "email-html" },
      { body: "", kind: "og-svg" },
      { body: "", kind: "css" },
    ];
    expect(inputs).toHaveLength(5);
  });
});

describe("public surface — DesignPack helpers stay reachable", () => {
  it("DesignPack class is a constructor", () => {
    const pack = new DesignPack();
    expect(pack.renderHtml({ type: "p", children: ["ok"] })).toBe("<p>ok</p>");
  });
});

describe("public surface — completeness sweep", () => {
  /**
   * Anything a charter author should be able to reach via
   * `import * from "@kpanks/design"`. Add a name here when you add a public
   * primitive — the test will fail loudly when the index re-export is missed.
   */
  const required = [
    // tokens
    "PRAETOR_EASE",
    "tokens",
    "tokensToCssVariables",
    "lintVoice",
    "lintEase",
    // renderer
    "render",
    // visual-qa
    "audit",
    "passes",
    "formatFindings",
    // spec defaults
    "defaultAccessibility",
    "defaultResponsive",
    // design pack
    "DesignPack",
    "resolveSplinePreset",
    "listSplinePresets",
  ] as const;

  it.each(required)("re-exports %s from package entry", (name) => {
    expect(name in designIndex).toBe(true);
    expect(typeof (designIndex as Record<string, unknown>)[name]).not.toBe("undefined");
  });

  it("PraetorTokens type is structurally compatible", () => {
    // Compile-time only — if the type re-export breaks, this file won't compile.
    const t: PraetorTokens = tokens;
    expect(t.color.accent).toBe("#a5b4fc");
  });
});
