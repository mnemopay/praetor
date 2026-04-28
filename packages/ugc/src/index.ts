/**
 * Praetor UGC pipeline — native, declarative ad generation for the user's
 * existing channel set (TikTok, Reels, Shorts, X video). Four stages:
 *
 *   portrait → motion → voiceover → composite
 *
 * Every stage has a paid backend (best quality) and a zero-cost fallback so a
 * charter can keep running when API credits are exhausted.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export interface UgcSpec {
  id: string;
  hookType?: "problem" | "proof" | "promise" | "process";
  portraitPrompt?: string;
  portraitImagePath?: string;
  motionPrompt: string;
  durationSeconds: number;
  voice: string;
  rate?: string;
  script: string;
  width?: number;
  height?: number;
}

export type PortraitBackend =
  | "nano-banana"
  | "fal-flux"
  | "openai-image"
  | "reuse";
export type MotionBackend =
  | "seedance"
  | "kling"
  | "luma-ray2"
  | "luma-ray-flash"
  | "hedra-character-3"
  | "kenburns";
export type VoiceBackend =
  | "azure-neural"
  | "edge-tts"
  | "elevenlabs"
  | "omnivoice-clone"
  | "xtts-v2-clone";

export interface VoiceCloneSource {
  referencePath: string;
  cloneId?: string;
  language?: string;
}

export interface UgcBackends {
  portrait: PortraitBackend;
  motion: MotionBackend;
  voice: VoiceBackend;
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
  render: (spec: UgcSpec, backends?: Partial<UgcBackends>) => Promise<UgcRenderResult>;
}

export const DEFAULT_BACKENDS: UgcBackends = {
  portrait: "reuse",
  motion: "kenburns",
  voice: "edge-tts",
};

export function specFromGoal(args: {
  id: string;
  goal: string;
  voice?: string;
  durationSeconds?: number;
}): UgcSpec {
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
 * Hedra "Omnia" prompt formula: Camera motion + Subject action + Background,
 * capped at ~25 words. The Character-3 model is the strongest in the field
 * when prompts stay this tight; longer prompts dilute the lipsync conditioning.
 */
export function hedraPrompt(parts: { camera: string; subject: string; background: string }): string {
  const sentence = `${parts.camera}. ${parts.subject}. ${parts.background}.`;
  const words = sentence.split(/\s+/);
  if (words.length <= 25) return sentence;
  return words.slice(0, 25).join(" ").replace(/[.,;:!?-]+$/, "") + ".";
}

/* ---------- Mock renderer (used by tests) ------------------------------- */

export class MockUgcRenderer implements UgcRenderer {
  async render(spec: UgcSpec, override: Partial<UgcBackends> = {}): Promise<UgcRenderResult> {
    const backends = { ...DEFAULT_BACKENDS, ...override };
    if ((backends.voice === "omnivoice-clone" || backends.voice === "xtts-v2-clone") && !backends.voiceClone) {
      throw new Error(`UGC: voice "${backends.voice}" requires backends.voiceClone.referencePath`);
    }
    const cost = priceOf(backends);
    return {
      spec,
      outputPath: `out/${spec.id}.mp4`,
      durationMs: spec.durationSeconds * 1000,
      costUsd: Number(cost.toFixed(4)),
      backends,
    };
  }
}

/**
 * Per-stage cost lookup. Numbers reflect April 2026 list prices and are
 * surfaced through MnemoPay's metered billing so a runaway charter cannot
 * silently empty a provider quota.
 */
export function priceOf(b: UgcBackends): number {
  const portrait =
    b.portrait === "nano-banana" ? 0.04
    : b.portrait === "fal-flux" ? 0.025
    : b.portrait === "openai-image" ? 0.04
    : 0;
  const motion =
    b.motion === "seedance" ? 0.5
    : b.motion === "kling" ? 0.3
    : b.motion === "luma-ray2" ? 0.4
    : b.motion === "luma-ray-flash" ? 0.18
    : b.motion === "hedra-character-3" ? 0.20
    : 0;
  const voice = b.voice === "elevenlabs" ? 0.05 : 0;
  return portrait + motion + voice;
}

/* ---------- Adapter contracts ------------------------------------------- */

