// Stand-alone interactive player embedded in exported episode pages.
// Reads window.__BRIDGE__ and builds the page: stage, transport, quiz pauses, chapters, calculators, transcript.

import { StageRenderer, type StageModel } from "../lib/render/stage";
import { chapterAt, lineAt, type Timeline } from "../shared/timeline";
import { clock } from "../shared/captions";
import { companyRouteTax, naira, personalIncomeTax, vatOnCommission } from "../shared/tax";
import type { Widget } from "../shared/types";
import { playerCss } from "./style";

export interface PlayerData {
  model: Omit<StageModel, "images">;
  images: { logo?: string; background?: string; qr?: string; portraits: Record<string, string>; cards: Record<string, string> };
  audio: string;
  fonts: { google: string[]; uploads: { family: string; url: string; weight?: string }[] };
  showName: string;
  tagline: string;
  disclosure: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

async function bitmap(url?: string): Promise<ImageBitmap | null> {
  if (!url) return null;
  try {
    const blob = await (await fetch(url)).blob();
    try {
      return await createImageBitmap(blob);
    } catch {
      // SVG: let an <img> decode it, then copy it onto a canvas
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || 1000;
      c.height = img.naturalHeight || 1000;
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      return await createImageBitmap(c);
    }
  } catch {
    return null;
  }
}

async function boot(data: PlayerData) {
  const m = data.model;
  const p = m.show.brand.palette;
  document.title = `${data.showName} · Episode ${m.episodeNumber}`;
  const style = el("style");
  style.textContent = playerCss(p, m.show.brand.fonts);
  document.head.append(style);
  if (data.fonts.google.length) {
    const link = el("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${data.fonts.google.map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700;800;900`).join("&")}&display=swap`;
    document.head.append(link);
  }
  for (const f of data.fonts.uploads) {
    try {
      const face = new FontFace(f.family, `url(${f.url})`, { weight: f.weight ?? "100 900" });
      document.fonts.add(await face.load());
    } catch {
      /* fall back to system fonts */
    }
  }

  const images = {
    logo: await bitmap(data.images.logo),
    background: await bitmap(data.images.background),
    qr: await bitmap(data.images.qr),
    portraits: Object.fromEntries(await Promise.all(Object.entries(data.images.portraits).map(async ([k, v]) => [k, await bitmap(v)]))),
    cards: Object.fromEntries(await Promise.all(Object.entries(data.images.cards).map(async ([k, v]) => [k, await bitmap(v)]))),
  };
  const model: StageModel = { ...m, images };
  const stage = new StageRenderer(model);
  const tl: Timeline = m.timeline;

  const root = el("div", "wrap");
  document.body.append(root);
  const mast = el("header", "mast");
  mast.append(el("div", "eyebrow", data.tagline), el("h1", "show", data.showName), el("div", "ep", `Episode ${m.episodeNumber} · ${m.script.title}`));
  if (m.script.summary) mast.append(el("p", "summary", m.script.summary));
  root.append(mast);

  const stageWrap = el("div", "stage");
  const canvas = el("canvas");
  stageWrap.append(canvas);
  const poster = el("button", "bigplay");
  poster.type = "button";
  poster.innerHTML = `<i></i><span>Play episode · ${clock(tl.duration)}</span>`;
  stageWrap.append(poster);
  const poll = el("div", "poll");
  poll.hidden = true;
  stageWrap.append(poll);
  root.append(stageWrap);

  const transport = el("div", "transport");
  const pp = el("button", "pp");
  pp.type = "button";
  pp.setAttribute("aria-label", "Play");
  const scrubWrap = el("div", "scrub");
  const seek = el("input");
  seek.type = "range";
  seek.min = "0";
  seek.max = String(Math.round(tl.duration * 10));
  seek.value = "0";
  seek.setAttribute("aria-label", "Seek");
  const ticks = el("div", "ticks");
  tl.chapters.slice(1).forEach((c) => {
    const i = el("i");
    i.style.left = `${(c.t / tl.duration) * 100}%`;
    ticks.append(i);
  });
  tl.polls.forEach((q) => {
    const b = el("b");
    b.style.left = `${(q.t / tl.duration) * 100}%`;
    ticks.append(b);
  });
  scrubWrap.append(seek, ticks);
  const time = el("div", "time", `0:00 / ${clock(tl.duration)}`);
  transport.append(pp, scrubWrap, time);
  root.append(transport);

  const opts = el("div", "opts");
  const chip = (label: string, on: boolean) => {
    const b = el("button", "chip");
    b.type = "button";
    b.setAttribute("aria-pressed", String(on));
    b.innerHTML = `<span class="dot"></span>${label}`;
    return b;
  };
  const quizChip = chip("Quiz pauses", tl.polls.length > 0);
  const capChip = chip("Captions", m.show.layout.showCaptions);
  const speedChip = el("button", "chip", "Speed 1×");
  speedChip.type = "button";
  const score = el("span", "score", tl.polls.length ? `Quiz score 0 / ${tl.polls.length}` : "");
  if (tl.polls.length) opts.append(quizChip);
  opts.append(capChip, speedChip, score);
  root.append(opts);

  const cols = el("div", "cols");
  const chapSec = el("section", "sec");
  chapSec.append(el("h2", null as any, "In this episode"));
  const chapList = el("div", "chapters");
  chapSec.append(chapList);
  cols.append(chapSec);
  const widgets = m.script.widgets ?? [];
  if (widgets.length) {
    const calcSec = el("section", "sec");
    calcSec.append(el("h2", null as any, "Run your own numbers"));
    widgets.forEach((w) => calcSec.append(widget(w)));
    cols.append(calcSec);
  }
  root.append(cols);

  const txSec = el("section", "sec");
  txSec.append(el("h2", null as any, "Transcript"), el("p", "lede", "Tap any line to hear it."));
  const tx = el("div", "transcript");
  txSec.append(tx);
  root.append(txSec);
  const foot = el("footer", "foot");
  const cta = el("div");
  cta.innerHTML = `<b></b> <span></span> `;
  (cta.querySelector("b") as HTMLElement).textContent = m.show.endCard.headline;
  (cta.querySelector("span") as HTMLElement).textContent = m.show.endCard.sub;
  if (m.show.endCard.url) {
    const a = el("a", undefined, m.show.endCard.url.replace(/^https?:\/\//, ""));
    a.href = m.show.endCard.url;
    a.target = "_blank";
    a.rel = "noopener";
    cta.append(a);
  }
  foot.append(cta, el("div", undefined, data.disclosure + " This is general information, not advice on your own situation."));
  root.append(foot);

  // ---- names
  const names: Record<string, string> = {};
  m.characters.forEach((c) => (names[c.id] = c.name));
  m.script.personas.forEach((q) => (names[q.id] = q.name));
  const isVn = new Set(m.script.personas.map((q) => q.id));

  const audio = new Audio(data.audio);
  audio.preload = "auto";
  const ctx = canvas.getContext("2d")!;
  let W = 0;
  let H = 0;
  const size = () => {
    const r = stageWrap.getBoundingClientRect();
    const portrait = r.width < 640;
    stageWrap.classList.toggle("portrait", portrait);
    const rr = stageWrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.round(rr.width);
    H = Math.round(rr.height);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  };
  const draw = () => stage.render(ctx, W, H, audio.currentTime || 0);

  // chapters + transcript
  const chapBtns: HTMLButtonElement[] = [];
  tl.chapters.forEach((c) => {
    const b = el("button", "chapter");
    b.type = "button";
    b.append(el("span", "n", c.n === 0 ? "·" : String(c.n)), el("span", "t", c.title), el("span", "ts", clock(c.t)));
    b.onclick = () => go(c.t);
    chapList.append(b);
    chapBtns.push(b);
  });
  const lineBtns: Record<string, HTMLButtonElement> = {};
  tl.chapters.forEach((c) => {
    const box = el("div", "tchap");
    box.append(el("h3", undefined, c.title));
    tl.lines
      .filter((l) => l.s >= c.t - 0.01 && l.s < c.end)
      .forEach((l) => {
        const b = el("button", "tline");
        b.type = "button";
        const who = el("span", "sp", names[l.speaker] ?? "");
        if (isVn.has(l.speaker)) who.append(el("em", undefined, " · voice note"));
        b.append(el("span", "ts", clock(l.s)), who, el("span", "tx", l.words.map((w) => w.w).join(" ")));
        b.onclick = () => go(l.s);
        box.append(b);
        lineBtns[l.id] = b;
      });
    tx.append(box);
  });

  // playback state
  let playing = false;
  let lastT = 0;
  let quizOn = tl.polls.length > 0;
  let rate = 1;
  let right = 0;
  const answered: Record<string, boolean | null> = {};
  const setPP = () => {
    pp.setAttribute("aria-label", playing ? "Pause" : "Play");
    pp.innerHTML = playing ? '<svg viewBox="0 0 20 20"><path d="M5 3h3.5v14H5zM11.5 3H15v14h-3.5z"/></svg>' : '<svg viewBox="0 0 20 20"><path d="M5 3l12 7-12 7z"/></svg>';
  };
  setPP();
  const play = () => {
    poster.hidden = true;
    audio.playbackRate = rate;
    audio.play().catch(() => {});
  };
  const go = (t: number) => {
    audio.currentTime = t;
    lastT = t;
    poll.hidden = true;
    play();
  };
  audio.onplay = () => {
    playing = true;
    setPP();
  };
  audio.onpause = () => {
    playing = false;
    setPP();
    tick();
  };
  audio.onseeked = () => tick();
  poster.onclick = play;
  pp.onclick = () => (playing ? audio.pause() : play());
  seek.oninput = () => {
    audio.currentTime = Number(seek.value) / 10;
    lastT = audio.currentTime;
    poster.hidden = true;
    tick();
  };
  quizChip.onclick = () => {
    quizOn = !quizOn;
    quizChip.setAttribute("aria-pressed", String(quizOn));
  };
  capChip.onclick = () => {
    m.show.layout.showCaptions = !m.show.layout.showCaptions;
    capChip.setAttribute("aria-pressed", String(m.show.layout.showCaptions));
    draw();
  };
  speedChip.onclick = () => {
    rate = rate === 1 ? 1.25 : rate === 1.25 ? 1.5 : 1;
    audio.playbackRate = rate;
    speedChip.textContent = `Speed ${rate}×`;
  };
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || /INPUT|BUTTON|TEXTAREA/.test((document.activeElement as HTMLElement)?.tagName ?? "")) return;
    e.preventDefault();
    playing ? audio.pause() : play();
  });

  const showPoll = (q: (typeof tl.polls)[number]) => {
    audio.pause();
    audio.currentTime = q.t;
    poll.textContent = "";
    const box = el("div", "poll-in");
    box.append(el("div", "poll-k", "Your guess first"), el("div", "poll-q", q.poll.question));
    const optsBox = el("div", "poll-opts");
    const why = el("div", "poll-why");
    const go2 = el("button", "go", "Hear the answer");
    go2.type = "button";
    go2.hidden = true;
    const skip = el("button", "skip", "Skip and keep listening");
    skip.type = "button";
    q.poll.options.forEach((o, i) => {
      const b = el("button", undefined, o);
      b.type = "button";
      b.onclick = () => {
        [...optsBox.children].forEach((x, j) => {
          (x as HTMLButtonElement).disabled = true;
          if (j === q.poll.answer) x.classList.add("right");
        });
        const ok = i === q.poll.answer;
        if (!ok) b.classList.add("wrong");
        if (!(q.poll.id in answered)) {
          answered[q.poll.id] = ok;
          if (ok) right++;
          score.textContent = `Quiz score ${right} / ${tl.polls.length}`;
        }
        why.textContent = `${ok ? "Correct." : "Not quite."} ${q.poll.why}`;
        go2.hidden = false;
        skip.hidden = true;
        go2.focus();
      };
      optsBox.append(b);
    });
    go2.onclick = skip.onclick = () => {
      if (!(q.poll.id in answered)) answered[q.poll.id] = null;
      poll.hidden = true;
      play();
    };
    const row = el("div", "poll-go");
    row.append(go2, skip);
    box.append(optsBox, why, row);
    poll.append(box);
    poll.hidden = false;
  };

  let activeLine = "";
  let activeChap = "";
  function tick() {
    const t = audio.currentTime || 0;
    if (playing && quizOn && poll.hidden) {
      for (const q of tl.polls) {
        if (!(q.poll.id in answered) && lastT < q.t && t >= q.t && t - lastT < 1.5) {
          showPoll(q);
          break;
        }
      }
    }
    lastT = t;
    draw();
    if (document.activeElement !== seek) seek.value = String(Math.round(t * 10));
    time.textContent = `${clock(t)} / ${clock(tl.duration)}`;
    const l = lineAt(tl, t);
    if (l && l.id !== activeLine) {
      lineBtns[activeLine]?.classList.remove("on");
      activeLine = l.id;
      lineBtns[l.id]?.classList.add("on");
    }
    const ch = chapterAt(tl, t);
    if (ch.id !== activeChap) {
      activeChap = ch.id;
      chapBtns.forEach((b, i) => b.classList.toggle("on", tl.chapters[i].id === ch.id));
    }
  }
  const loop = () => {
    if (playing) tick();
    requestAnimationFrame(loop);
  };
  new ResizeObserver(size).observe(stageWrap);
  await document.fonts.ready;
  size();
  loop();
}

function widget(w: Widget): HTMLElement {
  const card = el("div", "calc");
  const out = el("div", "out");
  const field = (label: string, value: string) => {
    const l = el("label");
    l.append(document.createTextNode(label));
    const i = el("input");
    i.inputMode = "decimal";
    i.value = value;
    l.append(i);
    return { l, i };
  };
  const num = (s: string) => {
    const v = parseFloat(s.replace(/[^0-9.]/g, ""));
    return isFinite(v) ? v : 0;
  };
  const row = (label: string, v: number, max: number, tone: string) => {
    const r = el("div", `orow ${tone}`);
    const bar = el("div", "ob");
    const fill = el("i");
    fill.style.width = `${max > 0 ? (v / max) * 100 : 0}%`;
    bar.append(fill);
    r.append(el("span", "ok", label), el("span", "ov", naira(v)), bar);
    return r;
  };
  const fields = el("div", "fields");
  if (w.type === "vat-commission") {
    card.append(el("h3", undefined, "VAT on the package or on your fee?"));
    const a = field("Package price (₦)", "3,000,000");
    const b = field("Your commission (%)", "10");
    fields.append(a.l, b.l);
    const calc = () => {
      const r = vatOnCommission(num(a.i.value), num(b.i.value));
      out.textContent = "";
      out.append(row("7.5% VAT on the full package", r.full, r.full, "bad"), row("7.5% VAT on your fee only", r.fee, r.full, "good"), el("div", "verdict", `Charging on your fee keeps ${naira(r.saving)} off the customer's bill.`));
    };
    [a.i, b.i].forEach((i) => (i.oninput = calc));
    calc();
  } else if (w.type === "company-vs-bn") {
    card.append(el("h3", undefined, "Small company or business name?"));
    const a = field("Profit for the year (₦)", "60,000,000");
    const b = field("Turnover for the year (₦)", "95,000,000");
    fields.append(a.l, b.l);
    const calc = () => {
      const co = companyRouteTax(num(a.i.value), num(b.i.value));
      const bn = personalIncomeTax(num(a.i.value));
      const max = Math.max(co.total, bn, 1);
      const better = co.total < bn;
      out.textContent = "";
      out.append(
        row(`Company · ${co.note}`, co.total, max, better ? "good" : "bad"),
        row("Business name · 2026 personal income tax bands", bn, max, better ? "mid" : "good"),
        el("div", "verdict", `${better ? "The company route" : "The business name"} costs ${naira(Math.abs(co.total - bn))} less tax on these numbers.`),
      );
    };
    [a.i, b.i].forEach((i) => (i.oninput = calc));
    calc();
  } else {
    card.append(el("h3", undefined, "Personal income tax on your income"));
    const a = field("Taxable income for the year (₦)", "12,000,000");
    fields.append(a.l);
    const calc = () => {
      const tax = personalIncomeTax(num(a.i.value));
      out.textContent = "";
      out.append(row("Tax under the 2026 bands", tax, Math.max(1, num(a.i.value) * 0.25), "mid"), el("div", "verdict", `Effective rate ${num(a.i.value) ? ((tax / num(a.i.value)) * 100).toFixed(1) : 0}%.`));
    };
    a.i.oninput = calc;
    calc();
  }
  card.append(fields, out, el("p", "fine", "Simplified illustration under the Nigeria Tax Act 2025, before reliefs. Speak to an adviser before you act."));
  return card;
}

const data = (window as any).__BRIDGE__ as PlayerData | undefined;
if (data) boot(data);
(window as any).BridgePlayer = { boot };
