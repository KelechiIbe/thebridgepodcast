import { HttpError } from "./http";
import { getKey } from "./secrets";

export const ELEVEN = "https://api.elevenlabs.io";

export async function eleven(path: string, init: RequestInit = {}): Promise<Response> {
  const key = await getKey("elevenlabs");
  const headers = new Headers(init.headers);
  headers.set("xi-api-key", key);
  const res = await fetch(ELEVEN + path, { ...init, headers });
  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    const msg = typeof err?.detail === "string" ? err.detail : err?.detail?.message ?? err?.detail?.[0]?.msg ?? res.statusText;
    const status = res.status === 401 ? 400 : res.status === 429 ? 429 : 502;
    throw new HttpError(status, `ElevenLabs: ${msg}`);
  }
  return res;
}
