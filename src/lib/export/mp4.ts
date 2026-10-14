// MP4 export in the browser: the stage is drawn frame by frame onto a canvas and encoded with
// WebCodecs (through mediabunny). Intro and outro videos are decoded and placed around the episode.

import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import type { MixResult } from "../audio/mixer";
import { StageRenderer, type StageModel } from "../render/stage";

export const SIZES = {
  landscape: { w: 1920, h: 1080 },
  portrait: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
} as const;

export interface Mp4Options {
  model: StageModel;
  mix: MixResult;
  width: number;
  height: number;
  fps?: number;
  /** Render only part of the episode (episode seconds). */
  range?: { start: number; end: number } | null;
  intro?: Blob | null;
  outro?: Blob | null;
  onProgress?: (fraction: number, label: string) => void;
  signal?: AbortSignal;
}

export interface VideoFormat {
  container: "mp4" | "webm";
  video: "avc" | "vp9" | "vp8";
  audio: "aac" | "opus";
}

/** Picks the best format this browser can encode: H.264/AAC in MP4, else VP9/Opus in WebM. */
export async function pickFormat(width: number, height: number): Promise<VideoFormat | null> {
  if (typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined") return null;
  if ((await canEncodeVideo("avc", { width, height })) && (await canEncodeAudio("aac"))) return { container: "mp4", video: "avc", audio: "aac" };
  if (await canEncodeAudio("opus")) {
    if (await canEncodeVideo("vp9", { width, height })) return { container: "webm", video: "vp9", audio: "opus" };
    if (await canEncodeVideo("vp8", { width, height })) return { container: "webm", video: "vp8", audio: "opus" };
  }
  return null;
}

export async function videoSupport(width: number, height: number): Promise<string | null> {
  const f = await pickFormat(width, height);
  if (!f) return "This browser can't encode video. Use Chrome or Edge on a laptop or desktop.";
  return null;
}

interface Bookend {
  sink: CanvasSink;
  duration: number;
  input: Input;
}

async function openBookend(blob: Blob | null | undefined, w: number, h: number): Promise<Bookend | null> {
  if (!blob) return null;
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) return null;
  const duration = await input.computeDuration();
  const sink = new CanvasSink(track, { width: w, height: h, fit: "contain", poolSize: 2 });
  return { sink, duration, input };
}

export async function renderVideo(o: Mp4Options): Promise<{ blob: Blob; format: VideoFormat }> {
  const fps = o.fps ?? 30;
  const W = o.width;
  const H = o.height;
  const format = await pickFormat(W, H);
  if (!format) throw new Error("This browser can't encode video. Use Chrome or Edge on a laptop or desktop.");

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const stage = new StageRenderer(o.model);

  const intro = await openBookend(o.intro, W, H);
  const outro = await openBookend(o.outro, W, H);
  // The mix already contains the bookends' sound: [intro][0.4s][episode][0.4s][outro]
  const epStart = o.mix.offset;
  const range = o.range ?? { start: 0, end: o.model.timeline.duration };
  const epLen = range.end - range.start;
  const clip = !!o.range;
  const segments: { kind: "intro" | "gap" | "episode" | "outro"; dur: number }[] = [];
  if (intro && !clip) segments.push({ kind: "intro", dur: intro.duration }, { kind: "gap", dur: epStart - intro.duration });
  segments.push({ kind: "episode", dur: epLen });
  if (outro && !clip) segments.push({ kind: "gap", dur: 0.4 }, { kind: "outro", dur: outro.duration });
  const total = segments.reduce((s, x) => s + x.dur, 0);

  const output = new Output({
    format: format.container === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(canvas, { codec: format.video, quality: QUALITY_HIGH, keyFrameInterval: 2 });
  const audio = new AudioBufferSource({ codec: format.audio, quality: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: fps });
  output.addAudioTrack(audio);
  await output.start();

  // audio is fed in 5-second chunks, kept a little ahead of the video
  const rate = o.mix.rate;
  const audioStart = clip ? epStart + range.start : 0;
  const audioEnd = audioStart + total;
  let audioAt = audioStart;
  const feedAudio = async (until: number) => {
    while (audioAt < Math.min(until, audioEnd) - 1e-6) {
      const next = Math.min(audioAt + 5, audioEnd);
      const a = Math.floor(audioAt * rate);
      const b = Math.min(o.mix.channels[0].length, Math.floor(next * rate));
      const len = Math.max(1, b - a);
      const buf = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: rate });
      buf.copyToChannel(o.mix.channels[0].subarray(a, a + len) as Float32Array<ArrayBuffer>, 0);
      buf.copyToChannel(o.mix.channels[1].subarray(a, a + len) as Float32Array<ArrayBuffer>, 1);
      await audio.add(buf);
      audioAt = next;
    }
  };

  const frames = Math.round(total * fps);
  let segIndex = 0;
  let segStart = 0;
  let introIter: AsyncGenerator<any> | null = null;
  let outroIter: AsyncGenerator<any> | null = null;
  const drawVideoFrame = async (iter: AsyncGenerator<any>) => {
    const r = await iter.next();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (!r.done && r.value) ctx.drawImage(r.value.canvas, 0, 0, W, H);
  };
  try {
    for (let f = 0; f < frames; f++) {
      if (o.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
      const t = f / fps;
      while (segIndex < segments.length - 1 && t >= segStart + segments[segIndex].dur) {
        segStart += segments[segIndex].dur;
        segIndex++;
      }
      const seg = segments[segIndex];
      const local = t - segStart;
      if (seg.kind === "intro" && intro) {
        introIter ??= intro.sink.canvasesAtTimestamps((function* () {
          for (let k = 0; k < Math.round(intro.duration * fps); k++) yield k / fps;
        })());
        await drawVideoFrame(introIter);
      } else if (seg.kind === "outro" && outro) {
        outroIter ??= outro.sink.canvasesAtTimestamps((function* () {
          for (let k = 0; k < Math.round(outro.duration * fps); k++) yield k / fps;
        })());
        await drawVideoFrame(outroIter);
      } else if (seg.kind === "gap") {
        const afterEpisode = segments.slice(0, segIndex).some((x) => x.kind === "episode");
        stage.render(ctx, W, H, afterEpisode ? o.model.timeline.duration - 0.01 : 0);
      } else {
        stage.render(ctx, W, H, range.start + local);
      }
      await feedAudio(audioStart + t + 1);
      await video.add(t, 1 / fps);
      if (f % 15 === 0) o.onProgress?.(f / frames, `Rendering frame ${f} of ${frames}`);
    }
    await feedAudio(audioEnd);
    o.onProgress?.(1, "Finishing the file");
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    (intro?.input as any)?.dispose?.();
    (outro?.input as any)?.dispose?.();
  }
  const buf = (output.target as BufferTarget).buffer!;
  return { blob: new Blob([buf], { type: format.container === "mp4" ? "video/mp4" : "video/webm" }), format };
}