export interface PortraitAdapter {
  backend: PortraitBackend;
  generate: (args: { prompt: string; width: number; height: number }) => Promise<{ imagePath: string; remoteUrl?: string }>;
}

export interface MotionAdapter {
  backend: MotionBackend;
  generate: (args: {
    prompt: string;
    portraitPath?: string;
    portraitUrl?: string;
    /** Set when the motion adapter bakes lipsync audio into the output (e.g. Hedra Character-3). */
    audioPath?: string;
    durationSeconds: number;
    width: number;
    height: number;
  }) => Promise<{ videoPath: string }>;
  /** True when the adapter produces a video with the VO already muxed in — renderer skips the compositor. */
  bakesAudio?: boolean;
}

export interface VoiceAdapter {
  backend: VoiceBackend;
  synthesize: (args: { script: string; voice: string; rate?: string }) => Promise<{ audioPath: string }>;
}

export interface Compositor {
  compose: (args: { videoPath: string; audioPath: string; outputPath: string }) => Promise<void>;
}

/* ---------- OpenAI image adapter ---------------------------------------- */

/**
 * OpenAI Images API (`gpt-image-1`). Default for the `openai-image` backend.
 * The "ChatGPT free tier" UI is rate-limited and unscriptable; this hits the
 * billed REST endpoint instead, which is the only programmatic path.
 */
export class OpenAIImageAdapter implements PortraitAdapter {
  backend: PortraitBackend = "openai-image";
  constructor(
    private readonly opts: {
      apiKey: string;
      model?: "gpt-image-1" | "dall-e-3";
      outDir: string;
      fetchImpl?: typeof fetch;
    },
  ) {}
  async generate(args: { prompt: string; width: number; height: number }) {
    const f = this.opts.fetchImpl ?? globalThis.fetch;
    const size = closestOpenAISize(args.width, args.height);
    const res = await f("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: this.opts.model ?? "gpt-image-1",
        prompt: args.prompt,
        n: 1,
        size,
      }),
    });
    if (!res.ok) throw new Error(`OpenAIImageAdapter: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
    const item = data.data?.[0];
    if (!item) throw new Error("OpenAIImageAdapter: empty response");
    await mkdir(this.opts.outDir, { recursive: true });
    const imagePath = join(this.opts.outDir, "portrait.png");
    if (item.b64_json) {
      await writeFile(imagePath, Buffer.from(item.b64_json, "base64"));
    } else if (item.url) {
      const r = await f(item.url);
      await writeFile(imagePath, Buffer.from(await r.arrayBuffer()));
    } else {
      throw new Error("OpenAIImageAdapter: response had neither b64_json nor url");
    }
    return { imagePath };
  }
}

function closestOpenAISize(w: number, h: number): "1024x1024" | "1024x1536" | "1536x1024" {
  if (w === h) return "1024x1024";
  return h > w ? "1024x1536" : "1536x1024";
}

/* ---------- Luma Dream Machine motion adapter --------------------------- */

/**
 * Luma Dream Machine v1 — Ray 2 / Ray 2 Flash. Image-to-video via
 * `keyframes.frame0.url`. The portrait must already be reachable over HTTPS
 * (Luma fetches it server-side); pass `portraitUrl`. If only `portraitPath`
 * is available the charter must upload it first (e.g. to fal storage,
 * Vercel Blob, S3) and pass the resulting URL.
 */
export class LumaMotionAdapter implements MotionAdapter {
  backend: MotionBackend;
  constructor(
    private readonly opts: {
      apiKey: string;
      model?: "ray-2" | "ray-flash-2";
      outDir: string;
      fetchImpl?: typeof fetch;
      pollIntervalMs?: number;
      maxPollMs?: number;
    },
  ) {
    this.backend = (opts.model ?? "ray-2") === "ray-flash-2" ? "luma-ray-flash" : "luma-ray2";
  }
  async generate(args: { prompt: string; portraitUrl?: string; durationSeconds: number; width: number; height: number }) {
    const f = this.opts.fetchImpl ?? globalThis.fetch;
    const aspect = aspectFromSize(args.width, args.height);
    const duration = args.durationSeconds <= 5 ? "5s" : "9s";
    const body: Record<string, unknown> = {
      prompt: args.prompt,
      model: this.opts.model ?? "ray-2",
      resolution: "720p",
      duration,
      aspect_ratio: aspect,
    };
    if (args.portraitUrl) {
      body.keyframes = { frame0: { type: "image", url: args.portraitUrl } };
    }
    const res = await f("https://api.lumalabs.ai/dream-machine/v1/generations", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LumaMotionAdapter: ${res.status} ${await res.text()}`);
    const created = (await res.json()) as { id: string };
    const videoUrl = await this.poll(created.id, f);
    await mkdir(this.opts.outDir, { recursive: true });
    const videoPath = join(this.opts.outDir, "motion.mp4");
    const dl = await f(videoUrl);
    await writeFile(videoPath, Buffer.from(await dl.arrayBuffer()));
    return { videoPath };
  }
  private async poll(id: string, f: typeof fetch): Promise<string> {
    const interval = this.opts.pollIntervalMs ?? 4_000;
    const max = this.opts.maxPollMs ?? 5 * 60_000;
    const t0 = Date.now();
    while (Date.now() - t0 < max) {
      const r = await f(`https://api.lumalabs.ai/dream-machine/v1/generations/${id}`, {
        headers: { authorization: `Bearer ${this.opts.apiKey}` },
      });
      const j = (await r.json()) as { state?: string; assets?: { video?: string }; failure_reason?: string };
      if (j.state === "completed" && j.assets?.video) return j.assets.video;
      if (j.state === "failed") throw new Error(`LumaMotionAdapter: failed — ${j.failure_reason ?? "unknown"}`);
      await new Promise((res) => setTimeout(res, interval));
    }
    throw new Error("LumaMotionAdapter: poll timeout");
  }
}

