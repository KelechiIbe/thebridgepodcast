// Animated stage backgrounds. Every frame is a pure function of time, so previews and exports match.

import type { Brand } from "../../shared/types";
import { mix, withAlpha } from "./text";

export type StageMode = "landscape" | "square" | "portrait" | "tall";

export function stageMode(W: number, H: number): StageMode {
  const r = H / W;
  if (r > 1.5) return "tall";
  if (r > 1.18) return "portrait";
  if (r > 0.85) return "square";
  return "landscape";
}

function rnd(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

const SKYLINE = (() => {
  const r = rnd(11);
  const out: { x: number; w: number; h: number; lit: number }[] = [];
  let x = 0;
  while (x < 1.02) {
    const w = 0.012 + r() * 0.03;
    out.push({ x, w, h: 0.03 + Math.pow(r(), 2.2) * 0.16, lit: r() });
    x += w + r() * 0.006;
  }
  return out;
})();

const BUSES = (() => {
  const r = rnd(5);
  return Array.from({ length: 9 }, () => ({ o: r(), v: (0.012 + r() * 0.016) * (r() > 0.5 ? 1 : -1), lane: r() > 0.5 ? 1 : 0, len: 0.016 + r() * 0.006 }));
})();

export function deckY(mode: StageMode, H: number) {
  return H * (mode === "tall" ? 0.665 : mode === "portrait" ? 0.715 : mode === "square" ? 0.72 : 0.705);
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  brand: Brand,
  voice: number,
  music: number,
  bgImage: CanvasImageSource | null,
) {
  const p = brand.palette;
  const mode = stageMode(W, H);
  const portraitish = mode !== "landscape";
  switch (brand.scene) {
    case "plain":
      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, W, H);
      break;
    case "image":
      drawImageScene(ctx, W, H, t, brand, bgImage);
      break;
    case "gradient":
      drawGradientScene(ctx, W, H, t, brand, voice);
      break;
    case "grid":
      drawGridScene(ctx, W, H, t, brand, voice);
      break;
    default:
      drawBridge(ctx, W, H, t, brand, voice, music, mode, portraitish);
  }
  // legibility for captions
  const vg = ctx.createLinearGradient(0, H * 0.55, 0, H);
  vg.addColorStop(0, withAlpha(p.bg, 0));
  vg.addColorStop(1, withAlpha(p.bg, 0.8));
  ctx.fillStyle = vg;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);
}

function drawBridge(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  brand: Brand,
  ve: number,
  me: number,
  mode: StageMode,
  portraitish: boolean,
) {
  const p = brand.palette;
  const dy = deckY(mode, H);
  const water = mix(p.bg, "#000000", 0.25);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, p.bg);
  g.addColorStop(dy / H, p.bg2);
  g.addColorStop(Math.min(1, dy / H + 0.02), mix(p.bg, p.bg2, 0.3));
  g.addColorStop(1, water);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const skyBase = dy - H * 0.012;
  const building = withAlpha(mix(p.bg2, p.ink, 0.18), 0.55);
  for (const b of SKYLINE) {
    if (b.x < 0.42) continue;
    const x = b.x * W;
    const w = b.w * W;
    const h = b.h * W * (portraitish ? 0.9 : 0.42);
    ctx.fillStyle = building;
    ctx.fillRect(x, skyBase - h, w, h);
    if (b.lit > 0.55) {
      ctx.fillStyle = withAlpha(p.accent, 0.22);
      for (let yy = skyBase - h + 4; yy < skyBase - 3; yy += 7) ctx.fillRect(x + w * 0.3, yy, Math.max(1, w * 0.12), 2);
    }
  }
  const deck = mix(p.bg2, p.ink, 0.16);
  const span = W / (portraitish ? 9 : 18);
  ctx.strokeStyle = withAlpha(deck, 0.9);
  ctx.lineWidth = Math.max(1, W * 0.0016);
  for (let x = 0; x < W + span; x += span) {
    ctx.beginPath();
    ctx.moveTo(x, dy);
    ctx.lineTo(x, dy + W * 0.028);
    ctx.stroke();
  }
  ctx.fillStyle = deck;
  ctx.fillRect(0, dy - Math.max(2, W * 0.0035), W, Math.max(3, W * 0.0045));
  const lampGap = W / (portraitish ? 7 : 14);
  for (let x = lampGap / 2; x < W; x += lampGap) {
    const top = dy - W * (portraitish ? 0.07 : 0.03);
    ctx.strokeStyle = withAlpha(deck, 0.9);
    ctx.lineWidth = Math.max(1, W * 0.0012);
    ctx.beginPath();
    ctx.moveTo(x, dy - H * 0.006);
    ctx.lineTo(x, top);
    ctx.stroke();
    const a = 0.35 + 0.65 * ve;
    const R = W * (portraitish ? 0.03 : 0.017);
    const rg = ctx.createRadialGradient(x, top, 0, x, top, R);
    rg.addColorStop(0, withAlpha(p.accent, 0.55 * a));
    rg.addColorStop(1, withAlpha(p.accent, 0));
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, top, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(x, top, Math.max(1.2, W * (portraitish ? 0.0035 : 0.002)), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = withAlpha(p.accent, 0.05 + 0.08 * a);
    for (let k = 0; k < 3; k++) {
      const yy = dy + W * 0.035 + k * W * 0.014;
      const wob = Math.sin(t * 2.1 + k * 1.7 + x * 0.05) * W * 0.004 * (1 + ve * 2);
      ctx.fillRect(x - W * 0.004 + wob, yy, W * 0.008 * (1 - k * 0.12), Math.max(1, H * 0.004));
    }
  }
  const u = portraitish ? 1.7 : 1;
  for (const b of BUSES) {
    const pos = (((b.o + b.v * t) % 1) + 1) % 1;
    const x = pos * (W + W * 0.06) - W * 0.03;
    const y = dy - W * u * (b.lane ? 0.0095 : 0.0062) - W * u * 0.0034;
    const bw = W * b.len * u;
    const bh = W * 0.005 * u;
    ctx.fillStyle = mix(p.accent, "#000000", 0.06);
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = p.bg;
    ctx.fillRect(x, y + bh * 0.45, bw, Math.max(1, bh * 0.14));
  }
  ripples(ctx, W, H, t, dy + W * 0.06, withAlpha(p.dim, 0.16), ve, me);
}

