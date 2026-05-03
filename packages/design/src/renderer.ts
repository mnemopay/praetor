/**
 * PraetorRenderer — the dispatch layer.
 *
 * `render(scene, target)` picks the right native emitter and hands back a
 * RenderResult. Every emitter is Praetor-native; external runtimes (Remotion,
 * Spark, Spline) are export targets only — Praetor owns the scene contract,
 * the renderer, and the diagnostics.
 *
 * Today's targets implemented natively: html, markdown, og-image (svg
 * placeholder rendered to text), email-html.
 *
 * Stubbed: react-remotion, hyperframes-html, video-mp4, three-scene,
 * spark-splat, godot-scene. These return a typed `stub` warning and an empty
 * file list so charter authors see the gap rather than a crash.
 */

import { tokens as defaultTokens, lintVoice, lintEase, tokensToCssVariables, type PraetorTokens } from "./tokens.js";
import type {
  PraetorScene,
  RendererTarget,
  RenderResult,
  RenderWarning,
  CompositionLayer,
  SceneNode,
  DesignFile,
} from "./spec.js";

/** Public entry. Charter authors call this; routing is internal. */
export function render(scene: PraetorScene, target: RendererTarget): RenderResult {
  if (!scene.targets.includes(target)) {
    return {
      target,
      files: [],
      warnings: [{ kind: "stub", message: `scene "${scene.id}" does not declare target "${target}"`, pointer: "scene.targets" }],
    };
  }
  switch (target) {
    case "html":
      return renderHtml(scene);
    case "markdown":
      return renderMarkdown(scene);
    case "og-image":
      return renderOgImage(scene);
    case "email-html":
      return renderEmailHtml(scene);
    default:
      return {
        target,
        files: [],
        warnings: [{
          kind: "stub",
          message: `target "${target}" is declared by spec but not yet emitted natively. shipping next in @praetor/design.`,
          pointer: "renderer.dispatch",
        }],
      };
  }
}

/* ---------- HTML target -------------------------------------------------- */

function renderHtml(scene: PraetorScene): RenderResult {
  const t = scene.tokens;
  const cssVars = tokensToCssVariables(t);
  const baseCss = renderBaseStylesheet(t);
  const body = scene.layers
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((layer) => renderLayer(layer, t))
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(scene.id)}</title>
  <style>
${cssVars}
${baseCss}
  </style>
</head>
<body class="praetor">
${body}
</body>
</html>
`;

  const warnings: RenderWarning[] = [];
  warnings.push(...auditScene(scene));
  for (const easeHit of lintEase(html)) {
    warnings.push({ kind: "ease", message: `non-Praetor ease curve: ${easeHit}`, pointer: "renderer.html" });
  }

  return { target: "html", files: [{ path: `${scene.id}/index.html`, contents: html }], warnings };
}

function renderBaseStylesheet(t: PraetorTokens): string {
  return `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: var(--sans); font-size: ${t.typeScale.body.sizePx}px; line-height: ${t.typeScale.body.lineHeight}; }
