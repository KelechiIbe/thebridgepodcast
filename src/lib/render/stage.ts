// The stage: everything a viewer sees, drawn on one canvas as a pure function of time.
// Used for the in-app preview, MP4 export and the exported interactive player.

import type { Card, Character, Persona, Script, Show } from "../../shared/types";
import { cardAt, chapterAt, lastLineBefore, lineAt, type Timeline, type TLCard, type TLLine } from "../../shared/timeline";
import { clock } from "../../shared/captions";
import { drawCard, cardSizes } from "./cards";
import { drawScene, stageMode, type StageMode } from "./scenes";
import { clamp, ease, fitSize, font, mix, readableOn, roundRect, withAlpha, wrap } from "./text";

export interface StageImages {
  logo: CanvasImageSource | null;
  background: CanvasImageSource | null;
  qr: CanvasImageSource | null;
  portraits: Record<string, CanvasImageSource | null>;
  cards: Record<string, CanvasImageSource | null>;
}

export interface StageModel {
  show: Show;
  characters: Character[];
  script: Script;
  timeline: Timeline;
  episodeNumber: number;
  /** Voice and music envelopes, values 0..1 at `fps`. */
  envVoice: number[];
  envMusic: number[];
  fps: number;
  images: StageImages;
  draft: boolean;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  mode: StageMode;
  u: number;
  pad: number;
  top: number;
  speak: Box;
  card: Box;
  capBottom: number;
  capW: number;
  capSize: number;
  seat: number;
}

function layout(W: number, H: number, showSpeakers: boolean): Layout {
  const mode = stageMode(W, H);
  const u = W / 100;
  if (mode === "landscape") {
    const card = showSpeakers ? { x: 47.8 * u, y: 8 * u, w: 49 * u, h: 28.5 * u } : { x: 3.2 * u, y: 9 * u, w: 70 * u, h: 30 * u };
    return { mode, u, pad: 3.2 * u, top: 2.6 * u, speak: { x: 3.2 * u, y: 9 * u, w: 40 * u, h: 27 * u }, card, capBottom: H - 2.8 * u, capW: 93.6 * u, capSize: 2.55 * u, seat: 13 * u };
  }
  if (mode === "square") {
    return { mode, u, pad: 5 * u, top: 4.2 * u, speak: { x: 5 * u, y: 12 * u, w: 90 * u, h: 24 * u }, card: { x: 5 * u, y: showSpeakers ? 39 * u : 16 * u, w: 90 * u, h: showSpeakers ? 31 * u : 50 * u }, capBottom: H - 4 * u, capW: 90 * u, capSize: 3.9 * u, seat: 17 * u };
  }
  if (mode === "portrait") {
    return { mode, u, pad: 5 * u, top: 4.5 * u, speak: { x: 5 * u, y: 12 * u, w: 90 * u, h: 30 * u }, card: { x: 5 * u, y: showSpeakers ? 43 * u : 16 * u, w: 90 * u, h: showSpeakers ? 42 * u : 64 * u }, capBottom: H - 4 * u, capW: 90 * u, capSize: 4.6 * u, seat: 19 * u };
  }
  return { mode, u, pad: 5 * u, top: 4.5 * u, speak: { x: 5 * u, y: 14 * u, w: 90 * u, h: 42 * u }, card: { x: 5 * u, y: showSpeakers ? 60 * u : 20 * u, w: 90 * u, h: showSpeakers ? 52 * u : 80 * u }, capBottom: H - 8 * u, capW: 90 * u, capSize: 5.3 * u, seat: 25 * u };
}

export class StageRenderer {
  private personaById: Map<string, Persona>;
  private charById: Map<string, Character>;
  private seats: Character[];
  private waveCache = new Map<string, number[]>();

