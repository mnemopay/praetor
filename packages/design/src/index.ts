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

  /**
   * Pick a preset from the Spline preset library and return the embed snippet.
   * The preset library is the same one Jerry uses on BizSuite (godly 3D orb,
   * fractional-ops rings, etc.) so charters can ship visually-consistent pages
   * without hand-rolling viewer config.
   */
  renderSplinePreset(presetId: SplinePresetId, overrides: Partial<SplinePreset> = {}): string {
    const preset = { ...resolveSplinePreset(presetId), ...overrides };
    const attrs: string[] = [`url="${escapeAttr(preset.sceneUrl)}"`];
    if (preset.loadingPolicy) attrs.push(`loading-policy="${preset.loadingPolicy}"`);
    if (preset.eventsTarget) attrs.push(`events-target="${preset.eventsTarget}"`);
    if (preset.background) attrs.push(`style="background:${escapeAttr(preset.background)}"`);
    return `<script type="module" src="https://unpkg.com/@splinetool/viewer/build/spline-viewer.js"></script>
<spline-viewer ${attrs.join(" ")}></spline-viewer>`;
  }

  /**
   * Hand a Praetor RemotionComposition off to a dele-video-shaped project. The
   * bridge writes scenes under `compositions/<id>/` so dele-video's existing
   * renderer (`bun run render <id>`) picks them up without further wiring.
   */
  toDeleVideo(comp: RemotionComposition, opts: { projectRoot?: string } = {}): DesignArtifact {
    const root = opts.projectRoot ?? "dele-video";
    const base = renderRemotionFiles(comp);
    const files = base.map((f) => ({
      path: `${root}/${f.path.replace(/^src\//, `src/compositions/${comp.id}/`).replace(/^remotion\.json$/, `compositions/${comp.id}/remotion.json`)}`,
      contents: f.contents,
    }));
    files.push({
      path: `${root}/compositions/${comp.id}/manifest.json`,
      contents: JSON.stringify({
        id: comp.id,
        fps: comp.fps,
        durationInFrames: comp.durationInFrames,
        width: comp.width,
        height: comp.height,
        scenes: comp.scenes.length,
        target: "dele-video",
        emittedBy: "praetor/design",
      }, null, 2),
    });
    return { surface: "remotion", files };
  }

  /**
   * Render an "HTML-in-Canvas-3D" hero — interactive HTML cards mounted as
   * THREE.js textures, with optional Mediapipe head-parallax. The technique
   * is the one Fojcik demoed (x.com/_fojcik/status/2049078294637596803):
   * real DOM rendered onto floating planes inside a WebGL scene, parallaxed
   * by the viewer's face position. Output is a single self-contained HTML
   * file — no build step, drops into any landing page as an iframe or as the
   * page itself.
   *
   * Pricing/feature cards are emitted as DOM (so they stay interactive and
   * SEO-readable as a fallback). The 3D layer is progressive enhancement.
   */
  renderHtmlInCanvas3D(spec: HtmlInCanvas3DSpec): DesignArtifact {
    const files = renderHtmlInCanvas3DFiles(spec);
    return { surface: "declarative-ui", files };
  }

  /**
   * Emit a UGC-pipeline-compatible job spec. The JSON shape mirrors
   * ugc-pipeline's input (kenburns + edge-tts free path, or Nano Banana +
   * Seedance paid path). Charters use this to enqueue 9:16 vertical ads.
   */
  toUgcPipeline(spec: UgcPipelineSpec): DesignArtifact {
    const files = [{
      path: `ugc-pipeline/jobs/${slug(spec.id)}.json`,
      contents: JSON.stringify({
        id: spec.id,
        durationSec: spec.durationSec,
        aspect: spec.aspect ?? "9:16",
        background: spec.background,
        voiceover: spec.voiceover,
        textOverlays: spec.textOverlays ?? [],
        cta: spec.cta,
        renderer: spec.renderer ?? "kenburns-edge-tts",
        emittedBy: "praetor/design",
      }, null, 2),
    }];
    return { surface: "declarative-ui", files };
  }
}

/* ---------- Spline preset library --------------------------------------- */

export type SplinePresetId =
  | "godly-3d-orb"
  | "fractional-ops-rings"
  | "ai-audit-shield"
  | "developer-portal-grid"
  | "drone-proof-of-presence";

export interface SplinePreset {
  sceneUrl: string;
  /** Spline viewer loading-policy attribute. */
  loadingPolicy?: "lazy" | "eager";
  /** Restrict pointer events to a particular target ("global" | "local"). */
  eventsTarget?: "global" | "local";
  /** CSS background for the host element. */
  background?: string;
  /** Free-text usage note for charters / designers. */
  note?: string;
}

