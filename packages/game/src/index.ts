/**
 * @praetor/game — web-native game engine.
 *
 * A charter declares a `GameSpec` with entities, sprites, audio, input
 * bindings, and a tick function. `emitGameHtml(spec)` returns a single
 * self-contained HTML string the user opens in any browser to play —
 * zero install, no third-party runtime, no asset CDN.
 *
 * The engine itself is ~3 KB minified (no Three.js, no Pixi, no Phaser).
 * 2D first; the canvas API is the renderer.
 *
 * Phase 2 additions (all opt-in, origin: "adapter"):
 *   - `spec.scene3d`  — optional Three.js 3D renderer (CDN importmap)
 *   - `spec.physics`  — AABB collision, gravity, grounded flag
 *   - `spec.camera`   — viewport follow, deadzone, bounds, smoothing
 *
 * Companion to `@praetor/game-assets` (the Godot 4.4 scaffolder). Use
 * game-assets for serious game projects (multi-week, full engine);
 * @praetor/game for the "charter ships a playable demo TODAY" use case.
 */

/* ---------- Asset manifest --------------------------------------------- */

export interface GameSprite {
  /** Stable id referenced by entities. */
  id: string;
  /** URL or data: URI. PNG / WebP / AVIF. */
  src: string;
  /** Sprite-sheet frame count (1 = static). */
  frames?: number;
  /** Frame width in px (single frame). */
  frameWidth?: number;
  /** Frame height in px. */
  frameHeight?: number;
  /** Frames per second when animated. */
  fps?: number;
}

export interface GameAudio {
  id: string;
  src: string;
  /** Loop the clip (e.g. background music). */
  loop?: boolean;
  /** Volume 0-1. */
  volume?: number;
}

/* ---------- Entity model ----------------------------------------------- */

export interface GameEntity {
  id: string;
  /** Sprite id from the manifest. */
  sprite?: string;
  x: number;
  y: number;
  /** Z-position for 3D mode. */
  z?: number;
  /** Width / height in px (2D) or x/z size (3D). */
  width: number;
  height: number;
  /** Euler rotation [x,y,z] in radians — used by the 3D renderer. */
  rotation?: [number, number, number];
  /** Optional flat tag system for collision filtering ("player", "enemy", "wall"). */
  tags?: string[];
  /** Optional vector velocity (px/s) — applied each tick before user logic runs. */
  vx?: number;
  vy?: number;
  /** Per-entity bag for charter logic. */
  data?: Record<string, unknown>;
  /**
   * Physics: if true the entity participates in AABB collision resolution.
   * Static entities never move; dynamic ones get pushed back.
   * origin: "adapter" — part of the Phase 2 physics layer.
   */
  solid?: boolean;
  /** Physics: if true the entity is immovable (walls, floors). */
  static?: boolean;
  /**
   * 3D mesh descriptor. When present the Three.js renderer creates the
   * corresponding mesh. Entities without a mesh are rendered to the HUD
   * overlay so 2D HUDs still work in 3D mode.
   * origin: "adapter" — part of the Phase 2 Three.js layer.
   */
  mesh?: {
    kind: "box" | "sphere" | "plane" | "model-glb";
    /** For model-glb: URL of the GLB file. */
    src?: string;
    /** Size override [x, y, z]. Defaults to [width, height, width]. */
    size?: [number, number, number];
    /** CSS color string. */
    color?: string;
  };
}

/* ---------- Input system ----------------------------------------------- */

export type GameInputAction = "up" | "down" | "left" | "right" | "primary" | "secondary" | "pause";

export interface GameInputBinding {
  /** Action name the charter listens for. */
  action: GameInputAction | string;
  /** Keyboard codes that fire this action (e.g. "KeyW", "ArrowUp"). */
  keys?: string[];
  /** Mouse buttons: 0=left, 1=middle, 2=right. */
  mouseButton?: number;
}

/* ---------- Phase 2 specs ----------------------------------------------- */

/**
 * Optional 3D scene configuration.
 * When present the emitter switches to the Three.js renderer path
 * (origin: "adapter") and injects a pinned importmap pointing to
 * cdn.jsdelivr.net. The 2D canvas API is NOT used.
 */
