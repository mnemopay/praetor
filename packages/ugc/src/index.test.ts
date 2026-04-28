import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {
  MockUgcRenderer,
  specFromGoal,
  DEFAULT_BACKENDS,
  priceOf,
  hedraPrompt,
  OpenAIImageAdapter,
  LumaMotionAdapter,
  HedraMotionAdapter,
  AzureNeuralVoiceAdapter,
  ProductionUgcRenderer,
  type Compositor,
  type MotionAdapter,
  type PortraitAdapter,
  type VoiceAdapter,
} from "./index.js";

describe("Praetor UGC pipeline", () => {
  it("produces a default spec from a goal string", () => {
    const spec = specFromGoal({ id: "demo", goal: "Praetor ships ads in eight seconds." });
    expect(spec.id).toBe("demo");
    expect(spec.script).toContain("eight seconds");
    expect(spec.durationSeconds).toBe(8);
  });

  it("default backends are all zero-cost", () => {
    expect(DEFAULT_BACKENDS).toEqual({ portrait: "reuse", motion: "kenburns", voice: "edge-tts" });
    expect(priceOf(DEFAULT_BACKENDS)).toBe(0);
  });

  it("mock renderer reports zero cost on the default zero-cost path", async () => {
    const r = new MockUgcRenderer();
    const result = await r.render(specFromGoal({ id: "free", goal: "free ads" }));
    expect(result.costUsd).toBe(0);
    expect(result.outputPath).toBe("out/free.mp4");
  });

  it("mock renderer prices the paid path correctly", async () => {
    const r = new MockUgcRenderer();
    const result = await r.render(specFromGoal({ id: "paid", goal: "paid ads" }), {
      portrait: "nano-banana",
      motion: "seedance",
      voice: "elevenlabs",
    });
    expect(result.costUsd).toBe(0.59);
  });

  it("luma-ray2 motion price is wired", () => {
    expect(priceOf({ portrait: "openai-image", motion: "luma-ray2", voice: "azure-neural" })).toBeCloseTo(0.44, 5);
    expect(priceOf({ portrait: "reuse", motion: "luma-ray-flash", voice: "azure-neural" })).toBeCloseTo(0.18, 5);
  });

  it("hedra-character-3 motion price is wired (~50% of seedance)", () => {
    expect(priceOf({ portrait: "openai-image", motion: "hedra-character-3", voice: "azure-neural" })).toBeCloseTo(0.24, 5);
  });

  it("hedraPrompt joins camera+subject+background", () => {
    const p = hedraPrompt({
      camera: "Slow dolly-in",
      subject: "founder speaking confidently to camera",
      background: "warm office at golden hour",
    });
    expect(p).toBe("Slow dolly-in. founder speaking confidently to camera. warm office at golden hour.");
    expect(p.split(/\s+/).length).toBeLessThanOrEqual(25);
  });

  it("hedraPrompt clips to 25 words", () => {
    const p = hedraPrompt({
      camera: "Slow handheld dolly-in tracking from waist to face level",
      subject: "founder speaking with calm conviction directly to the camera lens with subtle micro-expressions",
      background: "warm minimal office at golden hour with soft window light and bokeh plants",
    });
    expect(p.split(/\s+/).length).toBeLessThanOrEqual(25);
    expect(p.endsWith(".")).toBe(true);
  });

  it("voice clone path requires a reference audio source", async () => {
    const r = new MockUgcRenderer();
    await expect(
      r.render(specFromGoal({ id: "clone-fail", goal: "x" }), { voice: "omnivoice-clone" }),
    ).rejects.toThrow(/voiceClone/);
  });

  it("voice clone path renders when a reference is supplied", async () => {
    const r = new MockUgcRenderer();
    const result = await r.render(specFromGoal({ id: "clone-ok", goal: "x" }), {
      voice: "xtts-v2-clone",
      voiceClone: { referencePath: "/abs/path/to/me.wav" },
    });
    expect(result.backends.voice).toBe("xtts-v2-clone");
    expect(result.backends.voiceClone?.referencePath).toBe("/abs/path/to/me.wav");
  });
});

describe("OpenAIImageAdapter", () => {
  it("posts to /v1/images/generations and writes the b64_json image", async () => {
    const out = mkdtempSync(join(tmpdir(), "praetor-openai-"));
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/v1/images/generations")) {
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe("gpt-image-1");
        expect(body.size).toBe("1024x1536");
        return new Response(JSON.stringify({ data: [{ b64_json: fakePng.toString("base64") }] }), { status: 200 });
      }
      throw new Error("unexpected url " + u);
    });
    const a = new OpenAIImageAdapter({ apiKey: "sk-test", outDir: out, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await a.generate({ prompt: "a person", width: 1080, height: 1920 });
    expect(statSync(r.imagePath).size).toBeGreaterThan(0);
    expect(readFileSync(r.imagePath).slice(0, 4)).toEqual(fakePng);
  });
});