const SPLINE_PRESETS: Record<SplinePresetId, SplinePreset> = {
  "godly-3d-orb": {
    sceneUrl: "https://prod.spline.design/PraetorGodlyOrb/scene.splinecode",
    loadingPolicy: "lazy",
    eventsTarget: "global",
    background: "radial-gradient(circle at 50% 30%, #1e1b4b 0%, #000 70%)",
    note: "BizSuite homepage hero — indigo torus rings + parallax mouse-tracking.",
  },
  "fractional-ops-rings": {
    sceneUrl: "https://prod.spline.design/PraetorFractionalRings/scene.splinecode",
    loadingPolicy: "lazy",
    background: "linear-gradient(180deg, #0f172a 0%, #000 100%)",
    note: "Three concentric rings rotating off-axis — fractional-ops landing block.",
  },
  "ai-audit-shield": {
    sceneUrl: "https://prod.spline.design/PraetorAuditShield/scene.splinecode",
    loadingPolicy: "lazy",
    background: "#0a0a0a",
    note: "Hex shield with a slow pulse — Article 12 / AI Audit hero.",
  },
  "developer-portal-grid": {
    sceneUrl: "https://prod.spline.design/PraetorDevGrid/scene.splinecode",
    loadingPolicy: "lazy",
    note: "Subtle wireframe grid for /developers landing.",
  },
  "drone-proof-of-presence": {
    sceneUrl: "https://prod.spline.design/PraetorDroneProof/scene.splinecode",
    loadingPolicy: "lazy",
    note: "Drone hovering over a stamped tile — GridStamp PoP hero.",
  },
};

export function resolveSplinePreset(id: SplinePresetId): SplinePreset {
  const p = SPLINE_PRESETS[id];
  if (!p) throw new Error(`unknown Spline preset: ${id}`);
  return p;
}

export function listSplinePresets(): { id: SplinePresetId; preset: SplinePreset }[] {
  return (Object.keys(SPLINE_PRESETS) as SplinePresetId[]).map((id) => ({ id, preset: SPLINE_PRESETS[id] }));
}

/* ---------- HTML-in-Canvas-3D spec -------------------------------------- */

export interface HtmlInCanvas3DCard {
  id: string;
  /** Inner HTML for the card (kept interactive). */
  html: string;
  /** Position in 3D space — meters from camera. Defaults distribute on a row. */
  position?: { x: number; y: number; z: number };
  /** Rotation in radians. */
  rotation?: { x: number; y: number; z: number };
  /** Card size in pixels (rendered as a CSS3D plane). */
  size?: { width: number; height: number };
}

export interface HtmlInCanvas3DSpec {
  /** Title for the emitted HTML document. */
  title: string;
  /** Optional background CSS (e.g. "radial-gradient(...)" or "#0a0a0a"). */
  background?: string;
  /** Cards to mount in the 3D scene. */
  cards: HtmlInCanvas3DCard[];
  /** Enable Mediapipe face-tracked parallax. Default: true. */
  faceParallax?: boolean;
  /** Mouse-parallax fallback when no camera. Default: true. */
  mouseParallax?: boolean;
  /** Optional ambient torus rings (godly hero look). Default: false. */
  rings?: boolean;
  /** Scroll-driven camera dolly ([near, far] in meters). */
  dolly?: { near: number; far: number };
}

/* ---------- UGC pipeline spec ------------------------------------------- */