export interface Scene3DSpec {
  camera: {
    fov: number;
    near: number;
    far: number;
  };
  /** CSS color or hex. Defaults to black. */
  background?: string;
  lights?: {
    /** Ambient light intensity (0-1). */
    ambient?: number;
    directional?: Array<{
      color: string;
      intensity: number;
      direction: [number, number, number];
    }>;
  };
}

/**
 * Optional AABB physics layer (origin: "adapter").
 * Gravity is [gx, gy] in px/s². Mode controls behavior:
 *   - "none"        — only push-out; no gravity.
 *   - "topdown"     — no gravity; 4-direction collision.
 *   - "platformer"  — downward gravity; `data._grounded` flag set on landing.
 */
export interface PhysicsSpec {
  gravity?: [number, number];
  mode: "none" | "topdown" | "platformer";
}

/**
 * Optional camera / viewport (origin: "adapter").
 * In 2D mode applies `ctx.translate` per frame.
 * In 3D mode moves the Three.js camera's x/z following the target entity.
 */
export interface CameraSpec {
  /** Entity id to follow. */
  follow?: string;
  /** Pixel window where the camera does NOT move. */
  deadzone?: { x: number; y: number };
  /** Level bounds — clamp so the camera never shows outside. */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Lerp factor 0 (instant) – 0.9 (floaty). Defaults to 0.1. */
  smoothing?: number;
}

/* ---------- Spec ------------------------------------------------------- */

export interface GameSpec {
  id: string;
  title: string;
  /** Canvas size in CSS pixels. The renderer scales to fit the viewport
   * while preserving aspect ratio. */
  width: number;
  height: number;
  /** Background color (hex). Defaults to black. */
  background?: string;
  /** Target frames per second. Defaults to 60. */
  fps?: number;
  sprites: GameSprite[];
  audio?: GameAudio[];
  inputs: GameInputBinding[];
  /** Initial entity set. Charter logic mutates this list at runtime. */
  entities: GameEntity[];
  /** The game's `tick` function — runs every frame. Charter authors hand
   * Praetor the function source as a string; the renderer inlines it into
   * the emitted HTML so the game has no external script. */
  tickSource: string;
  /** Optional `init` function source — runs once on game start. */
  initSource?: string;
  /** HUD overlay HTML (score, lives, etc). Praetor sanitizes before inlining. */
  hudHtml?: string;
  /** Optional CSS overrides for the HUD layer. */
  hudCss?: string;
  /**
   * opt-in 3D scene mode (origin: "adapter").
   * When set the emitter switches to the Three.js renderer; a 2D canvas
   * renderer is NOT used. Three.js is loaded from CDN via importmap.
   */
  scene3d?: Scene3DSpec;
  /**
   * opt-in AABB physics (origin: "adapter").
   * Runs before the user's tick each frame.
   */
  physics?: PhysicsSpec;
  /**
   * opt-in camera / viewport follow (origin: "adapter").
   */
  camera?: CameraSpec;
}

export interface GameRunnerHandle {
  /** Single-file HTML string ready to write to disk + open in a browser. */
  html: string;
  /** Bytes-on-the-wire estimate (uncompressed). */
  byteSize: number;
  /** Sprite + audio asset URLs the host must reach for the game to work. */
  externalAssets: string[];
}

/* ---------- Emitter ---------------------------------------------------- */

/** Pinned Three.js version used by the 3D adapter. */
const THREE_VERSION = "0.166.0";
const THREE_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`;
const THREE_ADDONS_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/`;

