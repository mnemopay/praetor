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
    case "react-remotion":
      return renderReactRemotion(scene);
    case "hyperframes-html":
      return renderHyperframesHtml(scene);
    case "video-mp4":
      return renderVideoMp4(scene);
    case "three-scene":
      return renderThreeScene(scene);
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

/* ---------- React-Remotion target ---------------------------------------- */

function renderReactRemotion(scene: PraetorScene): RenderResult {
  const t = scene.tokens;
  if (!scene.video) {
    return {
      target: "react-remotion",
      files: [],
      warnings: [{
        kind: "missing-token",
        message: "react-remotion target requires scene.video (fps, durationInFrames, width, height).",
        pointer: "scene.video",
      }],
    };
  }
  const { fps, durationInFrames, width, height } = scene.video;
  const compId = sanitizeId(scene.id);

  // Composition.tsx — uses Praetor tokens for type/colors. Imports from
  // remotion/composition (the host runtime) but never embeds inline hex
  // codes; tokens drive every visual decision.
  const composition = `// Auto-generated by @praetor/design — do not edit by hand.
// Render with: npx remotion render src/index.ts ${compId} out/${compId}.mp4
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { tokens } from "@praetor/design/tokens";

const C = tokens.color;
const T = tokens.typeStack;

export const ${compId}: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.text, fontFamily: T.sans }}>
${scene.layers
  .slice()
  .sort((a, b) => a.zIndex - b.zIndex)
  .filter((l) => l.kind === "html" && l.content)
  .map((l) => `      <div data-layer="${l.id}" style={{ position: "absolute", inset: 0, opacity }}>` +
    sceneNodeToJsx(l.content!, t, "        ") +
    `</div>`)
  .join("\n")}
    </AbsoluteFill>
  );
};
`;

  const root = `// Auto-generated by @praetor/design — do not edit by hand.
import { Composition } from "remotion";
import { ${compId} } from "./${compId}.js";

export const Root: React.FC = () => (
  <Composition
    id="${compId}"
    component={${compId}}
    durationInFrames={${durationInFrames}}
    fps={${fps}}
    width={${width}}
    height={${height}}
  />
);
`;

  const indexEntry = `// Auto-generated by @praetor/design — do not edit by hand.
import { registerRoot } from "remotion";
import { Root } from "./Root.js";
registerRoot(Root);
`;

  const remotionConfig = `// Auto-generated by @praetor/design — do not edit by hand.
// Praetor invariant: all colors/fonts come from PraetorTokens. Do not
// hand-edit tokens here; modify packages/design/src/tokens.ts instead.
module.exports = {
  Config: { setVideoImageFormat: "jpeg", setQuality: 88 }
};
`;

  const warnings: RenderWarning[] = [];
  warnings.push(...auditScene(scene));
  for (const phrase of lintVoice(composition, t)) {
    warnings.push({ kind: "voice", message: `forbidden phrase: "${phrase}"`, pointer: "renderer.react-remotion" });
  }

  return {
    target: "react-remotion",
    files: [
      { path: `${compId}/src/index.ts`, contents: indexEntry },
      { path: `${compId}/src/Root.tsx`, contents: root },
      { path: `${compId}/src/${compId}.tsx`, contents: composition },
      { path: `${compId}/remotion.config.cjs`, contents: remotionConfig },
    ],
    warnings,
  };
}

