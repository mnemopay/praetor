/**
 * KokoroAdapter — Praetor's native default TTS backend.
 *
 * Kokoro 82M is Apache 2.0, ONNX-based, and runs on commodity CPU at 3-11×
 * realtime with q4/q8 quantization. This adapter lazy-loads the optional
 * `kokoro-js` peer dependency only when synthesize() is first called, so the
 * voice package itself doesn't pull a 200MB+ model into every Praetor
 * install.
 *
 * Install path:
 *   npm install kokoro-js
 *   # weights download lazily on first synthesize() call
 *
 * Per `feedback_praetor_native_tools.md` — kokoro-js is a runtime
 * (ONNX bridge), not a wrapper, so this stays within "native default" doctrine.
 * The runtime + voice fingerprint + audio pipeline are owned by Praetor; the
 * weights are public Apache-licensed assets we host externally.
 */

import type {
  LicenseFamily,
  VoiceAdapter,
  VoiceBackend,
  VoiceSynthesisRequest,
  VoiceSynthesisResult,
} from "../index.js";

export interface KokoroAdapterOptions {
  /**
   * Override the default model id pulled from Hugging Face.
   * Defaults to "onnx-community/Kokoro-82M-ONNX".
   */
  modelId?: string;
  /**
   * Quantization level. "q8" is highest quality; "q4" is fastest. Defaults
   * to "q8" — fits in ~70MB and runs faster than realtime on a modern CPU.
   */
  dtype?: "fp32" | "fp16" | "q8" | "q4";
  /**
   * Default voice when the request omits one. Kokoro 54-voice catalog —
   * "af_bella" is a common Apache-safe pick. See kokoro-js docs for the
   * full list.
   */
  defaultVoice?: string;
  /**
   * Inject a pre-loaded TTS instance for tests. Bypasses the lazy import.
   */
  __inject?: { generate: (text: string, opts: { voice: string }) => Promise<KokoroGenerated> };
}

interface KokoroGenerated {
  /** Buffer-like raw audio. kokoro-js returns a `RawAudio` with `.audio` (Float32Array) + `.sampling_rate` + `.toWav()`. */
  toWav(): ArrayBuffer | Uint8Array;
  sampling_rate: number;
}

interface KokoroJsModule {
  KokoroTTS: {
    from_pretrained(
      modelId: string,
      opts: { dtype?: string; device?: string },
    ): Promise<{ generate(text: string, opts: { voice: string }): Promise<KokoroGenerated> }>;
  };
}

export class KokoroAdapter implements VoiceAdapter {
  readonly backend: VoiceBackend = "kokoro";
  readonly licenseFamily: LicenseFamily = "apache_or_mit";
  readonly displayName = "Kokoro 82M (Apache 2.0, native ONNX)";
  private tts: { generate(text: string, opts: { voice: string }): Promise<KokoroGenerated> } | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly opts: KokoroAdapterOptions = {}) {
    if (opts.__inject) {
      this.tts = opts.__inject;
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.tts) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      let mod: KokoroJsModule;
      try {
        // kokoro-js is an optional peer dep — its types may not be on disk,
        // and the bare import would fail at compile time. Stage the
        // specifier through a non-literal so TS skips static resolution.
        const specifier = "kokoro-js";
        mod = (await import(/* @vite-ignore */ specifier)) as unknown as KokoroJsModule;
      } catch (err) {
        throw new Error(
          "KokoroAdapter: optional peer dependency 'kokoro-js' is not installed. Run `npm install kokoro-js` to enable the Praetor-native voice backend.",
        );
      }
      this.tts = await mod.KokoroTTS.from_pretrained(
        this.opts.modelId ?? "onnx-community/Kokoro-82M-ONNX",
        { dtype: this.opts.dtype ?? "q8" },
      );
    })();
    return this.loadPromise;
  }

  async synthesize(req: VoiceSynthesisRequest): Promise<VoiceSynthesisResult> {
    await this.ensureLoaded();
    if (!this.tts) {
      // Defensive — ensureLoaded throws on failure, so this path is unreachable.
      throw new Error("KokoroAdapter: failed to load");
    }
    const voice = req.voice ?? this.opts.defaultVoice ?? "af_bella";
    const audio = await this.tts.generate(req.text, { voice });
    const wav = audio.toWav();
    const buffer = Buffer.from(wav instanceof Uint8Array ? wav : new Uint8Array(wav));
    return {
      audioBuffer: buffer,
      mime: "audio/wav",
      sampleRate: audio.sampling_rate,
      backend: this.backend,
      licenseFamily: this.licenseFamily,
    };
  }
}