function aspectFromSize(w: number, h: number): "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "9:21" {
  if (w === h) return "1:1";
  const r = w / h;
  if (Math.abs(r - 9 / 16) < 0.05) return "9:16";
  if (Math.abs(r - 16 / 9) < 0.05) return "16:9";
  if (Math.abs(r - 3 / 4) < 0.05) return "3:4";
  if (Math.abs(r - 4 / 3) < 0.05) return "4:3";
  return r > 1 ? "16:9" : "9:16";
}

/* ---------- Hedra Character-3 motion adapter ---------------------------- */

/**
 * Hedra Character-3 — omnimodal lipsync. Phoneme-locked talking-head video
 * driven by a portrait image plus a VO audio track. ~50% of Seedance cost
 * for the talking-head shape. The renderer must run voice before motion and
 * pass the resulting `audioPath` into `generate()`. Output is already muxed
 * with the VO; the compositor stage is skipped.
 *
 * API surface (Hedra "Omnia" public v1):
 *   POST /web-app/public/v1/assets                         -> { id }   (image)
 *   POST /web-app/public/v1/assets/{id}/upload (multipart) -> upload bytes
 *   POST /web-app/public/v1/assets                         -> { id }   (audio)
 *   POST /web-app/public/v1/assets/{id}/upload (multipart) -> upload bytes
 *   POST /web-app/public/v1/generations                    -> { project_id }
 *   GET  /web-app/public/v1/projects/{project_id}          -> { status, video_url }
 */