export function emitGameHtml(spec: GameSpec): GameRunnerHandle {
  validateSpec(spec);
  const externalAssets = [
    ...spec.sprites.map((s) => s.src).filter((s) => /^https?:\/\//.test(s)),
    ...(spec.audio ?? []).map((a) => a.src).filter((s) => /^https?:\/\//.test(s)),
  ];
  const fps = spec.fps ?? 60;
  const bg = spec.background ?? "#000000";

  const html = spec.scene3d
    ? emit3dHtml(spec, bg, fps, externalAssets)
    : emit2dHtml(spec, bg, fps);

  return { html, byteSize: html.length, externalAssets };
}

/* ---------- 2-D emitter (Phase 1 path, fully preserved) ---------------- */

function emit2dHtml(spec: GameSpec, bg: string, fps: number): string {
  const physicsRuntime = spec.physics ? buildPhysicsRuntime(spec.physics) : "";
  const cameraRuntime = spec.camera ? buildCameraRuntime2d(spec.camera, spec.width, spec.height) : "";
  const cameraState = spec.camera
    ? `camera: { x: 0, y: 0, width: SPEC.width, height: SPEC.height },`
    : "";
  const cameraApply = spec.camera ? `applyCamera(state, ctx);` : "";
  const cameraReset = spec.camera ? `resetCamera(ctx);` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(spec.title)}</title>
<style>
html, body { margin: 0; padding: 0; height: 100%; background: ${bg}; overflow: hidden; font-family: system-ui, sans-serif; }
#stage { position: fixed; inset: 0; display: grid; place-items: center; }
canvas { background: ${bg}; image-rendering: pixelated; image-rendering: crisp-edges; max-width: 100vw; max-height: 100vh; aspect-ratio: ${spec.width} / ${spec.height}; width: 100%; height: auto; }
#hud { position: absolute; top: 12px; left: 12px; right: 12px; pointer-events: none; color: white; font-family: ui-monospace, "JetBrains Mono", monospace; }
${spec.hudCss ?? ""}
</style>
</head>
<body>
<div id="stage">
  <canvas id="game" width="${spec.width}" height="${spec.height}"></canvas>
  <div id="hud">${spec.hudHtml ?? ""}</div>
</div>
<script type="module">
const SPEC = ${JSON.stringify(spec, null, 2)};
const FPS = ${fps};
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");

// Asset preload — sprite Image objects + Audio buffers.
const sprites = {};
const sprAssets = await Promise.all(SPEC.sprites.map((s) => new Promise((res, rej) => {
  const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => res({ id: s.id, img, frames: s.frames ?? 1, frameWidth: s.frameWidth ?? img.width, frameHeight: s.frameHeight ?? img.height, fps: s.fps ?? 0 }); img.onerror = rej; img.src = s.src;
})));
sprAssets.forEach((s) => { sprites[s.id] = s; });

const audios = {};
(SPEC.audio ?? []).forEach((a) => {
  const el = new Audio(a.src);
  el.loop = !!a.loop; el.volume = a.volume ?? 1;
  audios[a.id] = el;
});

// Input system.
const actionsHeld = new Set();
const actionsJustPressed = new Set();
const keyToActions = new Map();
const mouseButtonToActions = new Map();
for (const bind of SPEC.inputs) {
  for (const k of bind.keys ?? []) {
    if (!keyToActions.has(k)) keyToActions.set(k, []);
    keyToActions.get(k).push(bind.action);
  }
  if (typeof bind.mouseButton === "number") {
    if (!mouseButtonToActions.has(bind.mouseButton)) mouseButtonToActions.set(bind.mouseButton, []);
    mouseButtonToActions.get(bind.mouseButton).push(bind.action);
  }
}
window.addEventListener("keydown", (e) => {
  for (const a of keyToActions.get(e.code) ?? []) {
    if (!actionsHeld.has(a)) actionsJustPressed.add(a);
    actionsHeld.add(a);
  }
});
window.addEventListener("keyup", (e) => {
  for (const a of keyToActions.get(e.code) ?? []) actionsHeld.delete(a);
});
canvas.addEventListener("pointerdown", (e) => {
  for (const a of mouseButtonToActions.get(e.button) ?? []) {
    if (!actionsHeld.has(a)) actionsJustPressed.add(a);
    actionsHeld.add(a);
  }
});
canvas.addEventListener("pointerup", (e) => {
  for (const a of mouseButtonToActions.get(e.button) ?? []) actionsHeld.delete(a);
});

const input = {
  held: (a) => actionsHeld.has(a),
  pressed: (a) => actionsJustPressed.has(a),
};

// Collision pair tracking for state.collide().
const _collidingPairs = new Set();

// Entity state — mutable by charter logic.
const state = {
  entities: structuredClone(SPEC.entities),
  audios,
  hud,
  setHud(html) { hud.innerHTML = html; },
  play(id) { audios[id]?.play().catch(() => {}); },
  stop(id) { const a = audios[id]; if (a) { a.pause(); a.currentTime = 0; } },
  width: SPEC.width,
  height: SPEC.height,
  time: 0,
  paused: false,
  ${cameraState}
  /** Returns true if entity overlaps any entity matching tag. */
  collide(entity, tag) {
    for (const key of _collidingPairs) {
      const [a, b] = key.split("|");
      if (a === entity.id || b === entity.id) {
        const other = state.entities.find(e => e.id === (a === entity.id ? b : a));
        if (other && other.tags && other.tags.includes(tag)) return true;
      }
    }
    return false;
  },
};

${physicsRuntime}
${cameraRuntime}

// Charter-supplied init + tick.
const userInit = ${spec.initSource ? `(${spec.initSource})` : "() => {}"};
const userTick = (${spec.tickSource});
userInit(state, input);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!state.paused) {
    state.time += dt;
    // Apply velocity before physics + user logic.
    for (const e of state.entities) {
      if (e.vx) e.x += e.vx * dt;
      if (e.vy) e.y += e.vy * dt;
    }
    ${spec.physics ? "resolvePhysics(state, dt, _collidingPairs);" : ""}
    ${spec.camera ? "tickCamera(state, dt);" : ""}
    userTick(state, input, dt);
  }
  // Render.
  ctx.fillStyle = "${bg}";
  ctx.fillRect(0, 0, SPEC.width, SPEC.height);
  ${cameraApply}
  for (const e of state.entities) {
    if (!e.sprite) continue;
    const s = sprites[e.sprite];
    if (!s) continue;
    if (s.frames > 1 && s.fps > 0) {
      const frame = Math.floor(state.time * s.fps) % s.frames;
      ctx.drawImage(s.img, frame * s.frameWidth, 0, s.frameWidth, s.frameHeight, e.x, e.y, e.width, e.height);
    } else {
      ctx.drawImage(s.img, e.x, e.y, e.width, e.height);
    }
  }
  ${cameraReset}
  actionsJustPressed.clear();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
</body>
</html>
`;
}

/* ---------- 3-D emitter (Phase 2, origin: "adapter") ------------------- */

function emit3dHtml(spec: GameSpec, bg: string, fps: number, externalAssets: string[]): string {
  const s3d = spec.scene3d!;
  const ambientIntensity = s3d.lights?.ambient ?? 0.4;
  const dirLights = s3d.lights?.directional ?? [
    { color: "#ffffff", intensity: 0.8, direction: [1, 2, 1] as [number, number, number] },
  ];
  const sceneBg = s3d.background ?? bg;
  const physicsRuntime = spec.physics ? buildPhysicsRuntime(spec.physics) : "";

  // GLB model URLs are external assets.
  for (const e of spec.entities) {
    if (e.mesh?.kind === "model-glb" && e.mesh.src && /^https?:\/\//.test(e.mesh.src)) {
      externalAssets.push(e.mesh.src);
    }
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(spec.title)}</title>
<script type="importmap">
{ "imports": {
  "three": "${THREE_CDN}",
  "three/addons/": "${THREE_ADDONS_CDN}"
} }
</script>
<style>
html, body { margin: 0; padding: 0; height: 100%; background: ${sceneBg}; overflow: hidden; font-family: system-ui, sans-serif; }
#stage { position: fixed; inset: 0; }
canvas { display: block; width: 100% !important; height: 100% !important; }
#hud { position: absolute; top: 12px; left: 12px; right: 12px; pointer-events: none; color: white; font-family: ui-monospace, "JetBrains Mono", monospace; z-index: 10; }
${spec.hudCss ?? ""}
</style>
</head>
<body>
<div id="stage">
  <div id="hud">${spec.hudHtml ?? ""}</div>
</div>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const SPEC = ${JSON.stringify(spec, null, 2)};
const FPS = ${fps};
const stage = document.getElementById("stage");
const hud = document.getElementById("hud");

// ---- Three.js scene setup ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(${JSON.stringify(sceneBg)});

const camera3d = new THREE.PerspectiveCamera(
  ${s3d.camera.fov},
  window.innerWidth / window.innerHeight,
  ${s3d.camera.near},
  ${s3d.camera.far}
);
camera3d.position.set(0, 5, 10);

const renderer3d = new THREE.WebGLRenderer({ antialias: true });
renderer3d.setPixelRatio(window.devicePixelRatio);
renderer3d.setSize(window.innerWidth, window.innerHeight);
renderer3d.shadowMap.enabled = true;
stage.appendChild(renderer3d.domElement);

// Lights.
const ambientLight = new THREE.AmbientLight(0xffffff, ${ambientIntensity});
scene.add(ambientLight);
${dirLights.map((dl) => `{
  const dl = new THREE.DirectionalLight(${JSON.stringify(dl.color)}, ${dl.intensity});
  dl.position.set(${dl.direction[0]}, ${dl.direction[1]}, ${dl.direction[2]});
  dl.castShadow = true;
  scene.add(dl);
}`).join("\n")}

// Resize handler.
window.addEventListener("resize", () => {
  camera3d.aspect = window.innerWidth / window.innerHeight;
  camera3d.updateProjectionMatrix();
  renderer3d.setSize(window.innerWidth, window.innerHeight);
});

// ---- Audio ----
const audios = {};
(SPEC.audio ?? []).forEach((a) => {
  const el = new Audio(a.src);
  el.loop = !!a.loop; el.volume = a.volume ?? 1;
  audios[a.id] = el;
});

// ---- Input system ----
const actionsHeld = new Set();
const actionsJustPressed = new Set();
const keyToActions = new Map();
const mouseButtonToActions = new Map();
for (const bind of SPEC.inputs) {
  for (const k of bind.keys ?? []) {
    if (!keyToActions.has(k)) keyToActions.set(k, []);
    keyToActions.get(k).push(bind.action);
  }
  if (typeof bind.mouseButton === "number") {
    if (!mouseButtonToActions.has(bind.mouseButton)) mouseButtonToActions.set(bind.mouseButton, []);
    mouseButtonToActions.get(bind.mouseButton).push(bind.action);
  }
}
window.addEventListener("keydown", (e) => {
  for (const a of keyToActions.get(e.code) ?? []) {
    if (!actionsHeld.has(a)) actionsJustPressed.add(a);
    actionsHeld.add(a);
  }
});
window.addEventListener("keyup", (e) => {
  for (const a of keyToActions.get(e.code) ?? []) actionsHeld.delete(a);
});
window.addEventListener("pointerdown", (e) => {
  for (const a of mouseButtonToActions.get(e.button) ?? []) {
    if (!actionsHeld.has(a)) actionsJustPressed.add(a);
    actionsHeld.add(a);
  }
});
window.addEventListener("pointerup", (e) => {
  for (const a of mouseButtonToActions.get(e.button) ?? []) actionsHeld.delete(a);
});
const input = {
  held: (a) => actionsHeld.has(a),
  pressed: (a) => actionsJustPressed.has(a),
};

// ---- Entity mesh map ----
const entityMeshes = new Map(); // entityId -> THREE.Object3D
const gltfLoader = new GLTFLoader();

function makeMesh(e) {
  if (!e.mesh) return null;
  const m = e.mesh;
  const sz = m.size ?? [e.width, e.height, e.width];
  const color = new THREE.Color(m.color ?? "#888888");
  let obj;
  if (m.kind === "box") {
    obj = new THREE.Mesh(new THREE.BoxGeometry(sz[0], sz[1], sz[2]), new THREE.MeshStandardMaterial({ color }));
  } else if (m.kind === "sphere") {
    obj = new THREE.Mesh(new THREE.SphereGeometry(sz[0] / 2, 32, 16), new THREE.MeshStandardMaterial({ color }));
  } else if (m.kind === "plane") {
    obj = new THREE.Mesh(new THREE.PlaneGeometry(sz[0], sz[2]), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
    obj.rotation.x = -Math.PI / 2;
  } else if (m.kind === "model-glb") {
    // Placeholder box while GLB loads.
    obj = new THREE.Group();
    if (m.src) {
      gltfLoader.load(m.src, (gltf) => {
        obj.add(gltf.scene);
      });
    }
  } else {
    obj = new THREE.Mesh(new THREE.BoxGeometry(sz[0], sz[1], sz[2]), new THREE.MeshStandardMaterial({ color }));
  }
  obj.position.set(e.x, e.z ?? 0, e.y);
  if (e.rotation) obj.rotation.set(e.rotation[0], e.rotation[1], e.rotation[2]);
  obj.castShadow = true;
  obj.receiveShadow = true;
  scene.add(obj);
  return obj;
}

// ---- Collision pair tracking ----
const _collidingPairs = new Set();

// ---- State ----
const state = {
  entities: structuredClone(SPEC.entities),
  audios,
  hud,
  setHud(html) { hud.innerHTML = html; },
  play(id) { audios[id]?.play().catch(() => {}); },
  stop(id) { const a = audios[id]; if (a) { a.pause(); a.currentTime = 0; } },
  width: SPEC.width,
  height: SPEC.height,
  time: 0,
  paused: false,
  camera: { x: 0, y: 0, width: SPEC.width, height: SPEC.height },
  collide(entity, tag) {
    for (const key of _collidingPairs) {
      const [a, b] = key.split("|");
      if (a === entity.id || b === entity.id) {
        const other = state.entities.find(e => e.id === (a === entity.id ? b : a));
        if (other && other.tags && other.tags.includes(tag)) return true;
      }
    }
    return false;
  },
};

// Init meshes for existing entities.
for (const e of state.entities) {
  const mesh = makeMesh(e);
  if (mesh) entityMeshes.set(e.id, mesh);
}

${physicsRuntime}

// ---- Camera follow (3D mode) ----
${spec.camera ? build3dCameraRuntime(spec.camera) : ""}

// ---- Charter init + tick ----
const userInit = ${spec.initSource ? `(${spec.initSource})` : "() => {}"};
const userTick = (${spec.tickSource});
userInit(state, input);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!state.paused) {
    state.time += dt;
    for (const e of state.entities) {
      if (e.vx) e.x += e.vx * dt;
      if (e.vy) e.y += e.vy * dt;
    }
    ${spec.physics ? "resolvePhysics(state, dt, _collidingPairs);" : ""}
    ${spec.camera ? "tick3dCamera(state, camera3d, dt);" : ""}
    userTick(state, input, dt);
  }
  // Sync Three.js meshes to entity positions.
  for (const e of state.entities) {
    const mesh = entityMeshes.get(e.id);
    if (mesh) {
      mesh.position.set(e.x, e.z ?? 0, e.y);
      if (e.rotation) mesh.rotation.set(e.rotation[0], e.rotation[1], e.rotation[2]);
    } else if (e.mesh) {
      // Entity was added at runtime — create its mesh now.
      const m = makeMesh(e);
      if (m) entityMeshes.set(e.id, m);
    }
  }
  // Remove meshes for deleted entities.
  for (const [id, mesh] of entityMeshes) {
    if (!state.entities.find(e => e.id === id)) {
      scene.remove(mesh);
      entityMeshes.delete(id);
    }
  }
  renderer3d.render(scene, camera3d);
  actionsJustPressed.clear();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
</body>
</html>
`;
}