  constructor(public model: StageModel) {
    this.personaById = new Map(model.script.personas.map((p) => [p.id, p]));
    this.charById = new Map(model.characters.map((c) => [c.id, c]));
    const speaking = new Set(model.script.lines.filter((l) => l.kind !== "voicenote").map((l) => l.speaker));
    this.seats = model.characters
      .filter((c) => c.kind !== "listener" && speaking.has(c.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, 4);
  }

  private env(arr: number[], t: number) {
    const i = Math.floor(t * this.model.fps);
    return i >= 0 && i < arr.length ? arr[i] : 0;
  }

  speakerName(id: string): string {
    return this.charById.get(id)?.name ?? this.personaById.get(id)?.name ?? "";
  }

  render(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
    const { show, timeline } = this.model;
    const brand = show.brand;
    const L = layout(W, H, show.layout.showSpeakers);
    const ve = this.env(this.model.envVoice, t);
    const me = this.env(this.model.envMusic, t);
    ctx.save();
    ctx.textAlign = "left";
    drawScene(ctx, W, H, t, brand, ve, me, this.model.images.background);

    const endP = clamp((t - timeline.endCard.t) / 0.7);
    if (endP < 1) {
      ctx.globalAlpha = 1 - endP;
      this.drawHeader(ctx, W, L, t);
      const line = lineAt(timeline, t) ?? lastLineBefore(timeline, t);
      if (show.layout.showSpeakers) this.drawSpeakers(ctx, L, t, line, ve);
      this.drawCardZone(ctx, L, t);
      if (show.layout.showCaptions) this.drawCaptions(ctx, L, t);
      ctx.globalAlpha = 1;
    }
    if (endP > 0) this.drawEndCard(ctx, W, H, L, ease(endP));
    if (show.layout.showProgress) {
      ctx.fillStyle = withAlpha(brand.palette.ink, 0.12);
      ctx.fillRect(0, H - L.u * 0.5, W, L.u * 0.5);
      ctx.fillStyle = brand.palette.accent;
      ctx.fillRect(0, H - L.u * 0.5, (W * clamp(t / timeline.duration)), L.u * 0.5);
    }
    if (this.model.draft) this.drawWatermark(ctx, W, H, L);
    ctx.restore();
  }

  private drawHeader(ctx: CanvasRenderingContext2D, W: number, L: Layout, t: number) {
    const { brand, layout: lay } = this.model.show;
    const p = brand.palette;
    const u = L.u;
    const big = L.mode === "landscape" ? 2.6 * u : L.mode === "square" ? 4 * u : 5.2 * u;
    const small = L.mode === "landscape" ? 1.2 * u : L.mode === "square" ? 1.9 * u : 2.3 * u;
    let x = L.pad;
    const yMid = L.top + big * 0.5;
    const logo = lay.showLogo ? this.model.images.logo : null;
    if (logo) {
      const iw = (logo as any).width || 1;
      const ih = (logo as any).height || 1;
      const h = big * 1.25;
      const w = (iw / ih) * h;
      ctx.drawImage(logo, x, yMid - h / 2, w, h);
      x += w + u * 1.2;
    }
    if (brand.wordmark) {
      ctx.font = font(brand, "display", 900, big);
      ctx.fillStyle = p.accent;
      ctx.textBaseline = "middle";
      const text = brand.wordmark.toUpperCase();
      ctx.fillText(text, x, yMid);
      x += ctx.measureText(text).width + u * 0.9;
      if (brand.byline && L.mode === "landscape") {
        ctx.font = font(brand, "mono", 500, 1.05 * u);
        ctx.fillStyle = p.dim;
        const b = brand.byline.toUpperCase();
        ctx.fillText(b, x, yMid + u * 0.3);
        x += ctx.measureText(b).width + u * 1.6;
      }
    }
    let right = W - L.pad;
    if (lay.showBadge && brand.badge) {
      ctx.font = font(brand, "mono", 500, small * 0.9);
      const bw = ctx.measureText(brand.badge.toUpperCase()).width + small * 1.6;
      const bh = small * 2;
      ctx.strokeStyle = withAlpha(p.ink, 0.35);
      ctx.lineWidth = Math.max(1, u * 0.1);
      roundRect(ctx, right - bw, yMid - bh / 2, bw, bh, bh / 2);
      ctx.stroke();
      ctx.fillStyle = p.ink;
      ctx.textBaseline = "middle";
      ctx.fillText(brand.badge.toUpperCase(), right - bw + small * 0.8, yMid + u * 0.05);
      right -= bw + u * 1.5;
    }
    if (lay.showChapterLabel) {
      const ch = chapterAt(this.model.timeline, t);
      const label = ch.n === 0 ? `Episode ${this.model.episodeNumber}` : `Part ${ch.n} · ${ch.title}`;
      ctx.font = font(brand, "mono", 500, small);
      ctx.fillStyle = p.dim;
      ctx.textBaseline = "middle";
      let text = label.toUpperCase();
      const room = right - x;
      while (text.length > 4 && ctx.measureText(text).width > room) text = text.slice(0, -2).trimEnd() + "…";
      if (room > u * 6) ctx.fillText(text, x, yMid + u * 0.15);
    }
  }

  private drawSpeakers(ctx: CanvasRenderingContext2D, L: Layout, t: number, line: TLLine | null, ve: number) {
    const { brand, layout: lay } = this.model.show;
    const p = brand.palette;
    const u = L.u;
    const vnActive = line && line.kind === "voicenote" && t <= line.e + 0.5;
    let seatAlpha = 1;
    if (vnActive) {
      const pIn = clamp((t - (line!.s - 0.35)) / 0.35);
      const pOut = clamp((t - line!.e - 0.15) / 0.35);
      const shown = ease(pIn) * (1 - pOut);
      seatAlpha = 1 - shown;
      this.drawVoiceNote(ctx, L, t, line!, shown);
    }
    if (seatAlpha <= 0.01 || !this.seats.length) return;
    const n = this.seats.length;
    const box = L.speak;
    const nameSize = L.mode === "landscape" ? 1.9 * u : L.mode === "square" ? 2.6 * u : 3.6 * u;
    const roleSize = nameSize * 0.62;
    const seat = Math.min(L.seat, (box.w - (n - 1) * 3 * u) / n / 1.3, box.h - nameSize * 3.2);
    const cellW = Math.min(box.w / n, seat * 1.35 + 3 * u);
    const totalW = cellW * n;
    const startX = L.mode === "landscape" ? box.x : box.x + (box.w - totalW) / 2;
    const cy = box.y + (box.h - (seat + nameSize * 2.6)) / 2 + seat / 2;
    this.seats.forEach((c, i) => {
      const cx = startX + cellW * i + cellW / 2;
      const speaking = !!line && line.speaker === c.id && t <= line.e + 0.4;
      const talking = speaking && t <= line!.e;
      const active = speaking || !line;
      ctx.save();
      ctx.globalAlpha *= seatAlpha * (active ? 1 : 0.42);
      const e = talking ? ve : 0;
      const r = (seat / 2) * (1 + 0.07 * e);
      if (talking) {
        ctx.strokeStyle = withAlpha(c.color, 0.9 * e);
        ctx.lineWidth = Math.max(1.5, u * 0.25);
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.12 + e * u * 0.6, 0, Math.PI * 2);
        ctx.stroke();
        const ph = (t * 0.9) % 1;
        ctx.strokeStyle = withAlpha(c.color, (1 - ph) * 0.45);
        ctx.beginPath();
        ctx.arc(cx, cy, r * (1.12 + ph * 0.38), 0, Math.PI * 2);
        ctx.stroke();
      }
      const img = lay.speakerStyle === "portrait" ? this.model.images.portraits[c.id] : null;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      if (img) {
        const iw = (img as any).width || 1;
        const ih = (img as any).height || 1;
        const s = Math.max((2 * r) / iw, (2 * r) / ih);
        ctx.drawImage(img, cx - (iw * s) / 2, cy - (ih * s) / 2, iw * s, ih * s);
      } else {
        const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
        g.addColorStop(0, mix(c.color, "#FFFFFF", 0.35));
        g.addColorStop(1, mix(c.color, "#000000", 0.12));
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
        const initials = c.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
        ctx.fillStyle = readableOn(c.color);
        ctx.font = font(brand, "display", 900, r * 0.85);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initials, cx, cy + r * 0.04);
        ctx.textAlign = "left";
      }
      ctx.restore();
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.font = font(brand, "body", 700, nameSize);
      ctx.fillStyle = p.ink;
      ctx.fillText(c.name, cx, cy + seat / 2 + nameSize * 0.7, cellW * 1.1);
      ctx.font = font(brand, "body", 400, roleSize);
      ctx.fillStyle = p.dim;
      const roleLines = wrap(ctx, c.role, cellW * 0.98).slice(0, 2);
      roleLines.forEach((rl, k) => ctx.fillText(rl, cx, cy + seat / 2 + nameSize * 1.95 + k * roleSize * 1.25, cellW));
      ctx.textAlign = "left";
      ctx.restore();
    });
  }

  private wave(line: TLLine): number[] {
    const hit = this.waveCache.get(line.id);
    if (hit) return hit;
    const NB = 34;
    const dur = Math.max(0.1, line.e - line.s);
    const out: number[] = [];
    for (let i = 0; i < NB; i++) {
      let m = 0;
      for (let k = 0; k < 4; k++) m = Math.max(m, this.env(this.model.envVoice, line.s + ((i + k / 4) / NB) * dur));
      out.push(0.15 + 0.85 * Math.pow(m, 0.8));
    }
    this.waveCache.set(line.id, out);
    return out;
  }

  private drawVoiceNote(ctx: CanvasRenderingContext2D, L: Layout, t: number, line: TLLine, shown: number) {
    if (shown <= 0.01) return;
    const { brand } = this.model.show;
    const u = L.u;
    const persona = this.personaById.get(line.speaker);
    const name = persona?.name ?? this.speakerName(line.speaker) ?? "Listener";
    const role = persona?.role ?? "";
    const color = persona?.color ?? brand.palette.accent;
    const k = L.mode === "landscape" ? 1 : L.mode === "square" ? 1.45 : 1.95;
    const box = L.speak;
    const w = L.mode === "landscape" ? 40 * u : box.w;
    const padX = 2 * u * k;
    const av = 5.2 * u * k;
    const h = av + 4.4 * u * k + padX * 2 + 1.2 * u * k;
    const x = box.x;
    const y = box.y + (box.h - h) / 2 + (1 - shown) * 3 * u;
    ctx.save();
    ctx.globalAlpha *= shown;
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 3 * u;
    ctx.shadowOffsetY = 1.4 * u;
    ctx.fillStyle = "#F4F0E6";
    const r = 2.2 * u * k;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, 0.5 * u * k);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = "transparent";
    // header
    const ax = x + padX;
    const ay = y + padX;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ax + av / 2, ay + av / 2, av / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = readableOn(color);
    ctx.font = font(brand, "display", 900, av * 0.5);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name[0]?.toUpperCase() ?? "?", ax + av / 2, ay + av / 2 + av * 0.03);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const tx = ax + av + 1.2 * u * k;
    ctx.fillStyle = "#142224";
    ctx.font = font(brand, "body", 700, 1.9 * u * k);
    ctx.fillText(name, tx, ay + av * 0.12, w - (tx - x) - 9 * u * k);
    ctx.fillStyle = "#4B5B59";
    ctx.font = font(brand, "body", 400, 1.2 * u * k);
    ctx.fillText(role, tx, ay + av * 0.12 + 2.4 * u * k, w - (tx - x) - padX);
    ctx.font = font(brand, "mono", 500, 1 * u * k);
    const tag = "VOICE NOTE";
    ctx.fillText(tag, x + w - padX - ctx.measureText(tag).width, ay);
    // waveform row
    const rowY = ay + av + 1.2 * u * k;
    const rowH = 4.4 * u * k;
    const pb = 3.4 * u * k;
    const playing = t < line.e;
    ctx.fillStyle = "#142224";
    ctx.beginPath();
    ctx.arc(ax + pb / 2, rowY + rowH / 2, pb / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#F4F0E6";
    if (playing) {
      ctx.fillRect(ax + pb * 0.33, rowY + rowH / 2 - pb * 0.18, pb * 0.11, pb * 0.36);
      ctx.fillRect(ax + pb * 0.56, rowY + rowH / 2 - pb * 0.18, pb * 0.11, pb * 0.36);
    } else {
      ctx.beginPath();
      ctx.moveTo(ax + pb * 0.4, rowY + rowH / 2 - pb * 0.2);
      ctx.lineTo(ax + pb * 0.72, rowY + rowH / 2);
      ctx.lineTo(ax + pb * 0.4, rowY + rowH / 2 + pb * 0.2);
      ctx.fill();
    }
    const timeW = 4.2 * u * k;
    const bx0 = ax + pb + 0.9 * u * k;
    const bw = x + w - padX - timeW - 0.9 * u * k - bx0;
    const bars = this.wave(line);
    const prog = clamp((t - line.s) / Math.max(0.1, line.e - line.s));
    const slot = bw / bars.length;
    bars.forEach((v, i) => {
      ctx.fillStyle = i / bars.length < prog ? "#1D7F55" : "#B9C3C0";
      const bh = Math.max(0.4 * u, rowH * v);
      roundRect(ctx, bx0 + i * slot + slot * 0.15, rowY + (rowH - bh) / 2, slot * 0.7, bh, slot * 0.35);
      ctx.fill();
    });
    ctx.fillStyle = "#4B5B59";
    ctx.font = font(brand, "mono", 500, 1.2 * u * k);
    ctx.textBaseline = "middle";
    const tt = clock(playing ? t - line.s : line.e - line.s);
    ctx.fillText(tt, x + w - padX - ctx.measureText(tt).width, rowY + rowH / 2);
    ctx.restore();
  }

  private chapterCard(t: number): { card: Card; tl: TLCard } {
    const ch = chapterAt(this.model.timeline, t);
    const isFirst = ch.n === 0;
    const card: Card = {
      id: `chapter-${ch.id}`,
      lineId: "",
      anchor: "",
      type: "stat",
      big: isFirst ? this.model.script.title : ch.title,
    };
    return { card, tl: { card, t: isFirst ? -10 : ch.t, end: ch.end, carry: [], max: 0 } };
  }

  private drawCardZone(ctx: CanvasRenderingContext2D, L: Layout, t: number) {
    const { brand } = this.model.show;
    const hit = cardAt(this.model.timeline, t);
    let card: Card;
    let tl: TLCard;
    let kicker: string | null = null;
    if (hit) {
      card = hit.card;
      tl = hit;
    } else {
      const c = this.chapterCard(t);
      card = c.card;
      tl = c.tl;
      const ch = chapterAt(this.model.timeline, t);
      kicker = ch.n === 0 ? `Episode ${this.model.episodeNumber}` : ch.cue === "outro" ? "Sign-off" : `Part ${ch.n}`;
    }
    const age = t - tl.t;
    const appear = ease(clamp(age / 0.6) * 1.6);
    const out = clamp((t - (tl.end - 0.3)) / 0.3);
    const alpha = appear * (1 - out);
    if (alpha <= 0.005) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    const box = L.card;
    if (kicker) {
      // chapter title card: kicker above a big title
      const u = L.u;
      const S = cardSizes(L.mode);
      const title = (card.big ?? "").toUpperCase();
      const size = fitSize(ctx, brand, "display", 900, title, S.big * u * 0.78, box.w, 3, S.big * u * 0.3);
      ctx.font = font(brand, "display", 900, size);
      const lines = wrap(ctx, title, box.w).slice(0, 3);
      const kh = S.kicker * u * 1.6;
      const total = kh + lines.length * size * 0.94;
      let y = box.y + Math.max(0, (box.h - total) / 2) + (1 - appear) * u * 2;
      ctx.font = font(brand, "mono", 500, S.kicker * u);
      ctx.fillStyle = brand.palette.dim;
      ctx.textBaseline = "top";
      ctx.fillText(kicker.toUpperCase(), box.x, y);
      y += kh;
      ctx.font = font(brand, "display", 900, size);
      ctx.fillStyle = brand.palette.accent;
      lines.forEach((ln, i) => ctx.fillText(ln, box.x, y + i * size * 0.94));
    } else {
      drawCard({
        ctx,
        card,
        brand,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        u: L.u,
        mode: L.mode,
        age,
        carry: tl.carry,
        max: tl.max,
        image: this.model.images.cards[card.id] ?? null,
      });
    }
    ctx.restore();
  }

  private drawCaptions(ctx: CanvasRenderingContext2D, L: Layout, t: number) {
    const { brand, layout: lay } = this.model.show;
    const p = brand.palette;
    const tl = this.model.timeline;
    let line = lineAt(tl, t);
    let fade = 1;
    if (!line) {
      const prev = lastLineBefore(tl, t);
      if (prev && t - prev.e < 0.7) {
        line = prev;
        fade = 1 - (t - prev.e) / 0.7;
      }
    }
    if (!line || !line.pages.length) return;
    let pi = 0;
    line.pages.forEach((pg, i) => {
      if (t >= pg.s - 0.08) pi = i;
    });
    const page = line.pages[pi];
    const words = page.idx.map((k) => line!.words[k]);
    const size = L.capSize;
    ctx.save();
    ctx.globalAlpha *= fade;
    ctx.font = font(brand, "body", 600, size);
    // lay words out into lines
    const space = ctx.measureText(" ").width;
    const rows: { w: (typeof words)[number]; x: number; width: number }[][] = [[]];
    let x = 0;
    for (const w of words) {
      const width = ctx.measureText(w.w).width;
      if (x > 0 && x + width > L.capW) {
        rows.push([]);
        x = 0;
      }
      rows[rows.length - 1].push({ w, x, width });
      x += width + space;
    }
    const lh = size * 1.32;
    const labelSize = size * 0.45;
    const blockH = rows.length * lh;
    const y0 = L.capBottom - blockH;
    if (lay.captionStyle === "boxed") {
      const maxW = Math.max(...rows.map((r) => (r.length ? r[r.length - 1].x + r[r.length - 1].width : 0)));
      ctx.fillStyle = withAlpha(p.bg, 0.78);
      roundRect(ctx, L.pad - size * 0.5, y0 - size * 0.35, maxW + size, blockH + size * 0.5, size * 0.4);
      ctx.fill();
    }
    // speaker label
    const persona = this.personaById.get(line.speaker);
    const name = this.speakerName(line.speaker);
    const label = (persona ? `${name} · voice note` : name).toUpperCase();
    ctx.font = font(brand, "mono", 500, labelSize);
    ctx.fillStyle = persona ? p.accent2 : p.accent;
    ctx.textBaseline = "bottom";
    if ("letterSpacing" in ctx) (ctx as any).letterSpacing = `${(labelSize * 0.12).toFixed(1)}px`;
    ctx.fillText(label, L.pad, y0 - size * (lay.captionStyle === "boxed" ? 0.55 : 0.3));
    if ("letterSpacing" in ctx) (ctx as any).letterSpacing = "0px";
    ctx.font = font(brand, "body", 600, size);
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = size * 0.45;
    ctx.shadowOffsetY = size * 0.08;
    rows.forEach((row, ri) => {
      for (const item of row) {
        const said = t >= item.w.s;
        const now = said && t < item.w.e + 0.05;
        if (lay.captionStyle === "karaoke") ctx.fillStyle = now ? p.accent : said ? p.ink : withAlpha(p.ink, 0.38);
        else ctx.fillStyle = p.ink;
        ctx.fillText(item.w.w, L.pad + item.x, y0 + ri * lh);
      }
    });
    ctx.restore();
  }

  private drawEndCard(ctx: CanvasRenderingContext2D, W: number, H: number, L: Layout, p: number) {
    const { brand, endCard } = this.model.show;
    const pal = brand.palette;
    const u = L.u;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.fillStyle = withAlpha(pal.bg, 0.72);
    ctx.fillRect(0, 0, W, H);
    const landscape = L.mode === "landscape";
    const qr = endCard.showQr ? this.model.images.qr : null;
    const qrSize = qr ? (landscape ? 24 * u : 46 * u) : 0;
    const textW = landscape && qr ? W - L.pad * 2 - qrSize - 6 * u : W - L.pad * 2;
    const S = landscape ? 1 : L.mode === "square" ? 1.5 : 2;
    const logo = this.model.images.logo;
    const blocks: { h: number; draw: (y: number) => void }[] = [];
    if (logo) {
      const iw = (logo as any).width || 1;
      const ih = (logo as any).height || 1;
      const h = 6 * u * S;
      blocks.push({ h, draw: (y) => ctx.drawImage(logo, L.pad, y, (iw / ih) * h, h) });
    } else if (brand.wordmark) {
      const s = 4 * u * S;
      blocks.push({
        h: s,
        draw: (y) => {
          ctx.font = font(brand, "display", 900, s);
          ctx.fillStyle = pal.accent;
          ctx.textBaseline = "top";
          ctx.fillText(brand.wordmark.toUpperCase(), L.pad, y);
        },
      });
    }
    const head = endCard.headline.toUpperCase();
    const hs = fitSize(ctx, brand, "display", 900, head, 8 * u * S, textW, 2, 3 * u * S);
    ctx.font = font(brand, "display", 900, hs);
    const headLines = wrap(ctx, head, textW);
    blocks.push({
      h: headLines.length * hs * 0.95,
      draw: (y) => {
        ctx.font = font(brand, "display", 900, hs);
        ctx.fillStyle = pal.ink;
        ctx.textBaseline = "top";
        headLines.forEach((l, i) => ctx.fillText(l, L.pad, y + i * hs * 0.95));
      },
    });
    const ss = 2.2 * u * S;
    ctx.font = font(brand, "body", 500, ss);
    const subLines = wrap(ctx, endCard.sub, textW).slice(0, 3);
    blocks.push({
      h: subLines.length * ss * 1.35,
      draw: (y) => {
        ctx.font = font(brand, "body", 500, ss);
        ctx.fillStyle = pal.dim;
        subLines.forEach((l, i) => ctx.fillText(l, L.pad, y + i * ss * 1.35));
      },
    });
    if (endCard.url) {
      const us = 1.7 * u * S;
      blocks.push({
        h: us * 1.3,
        draw: (y) => {
          ctx.font = font(brand, "mono", 500, us);
          ctx.fillStyle = pal.accent;
          ctx.fillText(endCard.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), L.pad, y);
        },
      });
    }
    const gap = 2.2 * u * S;
    const total = blocks.reduce((s, b) => s + b.h, 0) + gap * (blocks.length - 1);
    const areaTop = landscape ? 0 : qr ? H * 0.08 : 0;
    const areaH = landscape || !qr ? H : H * 0.5;
    let y = areaTop + (areaH - total) / 2 + (1 - p) * 3 * u;
    for (const b of blocks) {
      b.draw(y);
      y += b.h + gap;
    }
    if (qr) {
      const qx = landscape ? W - L.pad - qrSize : (W - qrSize) / 2;
      const qy = landscape ? (H - qrSize) / 2 : H * 0.58 + (H * 0.36 - qrSize) / 2;
      ctx.fillStyle = "#FFFFFF";
      roundRect(ctx, qx - u, qy - u, qrSize + 2 * u, qrSize + 2 * u, u);
      ctx.fill();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(qr, qx, qy, qrSize, qrSize);
      ctx.imageSmoothingEnabled = true;
    }
    ctx.restore();
  }

  private drawWatermark(ctx: CanvasRenderingContext2D, W: number, H: number, L: Layout) {
    const { brand } = this.model.show;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.atan2(H, W) * 0.6);
    ctx.font = font(brand, "display", 900, Math.min(W, H) * 0.12);
    ctx.fillStyle = withAlpha(brand.palette.ink, 0.08);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("DRAFT · NOT APPROVED", 0, 0);
    ctx.restore();
    void L;
  }
}
