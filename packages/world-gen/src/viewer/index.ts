/**
 * Self-contained viewer HTML for generated 3D assets.
 *
 *   - For GLB models — Google's <model-viewer> web component (battle-tested,
 *     ~20kb). Drag to orbit, AR button on supported devices.
 *   - For Gaussian splats — World Labs' Spark 2.0 (open-source) over THREE.js,
 *     loaded from CDN. Streams the SPZ/PLY archive with LOD.
 *
 * The HTML is fully static — no build step, no runtime dependency on the
 * Praetor API. Drop it on any S3 bucket or static host.
 */

export interface ModelViewerOptions {
  glbUrl: string;
  title?: string;
  background?: string;
  poster?: string;
  autoRotate?: boolean;
  ar?: boolean;
}

export function renderGlbViewerHtml(opts: ModelViewerOptions): string {
  const title = escapeText(opts.title ?? "Praetor — 3D Model");
  const bg = opts.background ?? "radial-gradient(circle at 50% 35%, #0f172a 0%, #000 70%)";
  const poster = opts.poster ? `poster="${escapeAttr(opts.poster)}"` : "";
  const autorotate = opts.autoRotate !== false ? "auto-rotate" : "";
  const ar = opts.ar !== false ? `ar ar-modes="webxr scene-viewer quick-look"` : "";
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<script type="module" src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"></script>
<style>
  html,body{margin:0;height:100%;background:${escapeAttr(bg)};color:#fff;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
  model-viewer{width:100vw;height:100vh;background:transparent;--poster-color:transparent}
  .meta{position:fixed;top:16px;left:16px;padding:10px 14px;border-radius:10px;background:rgba(15,23,42,.6);backdrop-filter:blur(10px);border:1px solid rgba(165,180,252,.18)}
</style>
</head><body>
<model-viewer src="${escapeAttr(opts.glbUrl)}" alt="${title}" ${poster} camera-controls ${autorotate} ${ar} exposure="0.95" environment-image="neutral"></model-viewer>
<div class="meta">${title}</div>
</body></html>`;
}

export interface SplatViewerOptions {
  splatUrl: string; // SPZ or PLY
  title?: string;
  background?: string;
}

export function renderSplatViewerHtml(opts: SplatViewerOptions): string {
  const title = escapeText(opts.title ?? "Praetor — 3D World");
  const bg = opts.background ?? "#000";
  // Spark 2.0 ships as @sparkjsdev/spark on npm; we load via the unpkg CDN so
  // the HTML stays static. Spark handles SPZ + PLY natively and will stream
  // LOD when the splat archive supports it.
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
  html,body{margin:0;height:100%;background:${escapeAttr(bg)};color:#fff;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;overflow:hidden}
  #stage{position:fixed;inset:0}
  .meta{position:fixed;top:16px;left:16px;padding:10px 14px;border-radius:10px;background:rgba(15,23,42,.55);backdrop-filter:blur(10px);border:1px solid rgba(165,180,252,.18);z-index:5}
  .hint{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:rgba(15,23,42,.55);backdrop-filter:blur(10px);font-size:12px;opacity:.85}
</style>
<script type="importmap">
{ "imports": {
  "three": "https://unpkg.com/three@0.166.0/build/three.module.js",
  "three/addons/": "https://unpkg.com/three@0.166.0/examples/jsm/",
  "@sparkjsdev/spark": "https://unpkg.com/@sparkjsdev/spark/dist/spark.module.js"
} }
</script>
</head><body>
<div id="stage"></div>
<div class="meta">${title}</div>
<div class="hint">drag to orbit · scroll to zoom</div>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SplatMesh } from "@sparkjsdev/spark";

const stage = document.getElementById("stage");
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 200);
camera.position.set(0, 1.2, 3.6);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
stage.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1, 0);

const splat = new SplatMesh({ url: ${JSON.stringify(opts.splatUrl)} });
scene.add(splat);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

(function loop() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
})();
</script>
</body></html>`;
}

function escapeAttr(s: string) { return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeText(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
