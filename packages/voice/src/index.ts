/**
 * @kpanks/voice — Praetor-native text-to-speech runtime.
 *
 * Per `feedback_praetor_native_tools.md`, the default backend is Kokoro 82M
 * (Apache 2.0, ONNX-based, lazy-loaded). Third-party services (Azure Speech,
 * ElevenLabs, OpenAI TTS, fal-tts) are opt-in adapters tagged
 * `origin: "adapter"` in audit logs.
 *
 * Per `project_praetor_voice_research.md`, the runtime exposes a
 * `licenseFamily` field on every adapter so charters can declare
 * `requires_license: apache_or_mit` and refuse to dispatch to non-permissive
 * backends. License families:
 *   - "apache_or_mit"   — safe-default (Kokoro, Piper, OpenVoice v2)
 *   - "proprietary"     — paid SaaS (Azure, ElevenLabs, OpenAI TTS, fal-tts)
 *   - "restricted"      — non-commercial / Llama-derivative / watermarked
 *
 * Surface intentionally compact:
 *
 *   const voice = new PraetorVoice();
 *   voice.attach("kokoro", new KokoroAdapter());
 *   voice.attach("azure-speech", new AzureSpeechAdapter({ key, region }));
 *   const out = await voice.synthesize({ text: "hello", voice: "af_bella" });
 *   // out.audioBuffer, out.mime, out.backend, out.licenseFamily
 */

export type LicenseFamily = "apache_or_mit" | "proprietary" | "restricted";

export type VoiceBackend =
  | "praetor-default"
  | "kokoro"
  | "piper"
  | "azure-speech"
  | "edge-tts"
  | "elevenlabs"
  | "openai-tts"
  | "fal-tts"
  | "openvoice-clone"
  | "mock";

export interface VoiceSynthesisRequest {
  /** Text to speak. */
  text: string;
  /**
   * Voice id. Backend-specific:
   *   - kokoro: "af_bella" | "am_michael" | … (54 voices)
   *   - azure-speech: "en-US-AndrewNeural"
   *   - edge-tts: "en-US-AndrewNeural"
   *   - elevenlabs: 11labs voice id
   * Pass "default" to let the adapter pick its own house voice.
   */
  voice?: string;
  /** SSML rate ("+0%", "-10%", etc.) when the backend supports it. */
  rate?: string;
  /** Override the backend selected by the runtime; otherwise the default. */
  backend?: VoiceBackend;
  /** Pass-through opts for the backend (e.g. style="newscast"). */
  options?: Record<string, unknown>;
}

export interface VoiceSynthesisResult {
  /** Raw audio bytes — format varies by backend. */
  audioBuffer: Buffer;
  /** MIME of `audioBuffer`. Most adapters emit "audio/mpeg" or "audio/wav". */
  mime: string;
  /** Sample rate in Hz when known (some adapters omit). */
  sampleRate?: number;
  /** Length of synthesized audio in milliseconds when known. */
  durationMs?: number;
  /** Backend that produced the audio. */
  backend: VoiceBackend;
  /** License family of the backend. Charters can pin against this. */
  licenseFamily: LicenseFamily;
}

export interface VoiceAdapter {
  /** Stable backend identifier — must match a `VoiceBackend` value. */
  readonly backend: VoiceBackend;
  /** License family of the underlying model/service. */
  readonly licenseFamily: LicenseFamily;
  /** Display-friendly name for telemetry / audit log. */
  readonly displayName: string;
  /** Synthesize text to audio. */
  synthesize(req: VoiceSynthesisRequest): Promise<VoiceSynthesisResult>;
}

export interface PraetorVoiceOptions {
  /** Force a default backend by name. Defaults to first attached. */
  defaultBackend?: VoiceBackend;
  /**
   * Reject calls whose adapter doesn't satisfy this license requirement.
   * "apache_or_mit" is safest for shipping.
   */
  requireLicense?: LicenseFamily | "any";
}

export class PraetorVoice {
  private readonly backends = new Map<VoiceBackend, VoiceAdapter>();
  private explicitDefault: VoiceBackend | undefined;
  private readonly requireLicense: LicenseFamily | "any";

  constructor(opts: PraetorVoiceOptions = {}) {
    this.explicitDefault = opts.defaultBackend;
    this.requireLicense = opts.requireLicense ?? "any";
  }

  /** Attach a backend. Last attached for a given name wins. */
  attach(name: VoiceBackend, adapter: VoiceAdapter): this {
    if (adapter.backend !== name) {
      throw new Error(
        `PraetorVoice: adapter.backend mismatch — passed name='${name}' but adapter reports '${adapter.backend}'`,
      );
    }
    this.backends.set(name, adapter);
    return this;
  }

  /** True if a backend is wired in. */
  has(name: VoiceBackend): boolean {
    return this.backends.has(name);
  }

  /** All attached backends with their license families — useful for diagnostics. */
  list(): { name: VoiceBackend; licenseFamily: LicenseFamily; displayName: string }[] {
    return [...this.backends.values()].map((a) => ({
      name: a.backend,
      licenseFamily: a.licenseFamily,
      displayName: a.displayName,
    }));
  }

  /** Resolve the default backend. Order: explicit → first attached. */
  defaultBackend(): VoiceBackend | null {
    if (this.explicitDefault && this.backends.has(this.explicitDefault)) return this.explicitDefault;
    const first = this.backends.keys().next();
    return first.done ? null : first.value;
  }

  async synthesize(req: VoiceSynthesisRequest): Promise<VoiceSynthesisResult> {
    if (!req.text || !req.text.trim()) {
      throw new Error("PraetorVoice: text is required");
    }
    const wantedBackend = req.backend ?? this.defaultBackend();
    if (!wantedBackend) {
      throw new Error(
        "PraetorVoice: no backend attached. Call attach('kokoro', ...) or attach('azure-speech', ...) before synthesize.",
      );
    }
    const adapter = this.backends.get(wantedBackend);
    if (!adapter) {
      throw new Error(`PraetorVoice: backend '${wantedBackend}' is not attached`);
    }
    if (this.requireLicense !== "any" && adapter.licenseFamily !== this.requireLicense) {
      throw new Error(
        `PraetorVoice: backend '${wantedBackend}' has licenseFamily='${adapter.licenseFamily}' but charter requires '${this.requireLicense}'`,
      );
    }
    return adapter.synthesize(req);
  }
}

/* ─── Built-in adapters ────────────────────────────────────────────────── */

export { KokoroAdapter } from "./adapters/kokoro.js";
export type { KokoroAdapterOptions } from "./adapters/kokoro.js";
export { AzureSpeechAdapter } from "./adapters/azure-speech.js";
export type { AzureSpeechAdapterOptions } from "./adapters/azure-speech.js";
export { MockVoiceAdapter } from "./adapters/mock.js";
