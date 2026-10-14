// Reads a brand kit from a web page (.html) or a zipped project folder (.zip) entirely in
// the browser: colours, colour tokens, fonts (with their files when the folder has them),
// logo candidates and readable text. Nothing inside the files is run: HTML is parsed as
// inert markup and CSS is read as text.

import { unzipSync } from "fflate";
import type { Brand, Palette } from "../shared/types";
import { luminance } from "./render/text";

export interface KitFile {
  path: string;
  name: string;
  data: Uint8Array;
  mime: string;
}

export interface KitFace {
  weight: number;
  /** variable fonts cover a range */
  weightMax: number;
  italic: boolean;
  file: KitFile | null;
}

export interface KitFont {
  family: string;
  uses: number;
  google: boolean;
  /** where the kit says it's used: "heading", "body", "mono" hints from token names and selectors */
  hints: string[];
  faces: KitFace[];
}

export interface BrandKit {
  source: string;
  text: string;
  tokens: { name: string; value: string }[];
  colors: string[];
  fonts: KitFont[];
  logos: KitFile[];
  title: string;
  pdf: Blob | null;
  counts: { pages: number; stylesheets: number; fontFiles: number; images: number };
}

const MAX_TEXT = 40_000;
const MAX_ENTRY = 30 * 1024 * 1024;
const MAX_TOTAL = 200 * 1024 * 1024;
const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "inherit", "initial", "unset", "revert", "emoji", "math", "fangsong", "-apple-system", "blinkmacsystemfont", "segoe ui", "helvetica neue", "arial", "helvetica", "apple color emoji", "segoe ui emoji", "segoe ui symbol", "noto color emoji"]);
const FONT_EXT = /\.(woff2|woff|ttf|otf)$/i;
const IMG_EXT = /\.(svg|png|webp|jpe?g)$/i;
const MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  pdf: "application/pdf",
};
const ext = (p: string) => (p.split(".").pop() ?? "").toLowerCase();
const base = (p: string) => p.split("/").pop() ?? p;
const decoder = new TextDecoder();