function ripples(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, y0: number, color: string, ve: number, me: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, H * 0.0018);
  for (let k = 0; k < 8; k++) {
    const yy = y0 + k * W * 0.03;
    if (yy > H) break;
    ctx.beginPath();
    for (let x = 0; x <= W; x += W / 60) {
      const amp = W * (0.0012 + 0.0036 * ve + 0.0018 * me) * (1 - k * 0.08);
      const y = yy + Math.sin(x * (0.018 * 1280) / W + t * (1.4 + k * 0.2) + k) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawGradientScene(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, brand: Brand, ve: number) {
  const p = brand.palette;
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  const blobs = [
    { c: p.accent, x: 0.78, y: 0.22, r: 0.55, s: 0.07 },
    { c: p.accent2, x: 0.18, y: 0.8, r: 0.6, s: 0.05 },
    { c: p.bg2, x: 0.5, y: 0.5, r: 0.8, s: 0.03 },
  ];
  for (const [i, b] of blobs.entries()) {
    const x = (b.x + Math.sin(t * b.s + i) * 0.06) * W;
    const y = (b.y + Math.cos(t * b.s * 1.3 + i) * 0.05) * H;
    const r = b.r * Math.max(W, H) * (1 + 0.04 * ve);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, withAlpha(b.c, i === 2 ? 0.55 : 0.16));
    g.addColorStop(1, withAlpha(b.c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawGridScene(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, brand: Brand, ve: number) {
  const p = brand.palette;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, p.bg);
  g.addColorStop(1, p.bg2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const step = Math.max(W, H) / 24;
  ctx.strokeStyle = withAlpha(p.ink, 0.05);
  ctx.lineWidth = 1;
  const off = (t * step * 0.15) % step;
  for (let x = -step + off; x < W + step; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  const sweep = ((t * 0.08) % 1.4 - 0.2) * W;
  const sg = ctx.createLinearGradient(sweep - W * 0.2, 0, sweep + W * 0.2, 0);
  sg.addColorStop(0, withAlpha(p.accent, 0));
  sg.addColorStop(0.5, withAlpha(p.accent, 0.05 + 0.05 * ve));
  sg.addColorStop(1, withAlpha(p.accent, 0));
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, W, H);
}

function drawImageScene(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, brand: Brand, img: CanvasImageSource | null) {
  const p = brand.palette;
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  if (img) {
    const iw = (img as any).width || (img as any).videoWidth || 1;
    const ih = (img as any).height || (img as any).videoHeight || 1;
    const zoom = 1.04 + 0.02 * Math.sin(t * 0.05);
    const s = Math.max(W / iw, H / ih) * zoom;
    const dw = iw * s;
    const dh = ih * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  ctx.fillStyle = withAlpha(p.bg, brand.backgroundDim);
  ctx.fillRect(0, 0, W, H);
}