/* ---------- Physics runtime (inlined into both 2D and 3D) -------------- */

function buildPhysicsRuntime(physics: PhysicsSpec): string {
  const [gx, gy] = physics.gravity ?? [0, 0];
  const isPlatformer = physics.mode === "platformer";
  // Sensible default downward gravity for platformer if the user didn't override.
  const effectiveGx = isPlatformer && gx === 0 && gy === 0 ? 0 : gx;
  const effectiveGy = isPlatformer && gx === 0 && gy === 0 ? 400 : gy;

  // Gravity + grounded-flag block: only emitted for platformer mode.
  // Keeping this conditional keeps the topdown/none emitted code smaller and
  // makes it trivially testable (no "_grounded" string in topdown output).
  const gravityBlock = isPlatformer ? `
  // Apply gravity + reset grounded flag before collision resolution.
  for (const e of ents) {
    if (e.solid && !e.static) {
      e.vy = (e.vy ?? 0) + ${effectiveGy} * dt;
      e.vx = (e.vx ?? 0) + ${effectiveGx} * dt;
      if (e.data) e.data._grounded = false;
      else e.data = { _grounded: false };
    }
  }` : "";

  // Y-axis push-out grounded flag: only for platformer.
  const groundedA = isPlatformer
    ? `if (push < 0 && a.data) a.data._grounded = true;`
    : "";
  const groundedB = isPlatformer
    ? `if (push > 0 && b.data) b.data._grounded = true;`
    : "";

  return `
// ---- AABB Physics — mode: ${physics.mode} (origin: "adapter") ----
function resolvePhysics(state, dt, collidingPairs) {
  collidingPairs.clear();
  const ents = state.entities;
  ${gravityBlock}
  // Broad-phase: N^2 (acceptable for entity counts < 200).
  for (let i = 0; i < ents.length; i++) {
    const a = ents[i];
    if (!a.solid) continue;
    for (let j = i + 1; j < ents.length; j++) {
      const b = ents[j];
      if (!b.solid) continue;
      // AABB overlap test.
      const ax = a.x, ay = a.y, aw = a.width, ah = a.height;
      const bx = b.x, by = b.y, bw = b.width, bh = b.height;
      const overlapX = ax + aw - bx;
      const overlapNX = bx + bw - ax;
      const overlapY = ay + ah - by;
      const overlapNY = by + bh - ay;
      if (overlapX <= 0 || overlapNX <= 0 || overlapY <= 0 || overlapNY <= 0) continue;
      // Record collision pair.
      collidingPairs.add(a.id + "|" + b.id);
      if (a.static && b.static) continue;
      // Find axis of least penetration.
      const minOX = Math.min(overlapX, overlapNX);
      const minOY = Math.min(overlapY, overlapNY);
      if (minOX < minOY) {
        // Push on X axis.
        const push = overlapX < overlapNX ? -minOX : minOX;
        if (!a.static && !b.static) {
          a.x += push / 2; b.x -= push / 2;
        } else if (!a.static) {
          a.x += push; a.vx = 0;
        } else {
          b.x -= push; b.vx = 0;
        }
      } else {
        // Push on Y axis.
        const push = overlapY < overlapNY ? -minOY : minOY;
        if (!a.static && !b.static) {
          a.y += push / 2; b.y -= push / 2;
        } else if (!a.static) {
          a.y += push; a.vy = 0;
          ${groundedA}
        } else {
          b.y -= push; b.vy = 0;
          ${groundedB}
        }
      }
    }
  }
}
`;
}

