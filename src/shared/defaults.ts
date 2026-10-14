import type { Character, Fact, Pronunciation, Show, StageLayout, VoiceSettings } from "./types";

export const DEFAULT_SHOW_ID = "show-the-bridge";

export const DEFAULT_LAYOUT: StageLayout = {
  showSpeakers: true,
  showCaptions: true,
  captionStyle: "karaoke",
  showChapterLabel: true,
  showBadge: true,
  showLogo: true,
  showProgress: false,
  speakerStyle: "portrait",
  endCardSeconds: 5,
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.5,
  similarity: 0.8,
  style: 0.15,
  speed: 1,
  speakerBoost: true,
};

export function defaultShow(): Show {
  return {
    id: DEFAULT_SHOW_ID,
    name: "The Bridge",
    tagline: "TaxStreem's weekly open office, replayed",
    description:
      "Every Friday business owners bring tax questions to TaxStreem's virtual open office. The Bridge replays the best ones.",
    brand: {
      palette: {
        bg: "#0B191C",
        bg2: "#15303A",
        ink: "#F4F0E6",
        dim: "#8EA29F",
        accent: "#F5C518",
        accent2: "#4CCB92",
        good: "#4CCB92",
        bad: "#FF7B5C",
        mid: "#E7DAB8",
      },
      fonts: {
        display: { family: "Big Shoulders Display", source: "google" },
        body: { family: "Figtree", source: "google" },
        mono: { family: "IBM Plex Mono", source: "google" },
      },
      logo: null,
      wordmark: "The Bridge",
      byline: "by TaxStreem",
      badge: "AI voices",
      scene: "bridge",
      backgroundImage: null,
      backgroundDim: 0.55,
    },
    layout: { ...DEFAULT_LAYOUT },
    music: {
      sting: null,
      bed: null,
      ident: null,
      outro: null,
      blip: null,
      useDefaults: true,
      stingLevel: 0.55,
      bedLevel: 0.2,
      identLevel: 0.42,
      outroLevel: 0.55,
      duckLevel: 0.12,
    },
    intro: {},
    outro: {},
    includeBookendAudioInMp3: false,
    endCard: {
      headline: "Fridays · 4 p.m. WAT",
      sub: "Free virtual open office. Bring your own tax questions.",
      url: "https://www.taxstreem.com",
      showQr: true,
    },
    disclosure:
      "The voices you're hearing are AI-generated. The answers come from our tax experts at last Friday's session. We've changed names and details to protect the people who asked.",
    aiProvider: "claude",
    aiModels: { claude: "claude-sonnet-5-5", gemini: "gemini-3.8-flash" },
    ttsModel: "eleven_multilingual_v2",
    requireApproval: true,
    scriptGuide: [
      "Audience: Nigerian business owners, founders, consultants and finance teams. Plain, warm, confident English with light Nigerian flavour in listener voice notes (an occasional 'abeg' is fine; no heavy pidgin).",
      "Keep each episode 6 to 10 minutes. Pick the 3 to 5 most useful questions; skip housekeeping and product demos.",
      "Never state a tax figure that is not in the notes or the facts library. If the expert said something that conflicts with the facts library, keep the expert's point but flag it.",
      "No real names of attendees or their businesses. Change industries, cities and figures when the answer survives the change.",
      "Cut asides about real public figures, and never advise anyone to wait for the tax office to find them or to pay bribes.",
    ].join("\n"),
  };
}

const none = (name = ""): Character["voice"] => ({
  provider: "none",
  voiceId: "",
  voiceName: name,
  isClone: false,
  settings: { ...DEFAULT_VOICE_SETTINGS },
  previewUrl: null,
});

export function defaultCharacters(showId = DEFAULT_SHOW_ID): Character[] {
  return [
    {
      id: "ch-ada",
      showId,
      name: "Ada",
      role: "Host",
      kind: "host",
      color: "#F5C518",
      image: null,
      voice: none(),
      bio: "Warm, curious host. Introduces each question, keeps things moving, never gives tax advice herself.",
      consent: null,
      sortOrder: 0,
    },
    {
      id: "ch-kelechi",
      showId,
      name: "Kelechi Ibe",
      role: "Co-founder, TaxStreem",
      kind: "expert",
      color: "#4CCB92",
      image: null,
      voice: none(),
      bio: "Tax lawyer and licensed tax practitioner (CITN). Ex-KPMG and UUBO. Direct, practical, explains with worked naira examples.",
      consent: null,
      sortOrder: 1,
    },
    {
      id: "ch-listener-f",
      showId,
      name: "Listener voice (female)",
      role: "Voice for female listeners",
      kind: "listener",
      color: "#F5C518",
      image: null,
      voice: none(),
      bio: "",
      consent: null,
      sortOrder: 2,
    },
    {
      id: "ch-listener-m",
      showId,
      name: "Listener voice (male)",
      role: "Voice for male listeners",
      kind: "listener",
      color: "#7FD8B0",
      image: null,
      voice: none(),
      bio: "",
      consent: null,
      sortOrder: 3,
    },
  ];
}

