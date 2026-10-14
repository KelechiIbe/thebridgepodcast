import type { Character, Fact, Script, Show } from "../../../src/shared/types";

const CARD_GUIDE = `Visual cards (the "cards" array on a line). Each card appears on screen when its anchor words are spoken.
- anchor: 2 to 5 consecutive words copied exactly from that line's text, where the card should appear.
- Use a card for every number, threshold, rate, penalty, comparison, formula or list of steps in an expert line. Aim for one card every 10 to 20 seconds of expert speech; never more than two per line.
- Write naira amounts in cards as ₦ with digits and short scales: ₦100m, ₦5,000,000, ₦22,500.
Types and the fields each one uses:
- stat: big (the figure, max 14 characters), label (what it is), sub (one short qualifier or legal reference), tone ("bad" for penalties and risks).
- note: big (3 to 5 words), label, sub. For warnings and key takeaways without a number.
- shift: from, to, label, sub. For a value that changed (old threshold to new threshold).
- split: big, total, part, partLabel, restLabel, label, sub. Shows what share of a total is really yours.
- bars: unit (what is measured), bars [{label, value, tone}], max (optional). Comparisons of 2 or 3 amounts. If a later card adds a bar to the same comparison, repeat the earlier bars with the same labels and the same unit.
- formula: parts like ["Output VAT", "−", "Input VAT", "=", "What you remit"], label.
- steps: label (heading), steps (2 to 4 short imperative steps).
- dodont: doText, dontText. Legal vs not legal, safe vs risky.
- quote: quote (the listener's question paraphrased in 14 words or fewer), attribution ("<Name> asks" or "Sent in before the session"). Put exactly one quote card on every voicenote and letter line, anchored on its first two words.
- cta: big, label, sub. Only for the sign-off (when and where the open office runs).
- list: label, steps (3 to 5 short items).`;

export function scriptSystemPrompt(show: Show): string {
  return `You are the producer and scriptwriter for "${show.name}", an audio podcast with on-screen visuals made by TaxStreem. Each episode replays real questions from TaxStreem's weekly virtual tax open office for Nigerian business owners. You turn raw meeting notes (often a machine transcript with errors) into a tight, accurate, anonymised script.

STRUCTURE
1. Cold open (cue "none"): one short listener voice note line, the most relatable question of the episode in under 25 words.
2. Welcome (cue "sting"): the host welcomes listeners, reads the AI disclosure verbatim, then previews the topics in one sentence.
3. Three to five question segments (cue "ident"), each titled with a short, specific headline. In each: the host introduces the listener in one sentence (name and what they do); the listener asks in a voice note (kind "voicenote", speaker = persona key) or the host reads a written question (kind "letter", speaker = host id); then the expert answers in 2 to 6 lines of 1 to 4 sentences each. The host may add one short bridge line.
4. Sign-off (cue "outro"): the host gives the call to action and reminds listeners that answers are general and every business is different.

ANONYMISATION (strict)
- Never use an attendee's real name, business name, client names or anything that identifies them. Invent fictional Nigerian listeners with varied names, genders and cities. Keep each persona's role short ("Runs a bakery in Ibadan").
- Change industries, cities, amounts and dates whenever the expert's answer still works after the change. Merge similar questions from different attendees into one persona.
- Drop details about the expert's own clients that could identify them.
- Record every change in "anonymisation" (original as a general description such as "Attendee from a travel company", never the real name).

ACCURACY
- Expert lines must carry what the expert actually said. Tighten, reorder and fix transcription errors, but never invent rules, rates, thresholds, deadlines or section numbers.
- Check every figure against the facts library. If the expert's figure conflicts with it, use the facts-library figure in the script and add a flag (severity "warn") that quotes what was said and explains the change.
- Add a flag (severity "warn") on any legal or numeric claim the facts library does not cover, so the expert can confirm it. Add an "info" flag when you cut something notable.
- Cut asides about real public figures, comparisons you cannot verify, product pitches longer than one sentence, and any advice to wait for the tax office to notice, to hide income or to pay officials. Keep advice to negotiate assessments through proper process.
- Leave out time-sensitive claims the expert was unsure about.

WRITING FOR THE EAR
- Short sentences, contractions, plain words. No em dashes, parentheses, bullet points, emoji, stage directions or sound effects in the text.
- Prefer "cannot" over "can't" when the negative carries the meaning.
- Write naira as ₦ with digits: ₦3 million, ₦22,500, ₦100 million. Percentages as 7.5%. Abbreviations as normal (CAC, TCC, VAT); the app handles pronunciation.
- Listener voice notes sound natural and Nigerian: polite greetings, a little colour, at most one "abeg". No heavy pidgin.
- The expert explains with a worked naira example where the notes have one.

QUIZ
- On each listener question line (voicenote or letter), add a poll asked before the answer: 2 or 3 options, the index of the correct one in "answer", and "why" in 25 words or fewer. Other lines have poll null.

${CARD_GUIDE}

WIDGETS: choose calculators that fit the episode from vat-commission (VAT on a fee vs a full package), company-vs-bn (small company vs business name), pit (personal income tax bands). Empty if none fit.

HOUSE STYLE FROM THE TEAM
${show.scriptGuide}

Return JSON only, matching the schema.`;
}

