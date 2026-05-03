/**
 * PraetorScene — the typed scene-description format every Praetor charter
 * speaks. A scene is renderer-agnostic; the renderer dispatch (renderer.ts)
 * picks the target and emits the artifact.
 *
 * Charter authors never import a third-party UI library. They build a
 * PraetorScene with PraetorTokens-aware nodes; the renderer owns every pixel.
 */

import type { PraetorTokens } from "./tokens.js";

/** Every render target Praetor's design pack supports. Adding a target = a
 * new file under `targets/` plus a switch arm in renderer.ts. */
export type RendererTarget =
  | "html"
  | "react-remotion"
  | "hyperframes-html"
  | "og-image"
  | "video-mp4"
  | "three-scene"
  | "spark-splat"
  | "godot-scene"
  | "email-html"
  | "markdown";

/** A single emitted file. Renderers return one or more of these. */
export interface DesignFile {
  path: string;
  contents: string;
  /** Binary payload when the renderer writes a non-text artifact (PNG, MP4, .splat). */
  bytes?: Uint8Array;
}

/** What the renderer dispatch returns. */
export interface RenderResult {
  target: RendererTarget;
  files: DesignFile[];
  /** Diagnostics (voice/ease/contrast hits etc). Empty array = clean. */
  warnings: RenderWarning[];
}

export interface RenderWarning {
  kind: "voice" | "ease" | "contrast" | "missing-token" | "unknown-node" | "stub";
  message: string;
  /** Where in the spec the issue originated. */
  pointer?: string;
}

/** A node in the layer's content tree. Token references are encoded as
 * `${tokenPath}` placeholders so renderers substitute consistently. */
export interface SceneNode {
  /** A node kind the renderer knows how to emit. Unknown kinds raise
   * an `unknown-node` warning and the dispatch keeps going. */
  kind:
    | "section"
    | "hero"
    | "h1"
    | "h2"
    | "h3"
    | "lede"
    | "eyebrow"
    | "p"
    | "em"
    | "cta-pill"
    | "stage-card"
    | "ledger-row"
    | "status-gate"
    | "image"
    | "splat-viewer"
    | "three-canvas"
    | "remotion-scene"
    | "code"
    | "code-block"
    | "list"
    | "li"
    | "sticky-nav"
    | "image-hero"
    | "video-hero"
    | "before-after"
    | "map-embed"
    | "marquee-strip"
    | "glass-card"
    | "accordion"
    | "accordion-item"
    | "progressive-cards"
    | "carousel"
    | "review-card"
    | "stars";
  /** Display props — colors, sizes, etc resolve to PraetorTokens at render
   * time. Renderers reject any inline hex codes. */
  props?: Record<string, unknown>;
  /** Children nodes or leaf text. Strings pass through after voice-lint. */
  children?: (SceneNode | string)[];
  /** Optional motion attachment — applied as `.reveal` + delay class. */
  motion?: {
    enter?: "reveal-d1" | "reveal-d2" | "reveal-d3" | "reveal-d4" | "reveal";
  };
}

export interface CompositionLayer {
  id: string;
  /** Layer kind controls which target subsystem renders it. */
  kind: "html" | "three" | "spark-splat" | "video" | "css3d" | "og-image";
  zIndex: number;
  /** Optional CSS blend-mode for the composite. */
  blendMode?: "normal" | "screen" | "overlay" | "multiply" | "lighten";
  pointerEvents?: "auto" | "none";
  /** Per-layer budget — the renderer warns when an artifact exceeds it. */
  budget?: { maxBytes?: number; maxFps?: number };
  /** Content tree for `html` / `css3d` layers; ignored for `three`/`spark-splat`/`video`. */
  content?: SceneNode;
  /** External-asset URL for `three`/`spark-splat`/`video` layers. */
  assetUrl?: string;
}

export interface AccessibilityConstraints {
  wcag: "2.2-AA";
  /** Reduced-motion compliance is mandatory on Praetor. */
  reducedMotion: "honor";
  focusVisible: { thicknessPx: number; color: string; offsetPx: number };
  contrast: { bodyMin: number; largeMin: number };
}

