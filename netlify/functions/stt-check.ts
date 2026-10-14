import { handle, json, body, HttpError } from "./_lib/http";
import { requireUser } from "./_lib/auth";
import { eleven } from "./_lib/eleven";
import { download } from "./_lib/storage";

// Listens back to a generated line with ElevenLabs speech-to-text so the app can flag mispronounced words.
export default handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  await requireUser(req);
  const b = await body<{ path: string }>(req);
  if (!b.path) throw new HttpError(400, "Missing audio path");
  const blob = await download(b.path);
  const form = new FormData();
  form.set("model_id", "scribe_v2");
  form.set("language_code", "en");
  form.set("tag_audio_events", "false");
  form.set("file", blob, "line.mp3");
  const out: any = await (await eleven("/v1/speech-to-text", { method: "POST", body: form })).json();
  const words = (out.words ?? []).filter((w: any) => w.type === "word").map((w: any) => ({ w: w.text, s: w.start, e: w.end }));
  return json({ text: out.text ?? "", words });
});