export class HedraMotionAdapter implements MotionAdapter {
  backend: MotionBackend = "hedra-character-3";
  bakesAudio = true;
  constructor(
    private readonly opts: {
      apiKey: string;
      modelId?: string;
      outDir: string;
      baseUrl?: string;
      fetchImpl?: typeof fetch;
      pollIntervalMs?: number;
      maxPollMs?: number;
    },
  ) {}
  async generate(args: {
    prompt: string;
    portraitPath?: string;
    portraitUrl?: string;
    audioPath?: string;
    durationSeconds: number;
    width: number;
    height: number;
  }) {
    if (!args.portraitPath) {
      throw new Error("HedraMotionAdapter: portraitPath is required (Hedra uploads the image directly)");
    }
    if (!args.audioPath) {
      throw new Error("HedraMotionAdapter: audioPath is required — run the voice stage before motion");
    }
    const f = this.opts.fetchImpl ?? globalThis.fetch;
    const base = this.opts.baseUrl ?? "https://api.hedra.com";
    const headers = { "x-api-key": this.opts.apiKey };

    const imageId = await this.createAndUpload(f, base, headers, args.portraitPath, "image");
    const audioId = await this.createAndUpload(f, base, headers, args.audioPath, "audio");

    const genRes = await f(`${base}/web-app/public/v1/generations`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        type: "video",
        ai_model_id: this.opts.modelId ?? "character-3",
        start_keyframe_id: imageId,
        audio_id: audioId,
        text_prompt: args.prompt,
        aspect_ratio: aspectFromSize(args.width, args.height),
        resolution: "720p",
        duration_ms: Math.round(args.durationSeconds * 1000),
      }),
    });
    if (!genRes.ok) throw new Error(`HedraMotionAdapter: generations ${genRes.status} ${await genRes.text()}`);
    const created = (await genRes.json()) as { id?: string; project_id?: string };
    const projectId = created.project_id ?? created.id;
    if (!projectId) throw new Error("HedraMotionAdapter: missing project_id in generations response");

    const videoUrl = await this.poll(projectId, base, headers, f);
    await mkdir(this.opts.outDir, { recursive: true });
    const videoPath = join(this.opts.outDir, "motion.mp4");
    const dl = await f(videoUrl);
    await writeFile(videoPath, Buffer.from(await dl.arrayBuffer()));
    return { videoPath };
  }
  private async createAndUpload(
    f: typeof fetch,
    base: string,
    headers: Record<string, string>,
    path: string,
    type: "image" | "audio",
  ): Promise<string> {
    const create = await f(`${base}/web-app/public/v1/assets`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ type, name: basename(path) }),
    });
    if (!create.ok) throw new Error(`HedraMotionAdapter: assets ${type} ${create.status} ${await create.text()}`);
    const asset = (await create.json()) as { id?: string };
    if (!asset.id) throw new Error(`HedraMotionAdapter: missing asset id for ${type}`);
    const buf = await readFile(path);
    const form = new FormData();
    const mime = type === "image" ? "image/png" : "audio/mpeg";
    form.append("file", new Blob([buf], { type: mime }), basename(path));
    const up = await f(`${base}/web-app/public/v1/assets/${asset.id}/upload`, {
      method: "POST",
      headers,
      body: form,
    });
    if (!up.ok) throw new Error(`HedraMotionAdapter: upload ${type} ${up.status} ${await up.text()}`);
    return asset.id;
  }
  private async poll(
    projectId: string,
    base: string,
    headers: Record<string, string>,
    f: typeof fetch,
  ): Promise<string> {
    const interval = this.opts.pollIntervalMs ?? 4_000;
    const max = this.opts.maxPollMs ?? 8 * 60_000;
    const t0 = Date.now();
    while (Date.now() - t0 < max) {
      const r = await f(`${base}/web-app/public/v1/projects/${projectId}`, { headers });
      const j = (await r.json()) as { status?: string; video_url?: string; error_message?: string };
      const s = (j.status ?? "").toLowerCase();
      if (s === "complete" || s === "completed" || s === "succeeded") {
        if (!j.video_url) throw new Error("HedraMotionAdapter: completed but no video_url");
        return j.video_url;
      }
      if (s === "failed" || s === "error") {
        throw new Error(`HedraMotionAdapter: failed — ${j.error_message ?? "unknown"}`);
      }
      await new Promise((res) => setTimeout(res, interval));
    }
    throw new Error("HedraMotionAdapter: poll timeout");
  }
}

/* ---------- Replicate adapter (Nano Banana / Seedance) ------------------ */

/**
 * Replicate adapter for Nano Banana (image) and Seedance (image-to-video).
 * Mirrors the proven path in `ugc-pipeline/generate.py`.
 */
export class ReplicateImageAdapter implements PortraitAdapter {
  backend: PortraitBackend = "nano-banana";
  constructor(
    private readonly opts: {
      apiKey: string;
      model?: string;
      outDir: string;
      fetchImpl?: typeof fetch;
      pollIntervalMs?: number;
    },
  ) {}
  async generate(args: { prompt: string; width: number; height: number }) {
    const f = this.opts.fetchImpl ?? globalThis.fetch;
    const url = await runReplicate(
      f,
      this.opts.apiKey,
      this.opts.model ?? "google/nano-banana",
      { prompt: args.prompt, width: args.width, height: args.height },
      this.opts.pollIntervalMs,
    );
    await mkdir(this.opts.outDir, { recursive: true });
    const imagePath = join(this.opts.outDir, "portrait.png");
    const dl = await f(url);
    await writeFile(imagePath, Buffer.from(await dl.arrayBuffer()));
    return { imagePath, remoteUrl: url };
  }
}