.praetor { min-height: 100vh; }
section { padding: ${t.layout.sectionPaddingDesktopPx}px ${t.layout.gutterDesktopPx}px; max-width: ${t.layout.maxContentWidthPx}px; margin: 0 auto; }
@media (max-width: 768px) {
  section { padding: ${t.layout.sectionPaddingMobilePx}px ${t.layout.gutterMobilePx}px; }
}
h1 { font-family: var(--sans); font-weight: ${t.typeScale.h1.weight}; letter-spacing: ${t.typeScale.h1.tracking}; font-size: clamp(${t.typeScale.h1.size.min}, ${t.typeScale.h1.size.pref}, ${t.typeScale.h1.size.max}); }
h1 em, h2 em { font-family: var(--serif); font-style: italic; font-weight: 500; background: linear-gradient(90deg, var(--accent2), var(--accent)); -webkit-background-clip: text; background-clip: text; color: transparent; }
h2 { font-family: var(--sans); font-weight: ${t.typeScale.h2.weight}; letter-spacing: ${t.typeScale.h2.tracking}; font-size: clamp(${t.typeScale.h2.size.min}, ${t.typeScale.h2.size.pref}, ${t.typeScale.h2.size.max}); }
.lede { font-size: ${t.typeScale.lede.sizePx}px; color: var(--muted); max-width: ${t.typeScale.lede.maxWidthPx}px; }
.eyebrow { font-family: var(--mono); font-size: ${t.typeScale.eyebrow.sizePx}px; letter-spacing: ${t.typeScale.eyebrow.tracking}; text-transform: uppercase; font-weight: ${t.typeScale.eyebrow.weight}; color: var(--muted); }
code, pre, .ledger { font-family: var(--mono); font-size: ${t.typeScale.mono.sizePx}px; }
.cta-pill { display: inline-block; background: var(--accent); color: ${t.components.ctaPill.foreground}; padding: ${t.components.ctaPill.paddingY}px ${t.components.ctaPill.paddingX}px; border-radius: ${t.components.ctaPill.radiusPx}px; font-size: ${t.components.ctaPill.sizePx}px; font-weight: ${t.components.ctaPill.weight}; text-decoration: none; transition: transform var(--hover-ms) var(--ease), box-shadow var(--hover-ms) var(--ease); }
.cta-pill:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(165,180,252,0.18); }
.stage-card { background: linear-gradient(180deg, var(--surface), var(--surface2)); border: 1px solid var(--border); border-radius: ${t.components.stageCard.radiusPx}px; padding: ${t.components.stageCard.paddingPx}px; transition: transform var(--hover-ms) var(--ease), border-color var(--hover-ms) var(--ease); }
.stage-card:hover { transform: translateY(-${t.components.stageCard.hoverLiftPx}px); border-color: ${t.components.stageCard.hoverBorder}; }
.brand-dot { display: inline-block; width: ${t.components.brandDot.sizePx}px; height: ${t.components.brandDot.sizePx}px; border-radius: 50%; background: var(--accent); animation: praetor-pulse ${t.components.brandDot.pulseSeconds}s ease-in-out infinite; }
@keyframes praetor-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.reveal { opacity: 0; transform: translateY(28px); transition: opacity var(--reveal-ms) var(--ease), transform var(--reveal-ms) var(--ease); }
.reveal.in { opacity: 1; transform: translateY(0); }
.reveal-d1 { transition-delay: ${t.motion.staggerMs}ms; }
.reveal-d2 { transition-delay: ${t.motion.staggerMs * 2}ms; }
.reveal-d3 { transition-delay: ${t.motion.staggerMs * 3}ms; }
.reveal-d4 { transition-delay: ${t.motion.staggerMs * 4}ms; }
.status-gate { display: inline-flex; align-items: center; gap: 6px; background: ${t.components.statusGate.bg}; border: 1px solid ${t.components.statusGate.border}; color: var(--accent3); font-size: ${t.components.statusGate.sizePx}px; text-transform: uppercase; letter-spacing: 0.12em; padding: 4px 10px; border-radius: 999px; }
.ledger { background: ${t.components.ledger.bg}; border: 1px solid var(--border); border-radius: ${t.layout.cardRadiusPx}px; padding: 14px; -webkit-mask-image: ${t.components.ledger.fadeMaskTop}; mask-image: ${t.components.ledger.fadeMaskTop}; }
@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
  .brand-dot { animation: none !important; }
}
`;
}

function renderLayer(layer: CompositionLayer, t: PraetorTokens): string {
  if (layer.kind === "three" || layer.kind === "spark-splat" || layer.kind === "video") {
    const url = layer.assetUrl ? escapeAttr(layer.assetUrl) : "";
    return `<div data-layer="${layer.id}" data-kind="${layer.kind}" data-zindex="${layer.zIndex}" data-asset="${url}"></div>`;
  }
  if (!layer.content) return `<!-- empty layer ${layer.id} -->`;
  return `<div data-layer="${layer.id}" data-kind="${layer.kind}" style="position:relative;z-index:${layer.zIndex};">
${renderNode(layer.content, t)}
</div>`;
}

function renderNode(node: SceneNode, t: PraetorTokens): string {
  const motionClass = node.motion?.enter ?? "";
  const childHtml = (node.children ?? [])
    .map((c) => (typeof c === "string" ? escapeHtml(c) : renderNode(c, t)))
    .join("");
  switch (node.kind) {
    case "section":
      return `<section class="${motionClass}">${childHtml}</section>`;
    case "hero":
      return `<section class="hero ${motionClass}">${childHtml}</section>`;
    case "h1":
      return `<h1 class="${motionClass}">${childHtml}</h1>`;
    case "h2":
      return `<h2 class="${motionClass}">${childHtml}</h2>`;
    case "lede":
      return `<p class="lede ${motionClass}">${childHtml}</p>`;
    case "eyebrow":
      return `<span class="eyebrow ${motionClass}">${childHtml}</span>`;
    case "p":
      return `<p class="${motionClass}">${childHtml}</p>`;
    case "cta-pill": {
      const href = String(node.props?.href ?? "#");
      return `<a class="cta-pill ${motionClass}" href="${escapeAttr(href)}">${childHtml}</a>`;
    }
    case "stage-card":
      return `<div class="stage-card ${motionClass}">${childHtml}</div>`;
    case "ledger-row": {
      const ts = String(node.props?.ts ?? "");
      const event = String(node.props?.event ?? "");
      const agent = String(node.props?.agent ?? "");
      return `<div class="ledger-row ${motionClass}"><span style="color:var(--muted)">${escapeHtml(ts)}</span> · <span style="color:var(--accent)">${escapeHtml(event)}</span> · <span>${escapeHtml(agent)}</span> · ${childHtml}</div>`;
    }
    case "status-gate":
      return `<span class="status-gate ${motionClass}"><span class="brand-dot"></span>${childHtml}</span>`;
    case "image": {
      const src = String(node.props?.src ?? "");
      const alt = String(node.props?.alt ?? "");
      return `<img class="${motionClass}" src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" loading="lazy" />`;
    }
    case "code-block": {
      const lang = String(node.props?.lang ?? "");
      return `<pre class="${motionClass}" data-lang="${escapeAttr(lang)}"><code>${childHtml}</code></pre>`;
    }
    case "list":
      return `<ul class="${motionClass}">${childHtml}</ul>`;
    default:
      return `<!-- unknown node kind: ${escapeHtml(String(node.kind))} -->`;
  }
}