/** Convert a SceneNode tree to JSX literal text. Token-aware; no inline hex. */
function sceneNodeToJsx(node: SceneNode, t: PraetorTokens, indent: string): string {
  const childJsx = (node.children ?? [])
    .map((c) => (typeof c === "string" ? jsxEscapeText(c) : sceneNodeToJsx(c, t, indent + "  ")))
    .join("");
  switch (node.kind) {
    case "h1":
      return `\n${indent}<h1 style={{ fontFamily: tokens.typeStack.sans, fontSize: 84, fontWeight: ${t.typeScale.h1.weight}, letterSpacing: "${t.typeScale.h1.tracking}", color: tokens.color.text }}>${childJsx}</h1>`;
    case "h2":
      return `\n${indent}<h2 style={{ fontFamily: tokens.typeStack.sans, fontSize: 44, fontWeight: ${t.typeScale.h2.weight}, color: tokens.color.text }}>${childJsx}</h2>`;
    case "lede":
      return `\n${indent}<p style={{ fontSize: ${t.typeScale.lede.sizePx + 8}, color: tokens.color.muted, maxWidth: ${t.typeScale.lede.maxWidthPx} }}>${childJsx}</p>`;
    case "p":
      return `\n${indent}<p style={{ color: tokens.color.text }}>${childJsx}</p>`;
    case "eyebrow":
      return `\n${indent}<span style={{ fontFamily: tokens.typeStack.mono, fontSize: ${t.typeScale.eyebrow.sizePx}, letterSpacing: "${t.typeScale.eyebrow.tracking}", textTransform: "uppercase", color: tokens.color.muted }}>${childJsx}</span>`;
    case "cta-pill": {
      const href = String(node.props?.href ?? "#");
      return `\n${indent}<a href="${jsxEscapeAttr(href)}" style={{ background: tokens.color.accent, color: tokens.components.ctaPill.foreground, padding: \`\${tokens.components.ctaPill.paddingY}px \${tokens.components.ctaPill.paddingX}px\`, borderRadius: tokens.components.ctaPill.radiusPx, fontWeight: tokens.components.ctaPill.weight, textDecoration: "none" }}>${childJsx}</a>`;
    }
    case "section":
    case "hero":
      return `\n${indent}<section style={{ padding: "${t.layout.sectionPaddingDesktopPx}px ${t.layout.gutterDesktopPx}px", maxWidth: ${t.layout.maxContentWidthPx}, margin: "0 auto" }}>${childJsx}\n${indent}</section>`;
    default:
      return `\n${indent}<div>${childJsx}</div>`;
  }
}

function jsxEscapeText(s: string): string {
  return s.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function jsxEscapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_").replace(/^(\d)/, "_$1");
}

/* ---------- Hyperframes-HTML target ------------------------------------- */

function renderHyperframesHtml(scene: PraetorScene): RenderResult {
  const t = scene.tokens;
  if (!scene.hyperframes) {
    return {
      target: "hyperframes-html",
      files: [],
      warnings: [{
        kind: "missing-token",
        message: "hyperframes-html target requires scene.hyperframes (defaultDurationMs).",
        pointer: "scene.hyperframes",
      }],
    };
  }
  const cssVars = tokensToCssVariables(t);
  const baseCss = renderBaseStylesheet(t);
  const hf = scene.hyperframes;

  const frames = scene.layers
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex)
    .filter((l) => l.kind === "html" && l.content)
    .map((l, i) => {
      const sched = hf.schedule?.[l.id];
      const startMs = sched?.startMs ?? i * hf.defaultDurationMs;
      const durationMs = sched?.durationMs ?? hf.defaultDurationMs;
      return `<section class="hf-frame" data-frame="${escapeAttr(l.id)}" data-start="${startMs}" data-duration="${durationMs}">
${renderNode(l.content!, t)}
</section>`;
    })
    .join("\n");

  const totalMs = scene.layers
    .filter((l) => l.kind === "html" && l.content)
    .reduce((acc, l, i) => Math.max(acc, (hf.schedule?.[l.id]?.startMs ?? i * hf.defaultDurationMs) + (hf.schedule?.[l.id]?.durationMs ?? hf.defaultDurationMs)), 0);

  const runtime = `(() => {
  const frames = Array.from(document.querySelectorAll("[data-frame]"));
  const loop = ${hf.loop ? "true" : "false"};
  const total = ${totalMs};
  const start = performance.now();
  function tick(now) {
    let elapsed = now - start;
    if (loop) elapsed = elapsed % total;
    for (const f of frames) {
      const s = Number(f.dataset.start);
      const d = Number(f.dataset.duration);
      const visible = elapsed >= s && elapsed < s + d;
      if (visible !== !f.classList.contains("hf-hidden")) continue;
      f.classList.toggle("hf-hidden", !visible);
    }
    if (loop || elapsed < total) requestAnimationFrame(tick);
  }
  if (matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) {
    frames.forEach((f) => f.classList.remove("hf-hidden"));
    return;
  }
  requestAnimationFrame(tick);
})();`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(scene.id)}</title>
  <style>
