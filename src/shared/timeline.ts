import { findAnchor } from "./timing";
import type { Card, ChapterCue, LineKind, Poll, Script, Show, Word } from "./types";

export interface LineTiming {
  duration: number;
  words: Word[];
  estimated: boolean;
}

export interface MusicDurations {
  sting: number;
  bed: number;
  ident: number;
  outro: number;
  blip: number;
}

export interface CaptionPage {
  idx: number[];
  s: number;
  e: number;
}

export interface TLLine {
  id: string;
  speaker: string;
  kind: LineKind;
  s: number;
  e: number;
  words: Word[];
  pages: CaptionPage[];
  estimated: boolean;
}

export interface TLChapter {
  id: string;
  title: string;
  n: number;
  t: number;
  end: number;
  cue: ChapterCue;
}

export interface TLCard {
  card: Card;
  t: number;
  end: number;
  /** Bar labels already shown on the previous card of the same series (they don't animate in again). */
  carry: string[];
  max: number;
}

export interface TLPoll {
  poll: Poll;
  t: number;
}

export type MusicSlot = "sting" | "bed" | "ident" | "outro" | "blip";

export interface MusicCue {
  slot: MusicSlot;
  start: number;
  /** Gain while nobody speaks. */
  full: number;
  /** Gain while someone speaks. */
  duck: number;
  /** Stop playing after this many seconds (with a fade). */
  maxDur?: number;
  fadeOut?: number;
}

export interface Timeline {
  duration: number;
  speechEnd: number;
  lines: TLLine[];
  chapters: TLChapter[];
  cards: TLCard[];
  polls: TLPoll[];
  cues: MusicCue[];
  endCard: { t: number; end: number };
}

const GAP_SAME = 0.32;
const GAP_CHANGE = 0.55;
const GAP_VOICENOTE = 0.75;

