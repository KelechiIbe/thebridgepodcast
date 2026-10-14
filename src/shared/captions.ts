import type { Timeline } from "./timeline";

const stamp = (t: number, sep: "," | ".") => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(r).padStart(3, "0")}`;
};

interface Cue {
  s: number;
  e: number;
  text: string;
}

function cues(tl: Timeline, names: Record<string, string>, withNames: boolean): Cue[] {
  const out: Cue[] = [];
  for (const l of tl.lines) {
    l.pages.forEach((p, i) => {
      const text = p.idx.map((k) => l.words[k].w).join(" ");
      const prefix = withNames && i === 0 && names[l.speaker] ? `${names[l.speaker]}: ` : "";
      out.push({ s: p.s, e: Math.max(p.e, p.s + 0.6), text: prefix + text });
    });
  }
  return out;
}

export function toSrt(tl: Timeline, names: Record<string, string>, withNames = false): string {
  return cues(tl, names, withNames)
    .map((c, i) => `${i + 1}\n${stamp(c.s, ",")} --> ${stamp(c.e, ",")}\n${c.text}\n`)
    .join("\n");
}

export function toVtt(tl: Timeline, names: Record<string, string>, withNames = false): string {
  return "WEBVTT\n\n" + cues(tl, names, withNames).map((c) => `${stamp(c.s, ".")} --> ${stamp(c.e, ".")}\n${c.text}\n`).join("\n");
}

export function toTranscript(tl: Timeline, names: Record<string, string>, chapterTitles = true): string {
  const parts: string[] = [];
  let ci = 0;
  for (const l of tl.lines) {
    while (chapterTitles && ci < tl.chapters.length && tl.chapters[ci].t <= l.s + 0.01) {
      parts.push(`\n## ${tl.chapters[ci].title} (${clock(tl.chapters[ci].t)})\n`);
      ci++;
    }
    parts.push(`${names[l.speaker] ?? "Speaker"}: ${l.words.map((w) => w.w).join(" ")}`);
  }
  return parts.join("\n").trim() + "\n";
}

export const clock = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
