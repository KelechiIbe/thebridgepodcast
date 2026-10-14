import { handle, json, body, HttpError } from "./_lib/http";
import { requireUser } from "./_lib/auth";
import { eleven } from "./_lib/eleven";
import { download } from "./_lib/storage";

// Creates an ElevenLabs instant voice clone from recordings already uploaded to storage.
export default handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  await requireUser(req, ["admin", "producer"]);
  const b = await body<{ name: string; description?: string; paths: string[]; removeNoise?: boolean; consent: boolean }>(req);
  if (!b.consent) throw new HttpError(400, "Confirm that the speaker agreed to be cloned.");
  if (!b.name?.trim() || !b.paths?.length) throw new HttpError(400, "Give the voice a name and at least one recording.");
  const form = new FormData();
  form.set("name", b.name.trim());
  if (b.description) form.set("description", b.description);
  form.set("remove_background_noise", b.removeNoise ? "true" : "false");
  for (const p of b.paths.slice(0, 25)) {
    const blob = await download(p);
    form.append("files", blob, p.split("/").pop() || "sample.mp3");
  }
  const out: any = await (await eleven("/v1/voices/add", { method: "POST", body: form })).json();
  return json({ voiceId: out.voice_id, requiresVerification: !!out.requires_verification });
});
