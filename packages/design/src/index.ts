/**
 * Praetor Design pack — native bindings for the design + motion stack:
 *
 *   1. Spline (spline.design) — embeddable 3D scenes via <spline-viewer>
 *   2. Godly.website inspiration patterns — dark-theme SaaS landing aesthetics
 *   3. Claude Design (claude-plugins.dev) — design-system automation
 *   4. AntiGravity (Google) — no-code prototyping scaffolds
 *   5. Hypeframes — animated frame sequences for motion-rich landing pages
 *   6. Remotion — React-based programmatic video rendering
 *   7. Declarative UI primitive — JSON spec → rendered component tree, the
 *      surface every charter targets when it wants UI without hand-rolled JSX
 *
 * The bindings are intentionally thin: a charter declares which surface the
 * mission needs, and the design pack emits the matching artifacts so the agent
 * pack does not have to know about visual concerns.
 */
export type DesignSurface =
  | "spline"
  | "godly"
  | "claude-design"
  | "antigravity"
  | "hypeframes"
  | "remotion"
  | "declarative-ui";

export interface DesignRequest {
  surface: DesignSurface;
  intent: string;
  outputDir: string;
  spec?: Record<string, unknown>;
}

export interface DesignArtifact {
  surface: DesignSurface;
  files: { path: string; contents: string }[];
}

/**
 * Declarative UI spec — a charter can hand the runtime a JSON tree and Praetor
 * renders it to whichever target the charter requests (HTML, JSX, React Native,
 * Remotion `<Composition>`). The schema is intentionally small so any agent
 * can emit it without a full UI library in scope.
 */
export interface UINode {
  type: string;
  props?: Record<string, unknown>;
  children?: (UINode | string)[];
}

export interface RemotionComposition {
  id: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  scenes: UINode[];
}

export interface HypeframesSpec {
  frames: { delayMs: number; node: UINode }[];
  loop?: boolean;
}

export class DesignPack {
  /**
   * Render a declarative UI tree to HTML. Trivial for day zero — covers the
   * 80% case (landing-page hero, copy block, CTA button) so charters can ship
   * a styled page without an external React build.
   */
  renderHtml(node: UINode): string {
    return uiNodeToHtml(node);
  }

  /**
   * Emit a Remotion project: an `index.ts` registering the composition, a
   * `Root.tsx` listing it, and per-scene `.tsx` components rendered from each
   * UINode. Drops into a Remotion app via `npx remotion render src/index.ts`.
   */
  async renderRemotion(comp: RemotionComposition): Promise<DesignArtifact> {
    const files = renderRemotionFiles(comp);
    return { surface: "remotion", files };
  }

  /**
   * Emit a Hypeframes spec: one HTML scene plus a tiny runtime that swaps
   * frames on the declared `delayMs` cadence. Output is self-contained; no
   * Hypeframes runtime needed at view time.
   */
  async renderHypeframes(spec: HypeframesSpec): Promise<DesignArtifact> {
    const files = renderHypeframesFiles(spec);
    return { surface: "hypeframes", files };
  }

  /**
   * Emit a Spline scene reference + a `<spline-viewer>` snippet.
   */
  renderSpline(sceneUrl: string): string {
    return `<script type="module" src="https://unpkg.com/@splinetool/viewer/build/spline-viewer.js"></script>
<spline-viewer url="${escapeAttr(sceneUrl)}"></spline-viewer>`;
  }
}

/* ---------- Remotion emitter -------------------------------------------- */