export class SeedanceMotionAdapter implements MotionAdapter {
  backend: MotionBackend = "seedance";
  constructor(
    private readonly opts: {
      apiKey: string;
      model?: string;
      outDir: string;
      fetchImpl?: typeof fetch;
      pollIntervalMs?: number;
    },
  ) {}
  async generate(args: { prompt: string; portraitUrl?: string; durationSeconds: number; width: number; height: number }) {
    const f = this.opts.fetchImpl ?? globalThis.fetch;
    const url = await runReplicate(
      f,
      this.opts.apiKey,
      this.opts.model ?? "bytedance/seedance-1-pro",
      {
        prompt: args.prompt,
        image: args.portraitUrl,
        duration: args.durationSeconds,
        resolution: "1080p",
        aspect_ratio: aspectFromSize(args.width, args.height),
      },
      this.opts.pollIntervalMs,
    );
    await mkdir(this.opts.outDir, { recursive: true });
    const videoPath = join(this.opts.outDir, "motion.mp4");
    const dl = await f(url);
    await writeFile(videoPath, Buffer.from(await dl.arrayBuffer()));
    return { videoPath };
  }
}

async function runReplicate(
  f: typeof fetch,
  apiKey: string,
  model: string,
  input: Record<string, unknown>,
  pollIntervalMs = 4_000,
): Promise<string> {
  const create = await f(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      prefer: "wait=60",
    },
    body: JSON.stringify({ input }),
  });
  if (!create.ok) throw new Error(`Replicate: ${create.status} ${await create.text()}`);
  let prediction = (await create.json()) as { status: string; output?: string | string[]; error?: string; urls?: { get?: string } };
  while (prediction.status !== "succeeded" && prediction.status !== "failed") {
    if (!prediction.urls?.get) throw new Error("Replicate: missing prediction.urls.get");
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const r = await f(prediction.urls.get, { headers: { authorization: `Bearer ${apiKey}` } });
    prediction = (await r.json()) as typeof prediction;
  }
  if (prediction.status === "failed") throw new Error(`Replicate: ${prediction.error ?? "unknown failure"}`);
  const out = prediction.output;
  const url = Array.isArray(out) ? out[0] : out;
  if (!url) throw new Error("Replicate: empty output");
  return url;
}

/* ---------- Azure / edge TTS voice adapters ----------------------------- */

/**
 * Azure Cognitive Services Speech — F0 free tier ships 500K chars/mo of
 * neural TTS. Default for VO per Jerry's `feedback_tts_default.md`.
 */
export class AzureNeuralVoiceAdapter implements VoiceAdapter {
  backend: VoiceBackend = "azure-neural";
  constructor(
    private readonly opts: {
      subscriptionKey: string;
      region: string;
      outDir: string;
      fetchImpl?: typeof fetch;
    },
  ) {}
  async synthesize(args: { script: string; voice: string; rate?: string }) {
    const f = this.opts.fetchImpl ?? globalThis.fetch;
    const ssml = `<speak version="1.0" xml:lang="en-US">
  <voice name="${args.voice}">
    <prosody rate="${args.rate ?? "+0%"}">${escapeXml(args.script)}</prosody>
  </voice>
</speak>`;
    const res = await f(`https://${this.opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "ocp-apim-subscription-key": this.opts.subscriptionKey,
        "content-type": "application/ssml+xml",
        "x-microsoft-outputformat": "audio-48khz-192kbitrate-mono-mp3",
        "user-agent": "praetor-ugc",
      },
      body: ssml,
    });
    if (!res.ok) throw new Error(`AzureNeuralVoiceAdapter: ${res.status} ${await res.text()}`);
    await mkdir(this.opts.outDir, { recursive: true });
    const audioPath = join(this.opts.outDir, "voiceover.mp3");
    await writeFile(audioPath, Buffer.from(await res.arrayBuffer()));
    return { audioPath };
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/* ---------- ffmpeg compositor ------------------------------------------- */

/**
 * Mux a motion clip with a VO track. Loops the video to match audio length
 * (or trims if video is longer than the script). Requires `ffmpeg` on PATH.
 */
export class FfmpegCompositor implements Compositor {
  constructor(private readonly opts: { ffmpegPath?: string } = {}) {}
  async compose(args: { videoPath: string; audioPath: string; outputPath: string }) {
    const bin = this.opts.ffmpegPath ?? "ffmpeg";
    const argv = [
      "-y",
      "-stream_loop", "-1",
      "-i", args.videoPath,
      "-i", args.audioPath,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-shortest",
      args.outputPath,
    ];
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bin, argv, { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      proc.stderr?.on("data", (d) => { err += d.toString(); });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}\n${err.slice(-1000)}`));
      });
    });
  }
}

