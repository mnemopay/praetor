# @praetor/voice

Text-to-speech for Praetor charters. Default backend is **Kokoro 82M**
(Apache 2.0, ONNX, lazy-loaded — no API key, no quota, no network egress).
Azure Speech, Edge TTS, ElevenLabs, OpenAI TTS, fal-tts, and OpenVoice v2
ship as opt-in adapters tagged with `licenseFamily` so charters can refuse
non-permissive backends.

## Install

```bash
npm install @praetor/voice
# Optional peer for the Kokoro adapter:
npm install kokoro-js
```

## Usage

```ts
import { PraetorVoice, KokoroAdapter, AzureSpeechAdapter } from "@praetor/voice";

const voice = new PraetorVoice();
voice.attach("kokoro", new KokoroAdapter());
voice.attach("azure-speech", new AzureSpeechAdapter({ key, region }));

const out = await voice.synthesize({ text: "hello", voice: "af_bella" });
// out.audioBuffer, out.mime, out.backend, out.licenseFamily
```

## License families

| Family | Adapters |
|---|---|
| `apache_or_mit` | Kokoro, Piper, OpenVoice v2 (safe-default) |
| `proprietary` | Azure Speech, ElevenLabs, OpenAI TTS, fal-tts |
| `restricted` | non-commercial / Llama-derivative / watermarked |

Pass `allowedLicenseFamilies` on `PraetorVoice` to whitelist.

## License

Apache 2.0. Kokoro itself is Apache 2.0.
