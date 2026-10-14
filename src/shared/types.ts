// Domain model shared by the studio, the exported player and the Netlify functions.

export type Role = "admin" | "producer" | "reviewer";

export type AssetKind = "image" | "logo" | "audio" | "video" | "font" | "document";

/** A file in storage. `path` is a storage key (Supabase bucket path or local blob id). */
export interface AssetRef {
  id: string;
  path: string;
  name: string;
  mime: string;
  kind: AssetKind;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
}

export interface Palette {
  /** Stage background, top. */
  bg: string;
  /** Stage background, horizon / second tone. */
  bg2: string;
  /** Main text on the stage. */
  ink: string;
  /** Secondary text on the stage. */
  dim: string;
  /** Brand accent (wordmark, highlights, big numbers). */
  accent: string;
  /** Second accent (expert seat, results). */
  accent2: string;
  good: string;
  bad: string;
  mid: string;
}

export interface FontChoice {
  family: string;
  source: "google" | "upload" | "system";
  /** For uploaded fonts: storage path of the font file. */
  assetPath?: string | null;
  /** For uploaded fonts: the weight (or range, for variable fonts) the file holds, when known. */
  weight?: number;
  weightMax?: number;
}

export type SceneKind = "bridge" | "gradient" | "grid" | "image" | "plain";

export interface Brand {
  palette: Palette;
  fonts: { display: FontChoice; body: FontChoice; mono: FontChoice };
  logo: AssetRef | null;
  wordmark: string;
  byline: string;
  badge: string;
  scene: SceneKind;
  backgroundImage: AssetRef | null;
  /** 0..1, darkens an uploaded background image so text stays readable. */
  backgroundDim: number;
}

export type CaptionStyle = "karaoke" | "plain" | "boxed";

export interface StageLayout {
  showSpeakers: boolean;
  showCaptions: boolean;
  captionStyle: CaptionStyle;
  showChapterLabel: boolean;
  showBadge: boolean;
  showLogo: boolean;
  showProgress: boolean;
  speakerStyle: "portrait" | "initials";
  /** Seconds the end card stays on screen after the last line. */
  endCardSeconds: number;
}

export interface MusicSettings {
  sting: AssetRef | null;
  bed: AssetRef | null;
  ident: AssetRef | null;
  outro: AssetRef | null;
  blip: AssetRef | null;
  /** Use the built-in cues for any slot left empty. */
  useDefaults: boolean;
  /** Linear gains. */
  stingLevel: number;
  bedLevel: number;
  identLevel: number;
  outroLevel: number;
  /** Gain applied to music while someone is speaking. */
  duckLevel: number;
}

export type Orientation = "landscape" | "portrait" | "square";

export interface EndCard {
  headline: string;
  sub: string;
  url: string;
  showQr: boolean;
}

export type AiProvider = "claude" | "gemini";

export interface Show {
  id: string;
  name: string;
  tagline: string;
  description: string;
  brand: Brand;
  layout: StageLayout;
  music: MusicSettings;
  intro: Partial<Record<Orientation, AssetRef | null>>;
  outro: Partial<Record<Orientation, AssetRef | null>>;
  includeBookendAudioInMp3: boolean;
  endCard: EndCard;
  /** Spoken and printed AI disclosure. */
  disclosure: string;
  aiProvider: AiProvider;
  aiModels: { claude: string; gemini: string };
  ttsModel: string;
  requireApproval: boolean;
  /** House style and standing instructions for the script writer. */
  scriptGuide: string;
  updatedAt?: string;
}

export interface VoiceSettings {
  stability: number;
  similarity: number;
  style: number;
  speed: number;
  speakerBoost: boolean;
}

export interface VoiceRef {
  provider: "elevenlabs" | "none";
  voiceId: string;
  voiceName: string;
  isClone: boolean;
  settings: VoiceSettings;
  previewUrl?: string | null;
}

export type CharacterKind = "host" | "expert" | "listener";

export interface Character {
  id: string;
  showId: string;
  name: string;
  role: string;
  kind: CharacterKind;
  color: string;
  image: AssetRef | null;
  voice: VoiceRef;
  /** Background the script writer can use (expertise, tone). */
  bio: string;
  consent: { confirmed: boolean; by: string; at: string; note: string } | null;
  sortOrder: number;
}

export interface Pronunciation {
  id: string;
  term: string;
  sayAs: string;
  caseSensitive: boolean;
  note: string;
}

