import type { ModelBackend, WorldBackend } from "../types.js";
import { Hunyuan3dBackend } from "./hunyuan3d.js";
import { Trellis2Backend } from "./trellis2.js";
import { TripoBackend } from "./tripo.js";
import { FalSam3dBackend } from "./fal.js";
import { WorldLabsBackend } from "./worldlabs.js";
import { HyWorldBackend } from "./hyworld.js";
import { MockModelBackend, MockWorldBackend } from "./mock.js";

/**
 * Resolution order — model generation:
 *
 *   explicit override -> self-hosted Hunyuan3D -> self-hosted TRELLIS-2
 *   -> Replicate (TRELLIS-2 / Hunyuan3D)        -> Tripo -> fal-sam-3d -> mock
 *
 * Resolution order — world generation:
 *
 *   explicit override -> self-hosted HY-World 2.0 -> World Labs Marble -> mock
 *
 * The default "mock" tail means smoke tests + offline dev always succeed.
 * Production users gate on `WORLD_GEN_REQUIRE_LIVE=true` to fail fast when
 * no real backend is reachable.
 */

export interface WorldGenSelector {
  pickModelBackend(explicit?: string): ModelBackend;
  pickWorldBackend(explicit?: string): WorldBackend;
  listAvailable(): { models: string[]; worlds: string[] };
}

export class DefaultWorldGenSelector implements WorldGenSelector {
  constructor(private env: NodeJS.ProcessEnv = process.env) {}

  pickModelBackend(explicit?: string): ModelBackend {
    const requireLive = this.env.WORLD_GEN_REQUIRE_LIVE === "true";
    const ordered = this.modelChain(explicit);
    for (const b of ordered) {
      if (requireLive && b.name === "mock") continue;
      if (b.available) return b;
    }
    if (requireLive) {
      throw new Error(`world-gen: no live model backend available (tried ${ordered.map((b) => b.name).join(", ")})`);
    }
    return new MockModelBackend();
  }

  pickWorldBackend(explicit?: string): WorldBackend {
    const requireLive = this.env.WORLD_GEN_REQUIRE_LIVE === "true";
    const ordered = this.worldChain(explicit);
    for (const b of ordered) {
      if (requireLive && b.name === "mock") continue;
      if (b.available) return b;
    }
    if (requireLive) {
      throw new Error(`world-gen: no live world backend available (tried ${ordered.map((b) => b.name).join(", ")})`);
    }
    return new MockWorldBackend();
  }

  listAvailable() {
    return {
      models: this.modelChain().filter((b) => b.available).map((b) => b.name),
      worlds: this.worldChain().filter((b) => b.available).map((b) => b.name),
    };
  }

  private modelChain(explicit?: string): ModelBackend[] {
    const all: ModelBackend[] = [
      Hunyuan3dBackend.fromEnv(this.env),
      Trellis2Backend.fromEnv(this.env),
      TripoBackend.fromEnv(this.env),
      FalSam3dBackend.fromEnv(this.env),
      new MockModelBackend(),
    ];
    if (!explicit) return all;
    const found = all.find((b) => b.name === explicit);
    if (!found) throw new Error(`world-gen: unknown model backend "${explicit}"`);
    return [found, ...all.filter((b) => b.name !== explicit)];
  }

  private worldChain(explicit?: string): WorldBackend[] {
    const all: WorldBackend[] = [
      HyWorldBackend.fromEnv(this.env),
      WorldLabsBackend.fromEnv(this.env),
      new MockWorldBackend(),
    ];
    if (!explicit) return all;
    const found = all.find((b) => b.name === explicit);
    if (!found) throw new Error(`world-gen: unknown world backend "${explicit}"`);
    return [found, ...all.filter((b) => b.name !== explicit)];
  }
}

let DEFAULT_SELECTOR: WorldGenSelector | null = null;
export function defaultSelector(): WorldGenSelector {
  if (!DEFAULT_SELECTOR) DEFAULT_SELECTOR = new DefaultWorldGenSelector();
  return DEFAULT_SELECTOR;
}

/** Reset for tests — flips a fresh selector that re-reads process.env. */
export function resetDefaultSelector(): void { DEFAULT_SELECTOR = null; }
