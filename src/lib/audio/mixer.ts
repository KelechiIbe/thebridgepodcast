// Builds the finished episode audio in the browser with OfflineAudioContext:
// voices (with the voice-note treatment), music cues ducked under speech, loudness to -16 LUFS.

import type { Timeline, MusicSlot } from "../../shared/timeline";
import { integratedLoudness, peak } from "./loudness";

export const MIX_RATE = 44100;
export const ENV_FPS = 30;

export interface MixInput {
  timeline: Timeline;
  /** Decoded audio per line id (lines without audio stay silent). */
  lines: Record<string, AudioBuffer | undefined>;
  /** Decoded music per slot. */
  music: Partial<Record<MusicSlot, AudioBuffer | null>>;
  voicenoteIds: Set<string>;
  targetLufs?: number;
  /** Optional audio placed before and after the episode (bookend videos' sound). */
  pre?: AudioBuffer | null;
  post?: AudioBuffer | null;
}

export interface MixResult {
  channels: [Float32Array, Float32Array];
  rate: number;
  duration: number;
  /** Where the episode itself starts inside the mix (after any pre audio). */
  offset: number;
  envVoice: number[];
  envMusic: number[];
  loudness: number;
}

function rms(buf: AudioBuffer): number {
  let acc = 0;
  let n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i += 2) {
      acc += d[i] * d[i];
      n++;
    }
  }
  return Math.sqrt(acc / Math.max(1, n));
}

function tanhCurve() {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * 3) / 3 / Math.tanh(1);
  }
  return c;
}

function envelope(channels: Float32Array[], rate: number, fps: number): number[] {
  const hop = Math.floor(rate / fps);
  const n = Math.floor(channels[0].length / hop);
  const out = new Array<number>(n);
  for (let f = 0; f < n; f++) {
    let acc = 0;
    for (let i = f * hop; i < (f + 1) * hop; i += 2) {
      const v = (channels[0][i] + (channels[1]?.[i] ?? channels[0][i])) / 2;
      acc += v * v;
    }
    out[f] = Math.sqrt(acc / (hop / 2));
  }
  const sorted = out.filter((v) => v > 1e-4).sort((a, b) => a - b);
  const ref = sorted.length ? sorted[Math.floor(sorted.length * 0.97)] : 1;
  return out.map((v) => Math.round(Math.min(1, v / (ref || 1)) * 100) / 100);
}