/* ---------- ProductionUgcRenderer --------------------------------------- */

export interface ProductionAdapters {
  portrait: Partial<Record<PortraitBackend, PortraitAdapter>>;
  motion: Partial<Record<MotionBackend, MotionAdapter>>;
  voice: Partial<Record<VoiceBackend, VoiceAdapter>>;
  compositor: Compositor;
  /** Required when the motion adapter wants a portrait *URL* (Luma, Seedance). */
  uploadPortrait?: (imagePath: string) => Promise<string>;
  /** Where to put final output. Defaults to `out/`. */
  outDir?: string;
  /** Where to stash intermediate frames. Defaults to a temp dir per render. */
  workDir?: string;
}

export class ProductionUgcRenderer implements UgcRenderer {
  constructor(private readonly adapters: ProductionAdapters) {}
  async render(spec: UgcSpec, override: Partial<UgcBackends> = {}): Promise<UgcRenderResult> {
    const t0 = Date.now();
    const backends = { ...DEFAULT_BACKENDS, ...override };
    if ((backends.voice === "omnivoice-clone" || backends.voice === "xtts-v2-clone") && !backends.voiceClone) {
      throw new Error(`UGC: voice "${backends.voice}" requires backends.voiceClone.referencePath`);
    }
    const width = spec.width ?? 1080;
    const height = spec.height ?? 1920;
    const outDir = this.adapters.outDir ?? "out";
    const workDir = this.adapters.workDir ?? join(tmpdir(), `praetor-ugc-${spec.id}-${Date.now()}`);
    await mkdir(outDir, { recursive: true });
    await mkdir(workDir, { recursive: true });

    let portraitPath = spec.portraitImagePath;
    let portraitUrl: string | undefined;
    if (!portraitPath && backends.portrait !== "reuse") {
      const a = this.adapters.portrait[backends.portrait];
      if (!a) throw new Error(`ProductionUgcRenderer: no adapter for portrait backend "${backends.portrait}"`);
      const r = await a.generate({
        prompt: spec.portraitPrompt ?? `cinematic UGC creator portrait, natural lighting, 35mm lens`,
        width,
        height,
      });
      portraitPath = r.imagePath;
      portraitUrl = r.remoteUrl;
    }

    if (portraitPath && !portraitUrl && (backends.motion === "luma-ray2" || backends.motion === "luma-ray-flash" || backends.motion === "seedance" || backends.motion === "kling")) {
      if (!this.adapters.uploadPortrait) {
        throw new Error(`ProductionUgcRenderer: motion backend "${backends.motion}" needs a hosted portrait URL — pass uploadPortrait()`);
      }
      portraitUrl = await this.adapters.uploadPortrait(portraitPath);
    }

    const motionAdapter = this.adapters.motion[backends.motion];
    if (!motionAdapter) throw new Error(`ProductionUgcRenderer: no adapter for motion backend "${backends.motion}"`);
    const voiceAdapter = this.adapters.voice[backends.voice];
    if (!voiceAdapter) throw new Error(`ProductionUgcRenderer: no adapter for voice backend "${backends.voice}"`);

    const outputPath = join(outDir, `${spec.id}.mp4`);

    // Lipsync motion backends (Hedra) need the VO audio to drive the video,
    // and emit a clip that already has the audio muxed in — voice runs first
    // and the compositor stage is skipped.
    if (motionAdapter.bakesAudio) {
      const voice = await voiceAdapter.synthesize({ script: spec.script, voice: spec.voice, rate: spec.rate });
      const motion = await motionAdapter.generate({
        prompt: spec.motionPrompt,
        portraitPath,
        portraitUrl,
        audioPath: voice.audioPath,
        durationSeconds: spec.durationSeconds,
        width,
        height,
      });
      await copyFile(motion.videoPath, outputPath);
    } else {
      const motion = await motionAdapter.generate({
        prompt: spec.motionPrompt,
        portraitPath,
        portraitUrl,
        durationSeconds: spec.durationSeconds,
        width,
        height,
      });
      const voice = await voiceAdapter.synthesize({ script: spec.script, voice: spec.voice, rate: spec.rate });
      await this.adapters.compositor.compose({ videoPath: motion.videoPath, audioPath: voice.audioPath, outputPath });
    }

    if (!this.adapters.workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }

    return {
      spec,
      outputPath,
      durationMs: Date.now() - t0,
      costUsd: Number(priceOf(backends).toFixed(4)),
      backends,
    };
  }
}