function renderRemotionFiles(comp: RemotionComposition): { path: string; contents: string }[] {
  const sceneCount = comp.scenes.length;
  const sceneFiles = comp.scenes.map((scene, i) => ({
    path: `src/scenes/Scene${i}.tsx`,
    contents: `import React from "react";
export const Scene${i}: React.FC = () => (${jsxFromUI(scene)});
`,
  }));
  const rootContents = `import React from "react";
import { Composition } from "remotion";
${comp.scenes.map((_, i) => `import { Scene${i} } from "./scenes/Scene${i}";`).join("\n")}

const SCENES = [${comp.scenes.map((_, i) => `Scene${i}`).join(", ")}];

const ${pascal(comp.id)}: React.FC = () => (
  <>{SCENES.map((S, i) => <S key={i} />)}</>
);

export const RemotionRoot: React.FC = () => (
  <Composition
    id="${comp.id}"
    component={${pascal(comp.id)}}
    durationInFrames={${comp.durationInFrames}}
    fps={${comp.fps}}
    width={${comp.width}}
    height={${comp.height}}
  />
);
`;
  const indexContents = `import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";
registerRoot(RemotionRoot);
`;
  return [
    { path: "src/index.ts", contents: indexContents },
    { path: "src/Root.tsx", contents: rootContents },
    ...sceneFiles,
    {
      path: "remotion.json",
      contents: JSON.stringify(
        { id: comp.id, fps: comp.fps, width: comp.width, height: comp.height, sceneCount },
        null,
        2,
      ),
    },
  ];
}

/**
 * Render a UI node as JSX. Tiny but enough for the typical Remotion scene
 * (background div + absolutely-positioned text + image). The output is plain
 * JSX, not React.createElement calls, so a designer can hand-edit it.
 */
function jsxFromUI(node: UINode | string): string {
  if (typeof node === "string") return JSON.stringify(node);
  const tag = node.type;
  const propsAttr = node.props
    ? Object.entries(node.props)
        .filter(([, v]) => v !== undefined && v !== null && typeof v !== "function")
        .map(([k, v]) => {
          if (typeof v === "string") return `${k}="${escapeAttr(v)}"`;
          return `${k}={${JSON.stringify(v)}}`;
        })
        .join(" ")
    : "";
  const inner = (node.children ?? [])
    .map((c) => (typeof c === "string" ? c : jsxFromUI(c)))
    .join("");
  return `<${tag}${propsAttr ? " " + propsAttr : ""}>${inner}</${tag}>`;
}

/* ---------- Hypeframes emitter ------------------------------------------ */

function renderHypeframesFiles(spec: HypeframesSpec): { path: string; contents: string }[] {
  const frames = spec.frames.map((f, i) => ({
    delayMs: f.delayMs,
    html: uiNodeToHtml(f.node),
    index: i,
  }));
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Hypeframes scene</title>
<style>
  body { margin:0; background:#000; color:#fff; font: 16px/1.4 system-ui, sans-serif; }
  .frame { position:absolute; inset:0; opacity:0; transition:opacity 200ms ease; }
  .frame.on { opacity:1; }
</style></head><body>
${frames.map((f) => `<section class="frame" data-i="${f.index}">${f.html}</section>`).join("\n")}
<script>
const frames = ${JSON.stringify(frames.map((f) => ({ i: f.index, delay: f.delayMs })))};
const loop = ${spec.loop ? "true" : "false"};
const els = document.querySelectorAll(".frame");
let i = 0;
function tick() {
  els.forEach((el) => el.classList.remove("on"));
  els[i].classList.add("on");
  const cur = frames[i];
  i = (i + 1) % frames.length;
  if (i === 0 && !loop) return;
  setTimeout(tick, cur.delay);
}
tick();
</script>
</body></html>`;
  return [
    { path: "scene.html", contents: html },
    { path: "hypeframes.json", contents: JSON.stringify(spec, null, 2) },
  ];
}

/* ---------- helpers ----------------------------------------------------- */

function uiNodeToHtml(node: UINode | string): string {
  if (typeof node === "string") return escapeText(node);
  const tag = node.type;
  const attrs = node.props
    ? Object.entries(node.props)
        .filter(([, v]) => v !== undefined && v !== null && typeof v !== "function")
        .map(([k, v]) => `${k}="${escapeAttr(String(v))}"`)
        .join(" ")
    : "";
  const inner = (node.children ?? []).map(uiNodeToHtml).join("");
  return `<${tag}${attrs ? " " + attrs : ""}>${inner}</${tag}>`;
}
function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function pascal(s: string) {
  return s.replace(/(^|[-_ ])([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
}
