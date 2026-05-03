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
    | "lede"
    | "eyebrow"
    | "p"
    | "cta-pill"
    | "stage-card"
    | "ledger-row"
    | "status-gate"
    | "image"
    | "splat-viewer"
    | "three-canvas"
    | "remotion-scene"
    | "code-block"
    | "list";
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

/** The full scene a charter hands the renderer. Tokens are required — every
 * renderer reads from this single token tree, never inline values. */
export interface PraetorScene {
  /** Charter-author-friendly id ("homepage-hero", "audit-report-2026-05-03"). */
  id: string;
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
