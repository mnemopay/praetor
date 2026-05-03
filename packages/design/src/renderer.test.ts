/**
 * PraetorRenderer + PraetorVisualQA conformance tests.
 */

import { describe, it, expect } from "vitest";
import { tokens } from "./tokens.js";
import { render } from "./renderer.js";
import { defaultAccessibility, defaultResponsive, type PraetorScene } from "./spec.js";
import { audit, passes } from "./visual-qa.js";

function makeScene(overrides: Partial<PraetorScene> = {}): PraetorScene {
  return {
    id: "test-hero",
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
            { kind: "lede", children: ["Charter-driven. Fiscally gated. Audit-logged by default."] },
            { kind: "cta-pill", props: { href: "/start" }, children: ["Run a charter"] },
          ],
        },
      },
    ],
    accessibility: defaultAccessibility(),
    responsive: defaultResponsive(),
    assets: [],
    targets: ["html", "markdown", "og-image", "email-html"],
    ...overrides,
  };
}

describe("renderer.dispatch", () => {
  it("rejects targets not declared by the scene", () => {
    const scene = makeScene({ targets: ["html"] });
    const result = render(scene, "markdown");
    expect(result.files).toHaveLength(0);
    expect(result.warnings.some((w) => w.kind === "stub")).toBe(true);
  });
  it("returns a stub for declared-but-unimplemented targets", () => {
    const scene = makeScene({ targets: ["html", "video-mp4"] });
    const result = render(scene, "video-mp4");
    expect(result.files).toHaveLength(0);
    expect(result.warnings[0]?.kind).toBe("stub");
  });
});

describe("html target", () => {
  const result = render(makeScene(), "html");
  const html = result.files[0]?.contents ?? "";

  it("emits a single index.html", () => {
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toContain("index.html");
  });
  it("inlines tokens via :root variables", () => {
    expect(html).toContain("--bg: #050510");
    expect(html).toContain("--accent: #a5b4fc");
    expect(html).toContain("--ease: cubic-bezier(0.22, 1, 0.36, 1)");
  });
  it("uses the praetor type stack", () => {
    expect(html).toContain("Inter Variable");
    expect(html).toContain("Source Serif 4");
    expect(html).toContain("JetBrains Mono");
  });
  it("renders cta-pill with pill radius", () => {
    expect(html).toContain('class="cta-pill');
    expect(html).toContain("border-radius: 999px");
  });
  it("includes prefers-reduced-motion override", () => {
    expect(html).toContain("prefers-reduced-motion");
  });
  it("emits no warnings for a clean scene", () => {
    expect(result.warnings.filter((w) => w.kind === "voice" || w.kind === "ease")).toHaveLength(0);
  });
});

