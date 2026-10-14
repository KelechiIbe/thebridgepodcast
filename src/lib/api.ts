// Calls to the Netlify functions, with the signed-in user's token.

import { store } from "./store";
import type { Alignment } from "../shared/timing";
import type { Character, Script, Show, UsageInfo, VoiceSettings } from "../shared/types";
import type { EditOp } from "../shared/aiSchema";

export class ApiError extends Error {}

export const serverAvailable = () => store.mode === "supabase";

async function call<T>(name: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<T> {
  if (!serverAvailable()) throw new ApiError("This needs the online studio (Supabase + Netlify). You're in demo mode in this browser.");
  const token = await store.token();
  const q = init.query ? `?${new URLSearchParams(init.query)}` : "";
  const res = await fetch(`/.netlify/functions/${name}${q}`, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  startAi: (b: { kind: "script" | "social" | "factcheck" | "brand"; showId: string; episodeId?: string; payload?: unknown }) =>
    call<{ jobId: string }>("ai-start", { method: "POST", body: JSON.stringify(b) }),
  edit: (b: { script: Script; show: Show; characters: Character[]; message: string; history: { role: string; text: string }[] }) =>
    call<{ reply: string; ops: EditOp[] }>("ai-edit", { method: "POST", body: JSON.stringify(b) }),
  tts: (b: {
    episodeId?: string;
    lineId?: string;
    hash?: string;
    text: string;
    voiceId: string;
    modelId: string;
    settings: VoiceSettings;
    previousText?: string;
    nextText?: string;
    preview?: boolean;
  }) => call<{ path?: string; audioBase64?: string; alignment: Alignment }>("tts", { method: "POST", body: JSON.stringify(b) }),
  myVoices: (search = "") => call<{ voices: VoiceInfo[] }>("voices", { query: { scope: "mine", search } }),
  libraryVoices: (q: { accent?: string; gender?: string; search?: string; page?: string }) =>
    call<{ voices: VoiceInfo[]; hasMore: boolean }>("voices", { query: { scope: "library", language: "en", ...Object.fromEntries(Object.entries(q).filter(([, v]) => v)) } as Record<string, string> }),
  addSharedVoice: (b: { publicOwnerId: string; voiceId: string; name: string }) =>
    call<{ voiceId: string }>("voices", { method: "POST", body: JSON.stringify({ action: "add-shared", ...b }) }),
  cloneVoice: (b: { name: string; description?: string; paths: string[]; removeNoise: boolean; consent: boolean }) =>
    call<{ voiceId: string; requiresVerification: boolean }>("voice-clone", { method: "POST", body: JSON.stringify(b) }),
  sttCheck: (path: string) => call<{ text: string; words: { w: string; s: number; e: number }[] }>("stt-check", { method: "POST", body: JSON.stringify({ path }) }),
  usage: () => call<UsageInfo & { canClone: boolean }>("usage"),
  keys: () => call<Record<"elevenlabs" | "anthropic" | "gemini", { set: boolean; last4: string; source: string }>>("keys"),
  saveKey: (name: string, value: string) => call<Record<string, { set: boolean; last4: string; source: string }>>("keys", { method: "POST", body: JSON.stringify({ name, value }) }),
  testKey: (name: string) => call<{ message: string }>("keys", { method: "POST", body: JSON.stringify({ action: "test", name }) }),
  team: () => call<{ members: { id: string; email: string; fullName: string; role: string }[] }>("team"),
  teamAction: (b: { action: "invite" | "create" | "password" | "role" | "remove"; email?: string; fullName?: string; role?: string; userId?: string; password?: string }) =>
    call<{ ok: boolean }>("team", { method: "POST", body: JSON.stringify(b) }),
};

export interface VoiceInfo {
  voiceId: string;
  publicOwnerId?: string;
  name: string;
  category?: string;
  isClone?: boolean;
  accent: string;
  gender: string;
  age?: string;
  description: string;
  useCase?: string;
  previewUrl: string | null;
  added?: boolean;
}

/** Waits for a background AI job to finish, reporting progress. */
export async function waitForJob(jobId: string, onUpdate: (msg: string, progress: number) => void, timeoutMs = 16 * 60_000) {
  const start = Date.now();
  let delay = 1500;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(4000, delay * 1.2);
    const job = await store.getJob(jobId);
    if (!job) continue;
    onUpdate(job.message, job.progress);
    if (job.status === "done") return job;
    if (job.status === "error") throw new ApiError(job.message || "The task failed");
  }
  throw new ApiError("This is taking longer than expected. Check back in a few minutes.");
}
