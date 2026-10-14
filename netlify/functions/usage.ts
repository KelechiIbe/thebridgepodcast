import { handle, json } from "./_lib/http";
import { requireUser } from "./_lib/auth";
import { eleven } from "./_lib/eleven";

export default handle(async (req) => {
  await requireUser(req);
  const s: any = await (await eleven("/v1/user/subscription")).json();
  return json({
    tier: s.tier ?? "",
    used: s.character_count ?? 0,
    limit: s.character_limit ?? 0,
    resetsAt: s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toISOString() : null,
    canClone: !!s.can_use_instant_voice_cloning,
  });
});
