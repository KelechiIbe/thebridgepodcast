import { handle, json, body, HttpError } from "./_lib/http";
import { requireUser } from "./_lib/auth";
import { adminClient } from "./_lib/supabase";
import { getKey } from "./_lib/secrets";

// Validates the request, records a job, then hands the slow AI work to the background function.
export default handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  const caller = await requireUser(req, ["admin", "producer"]);
  const b = await body<{ kind: string; episodeId?: string; showId: string; payload?: unknown }>(req);
  if (!["script", "social", "factcheck", "brand"].includes(b.kind)) throw new HttpError(400, "Unknown task");
  const db = adminClient();
  const { data: show } = await db.from("shows").select("data").eq("id", b.showId).maybeSingle();
  if (!show) throw new HttpError(404, "Show not found");
  await getKey(show.data.aiProvider === "gemini" ? "gemini" : "anthropic");
  const jobId = `job-${crypto.randomUUID().slice(0, 12)}`;
  const { error } = await db.from("jobs").insert({
    id: jobId,
    episode_id: b.episodeId ?? null,
    kind: b.kind,
    status: "queued",
    message: "Waiting to start",
    progress: 2,
    created_by: caller.id,
  });
  if (error) throw new HttpError(500, error.message);
  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/.netlify/functions/ai-run-background`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: req.headers.get("authorization") ?? "" },
    body: JSON.stringify({ ...b, jobId }),
  });
  if (res.status >= 400) {
    await db.from("jobs").update({ status: "error", message: `Couldn't start the background task (${res.status}).` }).eq("id", jobId);
    throw new HttpError(502, "Couldn't start the background task.");
  }
  return json({ jobId });
});