/* ---------- Camera runtime helpers ------------------------------------- */

function buildCameraRuntime2d(cam: CameraSpec, levelW: number, levelH: number): string {
  return `
// ---- Camera / viewport (origin: "adapter") ----
const _cam = { x: 0, y: 0 };
function tickCamera(state, dt) {
  ${cam.follow ? `
  const _target = state.entities.find(e => e.id === ${JSON.stringify(cam.follow)});
  if (_target) {
    const cx = _target.x + _target.width / 2 - state.width / 2;
    const cy = _target.y + _target.height / 2 - state.height / 2;
    const dzx = ${cam.deadzone?.x ?? 0};
    const dzy = ${cam.deadzone?.y ?? 0};
    const smooth = ${cam.smoothing ?? 0.1};
    if (Math.abs(cx - _cam.x) > dzx) _cam.x += (cx - _cam.x) * smooth + (cx > _cam.x ? dzx : -dzx) * smooth;
    if (Math.abs(cy - _cam.y) > dzy) _cam.y += (cy - _cam.y) * smooth + (cy > _cam.y ? dzy : -dzy) * smooth;
    ${cam.bounds ? `
    const bnd = ${JSON.stringify(cam.bounds)};
    _cam.x = Math.max(bnd.x, Math.min(bnd.x + bnd.width - state.width, _cam.x));
    _cam.y = Math.max(bnd.y, Math.min(bnd.y + bnd.height - state.height, _cam.y));
    ` : ""}
    state.camera = { x: _cam.x, y: _cam.y, width: state.width, height: state.height };
  }` : ""}
}
function applyCamera(state, ctx) {
  ctx.save();
  ctx.translate(-Math.round(_cam.x), -Math.round(_cam.y));
}
function resetCamera(ctx) {
  ctx.restore();
}
`;
}

