import { requireUser } from "./_lib/auth";
import { adminClient } from "./_lib/supabase";
import { generateJSON } from "./_lib/ai";
import {
  scriptSystemPrompt,
  scriptUserPrompt,
  socialPrompt,
  SOCIAL_SCHEMA,
  brandPrompt,
  BRAND_SCHEMA,
  factcheckPrompt,
  FACTCHECK_SCHEMA,
} from "./_lib/prompts";
import { SCRIPT_JSON_SCHEMA, scriptFromAi, type AiScript } from "../../src/shared/aiSchema";
import type { Character, Episode, Fact, Show } from "../../src/shared/types";

// Background function: Netlify replies 202 at once and lets this run for up to 15 minutes.
export default async (req: Request) => {
  const db = adminClient();
  let jobId = "";
  const update = (fields: Record<string, unknown>) =>
    db.from("jobs").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", jobId);
  try {
    const b: any = await req.json();
    jobId = b.jobId;
    const caller = await requireUser(req, ["admin", "producer"]);
    await update({ status: "running", message: "Reading", progress: 8 });
    const { data: showRow } = await db.from("shows").select("data").eq("id", b.showId).single();
    const show = showRow!.data as Show;
    const provider = show.aiProvider;
    const model = show.aiModels[provider];

    if (b.kind === "script") {
      const { data: epRow } = await db.from("episodes").select("data").eq("id", b.episodeId).single();
      const episode = epRow!.data as Episode;
      if (!episode.notes?.text) throw new Error("Upload the meeting notes first.");
      const [{ data: chars }, { data: facts }] = await Promise.all([
        db.from("characters").select("data").eq("show_id", show.id),
        db.from("facts").select("data").eq("show_id", show.id),
      ]);
      const characters = (chars ?? []).map((r: any) => r.data as Character).sort((a, z) => a.sortOrder - z.sortOrder);
      await update({ message: `Writing the script with ${model}`, progress: 20 });
      const out = await generateJSON<AiScript>({
        provider,
        model,
        system: scriptSystemPrompt(show),
        user: scriptUserPrompt({
          notes: episode.notes.text,
          characters,
          facts: (facts ?? []).map((r: any) => r.data as Fact),
          show,
          episodeNumber: episode.number,
          sessionDate: episode.sessionDate,
          instructions: String(b.payload?.instructions ?? ""),
        }),
        schema: SCRIPT_JSON_SCHEMA,
        maxTokens: 32000,
      });
      await update({ message: "Checking the result", progress: 85 });
      const script = scriptFromAi(out.data, characters);
      if (!script.lines.length) throw new Error("The AI returned an empty script. Try again.");
      if (episode.script) {
        await db.from("episode_versions").insert({ episode_id: episode.id, data: episode, note: "Before AI regeneration", created_by: caller.id });
      }
      const next: Episode = { ...episode, script, title: script.title, status: "draft", approval: null, updatedAt: new Date().toISOString() };
      await db.from("episodes").update({ data: next, title: next.title, status: "draft" }).eq("id", episode.id);
      await db.from("usage_log").insert({ kind: `ai:${provider}`, units: out.usage.input + out.usage.output, episode_id: episode.id, created_by: caller.id });
      await update({
        status: "done",
        progress: 100,
        message: `Script ready: ${script.lines.length} lines, ${script.cards.length} visuals, ${script.flags.length} items to check`,
        result: { lines: script.lines.length },
      });
      return;
    }

    if (b.kind === "social") {
      const p = socialPrompt(b.payload);
      const out = await generateJSON({ provider, model, system: p.system, user: p.user, schema: SOCIAL_SCHEMA, maxTokens: 6000 });
      await update({ status: "done", progress: 100, message: "Social pack ready", result: out.data });
      return;
    }

    if (b.kind === "factcheck") {
      const { data: facts } = await db.from("facts").select("data").eq("show_id", show.id);
      const p = factcheckPrompt(b.payload.script, (facts ?? []).map((r: any) => r.data as Fact));
      const out = await generateJSON({ provider, model, system: p.system, user: p.user, schema: FACTCHECK_SCHEMA, maxTokens: 8000 });
      await update({ status: "done", progress: 100, message: "Fact check finished", result: out.data });
      return;
    }

    if (b.kind === "brand") {
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 40) : []);
      const p = brandPrompt(String(b.payload.text ?? ""), list(b.payload.colors), { fonts: list(b.payload.fonts), logos: list(b.payload.logos) });
      const out = await generateJSON({ provider, model, system: p.system, user: p.user, schema: BRAND_SCHEMA, maxTokens: 3000 });
      await update({ status: "done", progress: 100, message: "Brand suggestions ready", result: out.data });
      return;
    }
    throw new Error("Unknown task");
  } catch (e) {
    console.error(e);
    if (jobId) await update({ status: "error", message: (e as Error).message || "The task failed" });
  }
};
