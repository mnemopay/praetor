/**
 * MockVoiceAdapter — deterministic test backend. Returns a tiny WAV-shaped
 * buffer keyed off the text so assertions can verify the right text was
 * synthesized without actually generating audio.
 */

import type {
  LicenseFamily,
  VoiceAdapter,
  VoiceBackend,
  VoiceSynthesisRequest,
  VoiceSynthesisResult,
} from "../index.js";

export interface MockVoiceAdapterOptions {
  /** Override the backend name (so the same mock can stand in for kokoro/azure/etc.). */
  backendName?: VoiceBackend;
  /** Override the license family — useful for testing license enforcement. */
  licenseFamily?: LicenseFamily;
  /** When true, every synthesize() throws. */
  shouldThrow?: boolean;
}

export class MockVoiceAdapter implements VoiceAdapter {
  readonly backend: VoiceBackend;
  readonly licenseFamily: LicenseFamily;
  readonly displayName = "Mock voice (test)";
  /** Each call recorded — handy for assertions. */
  readonly calls: VoiceSynthesisRequest[] = [];

  constructor(private readonly opts: MockVoiceAdapterOptions = {}) {
    this.backend = opts.backendName ?? "mock";
    this.licenseFamily = opts.licenseFamily ?? "apache_or_mit";
  }

  async synthesize(req: VoiceSynthesisRequest): Promise<VoiceSynthesisResult> {
    if (this.opts.shouldThrow) {
      throw new Error("MockVoiceAdapter: configured to throw");
    }
    this.calls.push(req);
    // Deterministic "audio" — first 4 bytes are RIFF magic so callers that
    // sniff WAV signatures don't immediately reject this buffer.
    const header = Buffer.from("RIFF");
    const body = Buffer.from(`mock:${req.voice ?? "default"}:${req.text}`, "utf8");
    return {
      audioBuffer: Buffer.concat([header, body]),
      mime: "audio/wav",
      sampleRate: 24_000,
      durationMs: req.text.length * 50,
      backend: this.backend,
      licenseFamily: this.licenseFamily,
    };
  }
}