export async function mixEpisode(input: MixInput): Promise<MixResult> {
  const { timeline } = input;
  const pre = input.pre ?? null;
  const post = input.post ?? null;
  const offset = pre ? pre.duration + 0.4 : 0;
  const total = offset + timeline.duration + (post ? post.duration + 0.4 : 0);
  const length = Math.ceil(total * MIX_RATE);

  // ---- voices
  const vctx = new OfflineAudioContext(2, length, MIX_RATE);
  const curve = tanhCurve();
  for (const line of timeline.lines) {
    const buf = input.lines[line.id];
    if (!buf) continue;
    const src = vctx.createBufferSource();
    src.buffer = buf;
    const gain = vctx.createGain();
    const isVn = input.voicenoteIds.has(line.id);
    const target = isVn ? 0.089 : 0.1; // about -21 / -20 dBFS RMS
    gain.gain.value = Math.min(6, target / Math.max(1e-4, rms(buf)));
    if (isVn) {
      const hp = vctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 300;
      hp.Q.value = 0.9;
      const lp = vctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 3500;
      lp.Q.value = 0.9;
      const sh = vctx.createWaveShaper();
      sh.curve = curve;
      src.connect(hp).connect(lp).connect(sh).connect(gain);
    } else {
      const hp = vctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 70;
      src.connect(hp).connect(gain);
    }
    gain.connect(vctx.destination);
    src.start(offset + line.s);
  }
  if (pre) {
    const s = vctx.createBufferSource();
    s.buffer = pre;
    s.connect(vctx.destination);
    s.start(0);
  }
  if (post) {
    const s = vctx.createBufferSource();
    s.buffer = post;
    s.connect(vctx.destination);
    s.start(offset + timeline.duration + 0.4);
  }
  const voiceBuf = await vctx.startRendering();

  // ---- music, ducked while anyone speaks
  const mctx = new OfflineAudioContext(2, length, MIX_RATE);
  const RES = 50; // automation points per second
  const presence = new Float32Array(Math.ceil(total * RES) + 1);
  for (const l of timeline.lines) {
    const a = Math.max(0, Math.floor((offset + l.s - 0.25) * RES));
    const b = Math.min(presence.length, Math.ceil((offset + l.e + 0.25) * RES));
    for (let i = a; i < b; i++) presence[i] = 1;
  }
  const smooth = new Float32Array(presence.length);
  const k = Math.round(0.3 * RES);
  for (let i = 0; i < presence.length; i++) {
    let acc = 0;
    let n = 0;
    for (let j = i - k; j <= i + k; j++) {
      if (j >= 0 && j < presence.length) {
        acc += presence[j];
        n++;
      }
    }
    smooth[i] = acc / n;
  }
  for (const cue of timeline.cues) {
    const buf = input.music[cue.slot];
    if (!buf) continue;
    const start = offset + cue.start;
    const dur = Math.min(cue.maxDur ?? buf.duration, total - start);
    if (dur <= 0.05) continue;
    const src = mctx.createBufferSource();
    src.buffer = buf;
    src.loop = (cue.maxDur ?? 0) > buf.duration;
    const g = mctx.createGain();
    const pts = Math.max(2, Math.ceil(dur * RES));
    const values = new Float32Array(pts);
    const fade = cue.fadeOut ?? 0.4;
    for (let i = 0; i < pts; i++) {
      const tt = (i / (pts - 1)) * dur;
      const pi = Math.min(smooth.length - 1, Math.round((start + tt) * RES));
      let v = cue.full + (cue.duck - cue.full) * smooth[pi];
      if (cue.maxDur && tt > dur - fade) v *= Math.max(0, (dur - tt) / fade);
      values[i] = v;
    }
    g.gain.setValueCurveAtTime(values, start, dur);
    src.connect(g).connect(mctx.destination);
    src.start(start);
    src.stop(start + dur + 0.01);
  }
  const musicBuf = await mctx.startRendering();

  // ---- sum and level
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  const vl = voiceBuf.getChannelData(0), vr = voiceBuf.getChannelData(1);
  const ml = musicBuf.getChannelData(0), mr = musicBuf.getChannelData(1);
  for (let i = 0; i < length; i++) {
    L[i] = vl[i] + ml[i];
    R[i] = vr[i] + mr[i];
  }
  const target = input.targetLufs ?? -16;
  const measured = integratedLoudness([L, R], MIX_RATE);
  let gain = Math.pow(10, (target - measured) / 20);
  const pk = peak([L, R]) * gain;
  if (pk > 0.84) gain *= 0.84 / pk;
  for (let i = 0; i < length; i++) {
    L[i] *= gain;
    R[i] *= gain;
  }
  // envelopes cover the episode only (not the bookends), aligned to episode time
  const startSample = Math.floor(offset * MIX_RATE);
  const epLen = Math.ceil(timeline.duration * MIX_RATE);
  const slice = (b: AudioBuffer) => [0, 1].map((c) => b.getChannelData(c).subarray(startSample, startSample + epLen));
  return {
    channels: [L, R],
    rate: MIX_RATE,
    duration: total,
    offset,
    envVoice: envelope(slice(voiceBuf), MIX_RATE, ENV_FPS),
    envMusic: envelope(slice(musicBuf), MIX_RATE, ENV_FPS),
    loudness: integratedLoudness([L, R], MIX_RATE),
  };
}

export function toAudioBuffer(m: MixResult): AudioBuffer {
  const b = new AudioBuffer({ length: m.channels[0].length, numberOfChannels: 2, sampleRate: m.rate });
  b.copyToChannel(m.channels[0] as Float32Array<ArrayBuffer>, 0);
  b.copyToChannel(m.channels[1] as Float32Array<ArrayBuffer>, 1);
  return b;
}

export async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, 1, MIX_RATE);
  return ctx.decodeAudioData(data.slice(0));
}
