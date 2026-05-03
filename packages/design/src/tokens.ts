/**
 * PraetorTokens — DESIGN.md as typed exports.
 *
 * The single source of truth for every Praetor surface. Every renderer (HTML,
 * Remotion, OG, three-scene, godot-scene, email, markdown) consumes these
 * tokens; no emitter is allowed to inline a hex code, a font stack, an ease
 * curve, or a radius value.
 *
 * Editing this file is editing Praetor's identity. Pair every change with the
 * matching DESIGN.md edit — the visual-QA suite asserts the two stay aligned.
 */

/** The single ease curve. No bare `ease`, `ease-out`, or other cubic-bezier
 * values are permitted on Praetor surfaces — DESIGN.md §4 + §10.2. Renderers
 * must reference `tokens.motion.ease` literally. */
export const PRAETOR_EASE = "cubic-bezier(0.22, 1, 0.36, 1)" as const;

export interface ColorTokens {
  /** Page background, hero behind canvas. DESIGN.md §2. */
  bg: "#050510";
  /** Cards, ledger stream, code blocks — base elevation. */
  surface: "#0b0b18";
  /** Stage cards, hovered list rows — second elevation. */
  surface2: "#11112a";
  /** All hairlines, card outlines, dividers. */
  border: "#1d1d3a";
  /** Body copy, headings, hero h1. */
  text: "#e8e8f0";
  /** Captions, eyebrow labels, lede paragraph, ledger timestamps. */
  muted: "#7d7d9c";
  /** Primary brand: indigo-violet — single brand voice. */
  accent: "#a5b4fc";
  /** Warm amber — italic-serif emphasis on h1/h2 `<em>` only. */
  accent2: "#fde68a";
  /** Mint — live-status pill (`gate`) and active-charter rows only. */
  accent3: "#86efac";
  /** Particle ring outer color (cyan, gradient destination from accent). */
  particleOuter: "#67e8f9";
  /** Inner-sphere additive depth glow on the hero. */
  particleGlow: "#312e81";
}

export interface TypeStack {
  /** Headlines + body. */
  sans: '"Inter Variable", -apple-system, BlinkMacSystemFont, sans-serif';
  /** Italic emphasis ONLY (h1/h2/blockquote `<em>`). */
  serif: '"Source Serif 4", "Source Serif Pro", Georgia, serif';
  /** Code, ledger rows, numerics. */
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
}

/** A fluid font-size triple (`clamp(min, pref, max)`) — DESIGN.md §3. */
export interface FluidSize {
  min: string;
  pref: string;
  max: string;
}

export interface TypeScale {
  /** clamp(40px, 6vw, 88px), weight 600, tracking -0.02em. */
  h1: { size: FluidSize; weight: 600; tracking: "-0.02em" };
  /** clamp(28px, 3.4vw, 44px). */
  h2: { size: FluidSize; weight: 600; tracking: "-0.02em" };
  body: { sizePx: 16; lineHeight: 1.55; weight: 400 };
  /** Lede paragraph below h1, max-width 680px. */
  lede: { sizePx: 18; weight: 400; maxWidthPx: 680 };
  /** Eyebrow / labels — uppercase, +0.16em tracking. */
  eyebrow: { sizePx: 12; weight: 600; tracking: "0.16em"; transform: "uppercase" };
  /** Code, ledger rows. */
  mono: { sizePx: 13 };
}

/** Layout scale — DESIGN.md §5. */
export interface LayoutTokens {
  maxContentWidthPx: 1280;
  gutterMobilePx: 24;
  gutterDesktopPx: 48;
  /** Section vertical rhythm. */
  sectionPaddingMobilePx: 64;
  sectionPaddingDesktopPx: 96;
  /** Card border radius. */
  cardRadiusPx: 18;
  cardPaddingPx: 18;
  /** Pill / CTA radius (effectively infinite). */
  pillRadiusPx: 999;
}

/** Motion grammar — DESIGN.md §4. */
export interface MotionTokens {
  ease: typeof PRAETOR_EASE;
  /** IntersectionObserver `.reveal` opacity+translate transition. */
  revealMs: 900;
  /** Hover transitions on buttons + cards. */
  hoverMs: 500;
  /** Stagger delay between `.reveal-d1` … `.reveal-d4`. */
  staggerMs: 60;
  /** Lenis smooth-scroll config. */
  lenis: {
    lerp: 0.1;
    duration: 1.2;
    smoothWheel: true;
    autoRaf: true;
  };
  /** IntersectionObserver root margin — fires when 8% of section is past viewport bottom. */
  revealRootMargin: "0px 0px -8% 0px";
  /** Three.js hero ring config. */
  particleRing: {
    pointCount: 1800;
    pointerLerp: 0.04;
    innerSphereOpacity: 0.18;
  };
}

