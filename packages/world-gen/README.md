# @praetor/world-gen

Native text/image -> 3D model and text/image/video -> 3D world generation for
Praetor. Backend-agnostic: TRELLIS-2, Hunyuan3D 2.x, Tripo, fal.ai sam-3,
World Labs Marble, Tencent HY-World 2.0, and a deterministic mock for
offline dev.

## Selector

A single selector decides which backend handles each call. Resolution order:

| Mode      | Model chain                                                                                                  |
|-----------|---------------------------------------------------------------------------------------------------------------|
| quality   | self-host Hunyuan3D -> self-host TRELLIS-2 -> Replicate TRELLIS-2 -> fal Hunyuan3D -> Tripo -> fal sam-3d -> mock |
| cost      | self-host Hunyuan3D -> self-host TRELLIS-2 -> Tripo (free credits) -> Replicate TRELLIS-2 -> fal Hunyuan3D -> fal sam-3d -> mock |

World chain (cost == quality today): self-host HY-World 2.0 -> World Labs
Marble -> mock.

The chain is set by `WORLD_GEN_PREFER` (`quality` is default, `cost` flips
the order). Paid backends are never hidden — `pickModelBackend("trellis2")`
always honors the explicit override regardless of mode.

## Cost baselines (USD per generation)

These are the values the backends populate `costUsd` with. They reflect
each vendor's published per-call price as of 2026-05; if the API returns a
real billed amount the runtime uses that instead.

| Backend                           | costUsd |
|-----------------------------------|---------|
| TRELLIS-2 self-host               | 0       |
| TRELLIS-2 Replicate (`firtoz/trellis`) | 0.06 |
| Hunyuan3D self-host               | 0       |
| Hunyuan3D fal (`hunyuan3d-v3`)    | 0.20    |
| Tripo                             | 0.10 (or 0 with free credits) |
| fal sam-3d                        | 0.05    |
| HY-World 2.0 self-host            | 0       |
| World Labs Marble                 | 0.18    |
| Mock                              | 0       |

## Run for free

To run end-to-end without paying any vendor:

1. **Leave all paid keys unset.** Specifically: do not set
   `REPLICATE_API_TOKEN`, `FAL_API_KEY` (or `FAL_KEY`), `TRIPO_API_KEY`,
   or `WORLDLABS_API_KEY`.
2. **Self-host the open models.** Stand up Hunyuan3D-2 and/or TRELLIS-2 on
   any A100/H100 box (the project repos ship FastAPI servers — Tencent's
   for Hunyuan3D, Microsoft's for TRELLIS-2). Point Praetor at them with
   `HUNYUAN3D_ENDPOINT=...` and `TRELLIS2_ENDPOINT=...`. Worlds: stand up
   HY-World 2.0 and set `HYWORLD_ENDPOINT=...`.
3. **Use free vendor credits.** Tripo grants a recurring monthly credit
   pool to every account. Set `TRIPO_API_KEY` and prefer cost mode
   (`WORLD_GEN_PREFER=cost`) to keep the chain on Tripo until credits run
   out, after which it falls through to the next backend.
4. **Smoke / dev only.** With no env keys at all, the chain falls back to
   the mock backend, which returns deterministic placeholder URLs.

To force the chain to fail rather than silently fall back to mock, set
`WORLD_GEN_REQUIRE_LIVE=true`.

## Tools

- `generate_3d_model({ prompt, referenceImageUrl?, detail? })` -> GLB URL
- `generate_3d_world({ prompt, referenceImageUrl?, panoramaUrl?, videoUrl?, detail? })` -> SPZ + GLB URLs
- `edit_3d_scene({ assetUrl, title? })` -> SuperSplat editor deep link
- `publish_3d_scene({ id, glbUrl?, splatUrl?, title?, outDir })` -> static viewer HTML

## Activity events (Phase E)

Both `generate_3d_model` and `generate_3d_world` accept an optional
`bus?: ActivityBus` and `missionId?: string` in their deps. When set, the
tools publish `tool.start`, `tool.progress`, and `tool.end` events the
dashboard can render in real time.
