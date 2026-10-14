// JSON schemas the AI must follow, plus helpers that turn AI output into app data.
// Schemas stay inside the subset both Claude and Gemini accept: every object lists its
// properties and sets additionalProperties:false; no numeric or length constraints.

import { uid } from "./ids";
import { findAnchor } from "./timing";
import { tokenize } from "./timing";
import type {
  Bar,
  Brand,
  Card,
  CardType,
  Chapter,
  ChapterCue,
  Character,
  EndCard,
  FactFlag,
  LineKind,
  Persona,
  Poll,
  Script,
  Show,
  StageLayout,
  Tone,
  WidgetType,
} from "./types";

const str = { type: "string" };
const num = { type: "number" };
const bool = { type: "boolean" };
const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const arr = (items: unknown) => ({ type: "array", items });

export const CARD_TYPES: CardType[] = ["stat", "note", "shift", "split", "bars", "formula", "steps", "dodont", "quote", "cta", "list"];
const TONES: Tone[] = ["good", "bad", "mid", "accent"];

const barSchema = obj({ label: str, value: num, tone: { type: "string", enum: TONES } }, ["label", "value", "tone"]);

export const cardFieldsSchema = {
  type: { type: "string", enum: CARD_TYPES },
  anchor: str,
  big: str,
  label: str,
  sub: str,
  tone: { type: "string", enum: TONES },
  from: str,
  to: str,
  total: num,
  part: num,
  partLabel: str,
  restLabel: str,
  unit: str,
  bars: arr(barSchema),
  max: num,
  parts: arr(str),
  steps: arr(str),
  doText: str,
  dontText: str,
  quote: str,
  attribution: str,
};

const aiCardSchema = obj(cardFieldsSchema, ["type", "anchor"]);

const pollSchema = obj(
  { question: str, options: arr(str), answer: { type: "integer" }, why: str },
  ["question", "options", "answer", "why"],
);

const flagSchema = obj(
  { claim: str, issue: str, suggestion: str, severity: { type: "string", enum: ["info", "warn", "error"] } },
  ["claim", "issue", "suggestion", "severity"],
);

export const SCRIPT_JSON_SCHEMA = obj(
  {
    title: str,
    summary: str,
    personas: arr(
      obj(
        { key: str, name: str, role: str, gender: { type: "string", enum: ["female", "male"] } },
        ["key", "name", "role", "gender"],
      ),
    ),
    chapters: arr(
      obj(
        {
          title: str,
          cue: { type: "string", enum: ["none", "sting", "ident", "outro"] },
          lines: arr(
            obj(
              {
                speaker: str,
                kind: { type: "string", enum: ["studio", "voicenote", "letter"] },
                text: str,
                cards: arr(aiCardSchema),
                poll: { anyOf: [pollSchema, { type: "null" }] },
                flags: arr(flagSchema),
              },
              ["speaker", "kind", "text", "cards", "poll", "flags"],
            ),
          ),
        },
        ["title", "cue", "lines"],
      ),
    ),
    anonymisation: arr(
      obj(
        {
          original: str,
          replacement: str,
          kind: { type: "string", enum: ["person", "business", "place", "figure", "other"] },
          note: str,
        },
        ["original", "replacement", "kind", "note"],
      ),
    ),
    widgets: arr({ type: "string", enum: ["vat-commission", "company-vs-bn", "pit"] }),
  },
  ["title", "summary", "personas", "chapters", "anonymisation", "widgets"],
);

export interface AiCard {
  type: CardType;
  anchor: string;
  [k: string]: unknown;
}
export interface AiLine {
  speaker: string;
  kind: LineKind;
  text: string;
  cards: AiCard[];
  poll: { question: string; options: string[]; answer: number; why: string } | null;
  flags: { claim: string; issue: string; suggestion: string; severity: "info" | "warn" | "error" }[];
}
export interface AiScript {
  title: string;
  summary: string;
  personas: { key: string; name: string; role: string; gender: "female" | "male" }[];
  chapters: { title: string; cue: ChapterCue; lines: AiLine[] }[];
  anonymisation: Script["anonymisation"];
  widgets: WidgetType[];
}

const PERSONA_COLORS = ["#F5C518", "#7FD8B0", "#F2A7C3", "#9CC3FF", "#FFB070", "#C9B8FF"];

