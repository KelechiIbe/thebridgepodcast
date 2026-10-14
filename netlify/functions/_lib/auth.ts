import { adminClient } from "./supabase";
import { HttpError } from "./http";
import type { Role } from "../../../src/shared/types";

export interface Caller {
  id: string;
  email: string;
  role: Role;
  name: string;
}

export async function requireUser(req: Request, roles?: Role[]): Promise<Caller> {
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in first.");
  const db = adminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Your session has expired. Sign in again.");
  const { data: profile } = await db.from("profiles").select("role, full_name, email").eq("id", data.user.id).maybeSingle();
  if (!profile) throw new HttpError(403, "Your account is not part of this studio.");
  if (roles && !roles.includes(profile.role)) throw new HttpError(403, `This needs the ${roles.join(" or ")} role.`);
  return { id: data.user.id, email: profile.email || data.user.email || "", role: profile.role, name: profile.full_name || profile.email };
}
