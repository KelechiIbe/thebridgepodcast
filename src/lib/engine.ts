// Glue between stored data and the renderer/mixer: timings, images, music and the final mix.

import type { AssetRef, Character, Line, Orientation, Persona, Pronunciation, Script, Show } from "../shared/types";
import { buildTimeline, syntheticEnvelope, type LineTiming, type MusicDurations, type Timeline, type MusicSlot } from "../shared/timeline";
import { estimateWords } from "../shared/timing";
import { hashString, toSpoken } from "../shared/pronounce";
import { decodeAudio, mixEpisode, ENV_FPS, type MixResult } from "./audio/mixer";
import type { StageImages, StageModel } from "./render/stage";
import { store } from "./store";
import QRCode from "qrcode";

export const DEFAULT_MUSIC: Record<MusicSlot, string> = {
  sting: "/defaults/sting.mp3",
  bed: "/defaults/bed.mp3",
  ident: "/defaults/ident.mp3",
  outro: "/defaults/outro.mp3",
  blip: "/defaults/blip.mp3",
};

export function voiceCharacter(line: Line, characters: Character[], personas: Persona[]): Character | undefined {
  const direct = characters.find((c) => c.id === line.speaker);
  if (direct) return direct;
  const p = personas.find((x) => x.id === line.speaker);
  return characters.find((c) => c.id === p?.voiceCharacterId);
}

export function speakerName(id: string, characters: Character[], personas: Persona[]): string {
  return characters.find((c) => c.id === id)?.name ?? personas.find((p) => p.id === id)?.name ?? "Unknown";
}

/** Identifies a take: if any of these change, the line needs regenerating. */
export function lineHash(line: Line, ch: Character | undefined, show: Show, library: Pronunciation[]): string {
  const { spoken } = toSpoken(line.text, library);
  return hashString([spoken, ch?.voice.voiceId ?? "", JSON.stringify(ch?.voice.settings ?? {}), show.ttsModel].join("|"));
}

export function isStale(line: Line, ch: Character | undefined, show: Show, library: Pronunciation[]): boolean {
  return !line.audio || line.audio.hash !== lineHash(line, ch, show, library);
}

export function lineTimings(script: Script, characters: Character[], show: Show, library: Pronunciation[]): Record<string, LineTiming> {
  const out: Record<string, LineTiming> = {};
  for (const line of script.lines) {
    const ch = voiceCharacter(line, characters, script.personas);
    if (line.audio && !isStale(line, ch, show, library)) {
      out[line.id] = { duration: line.audio.duration, words: line.audio.words, estimated: false };
    } else {
      const est = estimateWords(line.text, ch?.voice.settings.speed ?? 1);
      out[line.id] = { ...est, estimated: true };
    }
  }
  return out;
}

const audioCache = new Map<string, Promise<AudioBuffer>>();
export function loadAudio(path: string): Promise<AudioBuffer> {
  let p = audioCache.get(path);
  if (!p) {
    p = store.download(path).then((b) => b.arrayBuffer()).then(decodeAudio);
    p.catch(() => audioCache.delete(path));
    audioCache.set(path, p);
  }
  return p;
}

const imageCache = new Map<string, Promise<ImageBitmap | null>>();
export function loadImage(path: string | null | undefined): Promise<ImageBitmap | null> {
  if (!path) return Promise.resolve(null);
  let p = imageCache.get(path);
  if (!p) {
    p = store
      .download(path)
      .then((b) => createImageBitmap(b))
      .catch(() => null);
    imageCache.set(path, p);
  }
  return p;
}

export function musicPath(show: Show, slot: MusicSlot): string | null {
  const a = show.music[slot] as AssetRef | null;
  if (a) return a.path;
  return show.music.useDefaults ? DEFAULT_MUSIC[slot] : null;
}