export interface ComponentTokens {
  /** 8×8 indigo brand dot, 2.4s ease-in-out pulse. */
  brandDot: {
    sizePx: 8;
    pulseSeconds: 2.4;
  };
  /** CTA pill — DESIGN.md §6.CTA. The only button shape allowed. */
  ctaPill: {
    paddingY: 8;
    paddingX: 14;
    radiusPx: 999;
    sizePx: 13;
    weight: 600;
    /** Text is always `#0a0a18` — near-black for accent-bg contrast. */
    foreground: "#0a0a18";
  };
  /** Stage card — gradient bg, hover lift, mono number eyebrow. */
  stageCard: {
    radiusPx: 18;
    paddingPx: 18;
    hoverLiftPx: 4;
    /** Border on hover — softened indigo at 35% alpha. */
    hoverBorder: "rgba(165,180,252,0.35)";
  };
  /** Live ledger stream. */
  ledger: {
    bg: "#080814";
    rowFontSizePx: 13;
    /** Vertical mask-image fade for the infinite-scroll feel. */
    fadeMaskTop: "linear-gradient(to bottom, transparent, black 8%, black 92%, transparent)";
  };
  /** Status gate (live indicator). */
  statusGate: {
    bg: "rgba(134,239,172,0.08)";
    border: "rgba(134,239,172,0.25)";
    sizePx: 12;
    transform: "uppercase";
  };
  /** Glass card — backdrop-filter + accent border. */
  glassCard: {
    bg: "rgba(15,23,42,0.78)";
    backdropFilter: "blur(14px)";
    border: "1px solid rgba(165,180,252,0.25)";
  };
  /** Fixed nav backdrop. */
  navBackdrop: {
    bg: "rgba(5,5,16,0.72)";
    backdropFilter: "blur(14px) saturate(140%)";
  };
}

export interface IconTokens {
  /** Lucide outlined icons only — DESIGN.md §7. Never multi-color, never filled. */
  family: "lucide-outline";
  strokePx: 1.5;
  defaultSizePx: 20;
  fill: "currentColor";
}

/** Voice rules — DESIGN.md §9. Used by the markdown renderer + PraetorVisualQA
 * lint to fail any output containing forbidden phrases. */
export interface VoiceTokens {
  /** Headlines short, present-tense, declarative. */
  headlineMode: "present-tense-declarative";
  /** Body copy: technical, specific, no hype. Numbers over adjectives. */
  bodyMode: "technical-specific";
  /** Italic-serif `<em>` is the only place the amber→indigo gradient is used. */
  emphasisMode: "italic-serif-em-gradient";
  forbiddenPhrases: readonly ["revolutionize", "next-gen", "AI-powered", "supercharge"];
}

export interface PraetorTokens {
  color: ColorTokens;
  typeStack: TypeStack;
  typeScale: TypeScale;
  layout: LayoutTokens;
  motion: MotionTokens;
  components: ComponentTokens;
  icons: IconTokens;
  voice: VoiceTokens;
}

export const tokens: PraetorTokens = {
  color: {
    bg: "#050510",
    surface: "#0b0b18",
    surface2: "#11112a",
    border: "#1d1d3a",
    text: "#e8e8f0",
    muted: "#7d7d9c",
    accent: "#a5b4fc",
    accent2: "#fde68a",
    accent3: "#86efac",
    particleOuter: "#67e8f9",
    particleGlow: "#312e81",
  },
  typeStack: {
    sans: '"Inter Variable", -apple-system, BlinkMacSystemFont, sans-serif',
    serif: '"Source Serif 4", "Source Serif Pro", Georgia, serif',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  },
  typeScale: {
    h1: { size: { min: "40px", pref: "6vw", max: "88px" }, weight: 600, tracking: "-0.02em" },
    h2: { size: { min: "28px", pref: "3.4vw", max: "44px" }, weight: 600, tracking: "-0.02em" },
    body: { sizePx: 16, lineHeight: 1.55, weight: 400 },
    lede: { sizePx: 18, weight: 400, maxWidthPx: 680 },
    eyebrow: { sizePx: 12, weight: 600, tracking: "0.16em", transform: "uppercase" },
    mono: { sizePx: 13 },
  },
  layout: {
    maxContentWidthPx: 1280,
    gutterMobilePx: 24,
    gutterDesktopPx: 48,
    sectionPaddingMobilePx: 64,
    sectionPaddingDesktopPx: 96,
    cardRadiusPx: 18,
    cardPaddingPx: 18,
    pillRadiusPx: 999,
  },
  motion: {
    ease: PRAETOR_EASE,
    revealMs: 900,
    hoverMs: 500,
    staggerMs: 60,
    lenis: { lerp: 0.1, duration: 1.2, smoothWheel: true, autoRaf: true },
    revealRootMargin: "0px 0px -8% 0px",
    particleRing: { pointCount: 1800, pointerLerp: 0.04, innerSphereOpacity: 0.18 },
  },
  components: {
    brandDot: { sizePx: 8, pulseSeconds: 2.4 },
    ctaPill: {
      paddingY: 8,
      paddingX: 14,
      radiusPx: 999,
      sizePx: 13,
      weight: 600,
      foreground: "#0a0a18",
    },
    stageCard: {
      radiusPx: 18,
      paddingPx: 18,
      hoverLiftPx: 4,
      hoverBorder: "rgba(165,180,252,0.35)",
    },
    ledger: {
      bg: "#080814",
      rowFontSizePx: 13,
      fadeMaskTop: "linear-gradient(to bottom, transparent, black 8%, black 92%, transparent)",
    },
    statusGate: {
      bg: "rgba(134,239,172,0.08)",
      border: "rgba(134,239,172,0.25)",
      sizePx: 12,
      transform: "uppercase",
    },
    glassCard: {
      bg: "rgba(15,23,42,0.78)",
      backdropFilter: "blur(14px)",
      border: "1px solid rgba(165,180,252,0.25)",
    },
    navBackdrop: {
      bg: "rgba(5,5,16,0.72)",
      backdropFilter: "blur(14px) saturate(140%)",
    },
  },
  icons: {
    family: "lucide-outline",
    strokePx: 1.5,
    defaultSizePx: 20,
    fill: "currentColor",
  },
  voice: {
    headlineMode: "present-tense-declarative",
    bodyMode: "technical-specific",
    emphasisMode: "italic-serif-em-gradient",
    forbiddenPhrases: ["revolutionize", "next-gen", "AI-powered", "supercharge"] as const,
  },
};

