import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_MODEL_ID,
  ELEVENLABS_VOICE_ID,
  ELEVENLABS_SPEED,
} from "../config.js";

// ElevenLabs streaming endpoint with ulaw_8000 output — bytes drop straight
// into Twilio Media Streams, no resampling, no codec conversion.
export async function* streamElevenLabsMuLaw(
  text: string,
  opts: { voiceId?: string; modelId?: string; speed?: number } = {}
): AsyncGenerator<Buffer, void, void> {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not set");
  if (!text.trim()) return;

  const voiceId = opts.voiceId ?? ELEVENLABS_VOICE_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=ulaw_8000`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: opts.modelId ?? ELEVENLABS_MODEL_ID,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        speed: opts.speed ?? ELEVENLABS_SPEED,
      },
    }),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS ${res.status}: ${errText.slice(0, 300)}`);
  }

  const reader = (res.body as any).getReader?.();
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) yield Buffer.from(value);
    }
  } else {
    for await (const chunk of res.body as any) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
  }
}
