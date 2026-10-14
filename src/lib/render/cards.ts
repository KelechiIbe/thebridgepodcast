// Draws on-screen cards (figures, comparisons, steps...) onto the stage canvas.

import type { Brand, Card, Tone } from "../../shared/types";
import { nairaShort, naira } from "../../shared/tax";
import { clamp, ease, fitSize, font, roundRect, withAlpha, wrap, readableOn } from "./text";
import type { StageMode } from "./scenes";

export interface CardDrawArgs {
  ctx: CanvasRenderingContext2D;
  card: Card;
  brand: Brand;
  x: number;
  y: number;
  w: number;
  h: number;
  u: number;
  mode: StageMode;
  /** Seconds since the card appeared. */
  age: number;
  carry: string[];
  max: number;
  image: CanvasImageSource | null;
}

interface Sizes {
  kicker: number;
  big: number;
  label: number;
  sub: number;
  quote: number;
  barLabel: number;
  barH: number;
  barValue: number;
  formula: number;
  step: number;
  badge: number;
  dodont: number;
  dodontHead: number;
  track: number;
  legend: number;
  gap: number;
}

export function cardSizes(mode: StageMode): Sizes {
  if (mode === "landscape")
    return { kicker: 1.2, big: 7.4, label: 2.1, sub: 1.45, quote: 3.2, barLabel: 1.35, barH: 3, barValue: 3, formula: 3.4, step: 2.1, badge: 3.6, dodont: 1.9, dodontHead: 2.6, track: 4.2, legend: 1.35, gap: 1.1 };
  const k = mode === "square" ? 0.72 : 1;
  return {
    kicker: 2.3 * k,
    big: 15 * k,
    label: 4.2 * k,
    sub: 3 * k,
    quote: 6.2 * k,
    barLabel: 3 * k,
    barH: 6 * k,
    barValue: 6 * k,
    formula: 6.6 * k,
    step: 4.2 * k,
    badge: 7 * k,
    dodont: 3.6 * k,
    dodontHead: 5 * k,
    track: 8 * k,
    legend: 2.7 * k,
    gap: 2 * k,
  };
}

interface Block {
  h: number;
  draw: (x: number, y: number) => void;
}

function toneColor(brand: Brand, tone: Tone | undefined, fallback: string) {
  const p = brand.palette;
  return tone === "good" ? p.good : tone === "bad" ? p.bad : tone === "mid" ? p.mid : tone === "accent" ? p.accent : fallback;
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  if ("letterSpacing" in ctx) (ctx as any).letterSpacing = `${px.toFixed(1)}px`;
}

function textBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  f: string,
  color: string,
  w: number,
  lineH: number,
  maxLines = 6,
  spacing = 0,
  alpha = 1,
): Block {
  ctx.font = f;
  setSpacing(ctx, spacing);
  let lines = wrap(ctx, text, w);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "…");
  }
  setSpacing(ctx, 0);
  return {
    h: lines.length * lineH,
    draw: (x, y) => {
      ctx.font = f;
      setSpacing(ctx, spacing);
      ctx.fillStyle = color;
      ctx.globalAlpha *= alpha;
      ctx.textBaseline = "top";
      lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineH));
      ctx.globalAlpha /= alpha || 1;
      setSpacing(ctx, 0);
    },
  };
}

