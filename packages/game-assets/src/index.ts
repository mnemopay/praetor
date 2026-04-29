/**
 * Praetor game-asset pipeline — one spec → runnable Godot 4.4 project.
 *
 *   concept → sprites → textures → music → sfx → code → project
 *
 * Same adapter shape as @praetor/ugc. Every stage has a paid backend (best
 * quality) and a zero-cost fallback so a charter can keep running when API
 * credits are exhausted. The emitter writes a folder Godot can open
 * directly: `project.godot`, `Main.tscn`, `controller.gd`, plus the
 * generated assets in canonical paths.
 */
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/* ---------- Spec & backends ---------------------------------------------- */

export interface GameAssetSpec {
  /** Stable id used as the output folder name. */
  id: string;
  /** One-line idea — drives the concept image and prompt cascade. */
  goal: string;
  /** Optional override for the conceptArt prompt. */
  conceptPrompt?: string;
  /** Number of cardinal-direction sprite frames. Default 4 (down/left/right/up). */
  spriteFrames?: number;
  /** Number of seamless texture tiles. Default 6. */
  textureTiles?: number;
  /** Loop length for the music track in seconds. Default 60. */
  musicSeconds?: number;
  /** Number of SFX cues (jump, hit, pickup, ui-confirm, ui-cancel, music-sting). Default 6. */
  sfxCues?: number;
  /** Window dimensions for the generated Godot project. Default 1280x720. */
  width?: number;
  height?: number;
  /** Tonal direction for the music + SFX. e.g. "8-bit chiptune", "lo-fi ambient". */
  audioMood?: string;
  /** Optional explicit list of SFX cue names. Falls back to the canonical six. */
  sfxNames?: string[];
}

export type ConceptBackend = "openai-image" | "fal-flux" | "pollinations" | "reuse";
export type SpriteBackend = "nano-banana-bg-removed" | "openai-image" | "pollinations" | "aseprite-template" | "reuse";
export type TextureBackend = "fal-flux-tileable" | "noise-procedural" | "reuse";
export type MusicBackend = "suno-api" | "elevenlabs-music" | "royalty-free-pack" | "silent";
export type SfxBackend = "elevenlabs-sfx" | "sfxr-presets" | "silent";
export type CodeBackend = "anthropic-claude" | "static-template";

export interface GameBackends {
  concept: ConceptBackend;
  sprite: SpriteBackend;
  texture: TextureBackend;
  music: MusicBackend;
  sfx: SfxBackend;
  code: CodeBackend;
}

/** Zero-cost defaults — runs without a single API key. */
export const DEFAULT_BACKENDS: GameBackends = {
  concept: "reuse",
  sprite: "aseprite-template",
  texture: "noise-procedural",
  music: "silent",
  sfx: "silent",
  code: "static-template",
};

export interface GameRenderResult {
  spec: GameAssetSpec;
  /** Folder Godot can open — contains project.godot, Main.tscn, etc. */
  outputDir: string;
  durationMs: number;
  costUsd: number;
  backends: GameBackends;
  /** Per-stage relative paths under outputDir. */
  assets: {
    conceptArt: string;
    spriteSheet: string;
    textures: string[];
    music?: string;
    sfx: string[];
    controllerScript: string;
    sceneFile: string;
    projectFile: string;
  };
}

export interface GameAssetsRenderer {
  render: (spec: GameAssetSpec, override?: Partial<GameBackends>) => Promise<GameRenderResult>;
}

/* ---------- Pricing ------------------------------------------------------- */

/**
 * Per-clip list prices, April 2026. Surfaced through MnemoPay metered billing
 * so a charter can't silently drain a provider quota.
 */
export function priceOf(b: GameBackends, spec: GameAssetSpec): number {
  const sprites = spec.spriteFrames ?? 4;
  const tiles = spec.textureTiles ?? 6;
  const cues = spec.sfxCues ?? 6;
  const concept =
    b.concept === "openai-image" ? 0.04
    : b.concept === "fal-flux" ? 0.025
    : 0;
  const sprite =
    b.sprite === "nano-banana-bg-removed" ? sprites * 0.04
    : b.sprite === "openai-image" ? sprites * 0.04
    : 0;
  const texture =
    b.texture === "fal-flux-tileable" ? tiles * 0.025
    : 0;
  const music =
    b.music === "suno-api" ? 0.30
    : b.music === "elevenlabs-music" ? 0.25
    : 0;
  const sfx =
    b.sfx === "elevenlabs-sfx" ? cues * 0.018
    : 0;
  const code =
    b.code === "anthropic-claude" ? 0.45
    : 0;
  return Number((concept + sprite + texture + music + sfx + code).toFixed(4));
}

