import { HttpError } from "./http";
import { getKey } from "./secrets";
import type { AiProvider } from "../../../src/shared/types";
import { checkJson, fitsStrictMode } from "../../../src/shared/jsonCheck";

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

// Schemas Claude has already refused in strict mode, so later calls in this function
// instance go straight to the instructions route.
const tooComplexForStrict = new WeakSet<object>();
const SCHEMA_TOO_COMPLEX = /grammar|too complex|compil|optional param|union type|strict tool/i;

function jsonInstructions(schema: Record<string, unknown>): string {
  return `Reply with one JSON object and nothing else: no code fences, no commentary before or after it. The object must follow this JSON Schema. Include every property listed in "required". Leave out optional properties that don't apply rather than filling them with empty values. Use only the values listed in "enum".

${JSON.stringify(schema)}`;
}

async function claude<T>(o: GenerateOptions): Promise<GenerateResult<T>> {
  const key = await getKey("anthropic");
  return withTimeout(o.timeoutMs ?? 600_000, async (signal) => {
    const send = async (body: Record<string, unknown>) => {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: o.model, max_tokens: o.maxTokens, ...body }),
      });
      const out: any = await res.json().catch(() => ({}));
      return { res, out };
    };
    const fail = (res: Response, out: any) => new HttpError(res.status === 401 ? 400 : 502, `Claude: ${out?.error?.message ?? res.statusText}`);
    const textOf = (out: any) => {
      if (out.stop_reason === "max_tokens") throw new HttpError(502, "Claude ran out of room before finishing. Try again, or shorten the notes.");
      if (out.stop_reason === "refusal") throw new HttpError(502, "Claude declined this request.");
      return (out.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    };
    const usage = { input: 0, output: 0 };
    const count = (out: any) => {
      usage.input += out.usage?.input_tokens ?? 0;
      usage.output += out.usage?.output_tokens ?? 0;
    };

    // Strict mode guarantees the shape, but Claude only compiles small schemas. Big ones
    // (a whole script, the chat-edit operations) go the instructions route below.
    if (fitsStrictMode(o.schema) && !tooComplexForStrict.has(o.schema)) {
      const { res, out } = await send({
        system: o.system,
        messages: [{ role: "user", content: o.user }],
        output_config: { format: { type: "json_schema", schema: o.schema } },
      });
      if (res.ok) {
        count(out);
        return { data: parseJson(textOf(out)) as T, usage, model: o.model };
      }
      if (res.status !== 400 || !SCHEMA_TOO_COMPLEX.test(String(out?.error?.message ?? ""))) throw fail(res, out);
      tooComplexForStrict.add(o.schema);
    }

    // Instructions route: the schema goes in the system prompt, the reply is checked here,
    // and Claude gets one chance to correct it.
    const system = `${o.system}\n\n${jsonInstructions(o.schema)}`;
    const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: o.user }];
    for (let attempt = 0; ; attempt++) {
      const { res, out } = await send({ system, messages });
      if (!res.ok) throw fail(res, out);
      count(out);
      const text = textOf(out);
      let data: unknown;
      let problems: string[];
      try {
        data = parseJson(text);
        problems = checkJson(data, o.schema);
      } catch {
        data = undefined;
        problems = ["The reply wasn't a valid JSON object."];
      }
      if (!problems.length) return { data: data as T, usage, model: o.model };
      if (attempt >= 1) {
        // Small slips (a card missing a field) are repaired downstream; a missing top-level part is not.
        const fatal = data === undefined || problems.some((p) => /^\$\.[A-Za-z]+ is missing$|^\$ should be/.test(p));
        if (fatal) throw new HttpError(502, "Claude's reply didn't come back in the expected shape. Try again.");
        console.warn("Claude reply accepted with schema slips:", problems.join("; "));
        return { data: data as T, usage, model: o.model };
      }
      messages.push(
        { role: "assistant", content: text },
        { role: "user", content: `That reply doesn't match the schema:\n- ${problems.join("\n- ")}\n\nSend the whole corrected JSON object again, and nothing else.` },
      );
    }
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
