import { handle, json, body, HttpError } from "./_lib/http";
import { requireUser } from "./_lib/auth";
import { generateJSON } from "./_lib/ai";
import { editSystemPrompt, editUserPrompt } from "./_lib/prompts";
import { EDIT_JSON_SCHEMA, type EditOp } from "../../src/shared/aiSchema";
import type { Character, Script, Show } from "../../src/shared/types";

export default handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  await requireUser(req, ["admin", "producer"]);
  const b = await body<{ script: Script; show: Show; characters: Character[]; message: string; history?: { role: string; text: string }[] }>(req);
  if (!b.message?.trim()) throw new HttpError(400, "Say what you'd like to change.");
  const provider = b.show.aiProvider;
  const out = await generateJSON<{ reply: string; ops: EditOp[] }>({
    provider,
    model: b.show.aiModels[provider],
    system: editSystemPrompt(),
    user: editUserPrompt({ script: b.script, show: b.show, characters: b.characters, message: b.message, history: b.history ?? [] }),
    schema: EDIT_JSON_SCHEMA,
    maxTokens: 8000,
    timeoutMs: 50_000, // Netlify stops synchronous functions at 60 seconds
  });
  return json(out.data);
});