/* ---------- Adapter contracts -------------------------------------------- */

export interface ConceptAdapter {
  backend: ConceptBackend;
  generate: (args: { prompt: string; width: number; height: number }) => Promise<{ imagePath: string }>;
}

export interface SpriteAdapter {
  backend: SpriteBackend;
  generate: (args: { prompt: string; frames: number; width: number; height: number }) => Promise<{ sheetPath: string }>;
}

export interface TextureAdapter {
  backend: TextureBackend;
  generate: (args: { prompt: string; tiles: number; size: number }) => Promise<{ texturePaths: string[] }>;
}

export interface MusicAdapter {
  backend: MusicBackend;
  generate: (args: { prompt: string; seconds: number }) => Promise<{ audioPath: string }>;
}

export interface SfxAdapter {
  backend: SfxBackend;
  generate: (args: { cues: { name: string; description: string }[] }) => Promise<{ paths: string[] }>;
}

export interface CodeAdapter {
  backend: CodeBackend;
  generate: (args: { spec: GameAssetSpec }) => Promise<{ controllerCode: string }>;
}

export interface GameAdapters {
  concept: Partial<Record<ConceptBackend, ConceptAdapter>>;
  sprite: Partial<Record<SpriteBackend, SpriteAdapter>>;
  texture: Partial<Record<TextureBackend, TextureAdapter>>;
  music: Partial<Record<MusicBackend, MusicAdapter>>;
  sfx: Partial<Record<SfxBackend, SfxAdapter>>;
  code: Partial<Record<CodeBackend, CodeAdapter>>;
  outDir?: string;
}

/* ---------- Free-tier built-in adapters ---------------------------------- */

/**
 * 1×1 transparent PNG. Used by every "reuse" / "aseprite-template" /
 * "noise-procedural" zero-cost path so the emitter never blocks on a missing
 * binary asset. The generated Godot project still opens and runs — it just
 * looks like a single transparent pixel until real assets get wired in.
 */
const TRANSPARENT_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da636060606000000000050001a5f645400000000049454e44ae426082",
  "hex",
);

class ReuseConcept implements ConceptAdapter {
  backend: ConceptBackend = "reuse";
  constructor(private readonly outDir: string) {}
  async generate() {
    const p = join(this.outDir, "concept.png");
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, TRANSPARENT_PNG);
    return { imagePath: p };
  }
}

class AsepriteTemplateSprite implements SpriteAdapter {
  backend: SpriteBackend = "aseprite-template";
  constructor(private readonly outDir: string) {}
  async generate(args: { frames: number }) {
    const p = join(this.outDir, "sprites", `sheet_${args.frames}f.png`);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, TRANSPARENT_PNG);
    return { sheetPath: p };
  }
}

class NoiseProceduralTexture implements TextureAdapter {
  backend: TextureBackend = "noise-procedural";
  constructor(private readonly outDir: string) {}
  async generate(args: { tiles: number }) {
    const paths: string[] = [];
    for (let i = 0; i < args.tiles; i++) {
      const p = join(this.outDir, "textures", `tile_${i}.png`);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, TRANSPARENT_PNG);
      paths.push(p);
    }
    return { texturePaths: paths };
  }
}

class SilentMusic implements MusicAdapter {
  backend: MusicBackend = "silent";
  async generate() { return { audioPath: "" }; }
}

class SilentSfx implements SfxAdapter {
  backend: SfxBackend = "silent";
  async generate(args: { cues: { name: string }[] }) { return { paths: args.cues.map(() => "") }; }
}

class StaticTemplateCode implements CodeAdapter {
  backend: CodeBackend = "static-template";
  async generate(args: { spec: GameAssetSpec }) {
    return { controllerCode: STATIC_CONTROLLER_GD(args.spec) };
  }
}

/**
 * Pollinations.ai — keyless free image generation, no quota auth required.
 * Implements both ConceptAdapter and SpriteAdapter via two thin wrappers.
 *
 *   GET https://image.pollinations.ai/prompt/<encoded>?width=W&height=H&nologo=true
 */
async function pollinationsFetch(prompt: string, width: number, height: number): Promise<Buffer> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pollinations: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

