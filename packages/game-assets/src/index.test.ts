import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MockGameRenderer,
  GameAssetsRendererImpl,
  PollinationsConceptAdapter,
  PollinationsSpriteAdapter,
  specFromGoal,
  priceOf,
  DEFAULT_BACKENDS,
  CANONICAL_SFX_CUES,
  defaultRenderer,
  type GameBackends,
} from "./index.js";

describe("Praetor game-asset pipeline", () => {
  it("produces a default spec from a goal string", () => {
    const spec = specFromGoal({ id: "demo", goal: "A 2D platformer about a fox" });
    expect(spec.id).toBe("demo");
    expect(spec.spriteFrames).toBe(4);
    expect(spec.textureTiles).toBe(6);
    expect(spec.musicSeconds).toBe(60);
    expect(spec.sfxCues).toBe(6);
    expect(spec.width).toBe(1280);
    expect(spec.height).toBe(720);
  });

  it("default backends are all zero-cost", () => {
    expect(DEFAULT_BACKENDS).toEqual({
      concept: "reuse",
      sprite: "aseprite-template",
      texture: "noise-procedural",
      music: "silent",
      sfx: "silent",
      code: "static-template",
    });
    const spec = specFromGoal({ id: "free", goal: "free game" });
    expect(priceOf(DEFAULT_BACKENDS, spec)).toBe(0);
  });

  it("prices the paid path correctly", () => {
    const spec = specFromGoal({ id: "paid", goal: "paid game" });
    const paid: GameBackends = {
      concept: "openai-image",
      sprite: "nano-banana-bg-removed",
      texture: "fal-flux-tileable",
      music: "suno-api",
      sfx: "elevenlabs-sfx",
      code: "anthropic-claude",
    };
    // 0.04 + (4 * 0.04) + (6 * 0.025) + 0.30 + (6 * 0.018) + 0.45
    // = 0.04 + 0.16 + 0.15 + 0.30 + 0.108 + 0.45 = 1.208
    expect(priceOf(paid, spec)).toBeCloseTo(1.208, 4);
  });

  it("scales sprite/texture/sfx pricing with spec counts", () => {
    const spec = { ...specFromGoal({ id: "x", goal: "y" }), spriteFrames: 8, textureTiles: 12, sfxCues: 12 };
    const b: GameBackends = {
      concept: "reuse",
      sprite: "openai-image",
      texture: "fal-flux-tileable",
      music: "silent",
      sfx: "elevenlabs-sfx",
      code: "static-template",
    };
    // (8*0.04) + (12*0.025) + (12*0.018) = 0.32 + 0.30 + 0.216 = 0.836
    expect(priceOf(b, spec)).toBeCloseTo(0.836, 4);
  });

  it("canonical SFX cues are the documented six", () => {
    expect(CANONICAL_SFX_CUES.map((c) => c.name)).toEqual([
      "jump", "hit", "pickup", "ui_confirm", "ui_cancel", "music_sting",
    ]);
  });

  it("MockGameRenderer emits a runnable Godot project on the zero-cost path", async () => {
    const r = new MockGameRenderer();
    const tmp = mkdtempSync(join(tmpdir(), "praetor-game-"));
    const inner = new GameAssetsRendererImpl({
      concept: {}, sprite: {}, texture: {}, music: {}, sfx: {}, code: {},
      outDir: tmp,
    });
    const result = await inner.render(specFromGoal({ id: "test-game", goal: "tiny test game" }));

    expect(result.costUsd).toBe(0);
    expect(result.backends).toEqual(DEFAULT_BACKENDS);
    expect(result.outputDir).toContain("test-game");

    const project = readFileSync(join(result.outputDir, "project.godot"), "utf8");
    expect(project).toContain('config/name="test-game"');
    expect(project).toContain('run/main_scene="res://Main.tscn"');
    expect(project).toContain("4.4");

    const scene = readFileSync(join(result.outputDir, "Main.tscn"), "utf8");
    expect(scene).toContain("[gd_scene");
    expect(scene).toContain("controller.gd");

    const controller = readFileSync(join(result.outputDir, "controller.gd"), "utf8");
    expect(controller).toContain("extends Sprite2D");
    expect(controller).toContain("ui_left");
    expect(controller).toContain("ui_right");
    expect(controller).toContain("ui_up");
    expect(controller).toContain("ui_down");

    expect(existsSync(join(result.outputDir, "concept.png"))).toBe(true);
    expect(existsSync(join(result.outputDir, "sprites", "sheet_4f.png"))).toBe(true);
    for (let i = 0; i < 6; i++) {
      expect(existsSync(join(result.outputDir, "textures", `tile_${i}.png`))).toBe(true);
    }

    // 1×1 transparent PNG should exist and be small
    expect(statSync(join(result.outputDir, "concept.png")).size).toBeLessThan(200);
  });

  it("respects custom width/height/spriteFrames in emitted project", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "praetor-game-"));
    const r = new GameAssetsRendererImpl({
      concept: {}, sprite: {}, texture: {}, music: {}, sfx: {}, code: {},
      outDir: tmp,
    });
    const spec = { ...specFromGoal({ id: "wide", goal: "ultrawide" }), width: 1920, height: 1080, spriteFrames: 8 };
    const result = await r.render(spec);
    const project = readFileSync(join(result.outputDir, "project.godot"), "utf8");
    expect(project).toContain("window/size/viewport_width=1920");
    expect(project).toContain("window/size/viewport_height=1080");
    expect(existsSync(join(result.outputDir, "sprites", "sheet_8f.png"))).toBe(true);
  });

  it("Pollinations backends are zero-cost and falls back to transparent PNG when offline", async () => {
    const spec = specFromGoal({ id: "poll", goal: "pollinations test" });
    const b: GameBackends = { ...DEFAULT_BACKENDS, concept: "pollinations", sprite: "pollinations" };
    expect(priceOf(b, spec)).toBe(0);

    const tmp = mkdtempSync(join(tmpdir(), "praetor-game-"));
    const concept = new PollinationsConceptAdapter(tmp);
    const sprite = new PollinationsSpriteAdapter(tmp);
    const c = await concept.generate({ prompt: "test", width: 64, height: 64 });
    const s = await sprite.generate({ prompt: "test", frames: 4, width: 32, height: 32 });
    expect(existsSync(c.imagePath)).toBe(true);
    expect(existsSync(s.sheetPath)).toBe(true);
  });

  it("defaultRenderer factory returns a working zero-cost renderer", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "praetor-game-"));
    const r = defaultRenderer({ outDir: tmp });
    const result = await r.render(specFromGoal({ id: "factory-test", goal: "smoke" }));
    expect(result.costUsd).toBe(0);
    expect(existsSync(join(result.outputDir, "project.godot"))).toBe(true);
  });
});