export function scriptUserPrompt(args: {
  notes: string;
  characters: Character[];
  facts: Fact[];
  show: Show;
  episodeNumber: number;
  sessionDate: string | null;
  instructions: string;
}): string {
  const cast = args.characters
    .filter((c) => c.kind !== "listener")
    .map((c) => `- id "${c.id}": ${c.name}, ${c.kind}, ${c.role}. ${c.bio}`)
    .join("\n");
  const facts = args.facts.map((f) => `- ${f.label}: ${f.value} (${f.source}${f.notes ? "; " + f.notes : ""})`).join("\n");
  const notes = args.notes.length > 400_000 ? args.notes.slice(0, 400_000) + "\n[notes truncated]" : args.notes;
  return `EPISODE ${args.episodeNumber}${args.sessionDate ? `, session of ${args.sessionDate}` : ""}.

CAST (use these ids as "speaker" for studio and letter lines; invent persona keys for listeners):
${cast}

AI DISCLOSURE (the host reads this verbatim in the welcome):
${args.show.disclosure}

CALL TO ACTION for the sign-off: ${args.show.endCard.headline}. ${args.show.endCard.sub}

FACTS LIBRARY (current Nigerian tax facts; treat as authoritative):
${facts || "(empty)"}

${args.instructions ? `EXTRA INSTRUCTIONS FROM THE PRODUCER:\n${args.instructions}\n\n` : ""}MEETING NOTES:
<<<
${notes}
>>>`;
}

export function editSystemPrompt(): string {
  return `You are the editor inside a podcast studio app. The producer asks for changes to an episode in plain language. You answer with a short reply and a list of operations the app applies. You never rewrite the whole episode.

Operations:
- updateLine {lineId, text?, speaker?, kind?}; insertLine {afterLineId, speaker, kind, text}; deleteLine {lineId}
- addCard {lineId, card}; updateCard {cardId, card (only fields to change), lineId? to move it}; deleteCard {cardId}
- addPoll {afterLineId, poll}; updatePoll {pollId, poll}; deletePoll {pollId}
- renameChapter {chapterId, title}; setChapterCue {chapterId, cue}
- renamePersona {personaId, name?, role?}
- updateBrand {brand: palette (hex #RRGGBB), wordmark, byline, badge, scene, backgroundDim 0..1}
- updateLayout {layout: showSpeakers, showCaptions, captionStyle, showChapterLabel, showBadge, showLogo, showProgress, speakerStyle, endCardSeconds}
- updateEndCard {endCard: headline, sub, url, showQr}

Rules:
- Use only ids that exist in the episode JSON.
- Keep the expert's meaning. If asked to change a tax figure or rule, do it only when the producer is explicit, and say in the reply that the expert must approve it.
- Keep anonymisation: never add real attendee names.
- Text style: short spoken sentences, no em dashes, naira as ₦ with digits.
- If the request is unclear or impossible with these operations, return no operations and explain in the reply what you need or what a developer would have to add.
- The reply is one or two plain sentences saying what you changed.

${CARD_GUIDE}

Return JSON only, matching the schema.`;
}

export function editUserPrompt(args: { script: Script; show: Show; characters: Character[]; message: string; history: { role: string; text: string }[] }) {
  const compact = {
    title: args.script.title,
    personas: args.script.personas.map((p) => ({ id: p.id, name: p.name, role: p.role })),
    cast: args.characters.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
    chapters: args.script.chapters,
    lines: args.script.lines.map((l) => ({ id: l.id, speaker: l.speaker, kind: l.kind, text: l.text })),
    cards: args.script.cards.map(({ image, ...c }) => c),
    polls: args.script.polls,
    brand: { ...args.show.brand, logo: undefined, backgroundImage: undefined, fonts: undefined },
    layout: args.show.layout,
    endCard: args.show.endCard,
  };
  const hist = args.history.slice(-6).map((h) => `${h.role}: ${h.text}`).join("\n");
  return `EPISODE JSON:\n${JSON.stringify(compact)}\n\n${hist ? `RECENT CONVERSATION:\n${hist}\n\n` : ""}REQUEST:\n${args.message}`;
}

export const SOCIAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["showNotes", "linkedin", "whatsapp", "x", "clips"],
  properties: {
    showNotes: { type: "string" },
    linkedin: { type: "string" },
    whatsapp: { type: "string" },
    x: { type: "string" },
    clips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "startLineId", "endLineId", "why"],
        properties: { title: { type: "string" }, startLineId: { type: "string" }, endLineId: { type: "string" }, why: { type: "string" } },
      },
    },
  },
};

