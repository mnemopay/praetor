# @praetor/game-assets

> One spec → runnable Godot 4.4 project. Sprites, textures, music, SFX, scene tree, controller stub.

Charter-driven game-asset pipeline for Praetor. Same adapter contract as `@praetor/ugc` — every stage has a paid backend (best quality) and a zero-cost fallback so a charter can keep running when API credits are exhausted.

## Install

```bash
npm i @praetor/game-assets
```

## Quick start

```ts
import { defaultRenderer, specFromGoal } from "@praetor/game-assets";

const r = defaultRenderer({ outDir: "out" });
const result = await r.render(
  specFromGoal({ id: "fox-run", goal: "A 2D platformer about a fox who collects stars" })
);

// result.outputDir is a folder Godot 4.4 can open directly
console.log(result.outputDir);
console.log(result.costUsd); // 0 on the default zero-cost path
```

## Backends (April 2026 list prices)

| Stage   | Backend                  | Per-clip cost (default counts) | Env key             |
| ------- | ------------------------ | ------------------------------ | ------------------- |
| Concept | `openai-image`           | $0.04                          | `OPENAI_API_KEY`    |
| Concept | `fal-flux`               | $0.025                         | `FAL_KEY`           |
| Concept | `reuse` (default)        | $0                             | —                   |
| Sprite  | `nano-banana-bg-removed` | $0.04 × frames (default 4)     | `FAL_KEY`           |
| Sprite  | `openai-image`           | $0.04 × frames                 | `OPENAI_API_KEY`    |
| Sprite  | `aseprite-template` (default) | $0                        | —                   |
| Texture | `fal-flux-tileable`      | $0.025 × tiles (default 6)     | `FAL_KEY`           |
| Texture | `noise-procedural` (default) | $0                         | —                   |
| Music   | `suno-api`               | $0.30 / 60s loop               | `SUNO_API_KEY`      |
| Music   | `elevenlabs-music`       | $0.25 / 60s loop               | `ELEVENLABS_API_KEY`|
| Music   | `silent` (default)       | $0                             | —                   |
| SFX     | `elevenlabs-sfx`         | $0.018 × cues (default 6)      | `ELEVENLABS_API_KEY`|
| SFX     | `sfxr-presets`           | $0                             | —                   |
| SFX     | `silent` (default)       | $0                             | —                   |
| Code    | `anthropic-claude`       | ~$0.45 / controller            | `ANTHROPIC_API_KEY` |
| Code    | `static-template` (default) | $0                          | —                   |

Default total: **$0**. Maxed-out paid path with 4 sprite frames + 6 tiles + 6 SFX cues: **~$1.21**.

## Output

The renderer writes a folder Godot 4.4 can open directly:

```
out/games/<spec.id>/
├── project.godot          # Godot project manifest
├── Main.tscn              # Root scene
├── controller.gd          # 4-direction Sprite2D controller
├── concept.png            # Concept art
├── sprites/
│   └── sheet_4f.png       # 4-direction character sheet
├── textures/
│   ├── tile_0.png         # Seamless environment tiles
│   └── …
├── music.mp3              # (optional) loop
└── sfx/
    ├── jump.wav
    ├── hit.wav
    └── …
```

Open the folder in Godot 4.4 → press F5 → playable.

## Custom adapters

```ts
import { GameAssetsRendererImpl } from "@praetor/game-assets";

const r = new GameAssetsRendererImpl({
  concept: { "openai-image": myOpenAIAdapter },
  sprite: { "nano-banana-bg-removed": myFalAdapter },
  texture: {},
  music: { "suno-api": mySunoAdapter },
  sfx: { "elevenlabs-sfx": myElevenLabsSfxAdapter },
  code: { "anthropic-claude": myClaudeAdapter },
  outDir: "out",
});

const result = await r.render(spec, {
  concept: "openai-image",
  sprite: "nano-banana-bg-removed",
  music: "suno-api",
  sfx: "elevenlabs-sfx",
  code: "anthropic-claude",
});
```

Any stage without a wired backend falls back to its free-tier built-in (transparent PNG + `silent` audio + static template controller).

## Canonical SFX cues

Six cues are defined by default — `jump`, `hit`, `pickup`, `ui_confirm`, `ui_cancel`, `music_sting`. Override with `spec.sfxNames` for genre-specific cues.

## License

MIT
