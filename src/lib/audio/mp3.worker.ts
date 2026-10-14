import { Mp3Encoder } from "@breezystack/lamejs";

self.onmessage = (e: MessageEvent<{ left: Float32Array; right: Float32Array; rate: number; kbps: number }>) => {
  const { left, right, rate, kbps } = e.data;
  const enc = new Mp3Encoder(2, rate, kbps);
  const toI16 = (f: Float32Array, from: number, to: number) => {
    const out = new Int16Array(to - from);
    for (let i = from; i < to; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      out[i - from] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  };
  const chunks: Uint8Array[] = [];
  const step = 1152 * 20;
  for (let i = 0; i < left.length; i += step) {
    const end = Math.min(left.length, i + step);
    const out = enc.encodeBuffer(toI16(left, i, end), toI16(right, i, end));
    if (out.length) chunks.push(new Uint8Array(out));
    if ((i / step) % 40 === 0) (self as any).postMessage({ progress: i / left.length });
  }
  const tail = enc.flush();
  if (tail.length) chunks.push(new Uint8Array(tail));
  (self as any).postMessage({ done: true, blob: new Blob(chunks as BlobPart[], { type: "audio/mpeg" }) });
};