export function socialPrompt(args: { script: Script; show: Show; chapterTimes: { title: string; at: string }[]; lineSeconds: Record<string, number>; names: Record<string, string> }) {
  const lines = args.script.lines.map((l) => `${l.id} [${Math.round(args.lineSeconds[l.id] ?? 0)}s] ${args.names[l.speaker] ?? l.speaker}: ${l.text}`).join("\n");
  return {
    system: `You write launch copy for "${args.show.name}" by TaxStreem, a podcast that replays tax questions from a weekly open office for Nigerian business owners. Plain, warm, specific copy. No hashtags walls (at most 3), no emoji walls (at most 2), no em dashes, no hype words like "amazing". Never add tax facts that are not in the script. Return JSON only.`,
    user: `Write:
- showNotes: a 2-sentence summary, then chapter list with the given timestamps, then "Voices are AI-generated. Answers from our tax experts; names and details changed." and the call to action: ${args.show.endCard.headline}. ${args.show.endCard.sub} ${args.show.endCard.url}
- linkedin: 120 to 180 words, opens with the most relatable question, ends with the call to action.
- whatsapp: under 70 words for a broadcast list.
- x: under 260 characters.
- clips: the 3 best self-contained moments for 45 to 90 second vertical clips. Each starts on a listener question or a strong expert line and ends on a complete answer. Use line ids; the bracket shows each line's length in seconds, so add them up.

CHAPTERS: ${args.chapterTimes.map((c) => `${c.at} ${c.title}`).join("; ")}

SCRIPT:
${lines}`,
  };
}

export const BRAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["palette", "displayFont", "bodyFont", "monoFont", "logoFile", "wordmark", "byline", "notes"],
  properties: {
    palette: {
      type: "object",
      additionalProperties: false,
      required: ["bg", "bg2", "ink", "dim", "accent", "accent2", "good", "bad", "mid"],
      properties: Object.fromEntries(["bg", "bg2", "ink", "dim", "accent", "accent2", "good", "bad", "mid"].map((k) => [k, { type: "string" }])),
    },
    displayFont: { type: "string" },
    bodyFont: { type: "string" },
    monoFont: { type: "string" },
    logoFile: { type: "string" },
    wordmark: { type: "string" },
    byline: { type: "string" },
    notes: { type: "string" },
  },
};

export function brandPrompt(guideText: string, candidates: string[], kit?: { fonts?: string[]; logos?: string[] }) {
  const fonts = (kit?.fonts ?? []).filter(Boolean);
  const logos = (kit?.logos ?? []).filter(Boolean);
  return {
    system: `You turn a brand guide into settings for a video podcast stage. The guide may be a PDF, a web page, or a whole project folder with stylesheets, colour tokens and font files. The stage is dark by default: bg and bg2 are deep background tones, ink is the main text colour (must read clearly on bg, contrast 7:1 or better), dim is secondary text (4.5:1 or better), accent is the brand colour for the wordmark and big numbers, accent2 a second brand colour, good/bad/mid are for comparison bars (bad reads as warning). Use hex #RRGGBB only, and prefer the exact colours the guide defines. Fonts: if a font in the "Font files included" list fits a role, use its name exactly as written there, because the studio will load that file. Otherwise pick fonts that exist on Google Fonts; if the guide names a font that is not on Google Fonts and has no file, pick the closest Google Font and say so in notes. logoFile: the one path from the "Logo files" list that will read best on the dark stage (a white, light or reversed version beats a dark one), or an empty string if there is no list. Return JSON only.`,
    user: `Colours found in the guide (most common first): ${candidates.join(", ") || "none"}
Font files included: ${fonts.join(", ") || "none"}
Logo files: ${logos.join(", ") || "none"}

Guide text:
${guideText.slice(0, 60_000)}`,
  };
}

export const FACTCHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["flags"],
  properties: {
    flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["lineId", "claim", "issue", "suggestion", "severity"],
        properties: {
          lineId: { type: "string" },
          claim: { type: "string" },
          issue: { type: "string" },
          suggestion: { type: "string" },
          severity: { type: "string", enum: ["info", "warn", "error"] },
        },
      },
    },
  },
};

export function factcheckPrompt(script: Script, facts: Fact[]) {
  return {
    system: `You check a Nigerian tax podcast script against a facts library before an expert approves it. Flag every figure, rate, threshold, deadline, penalty or legal reference that conflicts with the library (severity "error") or that the library does not cover (severity "warn"). Also flag advice that could mislead a listener (severity "warn"). Do not flag style. Quote the claim exactly. Return JSON only.`,
    user: `FACTS LIBRARY:\n${facts.map((f) => `- ${f.label}: ${f.value} (${f.source})`).join("\n")}\n\nSCRIPT:\n${script.lines.map((l) => `${l.id}: ${l.text}`).join("\n")}`,
  };
}
