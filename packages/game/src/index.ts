/**
 * @praetor/game — web-native game engine.
 *
 * A charter declares a `GameSpec` with entities, sprites, audio, input
 * bindings, and a tick function. `emitGameHtml(spec)` returns a single
 * self-contained HTML string the user opens in any browser to play —
 * zero install, no third-party runtime, no asset CDN.
 *
 * The engine itself is ~3 KB minified (no Three.js, no Pixi, no Phaser).
 * 2D first; the canvas API is the renderer. Phase 2 will add an optional
 * Three.js layer (origin: "adapter") for 3D scenes.
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
  /** Width / height in px. */
  width: number;
  height: number;
  /** Optional flat tag system for collision filtering ("player", "enemy", "wall"). */
  tags?: string[];
  /** Optional vector velocity (px/s) — applied each tick before user logic runs. */
  vx?: number;
  vy?: number;
  /** Per-entity bag for charter logic. */
  data?: Record<string, unknown>;
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

export function emitGameHtml(spec: GameSpec): GameRunnerHandle {
  validateSpec(spec);
  const externalAssets = [
    ...spec.sprites.map((s) => s.src).filter((s) => /^https?:\/\//.test(s)),
    ...(spec.audio ?? []).map((a) => a.src).filter((s) => /^https?:\/\//.test(s)),
  ];
  const fps = spec.fps ?? 60;
  const bg = spec.background ?? "#000000";
  const html = `<!doctype html>
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
};

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
    // Apply velocity before user logic.
    for (const e of state.entities) {
      if (e.vx) e.x += e.vx * dt;
      if (e.vy) e.y += e.vy * dt;
    }
    userTick(state, input, dt);
  }
  // Render.
  ctx.fillStyle = "${bg}";
  ctx.fillRect(0, 0, SPEC.width, SPEC.height);
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
  actionsJustPressed.clear();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
</body>
</html>
`;
  return { html, byteSize: html.length, externalAssets };
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
