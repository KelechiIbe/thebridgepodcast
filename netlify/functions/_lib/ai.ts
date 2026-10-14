import { HttpError } from "./http";
import { getKey } from "./secrets";
import type { AiProvider } from "../../../src/shared/types";

export interface GenerateOptions {
  provider: AiProvider;
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs?: number;
}

export interface GenerateResult<T> {
  data: T;
  usage: { input: number; output: number };
  model: string;
}

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new HttpError(502, "The AI returned something that wasn't valid JSON. Try again.");
  }
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fn(ctl.signal);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new HttpError(504, "The AI took too long to answer. Try a shorter request or a faster model.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function claude<T>(o: GenerateOptions): Promise<GenerateResult<T>> {
  const key = await getKey("anthropic");
  return withTimeout(o.timeoutMs ?? 600_000, async (signal) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: o.model,
        max_tokens: o.maxTokens,
        system: o.system,
        messages: [{ role: "user", content: o.user }],
        output_config: { format: { type: "json_schema", schema: o.schema } },
      }),
    });
    const out: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(res.status === 401 ? 400 : 502, `Claude: ${out?.error?.message ?? res.statusText}`);
    if (out.stop_reason === "max_tokens") throw new HttpError(502, "Claude ran out of room before finishing. Try again, or shorten the notes.");
    if (out.stop_reason === "refusal") throw new HttpError(502, "Claude declined this request.");
    const text = (out.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return { data: parseJson(text) as T, usage: { input: out.usage?.input_tokens ?? 0, output: out.usage?.output_tokens ?? 0 }, model: o.model };
  });
}

async function gemini<T>(o: GenerateOptions): Promise<GenerateResult<T>> {
  const key = await getKey("gemini");
  const call = async (withSchema: boolean, signal: AbortSignal) => {
    const user = withSchema ? o.user : `${o.user}\n\nReturn only JSON that matches this JSON Schema:\n${JSON.stringify(o.schema)}`;
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}:generateContent`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: o.system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: o.maxTokens,
          ...(withSchema ? { responseJsonSchema: o.schema } : {}),
        },
      }),
    });
  };
  return withTimeout(o.timeoutMs ?? 600_000, async (signal) => {
    let res = await call(true, signal);
    if (res.status === 400) {
      // Older or newer API versions may not accept the schema field; fall back to describing it.
      const err = await res.clone().json().catch(() => ({}));
      if (/schema|responseJsonSchema|Unknown name/i.test(JSON.stringify(err))) res = await call(false, signal);
    }
    const out: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(res.status === 401 || res.status === 403 ? 400 : 502, `Gemini: ${out?.error?.message ?? res.statusText}`);
    const cand = out.candidates?.[0];
    if (!cand) throw new HttpError(502, `Gemini returned no answer${out.promptFeedback?.blockReason ? ` (${out.promptFeedback.blockReason})` : ""}.`);
    if (cand.finishReason === "MAX_TOKENS") throw new HttpError(502, "Gemini ran out of room before finishing. Try again, or shorten the notes.");
    const text = (cand.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    return {
      data: parseJson(text) as T,
      usage: { input: out.usageMetadata?.promptTokenCount ?? 0, output: out.usageMetadata?.candidatesTokenCount ?? 0 },
      model: o.model,
    };
  });
}

export function generateJSON<T>(o: GenerateOptions): Promise<GenerateResult<T>> {
  return o.provider === "gemini" ? gemini<T>(o) : claude<T>(o);
}
