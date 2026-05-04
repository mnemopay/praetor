# @praetor/3d

Image-to-3D and text-to-3D for Praetor charters. Generate GLB meshes with PBR
textures from a single photo (or a text prompt) without leaving the runtime.

Default backend is **Microsoft TRELLIS** (MIT license, image → GLB + PBR
materials) hosted on Replicate (`firtoz/trellis`, ~$0.035/run, ~25s on A100).
A `HuggingFaceTrellisAdapter` covers self-deployed Inference Endpoints for
sovereign mode, and a `MockThreeDAdapter` ships for tests.

## Install

```bash
npm install @praetor/3d
```

## Usage

```ts
import { Praetor3D, ReplicateTrellisAdapter } from "@praetor/3d";

const studio = new Praetor3D({
  adapter: new ReplicateTrellisAdapter({ token: process.env.REPLICATE_API_TOKEN! }),
  allowedLicenseFamilies: ["apache_or_mit"], // refuse proprietary backends
});

const result = await studio.imageTo3D({
  imageUrl: "https://example.com/photo.png",
  simplify: 0.95,
  textureSize: 1024,
});

console.log(result.glbUrl);      // signed Replicate delivery URL
console.log(result.previewUrls); // 360° preview render(s)
console.log(result.costUsd);     // 0.035 (FiscalGate sees this)
```

## Adapters

| Adapter | License family | Notes |
|---|---|---|
| `ReplicateTrellisAdapter` | apache_or_mit | Default. Polls Replicate's REST API. ~$0.035/run. |
| `HuggingFaceTrellisAdapter` | apache_or_mit | For self-deployed HF Inference Endpoints. Sovereign-mode safe. |
| `MockThreeDAdapter` | apache_or_mit | Returns canned URLs. Tests + zero-budget fallback. |

## Audit trail

When attached to a charter's `ActivityBus` + `missionId`, every call emits
`tool.start` / `tool.end` events with a stable `eventId`. The runtime's audit
sink also records `3d.image_to_3d` / `3d.text_to_3d` records with
non-PII fields (`imageUrl`, `simplify`, `textureSize`).

## License

Apache 2.0. The TRELLIS model itself is MIT-licensed by Microsoft.