describe("LumaMotionAdapter", () => {
  it("creates a generation, polls until completed, and writes the mp4", async () => {
    const out = mkdtempSync(join(tmpdir(), "praetor-luma-"));
    const fakeMp4 = Buffer.from("fakemp4content");
    let polls = 0;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/generations") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.model).toBe("ray-2");
        expect(body.aspect_ratio).toBe("9:16");
        expect(body.keyframes.frame0.url).toBe("https://example.com/p.png");
        return new Response(JSON.stringify({ id: "gen-1" }), { status: 200 });
      }
      if (u.endsWith("/generations/gen-1")) {
        polls++;
        if (polls < 2) return new Response(JSON.stringify({ state: "dreaming" }), { status: 200 });
        return new Response(
          JSON.stringify({ state: "completed", assets: { video: "https://example.com/v.mp4" } }),
          { status: 200 },
        );
      }
      if (u === "https://example.com/v.mp4") {
        return new Response(fakeMp4, { status: 200 });
      }
      throw new Error("unexpected url " + u);
    });
    const a = new LumaMotionAdapter({
      apiKey: "lk-test",
      outDir: out,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
    });
    const r = await a.generate({
      prompt: "person speaking",
      portraitUrl: "https://example.com/p.png",
      durationSeconds: 5,
      width: 1080,
      height: 1920,
    });
    expect(statSync(r.videoPath).size).toBeGreaterThan(0);
    expect(polls).toBeGreaterThanOrEqual(2);
  });
  it("propagates a failure state", async () => {
    const out = mkdtempSync(join(tmpdir(), "praetor-luma-fail-"));
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/generations") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "gen-x" }), { status: 200 });
      }
      return new Response(JSON.stringify({ state: "failed", failure_reason: "bad prompt" }), { status: 200 });
    });
    const a = new LumaMotionAdapter({
      apiKey: "lk-test",
      outDir: out,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
    });
    await expect(
      a.generate({ prompt: "p", portraitUrl: "https://example.com/p.png", durationSeconds: 5, width: 1080, height: 1920 }),
    ).rejects.toThrow(/bad prompt/);
  });
});

describe("AzureNeuralVoiceAdapter", () => {
  it("posts SSML and writes the mp3 to disk", async () => {
    const out = mkdtempSync(join(tmpdir(), "praetor-azure-"));
    const fakeMp3 = Buffer.from("ID3fakeMp3");
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      expect(u).toContain("eastus.tts.speech.microsoft.com");
      expect(String(init?.body)).toContain("<voice name=\"en-US-AndrewNeural\">");
      return new Response(fakeMp3, { status: 200 });
    });
    const a = new AzureNeuralVoiceAdapter({
      subscriptionKey: "az-test",
      region: "eastus",
      outDir: out,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const r = await a.synthesize({ script: "hello world", voice: "en-US-AndrewNeural" });
    expect(statSync(r.audioPath).size).toBeGreaterThan(0);
  });
});

describe("HedraMotionAdapter", () => {
  it("uploads image+audio assets, kicks a generation, polls, and writes the mp4", async () => {
    const out = mkdtempSync(join(tmpdir(), "praetor-hedra-"));
    const portraitPath = join(out, "portrait.png");
    const audioPath = join(out, "voice.mp3");
    writeFileSync(portraitPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(audioPath, Buffer.from("ID3audio"));
    const fakeMp4 = Buffer.from("hedra-final-mp4");
    let assetCalls = 0;
    let uploadCalls = 0;
    let polls = 0;
    const seenAssetIds: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/web-app/public/v1/assets") && init?.method === "POST") {
        assetCalls++;
        const body = JSON.parse(String(init.body)) as { type: string };
        const id = body.type === "image" ? "img-1" : "aud-1";
        seenAssetIds.push(id);
        return new Response(JSON.stringify({ id }), { status: 200 });
      }
      if (u.includes("/assets/") && u.endsWith("/upload") && init?.method === "POST") {
        uploadCalls++;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (u.endsWith("/web-app/public/v1/generations") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.start_keyframe_id).toBe("img-1");
        expect(body.audio_id).toBe("aud-1");
        expect(body.ai_model_id).toBe("character-3");
        expect(body.aspect_ratio).toBe("9:16");
        return new Response(JSON.stringify({ project_id: "proj-1" }), { status: 200 });
      }
      if (u.endsWith("/projects/proj-1")) {
        polls++;
        if (polls < 2) return new Response(JSON.stringify({ status: "in_progress" }), { status: 200 });
        return new Response(
          JSON.stringify({ status: "complete", video_url: "https://hedra.test/v.mp4" }),
          { status: 200 },
        );
      }
      if (u === "https://hedra.test/v.mp4") {
        return new Response(fakeMp4, { status: 200 });
      }
      throw new Error("unexpected url " + u);
    });
    const a = new HedraMotionAdapter({
      apiKey: "hk-test",
      outDir: out,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
    });
    const r = await a.generate({
      prompt: "person speaking",
      portraitPath,
      audioPath,
      durationSeconds: 8,
      width: 1080,
      height: 1920,
    });
    expect(assetCalls).toBe(2);
    expect(uploadCalls).toBe(2);
    expect(polls).toBeGreaterThanOrEqual(2);
    expect(statSync(r.videoPath).size).toBeGreaterThan(0);
  });
  it("requires audioPath — voice must run before motion", async () => {
    const out = mkdtempSync(join(tmpdir(), "praetor-hedra-noaudio-"));
    const a = new HedraMotionAdapter({
      apiKey: "hk-test",
      outDir: out,
      fetchImpl: (() => { throw new Error("should not be called"); }) as unknown as typeof fetch,
    });
    await expect(
      a.generate({ prompt: "p", portraitPath: "/tmp/p.png", durationSeconds: 8, width: 1080, height: 1920 }),
    ).rejects.toThrow(/audioPath/);
  });
});