export function cardFromAi(raw: Record<string, unknown>, lineId: string, lineText: string): Card | null {
  const type = String(raw.type ?? "") as CardType;
  if (!CARD_TYPES.includes(type)) return null;
  const card: Card = { id: uid("card"), lineId, anchor: String(raw.anchor ?? ""), type };
  const strings = ["big", "label", "sub", "from", "to", "partLabel", "restLabel", "unit", "doText", "dontText", "quote", "attribution"] as const;
  for (const k of strings) if (typeof raw[k] === "string" && (raw[k] as string).trim()) (card as any)[k] = (raw[k] as string).trim();
  for (const k of ["total", "part", "max"] as const) if (typeof raw[k] === "number" && isFinite(raw[k] as number)) (card as any)[k] = raw[k];
  if (typeof raw.tone === "string" && TONES.includes(raw.tone as Tone)) card.tone = raw.tone as Tone;
  if (Array.isArray(raw.bars)) {
    card.bars = (raw.bars as any[])
      .filter((b) => b && typeof b.label === "string" && typeof b.value === "number")
      .map((b): Bar => ({ label: b.label, value: b.value, tone: TONES.includes(b.tone) ? b.tone : "mid" }));
  }
  if (Array.isArray(raw.parts)) card.parts = (raw.parts as unknown[]).map(String);
  if (Array.isArray(raw.steps)) card.steps = (raw.steps as unknown[]).map(String);
  const words = tokenize(lineText);
  if (!card.anchor || findAnchor(words, card.anchor) < 0) card.anchor = words.slice(0, 2).map((w) => w.w).join(" ");
  return card;
}