export function captionPages(words: Word[]): CaptionPage[] {
  const pages: number[][] = [];
  let cur: number[] = [];
  words.forEach((w, i) => {
    cur.push(i);
    const end = /[.?!:]["')\]]?$/.test(w.w);
    const comma = /[,;]$/.test(w.w);
    if ((end && cur.length >= 4) || cur.length >= 14 || (comma && cur.length >= 10)) {
      pages.push(cur);
      cur = [];
    }
  });
  if (cur.length) {
    if (pages.length && cur.length < 3) pages[pages.length - 1].push(...cur);
    else pages.push(cur);
  }
  return pages.map((idx) => ({ idx, s: words[idx[0]].s, e: words[idx[idx.length - 1]].e }));
}

export function buildTimeline(input: {
  script: Script;
  show: Show;
  timings: Record<string, LineTiming>;
  music: MusicDurations;
}): Timeline {
  const { script, show, timings, music } = input;
  const m = show.music;
  const cues: MusicCue[] = [];
  const chapterStarts = new Map(script.chapters.map((c) => [c.startLineId, c]));
  const chapterTimes = new Map<string, number>();
  const lines: TLLine[] = [];
  let t = 0.35;

  script.lines.forEach((line, i) => {
    const timing = timings[line.id] ?? { duration: 1, words: [], estimated: true };
    const ch = chapterStarts.get(line.id);
    if (ch) {
      if (ch.cue === "ident" && i > 0 && music.ident > 0) {
        t += 0.35;
        chapterTimes.set(ch.id, t);
        cues.push({ slot: "ident", start: t, full: m.identLevel, duck: m.identLevel });
        t += Math.min(1.05, music.ident);
      } else if (ch.cue === "sting" && music.sting > 0) {
        chapterTimes.set(ch.id, Math.max(0, t - 0.35));
        cues.push({ slot: "sting", start: t, full: m.stingLevel, duck: m.duckLevel + 0.02 });
        const lead = Math.max(0.8, music.sting - 2.4);
        if (music.bed > 0) cues.push({ slot: "bed", start: t + lead, full: m.bedLevel, duck: Math.min(m.bedLevel, m.duckLevel * 0.75), maxDur: 22, fadeOut: 4 });
        t += lead + 0.35;
      } else {
        chapterTimes.set(ch.id, i === 0 ? 0 : Math.max(0, t - 0.35));
      }
    }
    if (line.kind === "voicenote" && music.blip > 0) {
      if (t < 0.35) t = 0.35;
      cues.push({ slot: "blip", start: t - 0.3, full: 0.35, duck: 0.35 });
    }
    const s = round(t);
    const words = timing.words.map((w) => ({ w: w.w, s: round(s + w.s), e: round(s + w.e) }));
    const e = round(s + timing.duration);
    lines.push({ id: line.id, speaker: line.speaker, kind: line.kind, s, e, words, pages: captionPages(words), estimated: timing.estimated });
    t = e;
    const next = script.lines[i + 1];
    if (next) {
      let gap = next.speaker === line.speaker ? GAP_SAME : GAP_CHANGE;
      if (line.kind === "voicenote" || next.kind === "voicenote") gap = GAP_VOICENOTE;
      t += gap + (line.pauseAfter ?? 0);
    }
  });

  const speechEnd = lines.length ? lines[lines.length - 1].e : 0;
  let duration = speechEnd + Math.max(2, show.layout.endCardSeconds) + 0.7;
  if (music.outro > 0 && script.chapters.some((c) => c.cue === "outro")) {
    const start = Math.max(0, speechEnd + Math.min(6, show.layout.endCardSeconds + 1) - music.outro);
    cues.push({ slot: "outro", start, full: m.outroLevel, duck: m.duckLevel });
    duration = Math.max(duration, start + music.outro + 0.3);
  }
  duration = round(duration);

  // chapters, in script order
  const orderedChapters = [...script.chapters].sort(
    (a, b) => script.lines.findIndex((l) => l.id === a.startLineId) - script.lines.findIndex((l) => l.id === b.startLineId),
  );
  const chapters: TLChapter[] = orderedChapters.map((c, n) => {
    const firstLine = lines.find((l) => l.id === c.startLineId);
    return { id: c.id, title: c.title, n, t: round(chapterTimes.get(c.id) ?? firstLine?.s ?? 0), end: duration, cue: c.cue };
  });
  if (!chapters.length) chapters.push({ id: "all", title: script.title, n: 0, t: 0, end: duration, cue: "none" });
  chapters[0].t = 0;
  for (let i = 0; i < chapters.length; i++) chapters[i].end = i + 1 < chapters.length ? chapters[i + 1].t : duration;

  // beds stop at the end of their chapter
  for (const c of cues) {
    if (c.slot !== "bed") continue;
    const ch = chapters.find((x) => c.start >= x.t && c.start < x.end);
    if (ch) c.maxDur = Math.min(c.maxDur ?? 22, Math.max(4, ch.end - c.start));
  }

  const lineById = new Map(lines.map((l) => [l.id, l]));
  const chapterAt = (time: number) => {
    let found = chapters[0];
    for (const c of chapters) if (time >= c.t) found = c;
    return found;
  };

  // cards
  const placed = script.cards
    .map((card) => {
      const line = lineById.get(card.lineId);
      if (!line) return null;
      const idx = findAnchor(line.words, card.anchor || "");
      const time = idx >= 0 && line.words[idx] ? line.words[idx].s : line.s;
      return { card, t: round(time), line };
    })
    .filter((x): x is { card: Card; t: number; line: TLLine } => !!x)
    .sort((a, b) => a.t - b.t);

  const cards: TLCard[] = placed.map((p, i) => {
    const next = placed[i + 1];
    const ch = chapterAt(p.t + 0.01);
    const holdLine = p.card.holdUntilLineId ? lineById.get(p.card.holdUntilLineId) : p.line;
    const hold = p.card.type === "cta" ? duration : (holdLine ?? p.line).e + (p.card.type === "quote" ? 5 : 0.3);
    const end = Math.min(next ? next.t : duration, ch.end - 0.2, Math.max(hold, p.t + 4));
    let carry: string[] = [];
    let max = 0;
    if (p.card.type === "bars" && p.card.bars?.length) {
      const prev = [...placed.slice(0, i)].reverse().find((q) => q.card.type === "bars" && q.card.unit === p.card.unit && p.t - q.t < 40);
      carry = prev?.card.bars?.map((b) => b.label) ?? [];
      max = p.card.max || Math.max(...p.card.bars.map((b) => b.value), 1);
    }
    return { card: p.card, t: p.t, end: round(Math.max(p.t + 0.5, end)), carry, max };
  });

  const polls: TLPoll[] = script.polls
    .map((poll) => {
      const line = lineById.get(poll.afterLineId);
      return line ? { poll, t: round(line.e + 0.2) } : null;
    })
    .filter((x): x is TLPoll => !!x)
    .sort((a, b) => a.t - b.t);

  return {
    duration,
    speechEnd,
    lines,
    chapters,
    cards,
    polls,
    cues,
    endCard: { t: round(speechEnd + 0.8), end: duration },
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** A stand-in voice envelope (30 fps) for previews before audio exists. */
export function syntheticEnvelope(tl: Timeline, fps = 30): number[] {
  const n = Math.ceil(tl.duration * fps);
  const env = new Array<number>(n).fill(0);
  for (const l of tl.lines) {
    for (const w of l.words) {
      const a = Math.floor(w.s * fps);
      const b = Math.ceil(w.e * fps);
      for (let i = a; i < b && i < n; i++) env[i] = 0.45 + 0.4 * Math.abs(Math.sin(i * 1.7 + w.s * 3));
    }
  }
  return env;
}

export function lineAt(tl: Timeline, time: number): TLLine | null {
  for (const l of tl.lines) if (time >= l.s - 0.05 && time <= l.e + 0.05) return l;
  return null;
}

export function lastLineBefore(tl: Timeline, time: number): TLLine | null {
  let p: TLLine | null = null;
  for (const l of tl.lines) {
    if (l.e < time) p = l;
    else break;
  }
  return p;
}

export function chapterAt(tl: Timeline, time: number): TLChapter {
  let c = tl.chapters[0];
  for (const ch of tl.chapters) if (time >= ch.t) c = ch;
  return c;
}

export function cardAt(tl: Timeline, time: number): TLCard | null {
  let hit: TLCard | null = null;
  for (const c of tl.cards) if (time >= c.t && time < c.end) hit = c;
  return hit;
}