export class PollinationsConceptAdapter implements ConceptAdapter {
  backend: ConceptBackend = "pollinations";
  constructor(private readonly outDir: string) {}
  async generate(args: { prompt: string; width: number; height: number }) {
    const p = join(this.outDir, "concept.png");
    await mkdir(dirname(p), { recursive: true });
    try {
      const png = await pollinationsFetch(args.prompt, args.width, args.height);
      await writeFile(p, png);
    } catch {
      await writeFile(p, TRANSPARENT_PNG);
    }
    return { imagePath: p };
  }
}

export class PollinationsSpriteAdapter implements SpriteAdapter {
  backend: SpriteBackend = "pollinations";
  constructor(private readonly outDir: string) {}
  async generate(args: { prompt: string; frames: number; width: number; height: number }) {
    const p = join(this.outDir, "sprites", `sheet_${args.frames}f.png`);
    await mkdir(dirname(p), { recursive: true });
    const sheetW = args.width * args.frames;
    try {
      const png = await pollinationsFetch(`${args.prompt} — sprite sheet, ${args.frames} frames horizontal, transparent background`, sheetW, args.height);
      await writeFile(p, png);
    } catch {
      await writeFile(p, TRANSPARENT_PNG);
    }
    return { sheetPath: p };
  }
}

/* ---------- Godot project emitter ---------------------------------------- */

export const CANONICAL_SFX_CUES = [
  { name: "jump",         description: "short upward whoosh, retro game jump" },
  { name: "hit",          description: "soft thump, low-mid impact" },
  { name: "pickup",       description: "rising bell ping, positive feedback" },
  { name: "ui_confirm",   description: "warm digital click, confirm" },
  { name: "ui_cancel",    description: "muted digital click, cancel" },
  { name: "music_sting",  description: "single rising note for level start" },
];

function PROJECT_GODOT(spec: GameAssetSpec): string {
  const w = spec.width ?? 1280;
  const h = spec.height ?? 720;
  return `; Generated by @praetor/game-assets
; ${spec.goal}

config_version=5

[application]
config/name="${escapeIni(spec.id)}"
run/main_scene="res://Main.tscn"
config/features=PackedStringArray("4.4", "Forward Plus")

[display]
window/size/viewport_width=${w}
window/size/viewport_height=${h}
window/stretch/mode="canvas_items"
window/stretch/aspect="keep"
`;
}

function MAIN_TSCN(): string {
  return `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://controller.gd" id="1"]
[ext_resource type="Texture2D" path="res://sprites/sheet_4f.png" id="2"]

[node name="Main" type="Node2D"]

[node name="Player" type="Sprite2D" parent="."]
texture = ExtResource("2")
position = Vector2(640, 360)
script = ExtResource("1")
`;
}

function STATIC_CONTROLLER_GD(spec: GameAssetSpec): string {
  return `extends Sprite2D
# Generated by @praetor/game-assets
# ${spec.goal}

@export var move_speed: float = 220.0

func _process(delta: float) -> void:
	var dir := Vector2.ZERO
	if Input.is_action_pressed("ui_left"):  dir.x -= 1.0
	if Input.is_action_pressed("ui_right"): dir.x += 1.0
	if Input.is_action_pressed("ui_up"):    dir.y -= 1.0
	if Input.is_action_pressed("ui_down"):  dir.y += 1.0
	if dir != Vector2.ZERO:
		position += dir.normalized() * move_speed * delta
`;
}

