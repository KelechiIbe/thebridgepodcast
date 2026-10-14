import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, HttpError } from "./http";

let admin: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (admin) return admin;
  const url = env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
  // Supabase's newer "secret" key, or the older "service_role" key; either works
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new HttpError(500, "Supabase is not configured on the server. Set VITE_SUPABASE_URL and SUPABASE_SECRET_KEY in Netlify.");
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export const BUCKET = "media";