export interface ResponsiveConstraints {
  /** Breakpoint widths. */
  breakpoints: { mobile: number; tablet: number; desktop: number };
  /** Maximum content width at each breakpoint (px). */
  contentMax: { mobile: number; tablet: number; desktop: number };
}

export interface AssetProvenance {
  /** Where the asset came from (URL, generator, file path). */
  source: string;
  /** SPDX-style license identifier or "proprietary". */
  license: string;
  /** Attribution text required by the asset's license, if any. */
  attribution?: string;
  /** SHA-256 of the asset bytes; renderers fail loudly on hash mismatch. */
  contentHash?: string;
}

/** Optional video-composition block for react-remotion + video-mp4 targets. */
export interface VideoComposition {
  /** Frame rate (typically 30 or 60). */
  fps: number;
  /** Total duration in frames. */
  durationInFrames: number;
  /** Width × height in pixels (1080×1920 for 9:16, 1920×1080 for 16:9). */
  width: number;
  height: number;
  /** Optional per-scene clipping. Each entry maps a layer to a frame window. */
  cuts?: Array<{
    /** Layer id from `scene.layers`. */
    layerId: string;
    /** Start frame (inclusive). */
    from: number;
    /** End frame (exclusive). */
    to: number;
  }>;
}

/** Optional hyperframes-composition block for hyperframes-html target. */
export interface HyperframesComposition {
  /** Default per-frame duration in milliseconds when a layer doesn't set its own. */
  defaultDurationMs: number;
  /** Loop the sequence after the last frame. */
  loop?: boolean;
  /** Optional per-layer overrides (`{ layerId: { startMs, durationMs } }`). */
  schedule?: Record<string, { startMs: number; durationMs: number }>;
}

/** SEO + share metadata. Renderers emit `<title>`, `<meta name="description">`,
 * Open Graph, Twitter Card, and JSON-LD blocks from this. Required for the
 * html target so we don't ship a marketing surface with no metadata. */
export interface SceneMeta {
  /** `<title>` tag content. */
  title: string;
  /** `<meta name="description">`. Keep ≤160 chars for SERP safety. */
  description: string;
  /** Canonical URL the page will be deployed at. */
  canonicalUrl?: string;
  /** Author name (defaults to "Praetor"). */
  author?: string;
  /** Open Graph image URL — falls back to the og-image SVG file the renderer also emits. */
  ogImageUrl?: string;
  /** Site name for og:site_name. */
  siteName?: string;
  /** Optional JSON-LD blocks to inject verbatim. */
  jsonLd?: Record<string, unknown>[];
  /** Robots directive — defaults to `index, follow, max-image-preview:large`. */
  robots?: string;
}

/** The full scene a charter hands the renderer. Tokens are required — every
 * renderer reads from this single token tree, never inline values. */
export interface PraetorScene {
  /** Charter-author-friendly id ("homepage-hero", "audit-report-2026-05-03"). */
  id: string;
  /** SEO + share metadata. Required when the html target ships to production. */
  meta?: SceneMeta;
  /** Token tree — usually `tokens` from ./tokens, occasionally a brand override. */
  tokens: PraetorTokens;
  /** Layers composited from low to high zIndex. */
  layers: CompositionLayer[];
  accessibility: AccessibilityConstraints;
  responsive: ResponsiveConstraints;
  /** Provenance for every external asset referenced by the scene. */
  assets: AssetProvenance[];
  /** Targets this scene supports; the renderer rejects any other target. */
  targets: RendererTarget[];
  /** Required when `targets` includes `react-remotion` or `video-mp4`. */
  video?: VideoComposition;
  /** Required when `targets` includes `hyperframes-html`. */
  hyperframes?: HyperframesComposition;
}

/** Sensible defaults so charter authors don't have to wire everything. */
export function defaultAccessibility(): AccessibilityConstraints {
  return {
    wcag: "2.2-AA",
    reducedMotion: "honor",
    focusVisible: { thicknessPx: 2, color: "#a5b4fc", offsetPx: 2 },
    contrast: { bodyMin: 4.5, largeMin: 3.0 },
  };
}

export function defaultResponsive(): ResponsiveConstraints {
  return {
    breakpoints: { mobile: 360, tablet: 768, desktop: 1280 },
    contentMax: { mobile: 360, tablet: 720, desktop: 1280 },
  };
}