/** Emit the tokens as a `:root { --bg: ...; }` CSS block. Renderers consume
 * this when emitting HTML; never inline a hex code in a renderer. */
export function tokensToCssVariables(t: PraetorTokens = tokens): string {
  const lines = [
    "  --bg: " + t.color.bg + ";",
    "  --surface: " + t.color.surface + ";",
    "  --surface2: " + t.color.surface2 + ";",
    "  --border: " + t.color.border + ";",
    "  --text: " + t.color.text + ";",
    "  --muted: " + t.color.muted + ";",
    "  --accent: " + t.color.accent + ";",
    "  --accent2: " + t.color.accent2 + ";",
    "  --accent3: " + t.color.accent3 + ";",
    "  --sans: " + t.typeStack.sans + ";",
    "  --serif: " + t.typeStack.serif + ";",
    "  --mono: " + t.typeStack.mono + ";",
    "  --ease: " + t.motion.ease + ";",
    "  --reveal-ms: " + t.motion.revealMs + "ms;",
    "  --hover-ms: " + t.motion.hoverMs + "ms;",
    "  --stagger-ms: " + t.motion.staggerMs + "ms;",
    "  --max-w: " + t.layout.maxContentWidthPx + "px;",
    "  --gutter-mobile: " + t.layout.gutterMobilePx + "px;",
    "  --gutter-desktop: " + t.layout.gutterDesktopPx + "px;",
    "  --card-radius: " + t.layout.cardRadiusPx + "px;",
    "  --pill-radius: " + t.layout.pillRadiusPx + "px;",
  ];
  return ":root {\n" + lines.join("\n") + "\n}\n";
}

/** Lint a string of Praetor-emitted text against the voice rules. Returns
 * the matched forbidden phrases (case-insensitive); empty array = clean. */
export function lintVoice(text: string, t: PraetorTokens = tokens): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const phrase of t.voice.forbiddenPhrases) {
    if (lower.includes(phrase.toLowerCase())) hits.push(phrase);
  }
  return hits;
}

/** Lint a string of CSS for ease-curve violations. Any transition timing
 * function that isn't `var(--ease)` (or the canonical literal cubic-bezier)
 * is a regression. Returns the offending substrings; empty array = clean. */
export function lintEase(css: string): string[] {
  // Mask the legitimate forms first so substring scans can't false-positive
  // on `var(--ease)`, `--ease:`, or the canonical cubic-bezier literal.
  const cleaned = css
    .replace(/var\(--ease\)/g, "__OK_EASE__")
    .replace(/--ease\s*:/g, "__OK_EASE_DECL__:")
    .replace(/cubic-bezier\(\s*0\.22\s*,\s*1\s*,\s*0\.36\s*,\s*1\s*\)/g, "__OK_BEZIER__");

  const hits: string[] = [];
  const banned: RegExp[] = [
    /\btransition-timing-function\s*:\s*(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)\b/gi,
    /\btransition\b[^;{}]*?\b(ease|ease-in|ease-out|ease-in-out|linear)\b(?!-)/gi,
    /\banimation-timing-function\s*:\s*(ease|ease-in|ease-out|ease-in-out|linear)\b/gi,
    /\bcubic-bezier\(/gi,
  ];
  for (const re of banned) {
    const matches = cleaned.match(re) ?? [];
    for (const m of matches) hits.push(m.trim());
  }
  return hits;
}
