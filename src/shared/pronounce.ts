import type { Pronunciation } from "./types";

/** Maps a range of the display text onto the text that is actually sent to the voice. */
export interface SpanMap {
  d0: number;
  d1: number;
  s0: number;
  s1: number;
  /** True when the display and spoken chunks are identical (character-for-character mapping). */
  same: boolean;
}

export interface SpokenText {
  spoken: string;
  spans: SpanMap[];
}

const SCALE: Record<string, string> = {
  m: "million",
  million: "million",
  bn: "billion",
  billion: "billion",
  k: "thousand",
  thousand: "thousand",
};

const CURRENCY = /₦\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(million|billion|thousand|bn|m|k)(?![\p{L}\p{N}]))?/gu;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Hit {
  start: number;
  end: number;
  say: string;
}

/**
 * Turns display text (what captions show) into spoken text (what the voice reads):
 * naira amounts become words ("₦3m" -> "3 million naira") and pronunciation-library
 * terms are swapped for their "say as" form. Returns the span map so word timings
 * from the voice can be placed back onto the display words.
 */
export function toSpoken(display: string, library: Pronunciation[]): SpokenText {
  const hits: Hit[] = [];
  for (const m of display.matchAll(CURRENCY)) {
    const scale = m[2] ? SCALE[m[2].toLowerCase()] : "";
    hits.push({ start: m.index!, end: m.index! + m[0].length, say: `${m[1]}${scale ? " " + scale : ""} naira` });
  }
  const terms = [...library].filter((p) => p.term.trim() && p.sayAs.trim()).sort((a, b) => b.term.length - a.term.length);
  for (const p of terms) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p.term.trim())}(?![\\p{L}\\p{N}])`, p.caseSensitive ? "gu" : "giu");
    for (const m of display.matchAll(re)) hits.push({ start: m.index!, end: m.index! + m[0].length, say: p.sayAs.trim() });
  }
  // keep leftmost, then longest, non-overlapping hits
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const chosen: Hit[] = [];
  let lastEnd = -1;
  for (const h of hits) {
    if (h.start >= lastEnd) {
      chosen.push(h);
      lastEnd = h.end;
    }
  }
  let spoken = "";
  const spans: SpanMap[] = [];
  let d = 0;
  for (const h of chosen) {
    if (h.start > d) {
      const chunk = display.slice(d, h.start);
      spans.push({ d0: d, d1: h.start, s0: spoken.length, s1: spoken.length + chunk.length, same: true });
      spoken += chunk;
    }
    spans.push({ d0: h.start, d1: h.end, s0: spoken.length, s1: spoken.length + h.say.length, same: false });
    spoken += h.say;
    d = h.end;
  }
  if (d < display.length) {
    const chunk = display.slice(d);
    spans.push({ d0: d, d1: display.length, s0: spoken.length, s1: spoken.length + chunk.length, same: true });
    spoken += chunk;
  }
  return { spoken, spans };
}

/** Maps a display character range to the spoken character range. */
export function mapRange(spans: SpanMap[], d0: number, d1: number): [number, number] {
  const point = (d: number, isEnd: boolean): number => {
    for (const sp of spans) {
      const inside = isEnd ? d > sp.d0 && d <= sp.d1 : d >= sp.d0 && d < sp.d1;
      if (!inside) continue;
      if (sp.same) return sp.s0 + (d - sp.d0);
      const frac = (d - sp.d0) / Math.max(1, sp.d1 - sp.d0);
      return Math.round(sp.s0 + frac * (sp.s1 - sp.s0));
    }
    const last = spans[spans.length - 1];
    return last ? last.s1 : 0;
  };
  const a = point(d0, false);
  const b = Math.max(a + 1, point(d1, true));
  return [a, b];
}

/** Small, stable hash (FNV-1a) used to tell when a line's audio is out of date. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
