/**
 * AzureSpeechAdapter — Microsoft Cognitive Services Speech.
 *
 * Praetor's per-`feedback_tts_default.md` adapter for production VO when
 * Kokoro isn't sufficient. F0 free tier ships 500K chars/mo of neural TTS.
 *
 * Tagged `proprietary` license-family; charters that pin
 * `requires_license: apache_or_mit` will refuse to dispatch.
 */

import type {
  LicenseFamily,
  VoiceAdapter,
  VoiceBackend,
  VoiceSynthesisRequest,
  VoiceSynthesisResult,
} from "../index.js";

export interface AzureSpeechAdapterOptions {
  subscriptionKey: string;
  region: string;
  /** Default voice name. e.g. "en-US-AndrewNeural". */
  defaultVoice?: string;
  /** Override the default audio output format. */
  outputFormat?: AzureOutputFormat;
  /** Test-friendly fetch override. */
  fetchImpl?: typeof fetch;
}

export type AzureOutputFormat =
  | "audio-16khz-32kbitrate-mono-mp3"
  | "audio-24khz-48kbitrate-mono-mp3"
  | "audio-48khz-192kbitrate-mono-mp3"
  | "riff-24khz-16bit-mono-pcm"
  | "riff-48khz-16bit-mono-pcm";

const FORMAT_INFO: Record<AzureOutputFormat, { mime: string; sampleRate: number }> = {
  "audio-16khz-32kbitrate-mono-mp3":  { mime: "audio/mpeg", sampleRate: 16_000 },
  "audio-24khz-48kbitrate-mono-mp3":  { mime: "audio/mpeg", sampleRate: 24_000 },
  "audio-48khz-192kbitrate-mono-mp3": { mime: "audio/mpeg", sampleRate: 48_000 },
  "riff-24khz-16bit-mono-pcm":        { mime: "audio/wav",  sampleRate: 24_000 },
  "riff-48khz-16bit-mono-pcm":        { mime: "audio/wav",  sampleRate: 48_000 },
};

export class AzureSpeechAdapter implements VoiceAdapter {
  readonly backend: VoiceBackend = "azure-speech";
  readonly licenseFamily: LicenseFamily = "proprietary";
  readonly displayName = "Azure Cognitive Services Speech";

  constructor(private readonly opts: AzureSpeechAdapterOptions) {
    if (!opts.subscriptionKey) throw new Error("AzureSpeechAdapter: subscriptionKey required");
    if (!opts.region) throw new Error("AzureSpeechAdapter: region required");
  }

  async synthesize(req: VoiceSynthesisRequest): Promise<VoiceSynthesisResult> {
    const f = this.opts.fetchImpl ?? globalThis.fetch;
    const voice = req.voice ?? this.opts.defaultVoice ?? "en-US-AndrewNeural";
    const rate = req.rate ?? "+0%";
    const format = this.opts.outputFormat ?? "audio-48khz-192kbitrate-mono-mp3";
    const lang = voice.includes("-") ? voice.split("-").slice(0, 2).join("-") : "en-US";
    const ssml = `<speak version="1.0" xml:lang="${escapeAttr(lang)}">
  <voice name="${escapeAttr(voice)}">
    <prosody rate="${escapeAttr(rate)}">${escapeXml(req.text)}</prosody>
  </voice>
</speak>`;
    const res = await f(`https://${this.opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "ocp-apim-subscription-key": this.opts.subscriptionKey,
        "content-type": "application/ssml+xml",
        "x-microsoft-outputformat": format,
        "user-agent": "praetor-voice",
      },
      body: ssml,
    });
    if (!res.ok) {
      throw new Error(`AzureSpeechAdapter: ${res.status} ${await res.text()}`);
    }
    const arr = await res.arrayBuffer();
    const info = FORMAT_INFO[format];
    return {
      audioBuffer: Buffer.from(arr),
      mime: info.mime,
      sampleRate: info.sampleRate,
      backend: this.backend,
      licenseFamily: this.licenseFamily,
    };
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function escapeAttr(s: string): string {
  return escapeXml(s);
}
