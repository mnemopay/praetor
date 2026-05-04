import { describe, it, expect, vi } from "vitest";
import {
  PraetorVoice,
  MockVoiceAdapter,
  AzureSpeechAdapter,
  KokoroAdapter,
} from "./index.js";

describe("PraetorVoice — runtime", () => {
  it("dispatches synthesize() to the default backend when one is attached", async () => {
    const mock = new MockVoiceAdapter();
    const voice = new PraetorVoice().attach("mock", mock);
    const r = await voice.synthesize({ text: "hello world" });
    expect(r.backend).toBe("mock");
    expect(r.licenseFamily).toBe("apache_or_mit");
    expect(r.audioBuffer.toString().includes("hello world")).toBe(true);
    expect(mock.calls).toHaveLength(1);
  });

  it("throws a clear error when no backend is attached", async () => {
    const voice = new PraetorVoice();
    await expect(voice.synthesize({ text: "x" })).rejects.toThrow(/no backend attached/);
  });

  it("rejects empty text", async () => {
    const voice = new PraetorVoice().attach("mock", new MockVoiceAdapter());
    await expect(voice.synthesize({ text: "" })).rejects.toThrow(/text is required/);
    await expect(voice.synthesize({ text: "  \n\t" })).rejects.toThrow(/text is required/);
  });

  it("respects an explicit backend override on the request", async () => {
    const a = new MockVoiceAdapter({ backendName: "kokoro" });
    const b = new MockVoiceAdapter({ backendName: "azure-speech", licenseFamily: "proprietary" });
    const voice = new PraetorVoice().attach("kokoro", a).attach("azure-speech", b);
    const r = await voice.synthesize({ text: "hi", backend: "azure-speech" });
    expect(r.backend).toBe("azure-speech");
    expect(b.calls).toHaveLength(1);
    expect(a.calls).toHaveLength(0);
  });

  it("enforces licenseFamily when requireLicense is set", async () => {
    const proprietary = new MockVoiceAdapter({ backendName: "azure-speech", licenseFamily: "proprietary" });
    const voice = new PraetorVoice({ requireLicense: "apache_or_mit" }).attach("azure-speech", proprietary);
    await expect(voice.synthesize({ text: "x" })).rejects.toThrow(/licenseFamily='proprietary'.*requires 'apache_or_mit'/);
  });

  it("attach() rejects an adapter whose backend name disagrees with the slot", () => {
    const voice = new PraetorVoice();
    const wrong = new MockVoiceAdapter({ backendName: "kokoro" });
    expect(() => voice.attach("azure-speech", wrong)).toThrow(/backend mismatch/);
  });

  it("list() exposes all attached backends with license families", () => {
    const voice = new PraetorVoice()
      .attach("kokoro", new MockVoiceAdapter({ backendName: "kokoro" }))
      .attach("azure-speech", new MockVoiceAdapter({ backendName: "azure-speech", licenseFamily: "proprietary" }));
    const names = voice.list().map((b) => b.name).sort();
    expect(names).toEqual(["azure-speech", "kokoro"]);
    const azure = voice.list().find((b) => b.name === "azure-speech");
    expect(azure?.licenseFamily).toBe("proprietary");
  });

  it("explicit defaultBackend wins over insertion order when present", () => {
    const voice = new PraetorVoice({ defaultBackend: "azure-speech" })
      .attach("kokoro", new MockVoiceAdapter({ backendName: "kokoro" }))
      .attach("azure-speech", new MockVoiceAdapter({ backendName: "azure-speech", licenseFamily: "proprietary" }));
    expect(voice.defaultBackend()).toBe("azure-speech");
  });

  it("falls through to first attached when defaultBackend is missing", () => {
    const voice = new PraetorVoice({ defaultBackend: "elevenlabs" })
      .attach("kokoro", new MockVoiceAdapter({ backendName: "kokoro" }));
    expect(voice.defaultBackend()).toBe("kokoro");
  });
});

describe("AzureSpeechAdapter", () => {
  it("posts SSML + ocp key to the regional endpoint and returns mp3", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = String((init as { body?: string }).body ?? "");
      expect(body).toContain('<voice name="en-US-AndrewNeural">');
      expect(body).toContain("Hello &amp; world");
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04, 0xff]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    }) as unknown as typeof fetch;
    const adapter = new AzureSpeechAdapter({ subscriptionKey: "k", region: "eastus", fetchImpl });
    const r = await adapter.synthesize({ text: "Hello & world", voice: "en-US-AndrewNeural" });
    expect(r.backend).toBe("azure-speech");
    expect(r.licenseFamily).toBe("proprietary");
    expect(r.mime).toBe("audio/mpeg");
    expect(r.sampleRate).toBe(48_000);
    expect(r.audioBuffer.length).toBeGreaterThan(0);
  });

  it("surfaces a useful error on non-2xx response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("Quota exceeded", { status: 429 }),
    ) as unknown as typeof fetch;
    const adapter = new AzureSpeechAdapter({ subscriptionKey: "k", region: "eastus", fetchImpl });
    await expect(adapter.synthesize({ text: "hi" })).rejects.toThrow(/AzureSpeechAdapter: 429.*Quota exceeded/);
  });

  it("constructor refuses missing key/region", () => {
    expect(() => new AzureSpeechAdapter({ subscriptionKey: "", region: "eastus" })).toThrow(/subscriptionKey/);
    expect(() => new AzureSpeechAdapter({ subscriptionKey: "k", region: "" })).toThrow(/region/);
  });
});

describe("KokoroAdapter — lazy load + injection", () => {
  it("uses an injected TTS instance and returns wav bytes", async () => {
    const fakeRaw = {
      sampling_rate: 24_000,
      toWav: () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x02]),
    };
    const adapter = new KokoroAdapter({
      __inject: { generate: async () => fakeRaw },
    });
    const r = await adapter.synthesize({ text: "hello", voice: "af_bella" });
    expect(r.backend).toBe("kokoro");
    expect(r.licenseFamily).toBe("apache_or_mit");
    expect(r.mime).toBe("audio/wav");
    expect(r.sampleRate).toBe(24_000);
    // First 4 bytes should be "RIFF".
    expect(r.audioBuffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
  });

  it("throws a helpful error when kokoro-js is not installed (no inject + no peer)", async () => {
    const adapter = new KokoroAdapter();
    await expect(adapter.synthesize({ text: "hi" })).rejects.toThrow(/kokoro-js' is not installed/);
  });
});
