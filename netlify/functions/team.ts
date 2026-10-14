import { handle, json, body, HttpError } from "./_lib/http";
import { requireUser } from "./_lib/auth";
import { adminClient } from "./_lib/supabase";
import type { Role } from "../../src/shared/types";

const ROLES: Role[] = ["admin", "producer", "reviewer"];

export default handle(async (req) => {
  const caller = await requireUser(req, req.method === "GET" ? undefined : ["admin"]);
  const db = adminClient();
  if (req.method === "GET") {
    const { data } = await db.from("profiles").select("id, email, full_name, role, created_at").order("created_at");
    return json({ members: (data ?? []).map((p: any) => ({ id: p.id, email: p.email, fullName: p.full_name, role: p.role })) });
  }
  const b = await body<{ action: string; email?: string; fullName?: string; role?: Role; userId?: string; password?: string }>(req);
  if (b.action === "invite") {
    if (!b.email || !/^\S+@\S+\.\S+$/.test(b.email)) throw new HttpError(400, "Enter a valid email address.");
    const role = ROLES.includes(b.role as Role) ? b.role : "producer";
    const origin = new URL(req.url).origin;
    const { data, error } = await db.auth.admin.inviteUserByEmail(b.email.trim(), {
      redirectTo: `${origin}/`,
      data: { full_name: b.fullName ?? "", role },
    });
    if (error) throw new HttpError(400, error.message);
    if (data.user) {
      const r = await db.from("profiles").upsert({ id: data.user.id, email: b.email.trim(), full_name: b.fullName ?? "", role });
      if (r.error) throw new HttpError(500, r.error.message);
    }
    return json({ ok: true });
  }
  if (b.action === "create") {
    // Adds someone with a temporary password, so no email has to be sent.
    // Supabase's built-in mailer only reaches members of your Supabase organisation.
    if (!b.email || !/^\S+@\S+\.\S+$/.test(b.email)) throw new HttpError(400, "Enter a valid email address.");
    if (!b.password || b.password.length < 8) throw new HttpError(400, "The temporary password needs at least 8 characters.");
    const role = ROLES.includes(b.role as Role) ? b.role : "producer";
    const { data, error } = await db.auth.admin.createUser({
      email: b.email.trim(),
      password: b.password,
      email_confirm: true,
      user_metadata: { full_name: b.fullName ?? "" },
    });
    if (error) throw new HttpError(400, /already/i.test(error.message) ? "Someone with that email already has an account." : error.message);
    const r = await db.from("profiles").upsert({ id: data.user.id, email: b.email.trim(), full_name: b.fullName ?? "", role });
    if (r.error) throw new HttpError(500, r.error.message);
    return json({ ok: true });
  }
  if (b.action === "password") {
    if (!b.userId) throw new HttpError(400, "Pick a person.");
    if (!b.password || b.password.length < 8) throw new HttpError(400, "The new password needs at least 8 characters.");
    const { error } = await db.auth.admin.updateUserById(b.userId, { password: b.password });
    if (error) throw new HttpError(400, error.message);
    return json({ ok: true });
  }
  if (b.action === "role") {
    if (!b.userId || !ROLES.includes(b.role as Role)) throw new HttpError(400, "Pick a role.");
    if (b.userId === caller.id && b.role !== "admin") {
      const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
      if ((count ?? 0) <= 1) throw new HttpError(400, "You're the only admin. Make someone else admin first.");
    }
    await db.from("profiles").update({ role: b.role }).eq("id", b.userId);
    return json({ ok: true });
  }
  if (b.action === "remove") {
    if (!b.userId || b.userId === caller.id) throw new HttpError(400, "You can't remove yourself.");
    const { error } = await db.auth.admin.deleteUser(b.userId);
    if (error) throw new HttpError(400, error.message);
    return json({ ok: true });
  }
  throw new HttpError(400, "Unknown action");
});