function build3dCameraRuntime(cam: CameraSpec): string {
  return `
// ---- 3D Camera follow (origin: "adapter") ----
const _cam3d = { x: 0, z: 0 };
function tick3dCamera(state, camera3d, dt) {
  ${cam.follow ? `
  const _target = state.entities.find(e => e.id === ${JSON.stringify(cam.follow)});
  if (_target) {
    const smooth = ${cam.smoothing ?? 0.1};
    const tx = _target.x;
    const tz = _target.y; // y in 2D entity space = z in 3D world
    _cam3d.x += (tx - _cam3d.x) * smooth;
    _cam3d.z += (tz - _cam3d.z) * smooth;
    ${cam.bounds ? `
    const bnd = ${JSON.stringify(cam.bounds)};
    _cam3d.x = Math.max(bnd.x, Math.min(bnd.x + bnd.width, _cam3d.x));
    _cam3d.z = Math.max(bnd.y, Math.min(bnd.y + bnd.height, _cam3d.z));
    ` : ""}
    camera3d.position.x = _cam3d.x;
    camera3d.position.z = _cam3d.z + 10;
    camera3d.lookAt(_cam3d.x, 0, _cam3d.z);
    state.camera = { x: _cam3d.x, y: _cam3d.z, width: state.width, height: state.height };
  }` : ""}
}
`;
}