/** Converts the AI's nested output into the app's Script, assigning ids and repairing references. */
export function scriptFromAi(ai: AiScript, characters: Character[]): Script {
  const listeners = characters.filter((c) => c.kind === "listener");
  const hosts = characters.filter((c) => c.kind === "host");
  const fallbackHost = hosts[0]?.id ?? characters[0]?.id ?? "host";
  const personas: Persona[] = (ai.personas ?? []).map((p, i) => {
    const want = p.gender === "male" ? /\bmale\b|\bman\b|\(m\)/i : /female|woman|\(f\)/i;
    const voice = listeners.find((l) => want.test(l.name) || want.test(l.role)) ?? listeners[i % Math.max(1, listeners.length)];
    return { id: `p-${slug(p.key || p.name)}-${i}`, name: p.name, role: p.role, voiceCharacterId: voice?.id ?? "", color: PERSONA_COLORS[i % PERSONA_COLORS.length] };
  });
  const personaByKey = new Map<string, Persona>();
  (ai.personas ?? []).forEach((p, i) => {
    personaByKey.set(p.key, personas[i]);
    personaByKey.set(p.name, personas[i]);
  });
  const charIds = new Set(characters.map((c) => c.id));
  const charByName = new Map(characters.map((c) => [c.name.toLowerCase(), c.id]));

  const script: Script = {
    title: ai.title || "Untitled episode",
    summary: ai.summary || "",
    personas,
    lines: [],
    chapters: [],
    cards: [],
    polls: [],
    widgets: [...new Set(ai.widgets ?? [])].map((type) => ({ id: uid("w"), type })),
    anonymisation: ai.anonymisation ?? [],
    flags: [],
    social: null,
  };
  let n = 0;
  for (const ch of ai.chapters ?? []) {
    let first: string | null = null;
    for (const l of ch.lines ?? []) {
      if (!l.text?.trim()) continue;
      const id = `l-${++n}`;
      first ??= id;
      let kind: LineKind = ["studio", "voicenote", "letter"].includes(l.kind) ? l.kind : "studio";
      let speaker = l.speaker;
      const persona = personaByKey.get(speaker);
      if (persona) {
        speaker = persona.id;
        kind = "voicenote";
      } else if (!charIds.has(speaker)) {
        speaker = charByName.get(String(speaker).toLowerCase()) ?? fallbackHost;
        if (kind === "voicenote") kind = "studio";
      } else if (kind === "voicenote") kind = "studio";
      script.lines.push({ id, speaker, kind, text: l.text.trim(), audio: null });
      for (const c of l.cards ?? []) {
        const card = cardFromAi(c as Record<string, unknown>, id, l.text);
        if (card) script.cards.push(card);
      }
      if (l.poll && l.poll.question && Array.isArray(l.poll.options) && l.poll.options.length >= 2) {
        const answer = Math.min(Math.max(0, Math.round(l.poll.answer)), l.poll.options.length - 1);
        script.polls.push({ id: uid("poll"), afterLineId: id, question: l.poll.question, options: l.poll.options, answer, why: l.poll.why ?? "" });
      }
      for (const f of l.flags ?? []) {
        script.flags.push({ id: uid("flag"), lineId: id, claim: f.claim, issue: f.issue, suggestion: f.suggestion, severity: f.severity ?? "warn", resolved: false });
      }
    }
    if (first) script.chapters.push({ id: uid("chap"), title: ch.title || "Part", startLineId: first, cue: ch.cue ?? "ident" });
  }
  if (script.chapters[0]) script.chapters[0].cue = script.chapters[0].cue === "ident" ? "none" : script.chapters[0].cue;
  return script;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "x";

// ---------------- chat edits ----------------

const opNames = [
  "updateLine",
  "insertLine",
  "deleteLine",
  "addCard",
  "updateCard",
  "deleteCard",
  "addPoll",
  "updatePoll",
  "deletePoll",
  "renameChapter",
  "setChapterCue",
  "updateBrand",
  "updateLayout",
  "updateEndCard",
  "renamePersona",
] as const;
export type EditOpName = (typeof opNames)[number];

const paletteSchema = obj(
  { bg: str, bg2: str, ink: str, dim: str, accent: str, accent2: str, good: str, bad: str, mid: str },
  [],
);

export const EDIT_JSON_SCHEMA = obj(
  {
    reply: str,
    ops: arr(
      obj(
        {
          op: { type: "string", enum: opNames as unknown as string[] },
          lineId: str,
          afterLineId: str,
          cardId: str,
          pollId: str,
          chapterId: str,
          personaId: str,
          speaker: str,
          kind: { type: "string", enum: ["studio", "voicenote", "letter"] },
          text: str,
          name: str,
          role: str,
          title: str,
          cue: { type: "string", enum: ["none", "sting", "ident", "outro"] },
          card: obj(cardFieldsSchema, []),
          poll: obj({ question: str, options: arr(str), answer: { type: "integer" }, why: str }, []),
          brand: obj(
            {
              palette: paletteSchema,
              wordmark: str,
              byline: str,
              badge: str,
              scene: { type: "string", enum: ["bridge", "gradient", "grid", "image", "plain"] },
              backgroundDim: num,
            },
            [],
          ),
          layout: obj(
            {
              showSpeakers: bool,
              showCaptions: bool,
              captionStyle: { type: "string", enum: ["karaoke", "plain", "boxed"] },
              showChapterLabel: bool,
              showBadge: bool,
              showLogo: bool,
              showProgress: bool,
              speakerStyle: { type: "string", enum: ["portrait", "initials"] },
              endCardSeconds: num,
            },
            [],
          ),
          endCard: obj({ headline: str, sub: str, url: str, showQr: bool }, []),
        },
        ["op"],
      ),
    ),
  },
  ["reply", "ops"],
);

export interface EditOp {
  op: EditOpName;
  lineId?: string;
  afterLineId?: string;
  cardId?: string;
  pollId?: string;
  chapterId?: string;
  personaId?: string;
  speaker?: string;
  kind?: LineKind;
  text?: string;
  name?: string;
  role?: string;
  title?: string;
  cue?: ChapterCue;
  card?: Record<string, unknown>;
  poll?: Partial<Poll>;
  brand?: Partial<Omit<Brand, "palette">> & { palette?: Partial<Brand["palette"]> };
  layout?: Partial<StageLayout>;
  endCard?: Partial<EndCard>;
}

export interface EditResult {
  script: Script;
  show: Show;
  applied: string[];
  skipped: string[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Applies AI (or user) edit operations to copies of the script and show. */
export function applyOps(script0: Script, show0: Show, ops: EditOp[]): EditResult {
  const script: Script = structuredClone(script0);
  const show: Show = structuredClone(show0);
  const applied: string[] = [];
  const skipped: string[] = [];
  const line = (id?: string) => script.lines.find((l) => l.id === id);
  for (const op of ops) {
    try {
      switch (op.op) {
        case "updateLine": {
          const l = line(op.lineId);
          if (!l) throw new Error("line not found");
          if (op.text && op.text !== l.text) {
            l.text = op.text.trim();
            l.audio = null;
          }
          if (op.speaker) l.speaker = op.speaker;
          if (op.kind) l.kind = op.kind;
          applied.push(`Edited line ${l.id}`);
          break;
        }
        case "insertLine": {
          if (!op.text || !op.speaker) throw new Error("needs text and speaker");
          const idx = op.afterLineId ? script.lines.findIndex((l) => l.id === op.afterLineId) : script.lines.length - 1;
          const id = uid("l");
          script.lines.splice(idx + 1, 0, { id, speaker: op.speaker, kind: op.kind ?? "studio", text: op.text.trim(), audio: null });
          applied.push(`Added a line after ${op.afterLineId ?? "the end"}`);
          break;
        }
        case "deleteLine": {
          const idx = script.lines.findIndex((l) => l.id === op.lineId);
          if (idx < 0) throw new Error("line not found");
          const [removed] = script.lines.splice(idx, 1);
          script.cards = script.cards.filter((c) => c.lineId !== removed.id);
          script.polls = script.polls.filter((p) => p.afterLineId !== removed.id);
          for (const ch of script.chapters) if (ch.startLineId === removed.id) ch.startLineId = script.lines[idx]?.id ?? script.lines[idx - 1]?.id ?? "";
          script.chapters = script.chapters.filter((c) => c.startLineId);
          applied.push(`Removed line ${removed.id}`);
          break;
        }
        case "addCard": {
          const l = line(op.lineId);
          if (!l || !op.card) throw new Error("needs lineId and card");
          const c = cardFromAi(op.card, l.id, l.text);
          if (!c) throw new Error("unknown card type");
          script.cards.push(c);
          applied.push(`Added a ${c.type} card`);
          break;
        }
        case "updateCard": {
          const c = script.cards.find((x) => x.id === op.cardId);
          if (!c || !op.card) throw new Error("card not found");
          const merged = cardFromAi({ ...c, ...op.card }, op.lineId && line(op.lineId) ? op.lineId : c.lineId, line(op.lineId ?? c.lineId)?.text ?? "");
          if (!merged) throw new Error("bad card");
          Object.assign(c, merged, { id: c.id, image: c.image });
          applied.push(`Updated card ${c.id}`);
          break;
        }
        case "deleteCard": {
          const before = script.cards.length;
          script.cards = script.cards.filter((c) => c.id !== op.cardId);
          if (before === script.cards.length) throw new Error("card not found");
          applied.push(`Removed card ${op.cardId}`);
          break;
        }
        case "addPoll": {
          const l = line(op.afterLineId ?? op.lineId);
          const p = op.poll;
          if (!l || !p?.question || !p.options || p.options.length < 2) throw new Error("needs a line and a full poll");
          script.polls.push({ id: uid("poll"), afterLineId: l.id, question: p.question, options: p.options, answer: Math.min(p.options.length - 1, Math.max(0, p.answer ?? 0)), why: p.why ?? "" });
          applied.push("Added a quiz question");
          break;
        }
        case "updatePoll": {
          const p = script.polls.find((x) => x.id === op.pollId);
          if (!p || !op.poll) throw new Error("poll not found");
          Object.assign(p, Object.fromEntries(Object.entries(op.poll).filter(([, v]) => v !== undefined)));
          p.answer = Math.min(p.options.length - 1, Math.max(0, p.answer));
          applied.push("Updated a quiz question");
          break;
        }
        case "deletePoll": {
          script.polls = script.polls.filter((p) => p.id !== op.pollId);
          applied.push("Removed a quiz question");
          break;
        }
        case "renameChapter": {
          const ch = script.chapters.find((c) => c.id === op.chapterId);
          if (!ch || !op.title) throw new Error("chapter not found");
          ch.title = op.title;
          applied.push(`Renamed chapter to ${op.title}`);
          break;
        }
        case "setChapterCue": {
          const ch: Chapter | undefined = script.chapters.find((c) => c.id === op.chapterId);
          if (!ch || !op.cue) throw new Error("chapter not found");
          ch.cue = op.cue;
          applied.push(`Set music cue for ${ch.title}`);
          break;
        }
        case "renamePersona": {
          const p = script.personas.find((x) => x.id === op.personaId);
          if (!p) throw new Error("listener not found");
          if (op.name) p.name = op.name;
          if (op.role) p.role = op.role;
          applied.push(`Updated listener ${p.name}`);
          break;
        }
        case "updateBrand": {
          const b = op.brand ?? {};
          if (b.palette) for (const [k, v] of Object.entries(b.palette)) if (typeof v === "string" && HEX.test(v) && k in show.brand.palette) (show.brand.palette as any)[k] = v;
          for (const k of ["wordmark", "byline", "badge"] as const) if (typeof b[k] === "string") show.brand[k] = b[k] as string;
          if (b.scene) show.brand.scene = b.scene;
          if (typeof b.backgroundDim === "number") show.brand.backgroundDim = Math.min(1, Math.max(0, b.backgroundDim));
          applied.push("Updated the brand");
          break;
        }
        case "updateLayout": {
          Object.assign(show.layout, Object.fromEntries(Object.entries(op.layout ?? {}).filter(([, v]) => v !== undefined)));
          applied.push("Updated the screen layout");
          break;
        }
        case "updateEndCard": {
          Object.assign(show.endCard, Object.fromEntries(Object.entries(op.endCard ?? {}).filter(([, v]) => v !== undefined)));
          applied.push("Updated the end card");
          break;
        }
        default:
          throw new Error("unknown operation");
      }
    } catch (e) {
      skipped.push(`${op.op}: ${(e as Error).message}`);
    }
  }
  return { script, show, applied, skipped };
}

export type { FactFlag };
