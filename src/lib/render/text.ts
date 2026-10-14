// Canvas text helpers: font strings, wrapping with a small cache, and fitting.

import type { Brand } from "../../shared/types";

export type FontRole = "display" | "body" | "mono";

const FALLBACK: Record<FontRole, string> = {
  display: '"Arial Narrow", "Roboto Condensed", sans-serif',
  body: '"Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
};

export function font(brand: Brand, role: FontRole, weight: number, size: number): string {
  return `${weight} ${Math.max(1, size).toFixed(2)}px "${brand.fonts[role].family}", ${FALLBACK[role]}`;
}

const cache = new Map<string, string[]>();

/** Splits text into lines that fit maxWidth with the context's current font. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const key = `${ctx.font}|${Math.round(maxWidth)}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const tryLine = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(tryLine).width <= maxWidth || !cur) {
      cur = tryLine;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (cache.size > 800) cache.clear();
  cache.set(key, lines);
  return lines;
}

/** Largest font size (<= size) at which text fits in maxLines lines of maxWidth. */
export function fitSize(
  ctx: CanvasRenderingContext2D,
  brand: Brand,
  role: FontRole,
  weight: number,
  text: string,
  size: number,
  maxWidth: number,
  maxLines: number,
  minSize = size * 0.45,
): number {
  let s = size;
  while (s > minSize) {
    ctx.font = font(brand, role, weight, s);
    const lines = wrap(ctx, text, maxWidth);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (lines.length <= maxLines && widest <= maxWidth) return s;
    s *= 0.92;
  }
  return minSize;
}

export function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.replace("#", ""), 16);
  const pb = parseInt(b.replace("#", ""), 16);
  if (Number.isNaN(pa) || Number.isNaN(pb)) return a;
  const c = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, "0")}`;
}

/** Relative luminance, used to pick readable text on coloured shapes. */
export function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return 0;
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export const readableOn = (hex: string, dark = "#0B191C", light = "#FFFFFF") => (luminance(hex) > 0.4 ? dark : light);

export const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
