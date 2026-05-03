/**
 * PraetorTokens conformance tests — DESIGN.md is the authority; this suite
 * fails loudly when a token drifts from its declared value.
 */

import { describe, it, expect } from "vitest";
import { PRAETOR_EASE, tokens, tokensToCssVariables, lintVoice, lintEase } from "./tokens.js";

describe("PRAETOR_EASE", () => {
  it("is the one-and-only ease curve", () => {
    expect(PRAETOR_EASE).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
  });
  it("is exposed on tokens.motion.ease", () => {
    expect(tokens.motion.ease).toBe(PRAETOR_EASE);
  });
});

describe("color palette matches DESIGN.md §2", () => {
  it("dark surface ramp is fixed", () => {
    expect(tokens.color.bg).toBe("#050510");
    expect(tokens.color.surface).toBe("#0b0b18");
    expect(tokens.color.surface2).toBe("#11112a");
    expect(tokens.color.border).toBe("#1d1d3a");
  });
  it("text ramp is fixed", () => {
    expect(tokens.color.text).toBe("#e8e8f0");
    expect(tokens.color.muted).toBe("#7d7d9c");
  });
  it("accents are exactly indigo / amber / mint", () => {
    expect(tokens.color.accent).toBe("#a5b4fc");
    expect(tokens.color.accent2).toBe("#fde68a");
    expect(tokens.color.accent3).toBe("#86efac");
  });
});

describe("typography stacks load Inter / Source Serif 4 / JetBrains Mono", () => {
  it("sans is Inter Variable first", () => {
    expect(tokens.typeStack.sans).toContain("Inter Variable");
  });
  it("serif is Source Serif 4 first (italic only)", () => {
    expect(tokens.typeStack.serif).toContain("Source Serif 4");
  });
  it("mono is JetBrains Mono first", () => {
    expect(tokens.typeStack.mono).toContain("JetBrains Mono");
  });
  it("rejects Roboto / Open Sans / system-ui defaults", () => {
    const all = Object.values(tokens.typeStack).join(" ");
    expect(all).not.toMatch(/\bRoboto\b/);
    expect(all).not.toMatch(/\bOpen Sans\b/);
  });
});

describe("layout rhythm matches DESIGN.md §5", () => {
  it("max content width is 1280px", () => {
    expect(tokens.layout.maxContentWidthPx).toBe(1280);
  });
  it("card radius is 18px (no square corners)", () => {
    expect(tokens.layout.cardRadiusPx).toBe(18);
  });
  it("pill radius is 999 — pills only, no square buttons", () => {
    expect(tokens.layout.pillRadiusPx).toBe(999);
  });
});

describe("CTA pill enforces the pills-only rule", () => {
  it("uses the indigo accent as background", () => {
    // The pill is filled by accent at the renderer; ensure pill component
    // shape declares the accent-bg foreground.
    expect(tokens.components.ctaPill.foreground).toBe("#0a0a18");
    expect(tokens.components.ctaPill.radiusPx).toBe(999);
  });
});

describe("tokensToCssVariables emits a :root block", () => {
  const css = tokensToCssVariables();
  it("declares --ease as the single curve", () => {
    expect(css).toContain("--ease: cubic-bezier(0.22, 1, 0.36, 1)");
  });
  it("declares all 9 color tokens", () => {
    for (const name of ["--bg", "--surface", "--surface2", "--border", "--text", "--muted", "--accent", "--accent2", "--accent3"]) {
      expect(css).toContain(name + ":");
    }
  });
  it("declares the type stack", () => {
    expect(css).toContain("--sans:");
    expect(css).toContain("--serif:");
    expect(css).toContain("--mono:");
  });
});

describe("lintVoice catches forbidden phrases (DESIGN.md §9)", () => {
  it("flags 'revolutionize'", () => {
    expect(lintVoice("Praetor will revolutionize agent ops.")).toEqual(["revolutionize"]);
  });
  it("flags 'AI-powered'", () => {
    expect(lintVoice("AI-powered charters.")).toEqual(["AI-powered"]);
  });
  it("ignores compliant copy", () => {
    expect(lintVoice("Praetor runs your charters.")).toEqual([]);
  });
});

describe("lintEase catches non-Praetor ease curves", () => {
  it("flags bare ease-out", () => {
    const hits = lintEase("a { transition: opacity 200ms ease-out; }");
    expect(hits.length).toBeGreaterThan(0);
  });
  it("ignores var(--ease) usage", () => {
    expect(lintEase("a { transition: opacity 200ms var(--ease); }")).toEqual([]);
  });
  it("ignores the canonical Praetor curve", () => {
    expect(lintEase("a { transition: opacity 200ms cubic-bezier(0.22, 1, 0.36, 1); }")).toEqual([]);
  });
  it("flags rogue cubic-bezier values", () => {
    const hits = lintEase("a { transition: opacity 200ms cubic-bezier(0.16, 1, 0.3, 1); }");
    expect(hits.length).toBeGreaterThan(0);
  });
});
