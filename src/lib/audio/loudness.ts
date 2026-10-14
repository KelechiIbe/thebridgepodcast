// ITU-R BS.1770 integrated loudness (LUFS), used to level every export to -16 LUFS.

interface Biquad {
  b: [number, number, number];
  a: [number, number, number];
}

function kFilters(rate: number): Biquad[] {
  // pre-filter (high shelf)
  const G = 3.99984385397;
  const Q = 0.7071752369554193;
  const fc = 1681.9744509555319;
  const A = Math.pow(10, G / 40);
  let w0 = (2 * Math.PI * fc) / rate;
  let alpha = Math.sin(w0) / (2 * Q);
  const shelf: Biquad = {
    b: [
      A * (A + 1 + (A - 1) * Math.cos(w0) + 2 * Math.sqrt(A) * alpha),
      -2 * A * (A - 1 + (A + 1) * Math.cos(w0)),
      A * (A + 1 + (A - 1) * Math.cos(w0) - 2 * Math.sqrt(A) * alpha),
    ],
    a: [A + 1 - (A - 1) * Math.cos(w0) + 2 * Math.sqrt(A) * alpha, 2 * (A - 1 - (A + 1) * Math.cos(w0)), A + 1 - (A - 1) * Math.cos(w0) - 2 * Math.sqrt(A) * alpha],
  };
  // RLB high-pass
  const Q2 = 0.5003270373253953;
  const fc2 = 38.13547087613982;
  w0 = (2 * Math.PI * fc2) / rate;
  alpha = Math.sin(w0) / (2 * Q2);
  const hp: Biquad = {
    b: [(1 + Math.cos(w0)) / 2, -(1 + Math.cos(w0)), (1 + Math.cos(w0)) / 2],
    a: [1 + alpha, -2 * Math.cos(w0), 1 - alpha],
  };
  return [shelf, hp];
}

function filter(x: Float32Array, f: Biquad): Float32Array {
  const [b0, b1, b2] = f.b.map((v) => v / f.a[0]);
  const a1 = f.a[1] / f.a[0];
  const a2 = f.a[2] / f.a[0];
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    y[i] = yi;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
  }
  return y;
}

export function integratedLoudness(channels: Float32Array[], rate: number): number {
  const [shelf, hp] = kFilters(rate);
  const z = channels.map((c) => filter(filter(c, shelf), hp));
  const block = Math.round(0.4 * rate);
  const step = Math.round(0.1 * rate);
  const n = z[0].length;
  const powers: number[] = [];
  for (let s = 0; s + block <= n; s += step) {
    let sum = 0;
    for (const ch of z) {
      let acc = 0;
      for (let i = s; i < s + block; i++) acc += ch[i] * ch[i];
      sum += acc / block;
    }
    powers.push(sum);
  }
  const lk = (p: number) => -0.691 + 10 * Math.log10(p || 1e-12);
  const abs = powers.filter((p) => lk(p) > -70);
  if (!abs.length) return -70;
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = lk(meanAbs) - 10;
  const gated = abs.filter((p) => lk(p) > rel);
  const mean = gated.reduce((a, b) => a + b, 0) / Math.max(1, gated.length);
  return lk(mean);
}

export function peak(channels: Float32Array[]): number {
  let m = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
  return m;
}
