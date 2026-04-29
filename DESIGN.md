# Praetor Design System

## 1. Visual Theme & Atmosphere

Praetor is the charter-driven mission runtime for AI agents — the design must feel **engineered, not designed**. Pattern B (Linear / Vercel / engineer's site) — *not* an agency-look studio site (godly.website style). Dark-mode-first. Motion is essential, but disciplined: it carries information, never decoration.

The dominant palette is near-black (`#050510`) with surface elevation through subtle navy gradients. The accent is indigo-violet (`#a5b4fc`) — a single brand voice repeated across CTA pills, link hovers, particle-ring hero gradient, and the brand dot. A warm amber (`#fde68a`) and soft mint (`#86efac`) live exclusively as italic-serif emphasis and "live" status, respectively.

The hero is a Three.js particle ring (1800 points, gradient violet → cyan, low-power pointer-driven camera lerp) sitting behind a glass-card stack. Smooth scroll comes from Lenis 1.x (`lerp: 0.1`, `autoRaf: true`). Every transition uses **`cubic-bezier(0.22, 1, 0.36, 1)`** — the only ease curve allowed.

**Key Characteristics:**
- Dark-mode only (no light theme)
- Single hero motion piece — never more than one Three.js scene per page
- Lenis smooth scroll + IntersectionObserver `.reveal` with cascading delays (`.reveal-d1`–`.reveal-d4`)
- `prefers-reduced-motion` always overrides — reveal becomes instant, particles freeze
- **No webcam.** The Praetor `DesignPack` `faceParallax` is opt-in only (`=== true`). Default is off. Never silently call `getUserMedia`.

## 2. Color Palette & Roles

### Background Surfaces
- **`--bg`** (`#050510`): Page background, hero behind the canvas.
- **`--surface`** (`#0b0b18`): Cards, ledger stream, code blocks — base elevation.
- **`--surface2`** (`#11112a`): Stage cards, hovered list rows — second elevation.
- **`--border`** (`#1d1d3a`): All hairlines, card outlines, dividers.

### Text
- **`--text`** (`#e8e8f0`): Body copy, headings, hero h1.
- **`--muted`** (`#7d7d9c`): Captions, eyebrow labels, lede paragraph, ledger timestamps.

### Accents (use sparingly)
- **`--accent`** (`#a5b4fc`): Indigo-violet — primary CTA pill, brand dot, link hover, ledger event keyword, particle inner color. Single brand voice — do not introduce a second indigo.
- **`--accent2`** (`#fde68a`): Warm amber — italic-serif emphasis on h1/h2 (`em` tag), nothing else.
- **`--accent3`** (`#86efac`): Mint — live-status pill (`gate` element) and active-charter rows. Never as text body color.

## 3. Typography

```
--sans:  "Inter Variable", -apple-system, BlinkMacSystemFont, sans-serif
--serif: "Source Serif 4", "Source Serif Pro", Georgia, serif   (italic only)
--mono:  "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace
```

- **Body:** 16px / 1.55, `--sans`, weight 400, color `--text`.
- **H1:** clamp(40px, 6vw, 88px), `--sans`, weight 600, letter-spacing -0.02em. Words wrapped in `<em>` flip to `--serif italic` weight 500 with the amber→indigo gradient.
- **H2:** clamp(28px, 3.4vw, 44px), same `em` treatment.
- **Lede:** 18px, `--muted`, max-width 680px.
- **Eyebrow / labels:** 12px uppercase, letter-spacing 0.16em, weight 600, `--muted`.
- **Code / ledger / numerics:** `--mono`, 13–14px.

The italic serif is **only ever** for the gradient `<em>` inside h1/h2/blockquote — never for body copy, never for buttons, never for nav links.

## 4. Motion Rules

**The single ease curve** — `cubic-bezier(0.22, 1, 0.36, 1)` — is exposed as `--ease` in CSS and applied to *every* transition. Linear easing is forbidden. No bounces, no overshoots.

**Lenis 1.x** (loaded as ESM via importmap from `cdn.jsdelivr.net/npm/lenis@1.1.13/+esm`):
```js
new Lenis({ lerp: 0.1, duration: 1.2, smoothWheel: true, autoRaf: true });
```

**IntersectionObserver reveal:**
```css
.reveal      { opacity: 0; transform: translateY(28px); transition: opacity 0.9s var(--ease), transform 0.9s var(--ease); }
.reveal.in   { opacity: 1; transform: translateY(0); }
.reveal-d1   { transition-delay: 0.06s; }
.reveal-d2   { transition-delay: 0.12s; }
.reveal-d3   { transition-delay: 0.18s; }
.reveal-d4   { transition-delay: 0.24s; }

@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
}
```

Trigger with `rootMargin: "0px 0px -8% 0px"`, threshold 0.

**Three.js hero ring:**
- 1800 `Points`, additive blending, soft point texture
- Gradient indigo `#a5b4fc` → cyan `#67e8f9`, mixed by radial distance
- Pointer drives camera target lerp, `lerp(0.04)` per frame
- Resize handler updates renderer + camera aspect
- Inner sphere: `MeshBasicMaterial` violet `#312e81`, opacity 0.18, additive — gives the depth glow

Never run more than one Three.js scene at a time. Never autoplay video on the landing.

**Hover transitions:**
- Buttons: `transform: translateY(-2px)`, `box-shadow` deepens, 0.5s `--ease`.
- Cards: `border-color` shifts to `rgba(165,180,252,.35)`, 0.5s `--ease`.

## 5. Layout

- Max content width: 1280px, centered, 24px gutter (mobile) → 48px (≥1024px).
- Section vertical rhythm: 96px top + 96px bottom (mobile 64+64).
- Cards: 18px border-radius standard, 18px padding.
- Backdrop-filter on the fixed nav: `blur(14px) saturate(140%)`, bg `rgba(5,5,16,0.72)`.
- Glass cards: `rgba(15,23,42,0.78)` background + `blur(14px)` backdrop-filter + `1px solid rgba(165,180,252,.25)` border.

## 6. Components

### Brand mark
A single 8×8px `--accent` dot animated with a 2.4s ease-in-out pulse. Goes to the left of the wordmark in the nav. Never use a logo lockup that doesn't include the dot.

### CTA pill
```
background: var(--accent); color: #0a0a18; padding: 8px 14px;
border-radius: 999px; font-size: 13px; font-weight: 600;
```
Pill shape only. No square buttons, no outlined buttons.

### Stage card (charter stages, package list, etc.)
Linear-gradient `--surface` → `--surface2` background, 1px `--border`, 18px radius, hover lifts 4px and brightens border to `rgba(165,180,252,.35)`. Number eyebrow (`--mono` 12px `--muted`) above the heading.

### Live ledger stream
JetBrains Mono 13px on `#080814`, `--border` outline. Each row is `[timestamp · event · agent · action]` with the event keyword in `--accent`. Mask-image vertical fade at top + bottom for the "infinite scroll" feel. Update via JS — never seed with static rows.

### Status gate (live indicator)
Pill with `rgba(134,239,172,.08)` background + `rgba(134,239,172,.25)` border, mint text, 12px uppercase, dot prefix. Use only when the indicator reflects real live state (npm version, build status, charter state) — never decorative.

## 7. Iconography

Lucide outlined icons, 1.5px stroke, 20px default size. Icons inherit `currentColor`. Never multi-color. Never filled. The only filled shape is the indigo brand dot.

## 8. Imagery

No stock photography on Praetor surfaces. The hero is the particle ring; supporting visuals are diagrams or live ledger streams. If a portrait is needed (founder, team page), use the same camera/lighting consistent with `feedback_reuse_existing_characters` (default = `mnemopay_narrator.png`). Never AI-generate a new face for Praetor.

## 9. Voice

Headlines: short, present-tense, declarative. "Praetor runs your charters." Not "Run charters with Praetor." Not "Praetor is a charter runtime."

Body copy: technical, specific, no hype. Numbers over adjectives. Use `<em>` to italic-emphasize the *one* word in a heading that earns it — usually a verb (`charter`, `prove`, `ship`).

Forbidden phrases: "revolutionize," "next-gen," "AI-powered" (it's all AI-powered, this is meaningless), "supercharge."

## 10. Generation contract

When regenerating Praetor surfaces (Stitch, Claude Code, hand-edits), the output **must**:

1. Pass `prefers-reduced-motion` audit (no transitions when set).
2. Use `var(--ease)` for every transition — no bare `ease`, `ease-out`, or numeric cubic-bezier.
3. Use Inter / Source Serif / JetBrains Mono — no Roboto, no Open Sans, no system-ui-only.
4. Keep the dark palette — no light surfaces, no light text on dark.
5. Never silently activate the camera. `faceParallax` is opt-in only.
6. Never introduce a second Three.js scene on the same page.
7. Never use a square button. Pills only.
8. Never use stock photos.

Any PR that violates these is a regression.