export interface Fact {
  id: string;
  key: string;
  label: string;
  value: string;
  source: string;
  effectiveFrom: string;
  notes: string;
}

export type LineKind = "studio" | "voicenote" | "letter";

/** A listener who appears in one episode (always fictional). */
export interface Persona {
  id: string;
  name: string;
  role: string;
  /** The listener-voice character that speaks for this persona. */
  voiceCharacterId: string;
  color: string;
}

export interface Word {
  w: string;
  s: number;
  e: number;
}

export interface LineAudio {
  path: string;
  /** Hash of text + voice + settings + pronunciations used, to know when audio is stale. */
  hash: string;
  duration: number;
  words: Word[];
  voiceId: string;
  createdAt: string;
  qa?: { checkedAt: string; heard: string; mismatches: string[] } | null;
}

export interface Line {
  id: string;
  /** Character id (host/expert) or persona id (listener). */
  speaker: string;
  kind: LineKind;
  text: string;
  audio: LineAudio | null;
  /** Extra silence after this line, seconds. */
  pauseAfter?: number | null;
}

export type ChapterCue = "none" | "sting" | "ident" | "outro";

export interface Chapter {
  id: string;
  title: string;
  startLineId: string;
  cue: ChapterCue;
}

export type CardType =
  | "stat"
  | "note"
  | "shift"
  | "split"
  | "bars"
  | "formula"
  | "steps"
  | "dodont"
  | "quote"
  | "cta"
  | "image"
  | "list";

export type Tone = "good" | "bad" | "mid" | "accent";

export interface Bar {
  label: string;
  value: number;
  tone: Tone;
}

/** A visual shown while a line plays, from the moment `anchor` is spoken. */
export interface Card {
  id: string;
  lineId: string;
  anchor: string;
  type: CardType;
  big?: string;
  label?: string;
  sub?: string;
  tone?: Tone;
  from?: string;
  to?: string;
  total?: number;
  part?: number;
  partLabel?: string;
  restLabel?: string;
  unit?: string;
  bars?: Bar[];
  max?: number;
  parts?: string[];
  steps?: string[];
  doText?: string;
  dontText?: string;
  quote?: string;
  attribution?: string;
  image?: AssetRef | null;
  /** Keep the card up until this line ends (defaults to its own line). */
  holdUntilLineId?: string | null;
}

export interface Poll {
  id: string;
  afterLineId: string;
  question: string;
  options: string[];
  answer: number;
  why: string;
}

export interface AnonItem {
  original: string;
  replacement: string;
  kind: "person" | "business" | "place" | "figure" | "other";
  note: string;
}

export interface FactFlag {
  id: string;
  lineId: string;
  claim: string;
  issue: string;
  suggestion: string;
  severity: "info" | "warn" | "error";
  resolved: boolean;
}

export type WidgetType = "vat-commission" | "company-vs-bn" | "pit";

export interface Widget {
  id: string;
  type: WidgetType;
}

export interface ClipSuggestion {
  title: string;
  startLineId: string;
  endLineId: string;
  why: string;
}

export interface SocialPack {
  showNotes: string;
  linkedin: string;
  whatsapp: string;
  x: string;
  clips: ClipSuggestion[];
}

export interface Script {
  title: string;
  summary: string;
  personas: Persona[];
  lines: Line[];
  chapters: Chapter[];
  cards: Card[];
  polls: Poll[];
  widgets: Widget[];
  anonymisation: AnonItem[];
  flags: FactFlag[];
  social: SocialPack | null;
}

export type EpisodeStatus = "draft" | "review" | "approved" | "published";

export interface JobState {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error";
  message: string;
  progress: number;
  updatedAt: string;
  result?: unknown;
}

export interface Episode {
  id: string;
  showId: string;
  number: number;
  title: string;
  status: EpisodeStatus;
  sessionDate: string | null;
  notes: { fileName: string; text: string; uploadedAt: string } | null;
  script: Script | null;
  approval: { by: string; byName: string; at: string; hash: string } | null;
  job: JobState | null;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  episodeId: string;
  lineId: string | null;
  authorId: string;
  authorName: string;
  body: string;
  resolved: boolean;
  createdAt: string;
}

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  /** signed in, but nobody has added this account to the studio */
  outsider?: boolean;
}

export interface UsageInfo {
  tier: string;
  used: number;
  limit: number;
  resetsAt: string | null;
}