${cssVars}
${baseCss}
.hf-frame { position: absolute; inset: 0; opacity: 1; transition: opacity var(--reveal-ms) var(--ease); }
.hf-frame.hf-hidden { opacity: 0; pointer-events: none; }
.hf-stage { position: relative; width: 100%; min-height: 100vh; }
@media (prefers-reduced-motion: reduce) { .hf-frame.hf-hidden { opacity: 1 !important; } }
  </style>
</head>
<body class="praetor">
<main class="hf-stage" data-total-ms="${totalMs}" data-loop="${hf.loop ? "true" : "false"}">
${frames}
</main>
<script>
${runtime}
</script>
</body>
</html>
`;

  const warnings: RenderWarning[] = auditScene(scene);
  for (const easeHit of lintEase(html)) {
    warnings.push({ kind: "ease", message: `non-Praetor ease curve: ${easeHit}`, pointer: "renderer.hyperframes-html" });
  }
  return {
    target: "hyperframes-html",
    files: [{ path: `${scene.id}/index.html`, contents: html }],
    warnings,
  };
}

/* ---------- Video-MP4 target -------------------------------------------- */

function renderVideoMp4(scene: PraetorScene): RenderResult {
  // video-mp4 is composed: it consumes the react-remotion artifacts and
  // adds a render script + README so the bundle is one zip away from
  // producing an .mp4. The renderer never spawns ffmpeg/remotion itself —
  // that's the host's job. This keeps the renderer pure (no IO side
  // effects beyond returning files) while still being one command away
  // from a finished mp4.
  if (!scene.video) {
    return {
      target: "video-mp4",
      files: [],
      warnings: [{
        kind: "missing-token",
        message: "video-mp4 target requires scene.video (fps, durationInFrames, width, height).",
        pointer: "scene.video",
      }],
    };
  }
  const compId = sanitizeId(scene.id);
  const remotionResult = renderReactRemotion(scene);
  const renderScript = `#!/usr/bin/env bash
# Auto-generated by @praetor/design — render this scene to mp4.
# Requirements: node >= 20, npx, remotion runtime is fetched on first run.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
npx --yes remotion@4 render src/index.ts ${compId} out/${compId}.mp4 \\
  --concurrency=1 \\
  --quality=88 \\
  --codec=h264
echo "rendered: out/${compId}.mp4"
`;
  const renderCmd = `@echo off
REM Auto-generated by @praetor/design — render this scene to mp4 (Windows).
cd /d "%~dp0"
if not exist out mkdir out
npx --yes remotion@4 render src/index.ts ${compId} out\\${compId}.mp4 --concurrency=1 --quality=88 --codec=h264
echo rendered: out\\${compId}.mp4
`;
  const readme = `# ${compId} — Praetor video bundle

Render with:
\`\`\`bash
./render.sh        # macOS / Linux / WSL
render.cmd         # Windows
\`\`\`
Output: \`out/${compId}.mp4\` — ${scene.video.width}×${scene.video.height} @ ${scene.video.fps}fps, ${(scene.video.durationInFrames / scene.video.fps).toFixed(2)}s.

This bundle is emitted by @praetor/design. Do not hand-edit the .tsx files —
they are derived from the PraetorScene at \`<scene>.json\`. To change the
output, change the scene + re-render via @praetor/design.
`;
  const files: DesignFile[] = [
    ...remotionResult.files,
    { path: `${compId}/render.sh`, contents: renderScript },
    { path: `${compId}/render.cmd`, contents: renderCmd },
    { path: `${compId}/README.md`, contents: readme },
  ];
  return {
    target: "video-mp4",
    files,
    warnings: remotionResult.warnings,
  };
}

/* ---------- Three-scene target ------------------------------------------ */

function renderThreeScene(scene: PraetorScene): RenderResult {
  const t = scene.tokens;
  // Single self-contained HTML with the canonical Praetor particle ring.
  // Loaded via importmap from a pinned three.js version on cdn.jsdelivr.net
  // (registered as an asset; provenance entry checked by auditScene).
  const threeImport = "https://cdn.jsdelivr.net/npm/three@0.166.1/+esm";
  const inlineThreeAssetMissing = !scene.assets.some((a) => a.source === threeImport);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(scene.id)} — particle ring</title>
  <style>
