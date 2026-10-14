import { adminClient } from "./supabase";
import { decrypt, encrypt } from "./crypto";
import { env, HttpError } from "./http";

export type KeyName = "elevenlabs" | "anthropic" | "gemini";

const ENV_NAMES: Record<KeyName, string> = {
  elevenlabs: "ELEVENLABS_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const LABEL: Record<KeyName, string> = { elevenlabs: "ElevenLabs", anthropic: "Anthropic (Claude)", gemini: "Google Gemini" };

export async function getKey(name: KeyName): Promise<string> {
  const { data } = await adminClient().from("secrets").select("ciphertext, iv").eq("name", name).maybeSingle();
  if (data) return decrypt(data.ciphertext, data.iv);
  const fromEnv = env(ENV_NAMES[name]);
  if (fromEnv) return fromEnv;
  throw new HttpError(400, `No ${LABEL[name]} API key yet. An admin can add one in Settings.`);
}

export async function keyStatus(): Promise<Record<KeyName, { set: boolean; last4: string; source: "settings" | "environment" | "none" }>> {
  const { data } = await adminClient().from("secrets").select("name, last4");
  const rows = new Map((data ?? []).map((r: any) => [r.name, r.last4]));
  const out = {} as Record<KeyName, { set: boolean; last4: string; source: "settings" | "environment" | "none" }>;
  for (const n of Object.keys(ENV_NAMES) as KeyName[]) {
    if (rows.has(n)) out[n] = { set: true, last4: rows.get(n) as string, source: "settings" };
    else if (env(ENV_NAMES[n])) out[n] = { set: true, last4: env(ENV_NAMES[n]).slice(-4), source: "environment" };
    else out[n] = { set: false, last4: "", source: "none" };
  }
  return out;
}

export async function saveKey(name: KeyName, value: string, userId: string) {
  const v = value.trim();
  if (!v) {
    await adminClient().from("secrets").delete().eq("name", name);
    return;
  }
  const { ciphertext, iv } = encrypt(v);
  const { error } = await adminClient()
    .from("secrets")
    .upsert({ name, ciphertext, iv, last4: v.slice(-4), updated_by: userId, updated_at: new Date().toISOString() });
  if (error) throw new HttpError(500, error.message);
}
