import { handle, json, body, HttpError } from "./_lib/http";
import { requireUser } from "./_lib/auth";
import { eleven } from "./_lib/eleven";
import { upload } from "./_lib/storage";
import { adminClient } from "./_lib/supabase";
import type { VoiceSettings } from "../../src/shared/types";

interface TtsBody {
  episodeId?: string;
  lineId?: string;
  hash?: string;
  /** Text exactly as the voice should read it (pronunciations already applied). */
  text: string;
  voiceId: string;
  modelId: string;
  settings: VoiceSettings;
  previousText?: string;
  nextText?: string;
  preview?: boolean;
}

const CONTEXT_MODELS = /^eleven_(multilingual|flash|turbo)/;

export default handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  const caller = await requireUser(req, ["admin", "producer"]);
  const b = await body<TtsBody>(req);
  if (!b.text?.trim()) throw new HttpError(400, "Nothing to read.");
  if (!b.voiceId) throw new HttpError(400, "This character has no voice yet. Pick one under Characters.");
  if (b.text.length > 4500) throw new HttpError(400, "That line is too long for one take. Split it into shorter lines.");
  const s = b.settings;
  const payload: Record<string, unknown> = {
    text: b.text,
    model_id: b.modelId || "eleven_multilingual_v2",
    voice_settings: {
      stability: s?.stability ?? 0.5,
      similarity_boost: s?.similarity ?? 0.8,
      style: s?.style ?? 0,
      use_speaker_boost: s?.speakerBoost ?? true,
      speed: s?.speed ?? 1,
    },
  };
  if (CONTEXT_MODELS.test(String(payload.model_id))) {
    if (b.previousText) payload.previous_text = b.previousText.slice(-300);
    if (b.nextText) payload.next_text = b.nextText.slice(0, 300);
  }
  const res = await eleven(`/v1/text-to-speech/${encodeURIComponent(b.voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const out: any = await res.json();
  const alignment = out.alignment ?? out.normalized_alignment;
  if (!out.audio_base64) throw new HttpError(502, "ElevenLabs returned no audio.");
  await adminClient().from("usage_log").insert({ kind: "tts", units: b.text.length, episode_id: b.episodeId ?? null, created_by: caller.id });
  if (b.preview) return json({ audioBase64: out.audio_base64, alignment });
  if (!b.episodeId || !b.lineId) throw new HttpError(400, "Missing episode or line.");
  const path = `episodes/${b.episodeId}/audio/${b.lineId}-${b.hash ?? Date.now()}.mp3`;
  await upload(path, Buffer.from(out.audio_base64, "base64"), "audio/mpeg");
  return json({ path, alignment });
});
