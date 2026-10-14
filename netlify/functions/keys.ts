import { handle, json, body, HttpError } from "./_lib/http";
import { requireUser } from "./_lib/auth";
import { keyStatus, saveKey, getKey, type KeyName } from "./_lib/secrets";

const NAMES: KeyName[] = ["elevenlabs", "anthropic", "gemini"];

async function test(name: KeyName): Promise<string> {
  const key = await getKey(name);
  let res: Response;
  if (name === "elevenlabs") res = await fetch("https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": key } });
  else if (name === "anthropic") res = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
  else res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key } });
  if (!res.ok) throw new HttpError(400, `The key was rejected (${res.status}).`);
  return "The key works.";
}

export default handle(async (req) => {
  if (req.method === "GET") {
    await requireUser(req);
    return json(await keyStatus());
  }
  const caller = await requireUser(req, ["admin"]);
  const b = await body<{ action?: string; name: KeyName; value?: string }>(req);
  if (!NAMES.includes(b.name)) throw new HttpError(400, "Unknown key");
  if (b.action === "test") return json({ message: await test(b.name) });
  await saveKey(b.name, b.value ?? "", caller.id);
  return json(await keyStatus());
});
