import { decodeAudio, MIX_RATE } from "../audio/mixer";
import { ALL_FORMATS, BlobSource, Input } from "mediabunny";

/** Duration of a video file, in seconds. */
export async function videoDuration(blob: Blob): Promise<number> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    return await input.computeDuration();
  } finally {
    (input as any).dispose?.();
  }
}

/** The video's soundtrack, padded or trimmed to exactly the video's length (silence if it has none). */
export async function bookendAudio(blob: Blob): Promise<AudioBuffer> {
  const duration = await videoDuration(blob);
  const length = Math.max(1, Math.round(duration * MIX_RATE));
  const out = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: MIX_RATE });
  try {
    const decoded = await decodeAudio(await blob.arrayBuffer());
    for (let c = 0; c < 2; c++) {
      const src = decoded.getChannelData(Math.min(c, decoded.numberOfChannels - 1));
      out.copyToChannel(src.subarray(0, length) as Float32Array<ArrayBuffer>, c);
    }
  } catch {
    // no audio track: keep silence
  }
  return out;
}