function escapeIni(s: string): string {
  return s.replace(/"/g, '\\"');
}

/* ---------- Renderer ----------------------------------------------------- */

export class GameAssetsRendererImpl implements GameAssetsRenderer {
  constructor(private readonly adapters: GameAdapters) {}
  async render(spec: GameAssetSpec, override: Partial<GameBackends> = {}): Promise<GameRenderResult> {
    const t0 = Date.now();
    const backends = { ...DEFAULT_BACKENDS, ...override };
    const outDir = join(this.adapters.outDir ?? "out", "games", spec.id);
    await mkdir(outDir, { recursive: true });

    const conceptAdapter: ConceptAdapter = this.adapters.concept[backends.concept] ?? new ReuseConcept(outDir);
    const spriteAdapter: SpriteAdapter = this.adapters.sprite[backends.sprite] ?? new AsepriteTemplateSprite(outDir);
    const textureAdapter: TextureAdapter = this.adapters.texture[backends.texture] ?? new NoiseProceduralTexture(outDir);
    const musicAdapter: MusicAdapter = this.adapters.music[backends.music] ?? new SilentMusic();
    const sfxAdapter: SfxAdapter = this.adapters.sfx[backends.sfx] ?? new SilentSfx();
    const codeAdapter: CodeAdapter = this.adapters.code[backends.code] ?? new StaticTemplateCode();

    const conceptPrompt = spec.conceptPrompt ?? `${spec.goal} — pixel art concept sheet, 16-color palette, single hero, simple environment`;
    const concept = await conceptAdapter.generate({
      prompt: conceptPrompt,
      width: spec.width ?? 1280,
      height: spec.height ?? 720,
    });

    const sprite = await spriteAdapter.generate({
      prompt: `${spec.goal} — 4-direction character sprite sheet, transparent background, pixel art`,
      frames: spec.spriteFrames ?? 4,
      width: 64,
      height: 64,
    });

    const texture = await textureAdapter.generate({
      prompt: `${spec.goal} — seamless tile, environment texture, pixel art`,
      tiles: spec.textureTiles ?? 6,
      size: 1024,
    });

    const music = await musicAdapter.generate({
      prompt: `${spec.audioMood ?? "8-bit chiptune"} game loop matching: ${spec.goal}`,
      seconds: spec.musicSeconds ?? 60,
    });

    const sfxCues = (spec.sfxNames ?? CANONICAL_SFX_CUES.map((c) => c.name))
      .slice(0, spec.sfxCues ?? 6)
      .map((name) => CANONICAL_SFX_CUES.find((c) => c.name === name) ?? { name, description: name });
    const sfx = await sfxAdapter.generate({ cues: sfxCues });

    const code = await codeAdapter.generate({ spec });

    const projectPath = join(outDir, "project.godot");
    const scenePath = join(outDir, "Main.tscn");
    const controllerPath = join(outDir, "controller.gd");
    await writeFile(projectPath, PROJECT_GODOT(spec));
    await writeFile(scenePath, MAIN_TSCN());
    await writeFile(controllerPath, code.controllerCode);

    if (concept.imagePath !== join(outDir, "concept.png")) {
      await mkdir(outDir, { recursive: true });
      await copyFile(concept.imagePath, join(outDir, "concept.png"));
    }

    return {
      spec,
      outputDir: outDir,
      durationMs: Date.now() - t0,
      costUsd: priceOf(backends, spec),
      backends,
      assets: {
        conceptArt: "concept.png",
        spriteSheet: relativize(outDir, sprite.sheetPath),
        textures: texture.texturePaths.map((p) => relativize(outDir, p)),
        music: music.audioPath ? relativize(outDir, music.audioPath) : undefined,
        sfx: sfx.paths.map((p, i) => p ? relativize(outDir, p) : `sfx/${sfxCues[i].name}.silent`),
        controllerScript: "controller.gd",
        sceneFile: "Main.tscn",
        projectFile: "project.godot",
      },
    };
  }
}

function relativize(outDir: string, p: string): string {
  if (!p) return p;
  if (p.startsWith(outDir)) return p.slice(outDir.length).replace(/^[\\/]+/, "");
  return p;
}

/* ---------- Public factory ----------------------------------------------- */

export class MockGameRenderer implements GameAssetsRenderer {
  async render(spec: GameAssetSpec, override: Partial<GameBackends> = {}): Promise<GameRenderResult> {
    const inner = new GameAssetsRendererImpl({
      concept: {}, sprite: {}, texture: {}, music: {}, sfx: {}, code: {},
      outDir: ".praetor-mock",
    });
    return inner.render(spec, override);
  }
}

export function specFromGoal(args: { id: string; goal: string }): GameAssetSpec {
  return {
    id: args.id,
    goal: args.goal,
    spriteFrames: 4,
    textureTiles: 6,
    musicSeconds: 60,
    sfxCues: 6,
    width: 1280,
    height: 720,
    audioMood: "8-bit chiptune",
  };
}

export function defaultRenderer(opts: { outDir?: string } = {}): GameAssetsRendererImpl {
  // Free-tier renderer — no env keys required. Wire OpenAIImageAdapter,
  // FalFluxAdapter, SunoMusicAdapter, ElevenLabsSfxAdapter, AnthropicCodeAdapter
  // here as they get implemented in Weekend 2 of the charter.
  return new GameAssetsRendererImpl({
    concept: {}, sprite: {}, texture: {}, music: {}, sfx: {}, code: {},
    outDir: opts.outDir,
  });
}
