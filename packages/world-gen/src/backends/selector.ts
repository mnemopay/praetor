import type { ModelBackend, WorldBackend } from "../types.js";
import { Hunyuan3dBackend } from "./hunyuan3d.js";
import { Trellis2Backend } from "./trellis2.js";
import { TripoBackend } from "./tripo.js";
import { FalSam3dBackend } from "./fal.js";
import { WorldLabsBackend } from "./worldlabs.js";
import { HyWorldBackend } from "./hyworld.js";
import { MockModelBackend, MockWorldBackend } from "./mock.js";

/**
 * Resolution order — model generation (quality, default):
 *
 *   explicit override -> self-hosted Hunyuan3D -> self-hosted TRELLIS-2
 *   -> Replicate TRELLIS-2 -> fal Hunyuan3D -> Tripo -> fal-sam-3d -> mock
 *
 * Resolution order — model generation (cost, when WORLD_GEN_PREFER=cost):
 *
 *   explicit override -> self-hosted Hunyuan3D -> self-hosted TRELLIS-2
 *   -> Tripo (free credits)        -> Replicate TRELLIS-2 (~$0.06)
 *   -> fal Hunyuan3D (~$0.20)      -> fal-sam-3d -> mock
 *
 * Resolution order — world generation (cost == quality for now, only one
 * paid hosted backend on the chain):
 *
 *   explicit override -> self-hosted HY-World 2.0 -> World Labs Marble -> mock
 *
 * Paid backends are NEVER hidden — explicit `pickModelBackend("trellis2")`
 * is always honored. The default "mock" tail keeps smoke tests + offline
 * dev working without keys. Production users gate on
 * `WORLD_GEN_REQUIRE_LIVE=true` to fail fast when no real backend is
 * reachable.
 */

export type WorldGenPreference = "quality" | "cost";

export interface WorldGenSelector {
  pickModelBackend(explicit?: string): ModelBackend;
  pickWorldBackend(explicit?: string): WorldBackend;
  listAvailable(): { models: string[]; worlds: string[] };
}

export class DefaultWorldGenSelector implements WorldGenSelector {
  readonly pref: WorldGenPreference;

  constructor(private env: NodeJS.ProcessEnv = process.env) {
    this.pref = env.WORLD_GEN_PREFER === "cost" ? "cost" : "quality";
  }

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
    // Two kinds of host for Hunyuan3D / TRELLIS-2: self-hosted (free) and
    // hosted (paid). We split each into two entries with the irrelevant
    // env keys stripped, so the cost-ordering can put self-host above
    // hosted regardless of where the hosted entry lands in the chain.
    const selfHostEnv = stripHostedKeys(this.env);
    const hostedEnv = stripSelfHostKeys(this.env);

    const hunyuanSelfHost = Hunyuan3dBackend.fromEnv(selfHostEnv);
    const hunyuanHosted = Hunyuan3dBackend.fromEnv(hostedEnv);
    const trellisSelfHost = Trellis2Backend.fromEnv(selfHostEnv);
    const trellisHosted = Trellis2Backend.fromEnv(hostedEnv);
    const tripo = TripoBackend.fromEnv(this.env);
    const falSam3d = FalSam3dBackend.fromEnv(this.env);
    const mock = new MockModelBackend();

    let chain: ModelBackend[];
    if (this.pref === "cost") {
      chain = [
        hunyuanSelfHost, trellisSelfHost,
        tripo,
        trellisHosted,
        hunyuanHosted,
        falSam3d,
        mock,
      ];
    } else {
      chain = [
        hunyuanSelfHost, trellisSelfHost,
        trellisHosted,
        hunyuanHosted,
        tripo,
        falSam3d,
        mock,
      ];
    }

    if (!explicit) return chain;
    // Prefer an available instance of the requested backend; if none is
    // available (caller supplied no env), fall through to the first
    // matching instance so the call still surfaces the right error.
    const matches = chain.filter((b) => b.name === explicit);
    if (matches.length === 0) {
      throw new Error(`world-gen: unknown model backend "${explicit}"`);
    }
    const preferred = matches.find((b) => b.available) ?? matches[0];
    return [preferred, ...chain.filter((b) => b !== preferred)];
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

/** Drop the keys that activate paid hosted variants — leaves only self-host endpoints active. */
function stripHostedKeys(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  delete out.REPLICATE_API_TOKEN;
  delete out.FAL_API_KEY;
  delete out.FAL_KEY;
  return out;
}

/** Drop the self-host endpoint keys — leaves only hosted/Replicate/fal active. */
function stripSelfHostKeys(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  delete out.HUNYUAN3D_ENDPOINT;
  delete out.HUNYUAN3D_AUTH;
  delete out.TRELLIS2_ENDPOINT;
  delete out.TRELLIS2_AUTH;
  return out;
}

let DEFAULT_SELECTOR: WorldGenSelector | null = null;
export function defaultSelector(): WorldGenSelector {
  if (!DEFAULT_SELECTOR) DEFAULT_SELECTOR = new DefaultWorldGenSelector();
  return DEFAULT_SELECTOR;
}

/** Reset for tests — flips a fresh selector that re-reads process.env. */
export function resetDefaultSelector(): void { DEFAULT_SELECTOR = null; }
