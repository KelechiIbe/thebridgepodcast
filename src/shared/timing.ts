import { mapRange, type SpanMap } from "./pronounce";
import type { Word } from "./types";

export interface DisplayToken {
  w: string;
  d0: number;
  d1: number;
}

export function tokenize(text: string): DisplayToken[] {
  const out: DisplayToken[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ w: m[0], d0: m.index, d1: m.index + m[0].length });
  return out;
}

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/**
 * Per-character times for the spoken string, taken from a voice provider's alignment.
 * Tolerates small differences between what we sent and what the provider reports.
 */
export function charTimes(spoken: string, al: Alignment): { start: number[]; end: number[] } {
  const n = spoken.length;
  const start = new Array<number>(n).fill(NaN);
  const end = new Array<number>(n).fill(NaN);
  const chars = al.characters;
  let j = 0;
  for (let i = 0; i < n && j < chars.length; i++) {
    const c = spoken[i];
    if (chars[j] === c || chars[j]?.toLowerCase() === c.toLowerCase()) {
      start[i] = al.character_start_times_seconds[j];
      end[i] = al.character_end_times_seconds[j];
      j++;
      continue;
    }
    // resync: look a little ahead in the alignment for this character
    let found = -1;
    for (let k = j + 1; k < Math.min(chars.length, j + 12); k++) {
      if (chars[k]?.toLowerCase() === c.toLowerCase()) {
        found = k;
        break;
      }
    }
    if (found >= 0) {
      j = found;
      start[i] = al.character_start_times_seconds[j];
      end[i] = al.character_end_times_seconds[j];
      j++;
    }
  }
  // fill gaps by carrying neighbours
  let last = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(start[i])) {
      start[i] = last;
      end[i] = last;
    } else last = end[i];
  }
  return { start, end };
}

/** Word timings for the display text, using provider alignment of the spoken text. */
export function wordsFromAlignment(display: string, spoken: string, spans: SpanMap[], al: Alignment): Word[] {
  const { start, end } = charTimes(spoken, al);
  const words: Word[] = [];
  let prevEnd = 0;
  for (const tok of tokenize(display)) {
    let [s0, s1] = mapRange(spans, tok.d0, tok.d1);
    while (s0 < s1 - 1 && /\s/.test(spoken[s0] ?? "")) s0++;
    while (s1 - 1 > s0 && /[\s.,!?;:]/.test(spoken[s1 - 1] ?? "")) s1--;
    const s = Math.max(prevEnd - 0.02, start[Math.min(s0, start.length - 1)] ?? prevEnd);
    const e = Math.max(s + 0.04, end[Math.min(s1 - 1, end.length - 1)] ?? s + 0.2);
    words.push({ w: tok.w, s: round3(s), e: round3(e) });
    prevEnd = e;
  }
  return words;
}

/** Rough timings for a line that has no audio yet, so the preview still works. */
export function estimateWords(display: string, speed = 1): { words: Word[]; duration: number } {
  const words: Word[] = [];
  let t = 0.05;
  for (const tok of tokenize(display)) {
    const core = tok.w.replace(/[^\p{L}\p{N}]/gu, "");
    const dur = (0.09 + 0.058 * Math.max(1, core.length)) / speed;
    words.push({ w: tok.w, s: round3(t), e: round3(t + dur) });
    t += dur;
    if (/[.!?]["')\]]?$/.test(tok.w)) t += 0.34 / speed;
    else if (/[,;:]$/.test(tok.w)) t += 0.16 / speed;
    else t += 0.03 / speed;
  }
  return { words, duration: round3(t + 0.1) };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Normalises a word for matching anchors and checking speech recognition output. */
export function normWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/[^\p{L}\p{N}₦%.,]/gu, "")
    .replace(/^[.,]+|[.,]+$/g, "");
}

/** Index of the first word where `anchor` starts within `words`, or -1. */
export function findAnchor(words: { w: string }[], anchor: string): number {
  const want = anchor.split(/\s+/).map(normWord).filter(Boolean);
  if (!want.length) return 0;
  const toks = words.map((w) => normWord(w.w));
  for (let i = 0; i + want.length <= toks.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) {
      if (toks[i + k] !== want[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  // looser: first anchor word alone
  const first = toks.indexOf(want[0]);
  return first;
}