/* ---------- Markdown target --------------------------------------------- */

function renderMarkdown(scene: PraetorScene): RenderResult {
  const t = scene.tokens;
  const lines: string[] = [];
  for (const layer of scene.layers.slice().sort((a, b) => a.zIndex - b.zIndex)) {
    if (!layer.content) continue;
    lines.push(renderNodeMarkdown(layer.content));
  }
  const md = lines.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

  const warnings: RenderWarning[] = [];
  warnings.push(...auditScene(scene));
  for (const phrase of lintVoice(md, t)) {
    warnings.push({ kind: "voice", message: `forbidden phrase: "${phrase}"`, pointer: "renderer.markdown" });
  }
  return { target: "markdown", files: [{ path: `${scene.id}.md`, contents: md }], warnings };
}

function renderNodeMarkdown(node: SceneNode): string {
  // Block-level container kinds join children with a blank line so each
  // child renders as its own paragraph / heading.
  const joinBlocks = node.kind === "section" || node.kind === "hero" || node.kind === "stage-card";
  const childText = (node.children ?? [])
    .map((c) => (typeof c === "string" ? c : renderNodeMarkdown(c)))
    .join(joinBlocks ? "\n\n" : "");
  switch (node.kind) {
    case "h1":
      return `# ${childText}`;
    case "h2":
      return `## ${childText}`;
    case "lede":
    case "p":
      return childText;
    case "eyebrow":
      return `**${childText.toUpperCase()}**`;
    case "cta-pill": {
      const href = String(node.props?.href ?? "#");
      return `[${childText}](${href})`;
    }
    case "code-block":
      return "```" + String(node.props?.lang ?? "") + "\n" + childText + "\n```";
    case "list":
      return childText
        .split(/\n(?=- )/)
        .map((s) => (s.startsWith("- ") ? s : "- " + s))
        .join("\n");
    case "stage-card":
    case "section":
    case "hero":
      return childText;
    case "status-gate":
      return `_(live)_ ${childText}`;
    case "ledger-row": {
      const ts = String(node.props?.ts ?? "");
      return `\`${ts}\` · ${childText}`;
    }
    default:
      return childText;
  }
}

/* ---------- OG image target (SVG-as-text) -------------------------------- */

