import type { ModelBackend, ModelRequest, ModelResult, WorldBackend, WorldRequest, WorldResult } from "../types.js";

/**
 * Always-available offline backend. Returns deterministic placeholder URLs so
 * smoke tests, CI, and disconnected dev all work without keys. Real backends
 * fall through to this only when explicitly selected (`backend: "mock"`).
 */
export class MockModelBackend implements ModelBackend {
  readonly name = "mock";
  readonly available = true;
  async generateModel(req: ModelRequest): Promise<ModelResult> {
    const slug = slugify(req.prompt).slice(0, 40) || "model";
    return {
      backend: this.name,
      glbUrl: `mock://glb/${slug}.glb`,
      thumbUrl: `mock://thumb/${slug}.png`,
      polyCount: 12_000,
      textureRes: 1024,
      durationMs: 50,
      costUsd: 0,
      raw: { prompt: req.prompt, referenceImageUrl: req.referenceImageUrl ?? null, detail: req.detail ?? "standard" },
    };
  }
}

export class MockWorldBackend implements WorldBackend {
  readonly name = "mock";
  readonly available = true;
  async generateWorld(req: WorldRequest): Promise<WorldResult> {
    const slug = slugify(req.prompt).slice(0, 40) || "world";
    return {
      backend: this.name,
      spzUrl: `mock://spz/${slug}.spz`,
      plyUrl: `mock://ply/${slug}.ply`,
      glbUrl: `mock://glb/${slug}.glb`,
      thumbUrl: `mock://thumb/${slug}.png`,
      durationMs: 80,
      costUsd: 0,
      raw: { prompt: req.prompt, detail: req.detail ?? "standard" },
    };
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
