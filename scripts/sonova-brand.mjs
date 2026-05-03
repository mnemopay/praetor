/**
 * Sonova Construction brand-token override.
 *
 * Praetor's default tokens are engineering-aesthetic dark (DESIGN.md). This
 * override lets the same renderer emit a construction-vertical light surface
 * with Sonova's red brand mark — same component contracts, different palette.
 *
 * Audience: a Plano homeowner whose roof just got destroyed by a hailstorm.
 * Voice: calm, expert, local, trustworthy. Headlines in Title Case. Full
 * sentences. No lowercase Twitter voice — this is a contractor's site.
 */

import { tokens as defaultTokens } from "../packages/design/dist/tokens.js";

export const sonovaTokens = {
  ...defaultTokens,
  color: {
    // Light warm surfaces — homeowner-friendly, prints well, looks credible.
    bg: "#fafaf7",
    surface: "#ffffff",
    surface2: "#f3efe9",
    border: "#e5dfd4",
    text: "#0f1115",
    muted: "#586068",
    // Sonova's brand red (from the business-card chevron mark).
    accent: "#c8202a",
    // Warm cream emphasis (replaces Praetor's amber italic gradient).
    accent2: "#f3c66b",
    // Trust-green for verified badges + reviews.
    accent3: "#1f8a4c",
    particleOuter: "#c8202a",
    particleGlow: "#1a1a1a",
  },
  typeStack: {
    // Source Serif gives a contractor-trustworthy editorial feel; Inter for
    // body + nav; JetBrains for the small print + numbers (license #s, BBB).
    sans: '"Inter Variable", -apple-system, BlinkMacSystemFont, sans-serif',
    serif: '"Source Serif 4", "Source Serif Pro", Georgia, serif',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  },
  components: {
    ...defaultTokens.components,
    ctaPill: {
      ...defaultTokens.components.ctaPill,
      // White text on the red brand pill.
      foreground: "#ffffff",
    },
    stageCard: {
      ...defaultTokens.components.stageCard,
      // Card hover-border deepens to a warm border tone.
      hoverBorder: "rgba(200,32,42,0.35)",
    },
    statusGate: {
      bg: "rgba(31,138,76,0.10)",
      border: "rgba(31,138,76,0.30)",
      sizePx: 12,
      transform: "uppercase",
    },
    glassCard: {
      bg: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(8px)",
      border: "1px solid rgba(15,17,21,0.10)",
    },
    navBackdrop: {
      bg: "rgba(255,255,255,0.94)",
      backdropFilter: "blur(10px) saturate(140%)",
    },
  },
  voice: {
    headlineMode: "present-tense-declarative",
    bodyMode: "technical-specific",
    emphasisMode: "italic-serif-em-gradient",
    // Construction-site voice forbids both AI-marketing slop AND
    // contractor-marketing cliches.
    forbiddenPhrases: [
      "revolutionize",
      "next-gen",
      "AI-powered",
      "supercharge",
      "world-class",
      "second to none",
      "one-stop shop",
      "your dream",
      "we go above and beyond",
    ],
  },
};