function renderOgImage(scene: PraetorScene): RenderResult {
  const t = scene.tokens;
  const headlineNode = findFirstNode(scene, ["h1", "h2"]);
  const headline = headlineNode ? plainText(headlineNode) : scene.id;
  const eyebrow = findFirstNode(scene, ["eyebrow"]);
  const eyebrowText = eyebrow ? plainText(eyebrow).toUpperCase() : "PRAETOR";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="${t.color.bg}"/>
      <stop offset="1" stop-color="${t.color.surface}"/>
    </linearGradient>
    <linearGradient id="emph" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${t.color.accent2}"/>
      <stop offset="1" stop-color="${t.color.accent}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="80" cy="80" r="6" fill="${t.color.accent}"/>
  <text x="100" y="86" font-family="${t.typeStack.mono}" font-size="20" fill="${t.color.muted}" letter-spacing="3.2">${escapeHtml(eyebrowText)}</text>
  <text x="80" y="340" font-family="${t.typeStack.sans}" font-size="84" font-weight="600" fill="${t.color.text}" letter-spacing="-1.6">${escapeHtml(truncate(headline, 60))}</text>
  <text x="80" y="560" font-family="${t.typeStack.mono}" font-size="22" fill="${t.color.muted}">${escapeHtml(`charter · ${scene.id} · praetor`)}</text>
</svg>
`;
  return {
    target: "og-image",
    files: [{ path: `${scene.id}/og.svg`, contents: svg }],
    warnings: auditScene(scene),
  };
}

/* ---------- Email HTML target (inline-styled) ---------------------------- */

function renderEmailHtml(scene: PraetorScene): RenderResult {
  const t = scene.tokens;
  const body = scene.layers
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex)
    .filter((l) => l.kind === "html" && l.content)
    .map((l) => renderNodeEmail(l.content!, t))
    .join("\n");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:${t.color.bg};color:${t.color.text};font-family:${t.typeStack.sans};font-size:${t.typeScale.body.sizePx}px;line-height:${t.typeScale.body.lineHeight};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center" style="padding:48px 24px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
      <tr><td>${body}</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  const warnings = auditScene(scene);
  for (const phrase of lintVoice(html, t)) warnings.push({ kind: "voice", message: `forbidden phrase: "${phrase}"`, pointer: "renderer.email-html" });
  return { target: "email-html", files: [{ path: `${scene.id}/email.html`, contents: html }], warnings };
}

function renderNodeEmail(node: SceneNode, t: PraetorTokens): string {
  const childHtml = (node.children ?? [])
    .map((c) => (typeof c === "string" ? escapeHtml(c) : renderNodeEmail(c, t)))
    .join("");
  switch (node.kind) {
    case "h1":
      return `<h1 style="margin:0 0 16px 0;font-family:${t.typeStack.sans};font-weight:${t.typeScale.h1.weight};font-size:36px;line-height:1.15;color:${t.color.text};letter-spacing:${t.typeScale.h1.tracking};">${childHtml}</h1>`;
    case "h2":
      return `<h2 style="margin:24px 0 12px 0;font-family:${t.typeStack.sans};font-weight:${t.typeScale.h2.weight};font-size:24px;line-height:1.2;color:${t.color.text};letter-spacing:${t.typeScale.h2.tracking};">${childHtml}</h2>`;
    case "lede":
      return `<p style="margin:0 0 16px 0;font-size:${t.typeScale.lede.sizePx}px;color:${t.color.muted};">${childHtml}</p>`;
    case "p":
      return `<p style="margin:0 0 16px 0;color:${t.color.text};">${childHtml}</p>`;
    case "cta-pill": {
      const href = String(node.props?.href ?? "#");
      return `<p style="margin:24px 0;"><a href="${escapeAttr(href)}" style="display:inline-block;background:${t.color.accent};color:${t.components.ctaPill.foreground};padding:${t.components.ctaPill.paddingY}px ${t.components.ctaPill.paddingX}px;border-radius:${t.components.ctaPill.radiusPx}px;font-size:${t.components.ctaPill.sizePx}px;font-weight:${t.components.ctaPill.weight};text-decoration:none;">${childHtml}</a></p>`;
    }
    case "code-block":
      return `<pre style="margin:0 0 16px 0;background:${t.color.surface};border:1px solid ${t.color.border};border-radius:${t.layout.cardRadiusPx}px;padding:14px;font-family:${t.typeStack.mono};font-size:${t.typeScale.mono.sizePx}px;color:${t.color.text};white-space:pre-wrap;"><code>${childHtml}</code></pre>`;
    default:
      return childHtml;
  }
}

/* ---------- Shared helpers ---------------------------------------------- */

function auditScene(scene: PraetorScene): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  // Single-Three.js-scene rule (DESIGN.md §1).
  const threeLayers = scene.layers.filter((l) => l.kind === "three");
  if (threeLayers.length > 1) {
    warnings.push({
      kind: "stub",
      message: `scene has ${threeLayers.length} three-scene layers; DESIGN.md §1 forbids more than one`,
      pointer: "scene.layers",
    });
  }
  // Provenance must cover every external asset.
  for (const layer of scene.layers) {
    if (layer.assetUrl && !scene.assets.some((a) => a.source === layer.assetUrl)) {
      warnings.push({
        kind: "missing-token",
        message: `layer "${layer.id}" references "${layer.assetUrl}" but no provenance entry exists in scene.assets`,
        pointer: `layers[id="${layer.id}"]`,
      });
    }
  }
  return warnings;
}

function findFirstNode(scene: PraetorScene, kinds: SceneNode["kind"][]): SceneNode | null {
  function walk(n: SceneNode): SceneNode | null {
    if (kinds.includes(n.kind)) return n;
    for (const c of n.children ?? []) {
      if (typeof c === "string") continue;
      const found = walk(c);
      if (found) return found;
    }
    return null;
  }
  for (const layer of scene.layers) {
    if (layer.content) {
      const found = walk(layer.content);
      if (found) return found;
    }
  }
  return null;
}

function plainText(node: SceneNode): string {
  return (node.children ?? [])
    .map((c) => (typeof c === "string" ? c : plainText(c)))
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/** Re-export the default token tree for charter-author convenience. */
export { defaultTokens };
