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
   * Emit a Remotion composition file. Real binding lands in week 3 — see
   * docs/ROADMAP.md.
   */
  async renderRemotion(_comp: RemotionComposition): Promise<DesignArtifact> {
    throw new Error("DesignPack.renderRemotion: not yet implemented");
  }

  /**
   * Emit a Hypeframes spec. Real binding lands in week 3.
   */
  async renderHypeframes(_spec: HypeframesSpec): Promise<DesignArtifact> {
    throw new Error("DesignPack.renderHypeframes: not yet implemented");
  }

  /**
   * Emit a Spline scene reference + a `<spline-viewer>` snippet.
   */
  renderSpline(sceneUrl: string): string {
    return `<script type="module" src="https://unpkg.com/@splinetool/viewer/build/spline-viewer.js"></script>
<spline-viewer url="${escapeAttr(sceneUrl)}"></spline-viewer>`;
  }
}

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