${tokensToCssVariables(t)}
html, body { margin: 0; padding: 0; background: var(--bg); overflow: hidden; }
#praetor-ring { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; }
@media (prefers-reduced-motion: reduce) { #praetor-ring { opacity: 0.6; } }
  </style>
  <script type="importmap">
  { "imports": { "three": "${threeImport}" } }
  </script>
</head>
<body>
<canvas id="praetor-ring"></canvas>
<script type="module">
// Praetor particle ring — DESIGN.md §4. Token-driven, single Three.js scene.
import * as THREE from "three";
const POINT_COUNT = ${t.motion.particleRing.pointCount};
const POINTER_LERP = ${t.motion.particleRing.pointerLerp};
const INNER_OPACITY = ${t.motion.particleRing.innerSphereOpacity};
const COLOR_INNER = new THREE.Color("${t.color.accent}");
const COLOR_OUTER = new THREE.Color("${t.color.particleOuter}");
const COLOR_GLOW = new THREE.Color("${t.color.particleGlow}");

const canvas = document.getElementById("praetor-ring");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 4.2);

// Inner depth-glow sphere (DESIGN.md §4 — additive, opacity 0.18)
const inner = new THREE.Mesh(
  new THREE.SphereGeometry(1.0, 24, 24),
  new THREE.MeshBasicMaterial({ color: COLOR_GLOW, transparent: true, opacity: INNER_OPACITY, blending: THREE.AdditiveBlending })
);
scene.add(inner);

// Particle ring — gradient violet -> cyan, additive blending.
const positions = new Float32Array(POINT_COUNT * 3);
const colors = new Float32Array(POINT_COUNT * 3);
for (let i = 0; i < POINT_COUNT; i++) {
  const r = 1.4 + Math.random() * 0.6;
  const theta = Math.random() * Math.PI * 2;
  const phi = (Math.random() - 0.5) * 0.6;
  positions[i * 3 + 0] = r * Math.cos(theta) * Math.cos(phi);
  positions[i * 3 + 1] = r * Math.sin(phi);
  positions[i * 3 + 2] = r * Math.sin(theta) * Math.cos(phi);
  const t01 = (r - 1.4) / 0.6;
  const c = COLOR_INNER.clone().lerp(COLOR_OUTER, t01);
  colors[i * 3 + 0] = c.r;
  colors[i * 3 + 1] = c.g;
  colors[i * 3 + 2] = c.b;
}
const geom = new THREE.BufferGeometry();
geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

const points = new THREE.Points(
  geom,
  new THREE.PointsMaterial({ size: 0.018, vertexColors: true, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false })
);
scene.add(points);

// Pointer-driven camera lerp (subtle, low-power).
const pointer = { x: 0, y: 0 };
const target = { x: 0, y: 0 };
window.addEventListener("pointermove", (e) => {
  pointer.x = (e.clientX / window.innerWidth - 0.5) * 0.6;
  pointer.y = (e.clientY / window.innerHeight - 0.5) * 0.6;
});
window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function tick() {
  if (!reduceMotion) {
    target.x += (pointer.x - target.x) * POINTER_LERP;
    target.y += (pointer.y - target.y) * POINTER_LERP;
    camera.position.x = target.x * 0.5;
    camera.position.y = -target.y * 0.5;
    camera.lookAt(0, 0, 0);
    points.rotation.y += 0.0008;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
</script>
</body>
</html>
`;
  const warnings = auditScene(scene);
  if (inlineThreeAssetMissing) {
    warnings.push({
      kind: "missing-token",
      message: `three-scene loads three.js from "${threeImport}" but no provenance entry exists in scene.assets`,
      pointer: "scene.assets",
    });
  }
  for (const easeHit of lintEase(html)) {
    warnings.push({ kind: "ease", message: `non-Praetor ease curve: ${easeHit}`, pointer: "renderer.three-scene" });
  }
  return {
    target: "three-scene",
    files: [{ path: `${scene.id}/index.html`, contents: html }],
    warnings,
  };
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