describe("markdown target", () => {
  const result = render(makeScene(), "markdown");
  const md = result.files[0]?.contents ?? "";
  it("emits .md", () => {
    expect(result.files[0]?.path.endsWith(".md")).toBe(true);
  });
  it("renders headings", () => {
    expect(md).toMatch(/^# Praetor runs your charters\.$/m);
  });
  it("renders cta as link", () => {
    expect(md).toContain("[Run a charter](/start)");
  });
  it("flags forbidden voice", () => {
    const dirty = makeScene({
      layers: [{ id: "x", kind: "html", zIndex: 1, content: { kind: "p", children: ["Praetor will revolutionize your stack."] } }],
    });
    const r = render(dirty, "markdown");
    expect(r.warnings.some((w) => w.kind === "voice")).toBe(true);
  });
});

describe("og-image target", () => {
  const result = render(makeScene(), "og-image");
  const svg = result.files[0]?.contents ?? "";
  it("emits og.svg", () => {
    expect(result.files[0]?.path.endsWith("og.svg")).toBe(true);
  });
  it("uses the bg + accent tokens", () => {
    expect(svg).toContain("#050510");
    expect(svg).toContain("#a5b4fc");
  });
  it("includes the headline text", () => {
    expect(svg).toContain("Praetor runs your charters.");
  });
});

describe("email-html target", () => {
  const result = render(makeScene(), "email-html");
  const email = result.files[0]?.contents ?? "";
  it("uses inline styles (no <style> block dependency for clients)", () => {
    expect(email).toContain('style="display:inline-block;background:#a5b4fc');
  });
  it("uses the table-based layout for email-client compatibility", () => {
    expect(email).toContain('<table role="presentation"');
  });
});

describe("scene audit", () => {
  it("flags multiple three-scene layers", () => {
    const scene = makeScene({
      layers: [
        { id: "a", kind: "three", zIndex: 0, assetUrl: "x" },
        { id: "b", kind: "three", zIndex: 1, assetUrl: "y" },
      ],
      assets: [
        { source: "x", license: "MIT" },
        { source: "y", license: "MIT" },
      ],
    });
    const r = render(scene, "html");
    expect(r.warnings.some((w) => w.message.includes("forbids more than one"))).toBe(true);
  });
  it("flags missing provenance entries", () => {
    const scene = makeScene({
      layers: [{ id: "a", kind: "spark-splat", zIndex: 0, assetUrl: "https://example/scene.rad" }],
    });
    const r = render(scene, "html");
    expect(r.warnings.some((w) => w.kind === "missing-token")).toBe(true);
  });
});

describe("visual-qa", () => {
  it("passes a clean praetor html string", () => {
    const html = render(makeScene(), "html").files[0]!.contents;
    const findings = audit({ body: html, kind: "html" });
    const fatals = findings.filter((f) => f.severity === "fatal");
    expect(fatals).toEqual([]);
    expect(passes({ body: html, kind: "html" })).toBe(true);
  });
  it("rejects tailwind utility classes", () => {
    const f = audit({
      body: '<style>body{background:#050510;color:#e8e8f0;font-family:Inter;}@media (prefers-reduced-motion: reduce){}</style><div class="flex p-4 text-lg bg-slate-900 rounded-md shadow-md">x</div>',
      kind: "html",
    });
    expect(f.some((x) => x.rule === "no-tailwind")).toBe(true);
  });
  it("rejects shadcn / radix hints", () => {
    const f = audit({
      body: '<style>body{background:#050510;}</style><button data-state="open" data-radix-slot>x</button>',
      kind: "html",
    });
    expect(f.some((x) => x.rule === "no-shadcn")).toBe(true);
  });
  it("rejects forbidden fonts", () => {
    const f = audit({
      body: 'body { background: #050510; color: #e8e8f0; font-family: "Roboto", sans-serif; transition: opacity 200ms var(--ease); } @media (prefers-reduced-motion: reduce) {}',
      kind: "css",
    });
    expect(f.some((x) => x.rule === "no-roboto")).toBe(true);
  });
  it("rejects light theme background", () => {
    const f = audit({
      body: 'body { background: #ffffff; color: #111; font-family: "Inter Variable"; transition: opacity 200ms var(--ease); } @media (prefers-reduced-motion: reduce) {}',
      kind: "html",
    });
    expect(f.some((x) => x.rule === "dark-only")).toBe(true);
  });
  it("rejects square buttons", () => {
    const f = audit({
      body: 'body { background: #050510; color: #e8e8f0; font-family: "Inter Variable"; transition: opacity 200ms var(--ease); } button { border-radius: 4px; } @media (prefers-reduced-motion: reduce) {}',
      kind: "css",
    });
    expect(f.some((x) => x.rule === "pills-only")).toBe(true);
  });
  it("rejects transitions without reduced-motion override", () => {
    const f = audit({
      body: 'body { background: #050510; color: #e8e8f0; font-family: "Inter Variable"; transition: opacity 200ms var(--ease); }',
      kind: "css",
    });
    expect(f.some((x) => x.rule === "reduced-motion")).toBe(true);
  });
});
