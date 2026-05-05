# @kpanks/design

Motion-first landing pages from a single declarative spec. Spline,
HTML-in-Canvas-3D, Hypeframes, Remotion, AntiGravity-style hero presets,
declarative-UI emitter — all from one renderer.

## Install

```bash
npm install @kpanks/design
```

## Usage

```ts
import { Renderer, parseDesignSpec } from "@kpanks/design";

const spec = parseDesignSpec(yaml);
const html = await new Renderer().render(spec);
```

The spec format covers tokens (color, type, spacing), hero variants,
motion blocks, and component composition. See `src/spec.ts` for the
authoritative schema.

## License

Apache 2.0.
