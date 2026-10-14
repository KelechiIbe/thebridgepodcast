import { handle, json, body, HttpError } from "./_lib/http";
import { requireUser } from "./_lib/auth";
import { eleven } from "./_lib/eleven";

export default handle(async (req) => {
  await requireUser(req);
  if (req.method === "GET") {
    const u = new URL(req.url);
    const scope = u.searchParams.get("scope") ?? "mine";
    const search = u.searchParams.get("search") ?? "";
    if (scope === "mine") {
      const q = new URLSearchParams({ page_size: "100" });
      if (search) q.set("search", search);
      const out: any = await (await eleven(`/v2/voices?${q}`)).json();
      return json({
        voices: (out.voices ?? []).map((v: any) => ({
          voiceId: v.voice_id,
          name: v.name,
          category: v.category,
          isClone: ["cloned", "professional"].includes(v.category),
          accent: v.labels?.accent ?? "",
          gender: v.labels?.gender ?? "",
          description: v.description ?? v.labels?.description ?? "",
          previewUrl: v.preview_url ?? null,
        })),
      });
    }
    const q = new URLSearchParams({ page_size: "40", page: u.searchParams.get("page") ?? "0" });
    for (const k of ["accent", "gender", "language", "search"]) {
      const v = u.searchParams.get(k);
      if (v) q.set(k, v);
    }
    const out: any = await (await eleven(`/v1/shared-voices?${q}`)).json();
    return json({
      hasMore: !!out.has_more,
      voices: (out.voices ?? []).map((v: any) => ({
        voiceId: v.voice_id,
        publicOwnerId: v.public_owner_id,
        name: v.name,
        accent: v.accent ?? "",
        gender: v.gender ?? "",
        age: v.age ?? "",
        description: v.description ?? "",
        useCase: v.use_case ?? "",
        previewUrl: v.preview_url ?? null,
        added: !!v.is_added_by_user,
      })),
    });
  }
  if (req.method !== "POST") throw new HttpError(405, "GET or POST");
  await requireUser(req, ["admin", "producer"]);
  const b = await body<{ action: string; publicOwnerId: string; voiceId: string; name: string }>(req);
  if (b.action !== "add-shared") throw new HttpError(400, "Unknown action");
  const out: any = await (
    await eleven(`/v1/voices/add/${encodeURIComponent(b.publicOwnerId)}/${encodeURIComponent(b.voiceId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ new_name: b.name }),
    })
  ).json();
  return json({ voiceId: out.voice_id ?? b.voiceId });
});
