# @praetor/ugc

Portrait → motion → voiceover → composite. One spec, four stages, real backends.

```
npm install @praetor/ugc
```

## Backends

| Stage | Backend | Cost / clip | Env var |
| --- | --- | --- | --- |
| Portrait | `openai-image` (gpt-image-1) | ~$0.04 | `OPENAI_API_KEY` |
| Portrait | `nano-banana` (Replicate) | ~$0.04 | `REPLICATE_API_TOKEN` |
| Portrait | `reuse` (existing PNG) | $0 | — |
| Motion | `luma-ray2` | ~$0.40 / 5s | `LUMA_API_KEY` |
| Motion | `luma-ray-flash` | ~$0.18 / 5s | `LUMA_API_KEY` |
| Motion | `seedance` (Replicate) | ~$0.50 / 5s | `REPLICATE_API_TOKEN` |
| Motion | `hedra-character-3` (lipsync, bakes VO) | ~$0.20 / 8s | `HEDRA_API_KEY` |
| Motion | `kenburns` (ffmpeg) | $0 | — |
| Voice | `azure-neural` | $0 (F0 free 500K char/mo) | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| Voice | `elevenlabs` | from $22/mo | `ELEVENLABS_API_KEY` |
| Voice | `edge-tts` | $0 | — |
| Composite | `ffmpeg` | $0 | local ffmpeg binary |

## Quick start

```ts
import { defaultRenderer, specFromGoal } from "@praetor/ugc";

const renderer = defaultRenderer();
const result = await renderer.render(
  specFromGoal({ id: "hook-1", goal: "Praetor ships ads in eight seconds." }),
  { portrait: "openai-image", motion: "luma-ray2", voice: "azure-neural" },
);

console.log(result.outputPath, result.costUsd);
```

The `defaultRenderer()` reads env vars and wires the production renderer with the
adapters whose keys are present. Missing keys make the corresponding backends
unavailable rather than crashing at import time.

## Zero-cost path

```ts
import { MockUgcRenderer, specFromGoal } from "@praetor/ugc";
const r = new MockUgcRenderer();
await r.render(specFromGoal({ id: "free", goal: "free ads" }));
// uses reuse + kenburns + edge-tts → costUsd = 0
```

## Voice cloning

Voice clone backends (`omnivoice-clone`, `xtts-v2-clone`) require a reference
audio path on the spec. Calling `render` without it throws.

```ts
await r.render(spec, {
  voice: "xtts-v2-clone",
  voiceClone: { referencePath: "/abs/path/to/me.wav" },
});
```

## Lipsync (Hedra Character-3)

Hedra is the talking-head specialist — phoneme-locked lipsync, ~50% the cost of
Seedance for that shape. The renderer detects `bakesAudio` motion adapters and
runs the voice stage **before** motion, then skips the compositor (the Hedra
clip is already muxed with the VO).

```ts
const result = await renderer.render(spec, {
  portrait: "openai-image",
  motion: "hedra-character-3",
  voice: "azure-neural",
});
```

## License

MIT — © 2026 J&B Enterprise LLC.