// ---------- colours ----------

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Turns one CSS colour (hex, rgb(), hsl()) into #RRGGBB, or null. Mostly transparent colours are skipped. */
export function normalizeColor(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    if (h.length === 8 && parseInt(h.slice(6), 16) < 128) return null;
    return `#${h.slice(0, 6)}`.toUpperCase();
  }
  m = /^rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(s);
  if (m) {
    const pct = s.includes("%") && !m[5];
    const conv = (v: string) => (pct ? (Number(v) / 100) * 255 : Number(v));
    const alpha = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4]);
    if (alpha < 0.5) return null;
    return toHex(conv(m[1]), conv(m[2]), conv(m[3]));
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(s);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4]);
    if (alpha < 0.5) return null;
    return toHex(...hslToRgb(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  return null;
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

function saturation(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

// ---------- CSS ----------

interface CssFacts {
  vars: Map<string, string>;
  colorCounts: Map<string, number>;
  families: Map<string, { uses: number; hints: Set<string> }>;
  faces: { family: string; weight: number; weightMax: number; italic: boolean; url: string | null; from: string }[];
  google: Set<string>;
}

const emptyFacts = (): CssFacts => ({ vars: new Map(), colorCounts: new Map(), families: new Map(), faces: [], google: new Set() });

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "").trim();

function firstFamily(value: string, vars: Map<string, string>): string | null {
  let v = value.trim();
  for (let i = 0; i < 4 && /var\(/.test(v); i++) {
    v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)/g, (_, n: string, fb: string) => vars.get(n) ?? fb ?? "");
  }
  for (const part of v.split(",")) {
    const fam = unquote(part.replace(/!important/, ""));
    if (fam && !GENERIC.has(fam.toLowerCase()) && !/^var\(/.test(fam)) return fam;
  }
  return null;
}

function weightOf(v: string | undefined): [number, number] {
  if (!v) return [400, 400];
  const s = v.trim().toLowerCase();
  if (s === "bold") return [700, 700];
  if (s === "normal") return [400, 400];
  const nums = s.match(/\d{3}/g)?.map(Number) ?? [];
  if (nums.length >= 2) return [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
  if (nums.length === 1) return [nums[0], nums[0]];
  return [400, 400];
}

export function googleFamilies(url: string): string[] {
  if (!/fonts\.googleapis\.com/.test(url)) return [];
  const out: string[] = [];
  try {
    const u = new URL(url.replace(/&amp;/g, "&"), "https://x.invalid");
    for (const f of u.searchParams.getAll("family")) {
      for (const one of f.split("|")) {
        const name = one.split(":")[0].replace(/\+/g, " ").trim();
        if (name) out.push(name);
      }
    }
  } catch {
    /* not a URL */
  }
  return out;
}

/** Reads one stylesheet's text. `from` is its path, used to resolve font URLs. */
export function readCss(css: string, from: string, facts: CssFacts = emptyFacts()): CssFacts {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of noComments.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/g)) googleFamilies(m[1]).forEach((g) => facts.google.add(g));
  for (const m of noComments.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const body = m[1];
    const fam = /font-family\s*:\s*([^;]+)/i.exec(body);
    if (!fam) continue;
    const urls = [...body.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((u) => u[1]);
    const pick = ["woff2", "woff", "ttf", "otf"].map((e) => urls.find((u) => ext(u.split("?")[0]) === e)).find(Boolean) ?? urls[0] ?? null;
    const [w, wMax] = weightOf(/font-weight\s*:\s*([^;]+)/i.exec(body)?.[1]);
    facts.faces.push({ family: unquote(fam[1]), weight: w, weightMax: wMax, italic: /font-style\s*:\s*(italic|oblique)/i.test(body), url: pick, from });
  }
  const rules = noComments.replace(/@font-face\s*{[^}]*}/g, "");
  for (const m of rules.matchAll(/(--[\w-]+)\s*:\s*([^;}{]+)/g)) facts.vars.set(m[1], m[2].trim());
  // selector-aware pass for font hints
  for (const m of rules.matchAll(/([^{}]+){([^{}]*)}/g)) {
    const sel = m[1].trim().toLowerCase();
    const body = m[2];
    const ff = /(?:^|[;\s])font-family\s*:\s*([^;]+)/i.exec(body) ?? /(?:^|[;\s])font\s*:\s*[^;]*?\d+(?:px|rem|em|pt)[^;,]*?\s+([^;]+)/i.exec(body);
    if (ff) {
      const fam = firstFamily(ff[1], facts.vars);
      if (fam) {
        const e = facts.families.get(fam) ?? { uses: 0, hints: new Set<string>() };
        e.uses++;
        if (/\bh[1-3]\b|head|title|display|hero/.test(sel)) e.hints.add("heading");
        if (/\bbody\b|\bp\b|html|:root/.test(sel)) e.hints.add("body");
        if (/code|pre|mono|kbd/.test(sel)) e.hints.add("mono");
        facts.families.set(fam, e);
      }
    }
  }
  for (const [name, value] of facts.vars) {
    if (!/font/.test(name)) continue;
    const fam = firstFamily(value, facts.vars);
    if (!fam) continue;
    const e = facts.families.get(fam) ?? { uses: 0, hints: new Set<string>() };
    e.uses++;
    if (/head|display|title|brand/.test(name)) e.hints.add("heading");
    if (/body|sans|text|base|copy/.test(name)) e.hints.add("body");
    if (/mono|code/.test(name)) e.hints.add("mono");
    facts.families.set(fam, e);
  }
  for (const m of noComments.matchAll(COLOR_RE)) {
    const hex = normalizeColor(m[0]);
    if (hex) facts.colorCounts.set(hex, (facts.colorCounts.get(hex) ?? 0) + 1);
  }
  return facts;
}

// ---------- paths ----------

function resolvePath(from: string, rel: string): string {
  const clean = rel.split(/[?#]/)[0];
  if (/^(https?:|data:|\/\/)/i.test(clean)) return clean;
  const parts = (clean.startsWith("/") ? [] : from.split("/").slice(0, -1)).concat(clean.replace(/^\//, "").split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(decodeURIComponent(p));
  }
  return out.join("/");
}

function dataUri(uri: string): KitFile | null {
  const m = /^data:([^;,]+)([^,]*),(.*)$/s.exec(uri);
  if (!m) return null;
  const data = /;base64/i.test(m[2]) ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
  const e = Object.entries(MIME).find(([, v]) => v === m[1])?.[0] ?? "bin";
  return { path: `inline.${e}`, name: `logo.${e}`, data, mime: m[1] };
}

// ---------- logos ----------

function logoScore(f: KitFile, fromMarkup: boolean): number {
  const n = f.path.toLowerCase();
  let s = 0;
  if (/logo|wordmark|logotype|brandmark|lockup/.test(n)) s += 6;
  if (fromMarkup) s += 3;
  s += { svg: 4, png: 3, webp: 2, jpg: 0, jpeg: 0 }[ext(n)] ?? 0;
  if (/white|light|reverse|reversed|negative|inverse|knockout|on-?dark|dark-?bg|for-dark/.test(n)) s += 3;
  else if (/black|dark|on-?light|light-?bg/.test(n)) s -= 2;
  if (/favicon|icon-\d|apple-touch|og-image|social|banner|screenshot|thumb/.test(n)) s -= 5;
  if (f.data.length > 4 * 1024 * 1024) s -= 4;
  return s;
}

// ---------- text ----------

const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,td,th,dt,dd,figcaption,blockquote";

function visibleText(doc: Document): string {
  const clone = doc.body?.cloneNode(true) as HTMLElement | undefined;
  if (!clone) return "";
  clone.querySelectorAll("script,style,noscript,template,svg,iframe,canvas").forEach((n) => n.remove());
  const blocks: string[] = [];
  clone.querySelectorAll(`${BLOCKS},div,span,a,label,button`).forEach((el) => {
    const isBlock = el.matches(BLOCKS);
    if (isBlock ? el.parentElement?.closest(BLOCKS) : el.children.length > 0 || el.closest(BLOCKS)) return;
    const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (t) blocks.push(/^H\d$/.test(el.tagName) ? `\n## ${t}` : t);
  });
  const seen = new Set<string>();
  return blocks.filter((b) => (seen.has(b) ? false : (seen.add(b), true))).join("\n");
}

// ---------- the reader ----------

/** Reads an .html page or a .zip project folder. */
export async function readBrandKit(file: File): Promise<BrandKit> {
  const e = ext(file.name);
  const files = new Map<string, Uint8Array>();
  if (e === "zip") {
    let total = 0;
    let count = 0;
    const all = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => {
        const p = f.name;
        if (p.endsWith("/") || /(^|\/)(__MACOSX|node_modules|\.git)\//.test(p) || /(^|\/)\./.test(p)) return false;
        if (f.originalSize > MAX_ENTRY || ++count > 3000) return false;
        total += f.originalSize;
        return total <= MAX_TOTAL;
      },
    });
    for (const [p, d] of Object.entries(all)) files.set(p.replace(/\\/g, "/"), d);
    if (!files.size) throw new Error("That zip file is empty, or everything in it was too large to read.");
  } else if (e === "html" || e === "htm") {
    files.set(file.name, new Uint8Array(await file.arrayBuffer()));
  } else {
    throw new Error("Choose a PDF, an .html page or a .zip of the project folder.");
  }

  const paths = [...files.keys()];
  const htmlPaths = paths.filter((p) => /\.html?$/i.test(p)).sort((a, b) => {
    const rank = (p: string) => (/(^|\/)index\.html?$/i.test(p) ? 0 : 1) + p.split("/").length / 100;
    return rank(a) - rank(b);
  }).slice(0, 12);
  const facts = emptyFacts();
  const textParts: string[] = [];
  const logos: { f: KitFile; markup: boolean }[] = [];
  const usedCss = new Set<string>();
  let title = "";
  const fileAt = (p: string): KitFile | null => {
    const d = files.get(p);
    return d ? { path: p, name: base(p), data: d, mime: MIME[ext(p)] ?? "application/octet-stream" } : null;
  };

  for (const hp of htmlPaths) {
    const doc = new DOMParser().parseFromString(decoder.decode(files.get(hp)!), "text/html");
    if (!title) title = doc.title?.trim() ?? "";
    doc.querySelectorAll("link[href]").forEach((l) => {
      const href = l.getAttribute("href") ?? "";
      googleFamilies(href).forEach((g) => facts.google.add(g));
      if (/stylesheet/i.test(l.getAttribute("rel") ?? "")) {
        const p = resolvePath(hp, href);
        const d = files.get(p);
        if (d && !usedCss.has(p)) {
          usedCss.add(p);
          readCss(decoder.decode(d), p, facts);
        }
      }
    });
    doc.querySelectorAll("style").forEach((s) => readCss(s.textContent ?? "", hp, facts));
    const inline = [...doc.querySelectorAll("[style]")].map((el) => `x{${el.getAttribute("style")}}`).join("\n");
    if (inline) readCss(inline, hp, facts);
    const theme = doc.querySelector('meta[name="theme-color"]')?.getAttribute("content");
    if (theme && normalizeColor(theme)) facts.vars.set("--meta-theme-color", theme);
    doc.querySelectorAll("img[src]").forEach((img) => {
      const hint = `${img.getAttribute("alt") ?? ""} ${img.getAttribute("class") ?? ""} ${img.id} ${img.getAttribute("src")}`;
      if (!/logo|brand|wordmark/i.test(hint)) return;
      const src = img.getAttribute("src")!;
      const f = src.startsWith("data:") ? dataUri(src) : fileAt(resolvePath(hp, src));
      if (f && IMG_EXT.test(f.name)) logos.push({ f, markup: true });
    });
    doc.querySelectorAll("svg").forEach((svg, i) => {
      const hint = `${svg.getAttribute("class") ?? ""} ${svg.id} ${svg.getAttribute("aria-label") ?? ""} ${svg.querySelector("title")?.textContent ?? ""} ${svg.parentElement?.getAttribute("class") ?? ""}`;
      if (!/logo|brand|wordmark/i.test(hint)) return;
      if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const data = new TextEncoder().encode(new XMLSerializer().serializeToString(svg));
      logos.push({ f: { path: `${hp}#logo-${i}.svg`, name: `logo-${i + 1}.svg`, data, mime: "image/svg+xml" }, markup: true });
    });
    const t = visibleText(doc);
    if (t) textParts.push(htmlPaths.length > 1 ? `# Page: ${hp}\n${t}` : t);
  }

  // stylesheets no page linked to, design-token JSON and written notes
  for (const p of paths) {
    const x = ext(p);
    if (x === "css" && !usedCss.has(p)) readCss(decoder.decode(files.get(p)!), p, facts);
    else if (x === "json" && files.get(p)!.length < 2_000_000 && !/package(-lock)?\.json$|manifest\.json$/i.test(p)) {
      try {
        const walk = (o: unknown, path: string) => {
          if (typeof o === "string") {
            if (normalizeColor(o)) facts.vars.set(`--${path}`, o);
            else if (/font|family|typeface/i.test(path) && o.length < 80) {
              const fam = firstFamily(o, facts.vars);
              if (fam) {
                const en = facts.families.get(fam) ?? { uses: 0, hints: new Set<string>() };
                en.uses++;
                if (/head|display|title/i.test(path)) en.hints.add("heading");
                if (/body|text|base|sans/i.test(path)) en.hints.add("body");
                if (/mono|code/i.test(path)) en.hints.add("mono");
                facts.families.set(fam, en);
              }
            }
          } else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}-${k}` : k);
        };
        walk(JSON.parse(decoder.decode(files.get(p)!)), "");
      } catch {
        /* not JSON after all */
      }
    } else if ((x === "md" || x === "txt") && files.get(p)!.length < 500_000) textParts.push(`# File: ${p}\n${decoder.decode(files.get(p)!)}`);
  }
  for (const value of facts.vars.values()) {
    const hex = normalizeColor(value);
    if (hex) facts.colorCounts.set(hex, (facts.colorCounts.get(hex) ?? 0) + 2);
  }

  // fonts: declared faces, then loose font files named like "Inter-Bold.ttf"
  const fonts = new Map<string, KitFont>();
  const fontEntry = (family: string) => {
    let f = fonts.get(family.toLowerCase());
    if (!f) {
      const fam = facts.families.get(family);
      f = { family, uses: fam?.uses ?? 0, google: facts.google.has(family), hints: [...(fam?.hints ?? [])], faces: [] };
      fonts.set(family.toLowerCase(), f);
    }
    return f;
  };
  const claimed = new Set<string>();
  for (const face of facts.faces) {
    const p = face.url ? resolvePath(face.from, face.url) : null;
    const file = p && FONT_EXT.test(p) ? fileAt(p) : null;
    if (file) claimed.add(file.path);
    fontEntry(face.family).faces.push({ weight: face.weight, weightMax: face.weightMax, italic: face.italic, file });
  }
  const WEIGHTS: [RegExp, number][] = [[/thin|hairline/, 100], [/extra-?light|ultra-?light/, 200], [/light/, 300], [/medium/, 500], [/semi-?bold|demi-?bold/, 600], [/extra-?bold|ultra-?bold/, 800], [/black|heavy/, 900], [/bold/, 700]];
  for (const p of paths) {
    if (!FONT_EXT.test(p) || claimed.has(p)) continue;
    let stem = base(p).replace(FONT_EXT, "");
    const variable = /variable|\[wght|wght\]/i.test(stem);
    stem = stem.replace(/[-_ ]?(VariableFont|Variable)\b.*$/i, "").replace(/\[.*\]/, "");
    const sm = /[-_ ]?((?:thin|hairline|extra-?light|ultra-?light|light|regular|book|normal|medium|semi-?bold|demi-?bold|extra-?bold|ultra-?bold|bold|black|heavy)?(?:italic|oblique)?)$/i.exec(stem);
    const s = (sm?.[1] ?? "").toLowerCase();
    const famRaw = stem.slice(0, stem.length - (sm?.[0].length ?? 0)) || stem;
    const weight = WEIGHTS.find(([re]) => re.test(s))?.[1] ?? 400;
    const family = famRaw.replace(/(?<=[a-z])(?=[A-Z])/g, " ").replace(/[_-]+/g, " ").trim() || stem;
    fontEntry(family).faces.push({ weight: variable ? 100 : weight, weightMax: variable ? 900 : weight, italic: /italic|oblique/.test(s), file: fileAt(p) });
  }
  for (const [fam, e] of facts.families) {
    const f = fontEntry(fam);
    f.uses = Math.max(f.uses, e.uses);
  }
  for (const g of facts.google) fontEntry(g).google = true;

  for (const p of paths) if (IMG_EXT.test(p) && /logo|wordmark|logotype|brandmark|lockup/i.test(p)) logos.push({ f: fileAt(p)!, markup: false });
  const seenLogo = new Set<string>();
  const rankedLogos = logos
    .filter(({ f }) => (seenLogo.has(f.path) ? false : (seenLogo.add(f.path), true)))
    .sort((a, b) => logoScore(b.f, b.markup) - logoScore(a.f, a.markup))
    .slice(0, 8)
    .map(({ f }) => f);

  const tokens = [...facts.vars.entries()]
    .map(([name, value]) => ({ name, value: normalizeColor(value) ?? "" }))
    .filter((t) => t.value)
    .slice(0, 120);
  const colors = [...facts.colorCounts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, 24);
  const pdfPath = paths.filter((p) => ext(p) === "pdf").sort((a, b) => Number(/guide|brand/i.test(b)) - Number(/guide|brand/i.test(a)))[0];

  return {
    source: file.name,
    text: textParts.join("\n\n").slice(0, MAX_TEXT),
    tokens,
    colors,
    fonts: [...fonts.values()].filter((f) => f.uses > 0 || f.faces.some((x) => x.file) || f.google).sort((a, b) => b.uses - a.uses).slice(0, 12),
    logos: rankedLogos,
    title,
    pdf: pdfPath ? new Blob([files.get(pdfPath)!.slice()], { type: "application/pdf" }) : null,
    counts: {
      pages: htmlPaths.length,
      stylesheets: paths.filter((p) => ext(p) === "css").length,
      fontFiles: paths.filter((p) => FONT_EXT.test(p)).length,
      images: paths.filter((p) => IMG_EXT.test(p)).length,
    },
  };
}

/** The best file for a font used in a given role: heavy for headlines, regular for text. */
export function pickFace(font: KitFont, role: "display" | "body" | "mono"): KitFace | null {
  const withFile = font.faces.filter((f) => f.file && !f.italic);
  if (!withFile.length) return null;
  const want = role === "display" ? 800 : role === "mono" ? 500 : 400;
  const cost = (f: KitFace) => (want >= f.weight && want <= f.weightMax ? 0 : Math.min(Math.abs(want - f.weight), Math.abs(want - f.weightMax)));
  return [...withFile].sort((a, b) => cost(a) - cost(b) || b.weightMax - b.weight - (a.weightMax - a.weight))[0];
}

/** What the AI gets to read: the page text plus a plain list of what was found. */
export function kitSummary(kit: BrandKit): string {
  const lines = [`Source: ${kit.source}${kit.title ? ` (title: ${kit.title})` : ""}`];
  if (kit.tokens.length) lines.push("Colour tokens defined in the code:", ...kit.tokens.slice(0, 80).map((t) => `  ${t.name}: ${t.value}`));
  if (kit.fonts.length)
    lines.push(
      "Fonts used:",
      ...kit.fonts.map((f) => `  ${f.family} (used ${f.uses}x${f.hints.length ? `, ${f.hints.join("/")}` : ""}${f.faces.some((x) => x.file) ? ", font files included" : ""}${f.google ? ", Google Fonts" : ""})`),
    );
  if (kit.logos.length) lines.push("Logo files found:", ...kit.logos.map((l) => `  ${l.path}`));
  return `${lines.join("\n")}\n\nText of the guide:\n${kit.text}`;
}

// ---------- without the AI ----------

const PAL_RULES: [keyof Palette, RegExp, ((hex: string) => number)?][] = [
  ["bg", /(^|-)(bg|background|surface|canvas|base|page)(-|$)/, (h) => -luminance(h)],
  ["bg2", /(bg|background|surface)-?(2|alt|secondary|subtle|elevated|raised|muted)|(card|panel)(-|$)/, (h) => -luminance(h)],
  ["ink", /(^|-)(text|fg|foreground|ink|on-?bg|on-?background|body-?color|content|heading)(-|$)/, (h) => luminance(h)],
  ["dim", /(muted|secondary|subtle|dim|caption|meta)/, undefined],
  ["accent", /(primary|brand|accent|highlight|main|theme-color)/, (h) => saturation(h)],
  ["accent2", /(secondary|accent-?2|tertiary|alt)/, (h) => saturation(h)],
  ["good", /(success|positive|good|green)/, undefined],
  ["bad", /(danger|error|warning|negative|bad|red|alert)/, undefined],
];

/** A best guess at the stage settings from what the kit defines, for when the AI isn't available. */
export function guessFromKit(kit: BrandKit, current: Brand): { palette: Palette; display: string | null; body: string | null; mono: string | null; logo: KitFile | null } {
  const palette = { ...current.palette };
  const taken = new Set<string>();
  for (const [key, re, score] of PAL_RULES) {
    const cands = kit.tokens.filter((t) => {
      const n = t.name.toLowerCase().replace(/^--/, "");
      if (!re.test(n) || taken.has(t.value)) return false;
      return !(key === "accent" || key === "accent2") || !/text|fg|foreground|ink|bg|background|surface|border|shadow/.test(n);
    });
    if (key === "dim") {
      const c = cands.find((t) => /text|fg|ink|foreground/.test(t.name));
      if (c) {
        palette.dim = c.value;
        taken.add(c.value);
      }
      continue;
    }
    if (!cands.length) continue;
    const best = score ? [...cands].sort((a, b) => score(b.value) - score(a.value))[0] : cands[0];
    palette[key] = best.value;
    taken.add(best.value);
  }
  if (!kit.tokens.length && kit.colors.length) {
    const byLum = [...kit.colors].sort((a, b) => luminance(a) - luminance(b));
    const darkest = byLum[0];
    const lightest = byLum[byLum.length - 1];
    if (luminance(darkest) < 0.08) palette.bg = darkest;
    if (luminance(lightest) > 0.7) palette.ink = lightest;
    const vivid = kit.colors.filter((c) => saturation(c) > 0.45 && luminance(c) > 0.08 && luminance(c) < 0.85);
    if (vivid[0]) palette.accent = vivid[0];
    if (vivid[1]) palette.accent2 = vivid[1];
  }
  const by = (hint: string) => kit.fonts.find((f) => f.hints.includes(hint))?.family ?? null;
  const mono = by("mono") ?? kit.fonts.find((f) => /mono|code/i.test(f.family))?.family ?? null;
  const rest = kit.fonts.filter((f) => f.family !== mono);
  const display = by("heading") ?? rest[0]?.family ?? null;
  const body = rest.find((f) => f.hints.includes("body") && f.family !== display)?.family ?? rest.find((f) => f.family !== display)?.family ?? display;
  return { palette, display, body, mono, logo: kit.logos[0] ?? null };
}