/**
 * Build a ProductionUgcRenderer from environment variables. Looks for:
 *   LUMA_API_KEY, OPENAI_API_KEY, REPLICATE_API_TOKEN, AZURE_SPEECH_KEY,
 *   AZURE_SPEECH_REGION (default: eastus), FFMPEG_PATH (default: ffmpeg).
 *
 * Charters that need a `uploadPortrait` hook (for Luma / Seedance image-to-
 * video) must pass it explicitly — Praetor does not pick a hosting backend
 * for the user.
 */
export function defaultRenderer(opts: {
  outDir?: string;
  uploadPortrait?: (imagePath: string) => Promise<string>;
  env?: NodeJS.ProcessEnv;
} = {}): ProductionUgcRenderer {
  const env = opts.env ?? process.env;
  const portrait: Partial<Record<PortraitBackend, PortraitAdapter>> = {};
  const motion: Partial<Record<MotionBackend, MotionAdapter>> = {};
  const voice: Partial<Record<VoiceBackend, VoiceAdapter>> = {};

  if (env.OPENAI_API_KEY) {
    portrait["openai-image"] = new OpenAIImageAdapter({
      apiKey: env.OPENAI_API_KEY,
      outDir: opts.outDir ?? "out",
    });
  }
  if (env.REPLICATE_API_TOKEN) {
    portrait["nano-banana"] = new ReplicateImageAdapter({
      apiKey: env.REPLICATE_API_TOKEN,
      outDir: opts.outDir ?? "out",
    });
    motion.seedance = new SeedanceMotionAdapter({
      apiKey: env.REPLICATE_API_TOKEN,
      outDir: opts.outDir ?? "out",
    });
  }
  if (env.LUMA_API_KEY) {
    motion["luma-ray2"] = new LumaMotionAdapter({
      apiKey: env.LUMA_API_KEY,
      model: "ray-2",
      outDir: opts.outDir ?? "out",
    });
    motion["luma-ray-flash"] = new LumaMotionAdapter({
      apiKey: env.LUMA_API_KEY,
      model: "ray-flash-2",
      outDir: opts.outDir ?? "out",
    });
  }
  if (env.HEDRA_API_KEY) {
    motion["hedra-character-3"] = new HedraMotionAdapter({
      apiKey: env.HEDRA_API_KEY,
      outDir: opts.outDir ?? "out",
    });
  }
  if (env.AZURE_SPEECH_KEY) {
    voice["azure-neural"] = new AzureNeuralVoiceAdapter({
      subscriptionKey: env.AZURE_SPEECH_KEY,
      region: env.AZURE_SPEECH_REGION ?? "eastus",
      outDir: opts.outDir ?? "out",
    });
  }

  return new ProductionUgcRenderer({
    portrait,
    motion,
    voice,
    compositor: new FfmpegCompositor({ ffmpegPath: env.FFMPEG_PATH }),
    uploadPortrait: opts.uploadPortrait,
    outDir: opts.outDir,
  });
}