export function drawCard(a: CardDrawArgs) {
  const { ctx, card, brand, w, u, mode } = a;
  const S = cardSizes(mode);
  const p = brand.palette;
  const prog = clamp(a.age / 0.6);
  const blocks: Block[] = [];
  const gap = S.gap * u;
  const display = (size: number, weight = 900) => font(brand, "display", weight, size);
  const body = (size: number, weight = 600) => font(brand, "body", weight, size);
  const mono = (size: number) => font(brand, "mono", 500, size);
  const kicker = (text: string) => blocks.push(textBlock(ctx, text.toUpperCase(), mono(S.kicker * u), p.dim, w, S.kicker * u * 1.3, 2, S.kicker * u * 0.14));
  const big = (text: string, tone?: Tone, sizeMul = 1) => {
    const t = text.toUpperCase();
    const size = fitSize(ctx, brand, "display", 900, t, S.big * u * sizeMul, w, 2, S.big * u * 0.4);
    blocks.push(textBlock(ctx, t, display(size), toneColor(brand, tone, p.accent), w, size * 0.94, 2));
  };
  const label = (text: string) => blocks.push(textBlock(ctx, text, body(S.label * u, 600), p.ink, w * 0.96, S.label * u * 1.22, 3));
  const sub = (text: string) => {
    const isRef = /\b(s\.\s?\d|section|Act 20\d\d|Regulations?)\b/i.test(text) && text.length < 90;
    blocks.push(textBlock(ctx, text, isRef ? mono(S.sub * u * 0.85) : body(S.sub * u, 400), p.dim, w * 0.92, S.sub * u * 1.4, 3));
  };

  switch (card.type) {
    case "quote": {
      if (card.attribution) kicker(card.attribution);
      const qm = display(S.big * u * 0.95);
      blocks.push({
        h: S.big * u * 0.55,
        draw: (x, y) => {
          ctx.font = qm;
          ctx.fillStyle = p.accent;
          ctx.textBaseline = "top";
          ctx.fillText("“", x - u * 0.2, y - S.big * u * 0.08);
        },
      });
      blocks.push(textBlock(ctx, card.quote || card.label || "", body(S.quote * u, 700), p.ink, w, S.quote * u * 1.14, 4));
      break;
    }
    case "stat":
    case "note":
    case "cta": {
      if (card.big) big(card.big, card.tone, card.big.length > 12 ? 0.76 : 1);
      if (card.label) label(card.label);
      if (card.sub) sub(card.sub);
      break;
    }
    case "shift": {
      const size = fitSize(ctx, brand, "display", 900, `${card.from ?? ""} → ${card.to ?? ""}`.toUpperCase(), S.big * u * 0.95, w, 1, S.big * u * 0.35);
      blocks.push({
        h: size,
        draw: (x, y) => {
          ctx.font = display(size);
          ctx.textBaseline = "top";
          const from = (card.from ?? "").toUpperCase();
          const to = (card.to ?? "").toUpperCase();
          const fw = ctx.measureText(from).width;
          ctx.fillStyle = p.dim;
          ctx.fillText(from, x, y);
          ctx.fillRect(x, y + size * 0.42, fw * ease(a.age / 0.9), Math.max(2, size * 0.05));
          ctx.font = display(size * 0.6);
          ctx.fillStyle = p.ink;
          const ax = x + fw + size * 0.25;
          ctx.fillText("→", ax, y + size * 0.18);
          const aw = ctx.measureText("→").width;
          ctx.font = display(size);
          ctx.fillStyle = p.accent;
          ctx.globalAlpha *= clamp((a.age - 0.25) / 0.4);
          ctx.fillText(to, ax + aw + size * 0.25, y);
          ctx.globalAlpha = 1;
        },
      });
      if (card.label) label(card.label);
      if (card.sub) sub(card.sub);
      break;
    }
    case "split": {
      if (card.big) big(card.big, card.tone, 0.76);
      if (card.label) label(card.label);
      const total = Math.max(1, card.total ?? 1);
      const part = Math.min(total, Math.max(0, card.part ?? 0));
      const th = S.track * u;
      const lf = mono(S.legend * u);
      blocks.push({
        h: th + S.legend * u * 1.9,
        draw: (x, y) => {
          ctx.fillStyle = withAlpha(p.ink, 0.12);
          roundRect(ctx, x, y, w, th, th * 0.2);
          ctx.fill();
          ctx.fillStyle = p.accent;
          roundRect(ctx, x, y, Math.max(th * 0.2, w * (part / total) * ease(a.age / 0.8)), th, th * 0.2);
          ctx.fill();
          ctx.font = lf;
          ctx.textBaseline = "top";
          const left = `${naira(part)} ${card.partLabel ?? ""}`.trim();
          const right = `${naira(total - part)} ${card.restLabel ?? ""}`.trim();
          ctx.fillStyle = p.accent;
          ctx.fillText(left, x, y + th + S.legend * u * 0.5);
          ctx.fillStyle = p.dim;
          ctx.fillText(right, x + w - ctx.measureText(right).width, y + th + S.legend * u * 0.5);
        },
      });
      if (card.sub) sub(card.sub);
      break;
    }
    case "bars": {
      if (card.unit) kicker(card.unit);
      const bars = card.bars ?? [];
      const max = a.max || Math.max(1, ...bars.map((b) => b.value));
      const bh = S.barH * u;
      const vf = display(S.barValue * u, 800);
      ctx.font = vf;
      const valW = Math.max(...bars.map((b) => ctx.measureText(nairaShort(b.value)).width), 0);
      const trackW = Math.max(w * 0.3, w - valW - u * 2);
      bars.forEach((b, i) => {
        const lb = textBlock(ctx, b.label, body(S.barLabel * u, 500), p.dim, w, S.barLabel * u * 1.3, 2);
        const carried = a.carry.includes(b.label);
        const q = carried ? 1 : ease(a.age / 0.7 - (carried ? 0 : 0));
        const fade = carried ? 1 : clamp(a.age * 3);
        blocks.push({
          h: lb.h + u * 0.5 + bh,
          draw: (x, y) => {
            const ga = ctx.globalAlpha;
            ctx.globalAlpha = ga * fade;
            lb.draw(x, y);
            const yy = y + lb.h + u * 0.5;
            ctx.fillStyle = toneColor(brand, b.tone, p.mid);
            roundRect(ctx, x, yy, Math.max(u * 0.4, (trackW * b.value * q) / max), bh, bh * 0.2);
            ctx.fill();
            ctx.font = vf;
            ctx.fillStyle = p.ink;
            ctx.textBaseline = "middle";
            ctx.fillText(nairaShort(b.value * q), x + (trackW * b.value * q) / max + u * 1.2, yy + bh / 2);
            ctx.globalAlpha = ga;
          },
        });
        if (i < bars.length - 1) blocks.push({ h: gap * 0.3, draw: () => {} });
      });
      break;
    }
    case "formula": {
      const parts = card.parts ?? [];
      const fs = fitSize(ctx, brand, "display", 800, parts.join("  ").toUpperCase(), S.formula * u, w, 2, S.formula * u * 0.5);
      ctx.font = display(fs, 800);
      const gapX = fs * 0.35;
      const rows: { x: number; row: number; t: string; i: number }[] = [];
      let cx = 0;
      let row = 0;
      parts.forEach((t, i) => {
        const tw = ctx.measureText(t.toUpperCase()).width;
        if (cx > 0 && cx + tw > w) {
          row++;
          cx = 0;
        }
        rows.push({ x: cx, row, t: t.toUpperCase(), i });
        cx += tw + gapX;
      });
      blocks.push({
        h: (row + 1) * fs * 1.12,
        draw: (x, y) => {
          ctx.font = display(fs, 800);
          ctx.textBaseline = "top";
          for (const r of rows) {
            const isOp = parts[r.i].length <= 1;
            const isRes = r.i === parts.length - 1;
            ctx.fillStyle = isOp ? p.accent : isRes ? p.accent2 : p.ink;
            const ga = ctx.globalAlpha;
            ctx.globalAlpha = ga * clamp(a.age * 4 - r.i * 0.55);
            ctx.fillText(r.t, x + r.x, y + r.row * fs * 1.12);
            ctx.globalAlpha = ga;
          }
        },
      });
      if (card.label) sub(card.label);
      break;
    }
    case "steps":
    case "list": {
      if (card.label) kicker(card.label);
      const items = card.steps ?? [];
      const bs = S.badge * u;
      items.forEach((it, i) => {
        const tb = textBlock(ctx, it, body(S.step * u, 600), p.ink, w - bs - u * 1.6, S.step * u * 1.2, 2);
        const h = Math.max(bs, tb.h);
        blocks.push({
          h,
          draw: (x, y) => {
            const q = clamp(a.age * 3 - i * 0.7);
            const ga = ctx.globalAlpha;
            ctx.globalAlpha = ga * q;
            const dx = (1 - ease(q)) * u * 2;
            if (card.type === "steps") {
              ctx.fillStyle = p.accent;
              ctx.beginPath();
              ctx.arc(x + dx + bs / 2, y + h / 2, bs / 2, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = readableOn(p.accent);
              ctx.font = display(bs * 0.55);
              ctx.textBaseline = "middle";
              ctx.textAlign = "center";
              ctx.fillText(String(i + 1), x + dx + bs / 2, y + h / 2 + bs * 0.03);
              ctx.textAlign = "left";
            } else {
              ctx.fillStyle = p.accent;
              ctx.fillRect(x + dx + bs * 0.3, y + h / 2 - bs * 0.12, bs * 0.24, bs * 0.24);
            }
            tb.draw(x + dx + bs + u * 1.4, y + (h - tb.h) / 2);
            ctx.globalAlpha = ga;
          },
        });
      });
      break;
    }
    case "dodont": {
      const colW = (w - gap) / 2;
      const pad = u * (mode === "landscape" ? 1.6 : 3);
      const mk = (head: string, text: string, color: string) => {
        const hb = textBlock(ctx, head.toUpperCase(), display(S.dodontHead * u), color, colW - pad * 2, S.dodontHead * u, 1);
        const tb = textBlock(ctx, text, body(S.dodont * u, 600), p.ink, colW - pad * 2, S.dodont * u * 1.25, 5);
        return { hb, tb, h: hb.h + u * 0.8 + tb.h + pad * 2 };
      };
      const A = mk("Legal", card.doText ?? "", p.good);
      const B = mk("Not legal", card.dontText ?? "", p.bad);
      const h = Math.max(A.h, B.h);
      blocks.push({
        h,
        draw: (x, y) => {
          const box = (bx: number, m: typeof A, color: string, q: number) => {
            const ga = ctx.globalAlpha;
            ctx.globalAlpha = ga * q;
            ctx.fillStyle = withAlpha(color, 0.13);
            ctx.strokeStyle = withAlpha(color, 0.55);
            ctx.lineWidth = Math.max(1, u * 0.12);
            roundRect(ctx, bx, y, colW, h, u * 1.2);
            ctx.fill();
            ctx.stroke();
            m.hb.draw(bx + pad, y + pad);
            m.tb.draw(bx + pad, y + pad + m.hb.h + u * 0.8);
            ctx.globalAlpha = ga;
          };
          box(x, A, p.good, 1);
          box(x + colW + gap, B, p.bad, clamp(a.age * 2.5 - 0.6));
        },
      });
      break;
    }
    case "image": {
      const img = a.image;
      if (img) {
        const iw = (img as any).width || 1;
        const ih = (img as any).height || 1;
        const maxH = a.h * 0.72;
        const s = Math.min(w / iw, maxH / ih);
        blocks.push({
          h: ih * s,
          draw: (x, y) => {
            ctx.save();
            roundRect(ctx, x, y, iw * s, ih * s, u);
            ctx.clip();
            ctx.drawImage(img, x, y, iw * s, ih * s);
            ctx.restore();
          },
        });
      }
      if (card.label) label(card.label);
      if (card.sub) sub(card.sub);
      break;
    }
  }

  const total = blocks.reduce((s, b) => s + b.h, 0) + gap * Math.max(0, blocks.length - 1);
  let y = a.y + Math.max(0, (a.h - total) / 2);
  const lift = (1 - ease(prog * 1.6)) * u * 2.2;
  y += lift;
  for (const b of blocks) {
    b.draw(a.x, y);
    y += b.h + gap;
  }
}