export interface UgcPipelineSpec {
  id: string;
  durationSec: number;
  aspect?: "9:16" | "16:9" | "1:1";
  background:
    | { type: "image"; url: string; kenBurns?: boolean }
    | { type: "video"; url: string }
    | { type: "color"; value: string };
  voiceover?: { text: string; voice?: string; provider?: "edge" | "azure" | "elevenlabs" };
  textOverlays?: { text: string; startSec: number; endSec: number; position?: "top" | "center" | "bottom" }[];
  cta?: { text: string; url?: string };
  renderer?: "kenburns-edge-tts" | "nano-banana-seedance";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

/* ---------- HTML-in-Canvas-3D emitter ----------------------------------- */

function renderHtmlInCanvas3DFiles(spec: HtmlInCanvas3DSpec): { path: string; contents: string }[] {
  const faceParallax = spec.faceParallax === true;
  const mouseParallax = spec.mouseParallax !== false;
  const rings = spec.rings === true;
  const bg = spec.background ?? "radial-gradient(circle at 50% 30%, #1e1b4b 0%, #000 70%)";
  const dolly = spec.dolly ?? { near: 6, far: 14 };
  const cards = spec.cards.map((c, i) => ({
    id: c.id,
    html: c.html,
    position: c.position ?? { x: (i - (spec.cards.length - 1) / 2) * 4.2, y: 0, z: 0 },
    rotation: c.rotation ?? { x: 0, y: 0, z: 0 },
    size: c.size ?? { width: 320, height: 420 },
  }));
  const cardsJson = JSON.stringify(cards);
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeText(spec.title)}</title>
<style>
  html,body{margin:0;height:100%;background:${escapeAttr(bg)};color:#fff;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;overflow:hidden}
  #stage{position:fixed;inset:0}
  #fallback{position:fixed;inset:0;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:24px;padding:48px;pointer-events:auto}
  #fallback.hidden{display:none}
  .card{box-sizing:border-box;width:320px;height:420px;padding:24px;border-radius:18px;background:rgba(15,23,42,.72);backdrop-filter:blur(12px);border:1px solid rgba(165,180,252,.25);box-shadow:0 30px 80px rgba(0,0,0,.45)}
  .card h2{margin:0 0 12px;font-size:22px}
  .card a.cta{display:inline-block;margin-top:16px;padding:10px 18px;border-radius:999px;background:#a5b4fc;color:#0f172a;text-decoration:none;font-weight:600}
  noscript .card{position:relative}
</style>
</head><body>
<div id="stage"></div>
<div id="fallback">
  ${cards.map((c) => `<article class="card" data-id="${escapeAttr(c.id)}">${c.html}</article>`).join("\n  ")}
</div>
<script type="importmap">
{ "imports": {
  "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
  "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
} }
</script>
<script type="module">
import * as THREE from "three";
import { CSS3DRenderer, CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";

const CARDS = ${cardsJson};
const FACE_PARALLAX = ${faceParallax};
const MOUSE_PARALLAX = ${mouseParallax};
const RINGS = ${rings};
const DOLLY_NEAR = ${dolly.near};
const DOLLY_FAR = ${dolly.far};

if (!("WebGL2RenderingContext" in window)) {
  // Leave the DOM fallback in place — no enhancement available.
} else {
  const fallback = document.getElementById("fallback");
  fallback.classList.add("hidden");

  const stage = document.getElementById("stage");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
  camera.position.set(0, 0, DOLLY_NEAR);

  // WebGL layer (rings + glow)
  const gl = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  gl.setPixelRatio(devicePixelRatio);
  gl.setSize(innerWidth, innerHeight);
  gl.domElement.style.position = "absolute";
  gl.domElement.style.inset = "0";
  gl.domElement.style.pointerEvents = "none";
  stage.appendChild(gl.domElement);

  // CSS3D layer (interactive HTML cards as planes)
  const css = new CSS3DRenderer();
  css.setSize(innerWidth, innerHeight);
  css.domElement.style.position = "absolute";
  css.domElement.style.inset = "0";
  stage.appendChild(css.domElement);

  if (RINGS) {
    const ringMat = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, wireframe: true });
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.08, 8, 96), ringMat(0xa5b4fc));
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.06, 8, 96), ringMat(0xfde68a));
    r1.rotation.x = Math.PI / 2.4; r2.rotation.x = Math.PI / 1.8;
    scene.add(r1, r2);
    const tickRings = () => { r1.rotation.z += 0.0018; r2.rotation.z -= 0.0026; };
    tickRings._fn = tickRings;
    scene.userData.tickRings = tickRings;
  }

  for (const c of CARDS) {
    const el = document.createElement("div");
    el.className = "card";
    el.style.width = c.size.width + "px";
    el.style.height = c.size.height + "px";
    el.dataset.id = c.id;
    el.innerHTML = c.html;
    const obj = new CSS3DObject(el);
    obj.position.set(c.position.x * 100, c.position.y * 100, c.position.z * 100);
    obj.rotation.set(c.rotation.x, c.rotation.y, c.rotation.z);
    obj.scale.setScalar(0.01);
    scene.add(obj);
  }

  let parallax = { x: 0, y: 0 };
  if (MOUSE_PARALLAX) {
    addEventListener("mousemove", (e) => {
      parallax.x = (e.clientX / innerWidth - 0.5) * 0.6;
      parallax.y = (e.clientY / innerHeight - 0.5) * 0.4;
    }, { passive: true });
  }

  if (FACE_PARALLAX && navigator.mediaDevices?.getUserMedia) {
    initFaceTracking().catch(() => { /* graceful fallback to mouse-only */ });
  }

  let scrollT = 0;
  addEventListener("scroll", () => {
    const max = Math.max(1, document.body.scrollHeight - innerHeight);
    scrollT = Math.min(1, Math.max(0, scrollY / max));
  }, { passive: true });

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    gl.setSize(innerWidth, innerHeight); css.setSize(innerWidth, innerHeight);
  });

  function loop() {
    if (scene.userData.tickRings) scene.userData.tickRings();
    camera.position.x += (parallax.x - camera.position.x) * 0.06;
    camera.position.y += (-parallax.y - camera.position.y) * 0.06;
    camera.position.z = DOLLY_NEAR + (DOLLY_FAR - DOLLY_NEAR) * scrollT;
    camera.lookAt(0, 0, 0);
    gl.render(scene, camera); css.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();

  async function initFaceTracking() {
    const { FaceLandmarker, FilesetResolver } = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm");
    const fileset = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
    const lm = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
      runningMode: "VIDEO", numFaces: 1,
    });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
    const v = document.createElement("video"); v.srcObject = stream; v.muted = true; v.playsInline = true; await v.play();
    const tick = () => {
      if (v.readyState >= 2) {
        const r = lm.detectForVideo(v, performance.now());
        const lmk = r.faceLandmarks?.[0];
        if (lmk && lmk[1]) {
          const nose = lmk[1];
          parallax.x = (0.5 - nose.x) * 1.2;
          parallax.y = (nose.y - 0.5) * 0.8;
        }
      }
      requestAnimationFrame(tick);
    };
    tick();
  }
}
</script>
</body></html>`;
  return [
    { path: "index.html", contents: html },
    { path: "spec.json", contents: JSON.stringify(spec, null, 2) },
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