let pid = 0;
const p = (term: string, sayAs: string, note: string, caseSensitive = true): Pronunciation => ({
  id: `pr-${++pid}`,
  term,
  sayAs,
  caseSensitive,
  note,
});

export function defaultPronunciations(): Pronunciation[] {
  pid = 0;
  return [
    p("CAC", "C. A. C.", "Corporate Affairs Commission, spelled out"),
    p("TCC", "T. C. C.", "Tax clearance certificate"),
    p("NRS", "N. R. S.", "Nigeria Revenue Service"),
    p("FIRS", "F. I. R. S.", "Former name of the NRS"),
    p("NTA", "N. T. A.", "Nigeria Tax Act"),
    p("NTAA", "N. T. A. A.", "Nigeria Tax Administration Act"),
    p("IFRS", "I. F. R. S.", "Accounting standards"),
    p("CITN", "C. I. T. N.", "Chartered Institute of Taxation of Nigeria"),
    p("WHT", "withholding tax", "Say the full words"),
    p("CIT", "company income tax", "Say the full words"),
    p("PIT", "personal income tax", "Say the full words"),
    p("ID", "I.D.", "As in Tax ID"),
    p("Rev360", "Rev three sixty", "NRS filing portal"),
    p("TaxStreem", "Tax Stream", "Brand name"),
    p("Ibe", "Eebeh", "Surname, Igbo pronunciation"),
    p("Funke", "Foonkay", "Yoruba first name"),
    p("Lekki", "Leckee", "Lagos neighbourhood"),
  ];
}

let fid = 0;
const f = (key: string, label: string, value: string, source: string, notes = ""): Fact => ({
  id: `fact-${++fid}`,
  key,
  label,
  value,
  source,
  effectiveFrom: "2026-01-01",
  notes,
});

/** Starting facts, Nigeria Tax Act 2025 and Nigeria Tax Administration Act 2025. Review before relying on them. */
export function defaultFacts(): Fact[] {
  fid = 0;
  return [
    f("vat_rate", "VAT rate", "7.5%", "Nigeria Tax Act 2025"),
    f("small_turnover", "Small company / small business turnover limit", "₦100,000,000 or less a year", "Nigeria Tax Act 2025", "Was ₦25m for VAT from 2020 to 2025."),
    f("small_assets", "Small company fixed assets limit", "₦250,000,000 or less", "Nigeria Tax Act 2025"),
    f("small_excludes", "Small company exclusion", "Businesses providing professional services never qualify", "Nigeria Tax Act 2025"),
    f("small_vat", "Small business VAT position", "Not required to register for, charge, file or remit VAT", "Nigeria Tax Act 2025"),
    f("cit_small", "CIT rate, small company", "0%", "Nigeria Tax Act 2025"),
    f("cit_rate", "CIT rate, other companies", "30%", "Nigeria Tax Act 2025"),
    f("dev_levy", "Development levy", "4% of assessable profits (not small companies)", "Nigeria Tax Act 2025"),
    f("wht_dividend", "Withholding tax on dividends", "10%", "Deduction of tax at source regulations"),
    f(
      "pit_bands",
      "Personal income tax bands (annual)",
      "First ₦800,000 at 0%; next ₦2.2m at 15%; next ₦9m at 18%; next ₦13m at 21%; next ₦25m at 23%; above ₦50m at 25%",
      "Nigeria Tax Act 2025",
    ),
    f("penalty_unregistered", "Awarding a contract to an unregistered person", "₦5,000,000 administrative penalty", "Nigeria Tax Administration Act 2025, s.100(2)"),
    f("einvoice", "E-invoicing rollout", "Large taxpayers live; ₦1bn to ₦5bn turnover from July 2026; below ₦1bn from July 2027, enforced January 2028", "NRS phased rollout"),
    f("rev360", "Filing portal", "Rev360 replaced TaxPro Max in 2026; TCC downloads only when all returns are filed", "NRS"),
  ];
}
