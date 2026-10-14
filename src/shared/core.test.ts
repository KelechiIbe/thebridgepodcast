import { describe, expect, it } from "vitest";
import { toSpoken, mapRange } from "./pronounce";
import { estimateWords, wordsFromAlignment, findAnchor, tokenize } from "./timing";
import { buildTimeline } from "./timeline";
import { personalIncomeTax, companyRouteTax, vatOnCommission, nairaShort } from "./tax";
import { defaultPronunciations, defaultShow, defaultCharacters } from "./defaults";
import { applyOps, scriptFromAi } from "./aiSchema";
import sample from "./sampleEpisode.json";
import type { Episode } from "./types";

const lib = defaultPronunciations();

describe("pronunciation", () => {
  it("expands naira amounts and library terms", () => {
    const { spoken } = toSpoken("Register with CAC. Your revenue is ₦300,000 on a ₦3m package, not ₦100 million.", lib);
    expect(spoken).toBe("Register with C. A. C.. Your revenue is 300,000 naira on a 3 million naira package, not 100 million naira.");
  });
  it("respects whole words and case", () => {
    expect(toSpoken("CACTUS and cac", lib).spoken).toBe("CACTUS and cac");
    expect(toSpoken("Tax ID", lib).spoken).toBe("Tax I.D.");
  });
  it("maps display ranges onto spoken ranges", () => {
    const d = "Pay ₦5m now";
    const { spoken, spans } = toSpoken(d, lib);
    const [a, b] = mapRange(spans, d.indexOf("now"), d.indexOf("now") + 3);
    expect(spoken.slice(a, b)).toBe("now");
  });
});

describe("timing", () => {
  it("places display words using a character alignment", () => {
    const display = "It costs ₦3m today.";
    const { spoken, spans } = toSpoken(display, lib);
    const chars = [...spoken];
    const al = {
      characters: chars,
      character_start_times_seconds: chars.map((_, i) => i * 0.05),
      character_end_times_seconds: chars.map((_, i) => i * 0.05 + 0.05),
    };
    const words = wordsFromAlignment(display, spoken, spans, al);
    expect(words.map((w) => w.w)).toEqual(["It", "costs", "₦3m", "today."]);
    const today = spoken.indexOf("today");
    expect(words[3].s).toBeCloseTo(today * 0.05, 3);
    expect(words[2].e).toBeLessThanOrEqual(words[3].s + 0.001);
  });
  it("finds anchors with currency and punctuation", () => {
    const toks = tokenize("Before any reliefs, that comes to about ₦12.9 million.");
    expect(findAnchor(toks, "₦12.9 million.")).toBe(7);
  });
  it("estimates timings for silent preview", () => {
    const { words, duration } = estimateWords("Hello there. How are you?");
    expect(words).toHaveLength(5);
    expect(duration).toBeGreaterThan(words[4].e);
  });
});

describe("timeline", () => {
  it("lays out the sample episode", () => {
    const ep = sample as unknown as Episode;
    const show = defaultShow();
    const timings = Object.fromEntries(ep.script!.lines.map((l) => [l.id, { ...estimateWords(l.text), estimated: true }]));
    const tl = buildTimeline({ script: ep.script!, show, timings, music: { sting: 6.96, bed: 17.45, ident: 1.8, outro: 16.09, blip: 0.22 } });
    expect(tl.lines).toHaveLength(35);
    expect(tl.chapters.map((c) => c.title)[0]).toBe("Cold open");
    expect(tl.cards.length).toBe(ep.script!.cards.length);
    for (let i = 1; i < tl.lines.length; i++) expect(tl.lines[i].s).toBeGreaterThan(tl.lines[i - 1].e);
    expect(tl.cues.some((c) => c.slot === "sting")).toBe(true);
    expect(tl.cues.filter((c) => c.slot === "blip")).toHaveLength(4);
    expect(tl.duration).toBeGreaterThan(tl.speechEnd + 4);
    const bars = tl.cards.filter((c) => c.card.type === "bars" && c.card.unit?.startsWith("Total"));
    expect(bars[1].carry).toContain(bars[0].card.bars![0].label);
  });
});

describe("tax", () => {
  it("matches the episode figures", () => {
    expect(personalIncomeTax(60e6)).toBe(12_930_000);
    expect(personalIncomeTax(5e6)).toBe(690_000);
    expect(companyRouteTax(60e6, 95e6).total).toBe(6_000_000);
    expect(Math.round(companyRouteTax(60e6, 120e6).total)).toBe(24_360_000);
    expect(vatOnCommission(3e6, 10)).toEqual({ full: 225000, fee: 22500, saving: 202500 });
    expect(nairaShort(12_930_000)).toBe("₦12.93m");
    expect(nairaShort(6_000_000)).toBe("₦6m");
  });
});

describe("ai output", () => {
  it("normalises a generated script and applies edits", () => {
    const chars = defaultCharacters();
    const s = scriptFromAi(
      {
        title: "T",
        summary: "S",
        personas: [{ key: "bola", name: "Bola", role: "Bakery owner, Ibadan", gender: "female" }, { key: "tunde", name: "Tunde", role: "Mechanic", gender: "male" }],
        chapters: [
          { title: "Open", cue: "ident", lines: [{ speaker: "bola", kind: "voicenote", text: "Do I pay VAT on bread?", cards: [], poll: null, flags: [] }] },
          {
            title: "Answer",
            cue: "ident",
            lines: [
              { speaker: "ch-kelechi", kind: "studio", text: "Bread is a basic food item, so it is zero-rated.", cards: [{ type: "stat", anchor: "zero-rated", big: "0%" }, { type: "nonsense" as any, anchor: "x" }], poll: { question: "Q?", options: ["a", "b"], answer: 5, why: "w" }, flags: [] },
              { speaker: "tunde", kind: "studio", text: "Thanks.", cards: [], poll: null, flags: [] },
            ],
          },
        ],
        anonymisation: [],
        widgets: ["pit"],
      },
      chars,
    );
    expect(s.lines.map((l) => l.kind)).toEqual(["voicenote", "studio", "voicenote"]);
    expect(s.personas[0].voiceCharacterId).toBe("ch-listener-f");
    expect(s.personas[1].voiceCharacterId).toBe("ch-listener-m");
    expect(s.cards).toHaveLength(1);
    expect(s.polls[0].answer).toBe(1);
    expect(s.chapters[0].cue).toBe("none");
    const r = applyOps(s, defaultShow(), [
      { op: "updateLine", lineId: s.lines[1].id, text: "Bread is zero-rated." },
      { op: "updateBrand", brand: { palette: { accent: "#123456", bg: "nope" } } },
      { op: "deleteCard", cardId: "missing" },
    ]);
    expect(r.script.lines[1].text).toBe("Bread is zero-rated.");
    expect(r.show.brand.palette.accent).toBe("#123456");
    expect(r.show.brand.palette.bg).toBe(defaultShow().brand.palette.bg);
    expect(r.skipped).toHaveLength(1);
  });
});

import { missingWords } from "./qa";
describe("qa", () => {
  it("finds words the voice didn't say clearly", () => {
    expect(missingWords("Register with C. A. C. today, it costs 22,500 naira", "Register with CAC today it costs 22500 naira")).toEqual([]);
    expect(missingWords("you can't download a TCC", "you can download a TCC")).toEqual(["cant"]);
  });
});