describe("ProductionUgcRenderer", () => {
  it("end-to-end with mocked adapters dispatches all four stages and prices correctly", async () => {
    const calls: string[] = [];
    const portraitAdapter: PortraitAdapter = {
      backend: "openai-image",
      generate: async () => { calls.push("portrait"); return { imagePath: "/tmp/p.png" }; },
    };
    const motionAdapter: MotionAdapter = {
      backend: "luma-ray2",
      generate: async (a) => {
        calls.push("motion");
        expect(a.portraitUrl).toBe("https://cdn.test/p.png");
        return { videoPath: "/tmp/m.mp4" };
      },
    };
    const voiceAdapter: VoiceAdapter = {
      backend: "azure-neural",
      synthesize: async () => { calls.push("voice"); return { audioPath: "/tmp/v.mp3" }; },
    };
    const compositor: Compositor = {
      compose: async (a) => {
        calls.push("compose");
        expect(a.videoPath).toBe("/tmp/m.mp4");
        expect(a.audioPath).toBe("/tmp/v.mp3");
        expect(a.outputPath).toContain("test.mp4");
      },
    };
    const r = new ProductionUgcRenderer({
      portrait: { "openai-image": portraitAdapter },
      motion: { "luma-ray2": motionAdapter },
      voice: { "azure-neural": voiceAdapter },
      compositor,
      uploadPortrait: async () => "https://cdn.test/p.png",
      outDir: tmpdir(),
    });
    const result = await r.render(specFromGoal({ id: "test", goal: "hi" }), {
      portrait: "openai-image",
      motion: "luma-ray2",
      voice: "azure-neural",
    });
    expect(calls).toEqual(["portrait", "motion", "voice", "compose"]);
    expect(result.costUsd).toBeCloseTo(0.44, 5);
  });
  it("hedra (bakesAudio) flow runs voice before motion and skips compositor", async () => {
    const calls: string[] = [];
    const portraitAdapter: PortraitAdapter = {
      backend: "openai-image",
      generate: async () => { calls.push("portrait"); return { imagePath: join(tmpdir(), "p.png") }; },
    };
    const motionAdapter: MotionAdapter = {
      backend: "hedra-character-3",
      bakesAudio: true,
      generate: async (a) => {
        calls.push("motion");
        expect(a.audioPath).toBe(join(tmpdir(), "v.mp3"));
        const videoPath = join(tmpdir(), `hedra-out-${Date.now()}.mp4`);
        writeFileSync(videoPath, Buffer.from("hedra-mp4"));
        return { videoPath };
      },
    };
    const voiceAdapter: VoiceAdapter = {
      backend: "azure-neural",
      synthesize: async () => { calls.push("voice"); return { audioPath: join(tmpdir(), "v.mp3") }; },
    };
    const compositor: Compositor = {
      compose: async () => { calls.push("compose"); throw new Error("compose must not run for hedra"); },
    };
    const r = new ProductionUgcRenderer({
      portrait: { "openai-image": portraitAdapter },
      motion: { "hedra-character-3": motionAdapter },
      voice: { "azure-neural": voiceAdapter },
      compositor,
      outDir: tmpdir(),
    });
    const result = await r.render(specFromGoal({ id: `hedra-${Date.now()}`, goal: "lipsync demo" }), {
      portrait: "openai-image",
      motion: "hedra-character-3",
      voice: "azure-neural",
    });
    expect(calls).toEqual(["portrait", "voice", "motion"]);
    expect(result.backends.motion).toBe("hedra-character-3");
    expect(result.costUsd).toBeCloseTo(0.24, 5);
  });
  it("rejects motion backends needing a portrait URL when no uploader is supplied", async () => {
    const r = new ProductionUgcRenderer({
      portrait: { "openai-image": { backend: "openai-image", generate: async () => ({ imagePath: "/tmp/p.png" }) } },
      motion: { "luma-ray2": { backend: "luma-ray2", generate: async () => ({ videoPath: "/tmp/m.mp4" }) } },
      voice: { "azure-neural": { backend: "azure-neural", synthesize: async () => ({ audioPath: "/tmp/v.mp3" }) } },
      compositor: { compose: async () => {} },
      outDir: tmpdir(),
    });
    await expect(
      r.render(specFromGoal({ id: "no-upload", goal: "hi" }), {
        portrait: "openai-image",
        motion: "luma-ray2",
        voice: "azure-neural",
      }),
    ).rejects.toThrow(/uploadPortrait/);
  });
});