export async function loadMusic(show: Show): Promise<{ buffers: Partial<Record<MusicSlot, AudioBuffer | null>>; durations: MusicDurations }> {
  const slots: MusicSlot[] = ["sting", "bed", "ident", "outro", "blip"];
  const buffers: Partial<Record<MusicSlot, AudioBuffer | null>> = {};
  await Promise.all(
    slots.map(async (s) => {
      const p = musicPath(show, s);
      buffers[s] = p ? await loadAudio(p).catch(() => null) : null;
    }),
  );
  const d = (s: MusicSlot) => buffers[s]?.duration ?? 0;
  return { buffers, durations: { sting: d("sting"), bed: d("bed"), ident: d("ident"), outro: d("outro"), blip: d("blip") } };
}

export async function stageImages(show: Show, characters: Character[], script: Script): Promise<StageImages> {
  const portraits: Record<string, ImageBitmap | null> = {};
  await Promise.all(characters.map(async (c) => (portraits[c.id] = await loadImage(c.image?.path))));
  const cards: Record<string, ImageBitmap | null> = {};
  await Promise.all(script.cards.filter((c) => c.image).map(async (c) => (cards[c.id] = await loadImage(c.image?.path))));
  let qr: ImageBitmap | null = null;
  if (show.endCard.showQr && show.endCard.url) {
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, show.endCard.url, { margin: 0, width: 512, color: { dark: "#0B191C", light: "#FFFFFF" } });
    qr = await createImageBitmap(canvas);
  }
  return {
    logo: await loadImage(show.brand.logo?.path),
    background: show.brand.scene === "image" ? await loadImage(show.brand.backgroundImage?.path) : null,
    qr,
    portraits,
    cards,
  };
}

export interface Production {
  timeline: Timeline;
  model: StageModel;
  music: Awaited<ReturnType<typeof loadMusic>>;
}

/** Builds everything needed to preview the episode (no mixing yet, so it's fast). */
export async function prepare(args: {
  show: Show;
  characters: Character[];
  script: Script;
  library: Pronunciation[];
  episodeNumber: number;
  draft: boolean;
}): Promise<Production> {
  const music = await loadMusic(args.show);
  const timings = lineTimings(args.script, args.characters, args.show, args.library);
  const timeline = buildTimeline({ script: args.script, show: args.show, timings, music: music.durations });
  const images = await stageImages(args.show, args.characters, args.script);
  return {
    timeline,
    music,
    model: {
      show: args.show,
      characters: args.characters,
      script: args.script,
      timeline,
      episodeNumber: args.episodeNumber,
      envVoice: syntheticEnvelope(timeline, ENV_FPS),
      envMusic: [],
      fps: ENV_FPS,
      images,
      draft: args.draft,
    },
  };
}

/** Mixes the full episode audio and swaps real envelopes into the stage model. */
export async function mixProduction(
  prod: Production,
  opts: { bookends?: { pre?: AudioBuffer | null; post?: AudioBuffer | null } } = {},
): Promise<MixResult> {
  const { timeline, model } = prod;
  const lines: Record<string, AudioBuffer | undefined> = {};
  await Promise.all(
    model.script.lines.map(async (l) => {
      const t = timeline.lines.find((x) => x.id === l.id);
      if (l.audio && t && !t.estimated) lines[l.id] = await loadAudio(l.audio.path);
    }),
  );
  const mix = await mixEpisode({
    timeline,
    lines,
    music: prod.music.buffers,
    voicenoteIds: new Set(model.script.lines.filter((l) => l.kind === "voicenote").map((l) => l.id)),
    pre: opts.bookends?.pre,
    post: opts.bookends?.post,
  });
  const anyAudio = Object.keys(lines).length > 0;
  model.envVoice = anyAudio ? mix.envVoice : syntheticEnvelope(timeline, ENV_FPS);
  model.envMusic = mix.envMusic;
  return mix;
}

export function bookend(show: Show, which: "intro" | "outro", o: Orientation): AssetRef | null {
  const set = show[which];
  return set[o] ?? set.landscape ?? set.portrait ?? set.square ?? null;
}
