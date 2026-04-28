/**
 * Praetor UGC pipeline — native, declarative ad generation for the user's
 * existing channel set (TikTok, Reels, Shorts, X video). Mirrors the four-stage
 * pipeline already proven in the user's stand-alone `ugc-pipeline/` repo:
 *
 *   portrait → motion → voiceover → composite
 *
 * Each stage has a paid backend (best quality) and a zero-cost fallback so a
 * charter can keep running when API credits are exhausted.
 */
export interface UgcSpec {
  /** Output filename stem. */
  id: string;
  /** Hook framing — copy generation can lean on this. */
  hookType?: "problem" | "proof" | "promise" | "process";
  /** Image-gen prompt (skipped when `portraitImagePath` is supplied). */
  portraitPrompt?: string;
  /** Path to a pre-rendered portrait that overrides image generation. */
  portraitImagePath?: string;
  /** Video-gen prompt (ignored when `motionBackend` is `kenburns`). */
  motionPrompt: string;
  durationSeconds: number;
  /** Azure / edge-tts voice id. */
  voice: string;
  rate?: string;
  script: string;
  /** Output frame size — defaults to 1080x1920 vertical. */
  width?: number;
  height?: number;
}

export type PortraitBackend = "nano-banana" | "fal-flux" | "reuse";
export type MotionBackend = "seedance" | "kling" | "kenburns";
export type VoiceBackend = "azure-neural" | "edge-tts" | "elevenlabs" | "omnivoice-clone" | "xtts-v2-clone";

export interface VoiceCloneSource {
  /** Path to a reference audio sample (6–30 sec recommended). */
  referencePath: string;
  /** Optional named identity for caching; auto-derived if omitted. */
  cloneId?: string;
  /** Language code, ISO 639-1. Defaults to "en". */
  language?: string;
}

export interface UgcBackends {
  portrait: PortraitBackend;
  motion: MotionBackend;
  voice: VoiceBackend;
  /** Required when `voice` is one of the *-clone variants. */
  voiceClone?: VoiceCloneSource;
}

export interface UgcRenderResult {
  spec: UgcSpec;
  outputPath: string;
  durationMs: number;
  costUsd: number;
  backends: UgcBackends;
}

export interface UgcRenderer {
  /**
   * Render a UGC ad to disk. Implementations dispatch by backend and chain
   * through Praetor's `MnemoPayAdapter` so video credits are metered against
   * the mission's budget.
   */
  render: (spec: UgcSpec, backends?: Partial<UgcBackends>) => Promise<UgcRenderResult>;
}

/**
 * Default backend selection — prefer zero-cost path so charters keep working
 * even when paid credits are exhausted. A charter can override by passing
 * explicit `backends` to `render()`.
 */
export const DEFAULT_BACKENDS: UgcBackends = {
  portrait: "reuse",
  motion: "kenburns",
  voice: "edge-tts",
};

/**
 * Compose a default `UgcSpec` from a Praetor charter goal. Useful for charters
 * that just want "an ad about X" without specifying every stage.
 */
export function specFromGoal(args: { id: string; goal: string; voice?: string; durationSeconds?: number }): UgcSpec {
  return {
    id: args.id,
    motionPrompt: `person speaking directly to camera, casual UGC selfie energy, natural micro-movements while saying: ${args.goal}`,
    durationSeconds: args.durationSeconds ?? 8,
    voice: args.voice ?? "en-US-AndrewNeural",
    rate: "+0%",
    script: args.goal,
  };
}

/**
 * Mock renderer — produces a deterministic UgcRenderResult without touching
 * disk, network, or ffmpeg. Used by tests and by the runtime smoke path.
 */
export class MockUgcRenderer implements UgcRenderer {
  async render(spec: UgcSpec, override: Partial<UgcBackends> = {}): Promise<UgcRenderResult> {
    const backends = { ...DEFAULT_BACKENDS, ...override };
    if ((backends.voice === "omnivoice-clone" || backends.voice === "xtts-v2-clone") && !backends.voiceClone) {
      throw new Error(`UGC: voice "${backends.voice}" requires backends.voiceClone.referencePath`);
    }
    const cost =
      (backends.portrait === "nano-banana" ? 0.04 : 0) +
      (backends.motion === "seedance" ? 0.5 : backends.motion === "kling" ? 0.3 : 0) +
      (backends.voice === "elevenlabs" ? 0.05 : 0);
    return {
      spec,
      outputPath: `out/${spec.id}.mp4`,
      durationMs: spec.durationSeconds * 1000,
      costUsd: Number(cost.toFixed(2)),
      backends,
    };
  }
}