/* ---------- Validation ------------------------------------------------- */

function validateSpec(spec: GameSpec): void {
  if (!spec.id) throw new Error("GameSpec.id required");
  if (!spec.title) throw new Error("GameSpec.title required");
  if (spec.width <= 0 || spec.height <= 0) throw new Error("GameSpec.width and height must be positive");
  if (!spec.tickSource) throw new Error("GameSpec.tickSource required (the per-frame logic)");
  const spriteIds = new Set(spec.sprites.map((s) => s.id));
  for (const e of spec.entities) {
    if (e.sprite && !spriteIds.has(e.sprite)) throw new Error(`entity '${e.id}' references missing sprite '${e.sprite}'`);
  }
  // Phase 2 validation.
  if (spec.scene3d) {
    const cam = spec.scene3d.camera;
    if (!cam || cam.fov <= 0) throw new Error("scene3d.camera.fov must be > 0");
    if (cam.near <= 0) throw new Error("scene3d.camera.near must be > 0");
    if (cam.far <= cam.near) throw new Error("scene3d.camera.far must be > near");
    if (spec.scene3d.lights?.ambient !== undefined) {
      const a = spec.scene3d.lights.ambient;
      if (a < 0 || a > 1) throw new Error("scene3d.lights.ambient must be 0-1");
    }
  }
  if (spec.physics) {
    const valid = ["none", "topdown", "platformer"];
    if (!valid.includes(spec.physics.mode)) {
      throw new Error(`physics.mode must be one of: ${valid.join(", ")}`);
    }
  }
  if (spec.camera) {
    if (spec.camera.smoothing !== undefined) {
      const s = spec.camera.smoothing;
      if (s < 0 || s >= 1) throw new Error("camera.smoothing must be in [0, 1)");
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

/* ---------- Charter convenience: hello-game ---------------------------- */

/** Smallest possible playable game — a square the player moves with WASD.
 * Useful as a smoke test + the "did we install correctly" signal. */
export function helloGameSpec(): GameSpec {
  return {
    id: "hello-game",
    title: "Praetor — Hello Game",
    width: 480,
    height: 320,
    background: "#0b0b18",
    fps: 60,
    sprites: [],
    inputs: [
      { action: "up", keys: ["KeyW", "ArrowUp"] },
      { action: "down", keys: ["KeyS", "ArrowDown"] },
      { action: "left", keys: ["KeyA", "ArrowLeft"] },
      { action: "right", keys: ["KeyD", "ArrowRight"] },
    ],
    entities: [{ id: "player", x: 220, y: 140, width: 40, height: 40, tags: ["player"], data: { speed: 180, color: "#a5b4fc" } }],
    hudHtml: `<div style="font-size:13px;letter-spacing:.16em;text-transform:uppercase;opacity:.6">WASD to move · Praetor hello-game</div>`,
    tickSource: `function tick(state, input, dt){
      const p = state.entities.find(e => e.id === "player");
      if (!p) return;
      const speed = p.data.speed;
      if (input.held("up")) p.y -= speed * dt;
      if (input.held("down")) p.y += speed * dt;
      if (input.held("left")) p.x -= speed * dt;
      if (input.held("right")) p.x += speed * dt;
      p.x = Math.max(0, Math.min(state.width - p.width, p.x));
      p.y = Math.max(0, Math.min(state.height - p.height, p.y));
    }`,
    // Render the player as a colored rect since we have no sprite asset.
    // The emitter draws sprites from the manifest; for sprite-less entities
    // we paint a fallback in the tick by appending a per-entity overlay.
    initSource: `function init(state){
      // Patch the renderer to draw a colored rect when a sprite is missing.
      const ctx = document.getElementById("game").getContext("2d");
      state.paintRect = (e) => { ctx.fillStyle = e.data?.color ?? "#a5b4fc"; ctx.fillRect(e.x, e.y, e.width, e.height); };
    }`,
  };
}
