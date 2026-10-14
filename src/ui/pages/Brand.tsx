import { useEffect, useRef, useState } from "react";
import type { AssetRef, FontChoice, Orientation, Palette, SceneKind, Show } from "../../shared/types";
import type { MusicSlot } from "../../shared/timeline";
import sample from "../../shared/sampleEpisode.json";
import type { Episode } from "../../shared/types";
import { store } from "../../lib/store";
import { uploadAsset } from "../../lib/assets";
import { prepare, DEFAULT_MUSIC, type Production } from "../../lib/engine";
import { pdfColours, pdfText } from "../../lib/notes";
import { guessFromKit, kitSummary, pickFace, readBrandKit, type BrandKit, type KitFile } from "../../lib/brandkit";
import { api, serverAvailable, waitForJob } from "../../lib/api";
import { luminance } from "../../lib/render/text";
import { useApp } from "../ctx";
import { Preview } from "../components/Preview";

const ROLE_LABEL = { display: "Headlines", body: "Captions and text", mono: "Labels" } as const;

const PALETTE_LABELS: Record<keyof Palette, string> = {
  bg: "Background",
  bg2: "Background, horizon",
  ink: "Main text",
  dim: "Secondary text",
  accent: "Brand accent",
  accent2: "Second accent",
  good: "Positive",
  bad: "Warning",
  mid: "Neutral bar",
};

const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

export function Brand() {
  const app = useApp();
  const [show, setShow] = useState<Show>(app.show);
  const [prod, setProd] = useState<Production | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [guide, setGuide] = useState<string | null>(null);
  const [imported, setImported] = useState<{ before: Show; source: string; lines: string[]; notes: string } | null>(null);
  const timer = useRef(0);
  const editable = app.can("edit");

  const change = (next: Show) => {
    setShow(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => app.saveShow(next), 600);
  };
  const brand = show.brand;
  const setBrand = (patch: Partial<Show["brand"]>) => change({ ...show, brand: { ...brand, ...patch } });

  useEffect(() => {
    let alive = true;
    (async () => {
      const eps = await store.listEpisodes(app.show.id);
      const ep = eps.find((e) => e.script) ?? (sample as unknown as Episode);
      const p = await prepare({ show, characters: app.characters, script: ep.script!, library: app.pronunciations, episodeNumber: ep.number, draft: false });
      if (alive) setProd(p);
    })();
    return () => {
      alive = false;
    };
  }, [show, app.characters, app.pronunciations, app.show.id]);

  const upload = async (f: File | undefined, kind: AssetRef["kind"], folder: string): Promise<AssetRef | null> => (f ? uploadAsset(app.show.id, f, kind, folder) : null);

  const importGuide = async (f: File) => {
    const isPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
    const isKit = /\.(zip|html?)$/i.test(f.name);
    if (!isPdf && !isKit) return app.toast("Choose a PDF, an .html page or a .zip of the project folder.", true);
    if (isPdf && !serverAvailable()) return app.toast("Reading a PDF guide needs the online studio. In demo mode, try an .html page or a .zip.", true);
    const before = show;
    try {
      setGuide("Reading the guide");
      let text = "";
      let colors: string[] = [];
      let kit: BrandKit | null = null;
      if (isPdf) {
        [text, colors] = await Promise.all([pdfText(f, 30), pdfColours(f)]);
      } else {
        kit = await readBrandKit(f);
        text = kitSummary(kit);
        colors = kit.colors;
        if (kit.pdf) {
          const [t, c] = await Promise.all([pdfText(kit.pdf, 30), pdfColours(kit.pdf)]);
          text += `\n\nText of the PDF in the folder:\n${t}`;
          colors = [...new Set([...colors, ...c])].slice(0, 24);
        }
        if (!kit.tokens.length && !kit.colors.length && !kit.fonts.length && !kit.logos.length && !kit.pdf && !kit.text)
          throw new Error("Couldn't find any colours, fonts or logos in that file.");
      }

      // the AI matches the guide to the stage when the online studio is connected; otherwise the studio reads the code's own names
      let r: { palette?: Partial<Palette>; displayFont?: string; bodyFont?: string; monoFont?: string; logoFile?: string; wordmark?: string; byline?: string; notes?: string };
      if (serverAvailable()) {
        setGuide("Matching it to the stage");
        const { jobId } = await api.startAi({
          kind: "brand",
          showId: app.show.id,
          payload: { text, colors, fonts: kit?.fonts.filter((x) => x.faces.some((y) => y.file)).map((x) => x.family) ?? [], logos: kit?.logos.map((l) => l.path) ?? [] },
        });
        const job: any = await waitForJob(jobId, (m) => setGuide(m));
        r = job.result ?? {};
      } else {
        const g = guessFromKit(kit!, brand);
        r = { palette: g.palette, displayFont: g.display ?? "", bodyFont: g.body ?? "", monoFont: g.mono ?? "", logoFile: g.logo?.path ?? "" };
      }

      setGuide("Applying it");
      const hex = /^#[0-9a-fA-F]{6}$/;
      const palette = { ...brand.palette };
      let colourCount = 0;
      for (const k of Object.keys(palette) as (keyof Palette)[]) {
        const v = r.palette?.[k] ?? "";
        if (hex.test(v) && v.toUpperCase() !== palette[k].toUpperCase()) colourCount++;
        if (hex.test(v)) palette[k] = v.toUpperCase();
      }
      const uploaded = new Map<string, string>();
      const asFile = (k: KitFile) => new File([k.data.slice()], k.name, { type: k.mime });
      const lines: string[] = [];
      const fontFor = async (role: "display" | "body" | "mono", family: string | undefined): Promise<FontChoice> => {
        if (!family?.trim()) return brand.fonts[role];
        const kf = kit?.fonts.find((x) => x.family.toLowerCase() === family.trim().toLowerCase());
        const face = kf ? pickFace(kf, role) : null;
        if (kf && face?.file) {
          let path = uploaded.get(face.file.path);
          if (!path) {
            path = (await uploadAsset(app.show.id, asFile(face.file), "font", "fonts")).path;
            uploaded.set(face.file.path, path);
          }
          lines.push(`${ROLE_LABEL[role]}: ${kf.family}, from ${face.file.name}`);
          return { family: kf.family, source: "upload", assetPath: path, weight: face.weight, weightMax: face.weightMax };
        }
        lines.push(`${ROLE_LABEL[role]}: ${family.trim()}, from Google Fonts`);
        return { family: family.trim(), source: "google" };
      };
      const fonts = {
        display: await fontFor("display", r.displayFont),
        body: await fontFor("body", r.bodyFont),
        mono: await fontFor("mono", r.monoFont),
      };
      const logoKit = kit?.logos.length ? (kit.logos.find((l) => l.path === r.logoFile) ?? kit.logos[0]) : null;
      const logo = logoKit ? await uploadAsset(app.show.id, asFile(logoKit), "logo", "logo") : brand.logo;
      if (logoKit) lines.unshift(`Logo: ${logoKit.name}`);
      lines.unshift(colourCount ? `${colourCount} colour${colourCount === 1 ? "" : "s"} changed` : "Colours unchanged");
      change({
        ...show,
        brand: { ...brand, palette, logo, wordmark: r.wordmark || brand.wordmark, byline: r.byline || brand.byline, fonts },
      });
      const notes = r.notes || (serverAvailable() ? "" : "Matched without the AI, from the names in the code. The online studio's AI reads guides more closely.");
      setImported({ before, source: f.name, lines, notes });
      app.toast("Brand guide applied");
    } catch (e) {
      app.toast((e as Error).message, true);
    } finally {
      setGuide(null);
    }
  };

  const font = (role: "display" | "body" | "mono", label: string) => {
    const f = brand.fonts[role];
    const set = (v: FontChoice) => setBrand({ fonts: { ...brand.fonts, [role]: v } });
    return (
      <div className="stack tight">
        <label className="field">
          {label}
          <input className="input" value={f.family} disabled={!editable} onChange={(e) => set({ ...f, family: e.target.value })} />
        </label>
        <div className="row small">
          <select className="input" style={{ maxWidth: 170 }} value={f.source} disabled={!editable} onChange={(e) => set({ ...f, source: e.target.value as FontChoice["source"] })} aria-label={`${label} source`}>
            <option value="google">Google Fonts</option>
            <option value="upload">Uploaded file</option>
            <option value="system">Installed on the computer</option>
          </select>
          {f.source === "upload" && (
            <label className="btn sm">
              {f.assetPath ? "Replace file" : "Upload .woff2/.ttf"}
              <input type="file" accept=".woff2,.woff,.ttf,.otf" hidden onChange={async (e) => {
                const a = await upload(e.target.files?.[0], "font", "fonts");
                if (a) set({ ...f, assetPath: a.path, weight: undefined, weightMax: undefined });
              }} />
            </label>
          )}
        </div>
      </div>
    );
  };

  const musicSlot = (slot: MusicSlot, label: string, hint: string) => {
    const a = show.music[slot];
    return (
      <div className="row" key={slot}>
        <div style={{ minWidth: 150 }}>
          <b>{label}</b>
          <div className="small muted">{hint}</div>
        </div>
        <span className="small" style={{ flex: 1, minWidth: 120 }}>{a ? a.name : show.music.useDefaults ? "Built-in cue" : "None"}</span>
        <button className="btn sm" onClick={async () => new Audio(a ? await store.fileUrl(a.path) : DEFAULT_MUSIC[slot]).play()}>Play</button>
        {editable && (
          <label className="btn sm">
            Upload
            <input type="file" accept="audio/*" hidden onChange={async (e) => {
              const up = await upload(e.target.files?.[0], "audio", "music");
              if (up) change({ ...show, music: { ...show.music, [slot]: up } });
            }} />
          </label>
        )}
        {a && editable && <button className="icon-btn" onClick={() => change({ ...show, music: { ...show.music, [slot]: null } })} aria-label={`Remove ${label}`}>✕</button>}
      </div>
    );
  };

  const bookend = (which: "intro" | "outro", o: Orientation) => {
    const a = show[which][o];
    return (
      <div className="row" key={which + o}>
        <span style={{ minWidth: 110 }}>{o === "landscape" ? "Landscape 16:9" : o === "portrait" ? "Portrait 9:16" : "Square 1:1"}</span>
        <span className="small" style={{ flex: 1, minWidth: 120 }}>{a ? `${a.name}${a.duration ? ` · ${a.duration.toFixed(1)}s` : ""}` : "None"}</span>
        {editable && (
          <label className="btn sm">
            Upload
            <input type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={async (e) => {
              const up = await upload(e.target.files?.[0], "video", which);
              if (up) change({ ...show, [which]: { ...show[which], [o]: up } });
            }} />
          </label>
        )}
        {a && editable && <button className="icon-btn" onClick={() => change({ ...show, [which]: { ...show[which], [o]: null } })} aria-label="Remove">✕</button>}
      </div>
    );
  };

  const inkContrast = contrast(brand.palette.ink, brand.palette.bg);
  const dimContrast = contrast(brand.palette.dim, brand.palette.bg);

  return (
    <div>
      <h1 className="page">Brand</h1>
      <p className="page-sub">How The Bridge looks and sounds in every episode, video and page. Changes show in the preview straight away and save automatically.</p>
      <div className="studio">
        <div className="stack">
          <div className="seg" role="group" aria-label="Orientation">
            {(["landscape", "portrait", "square"] as Orientation[]).map((o) => (
              <button key={o} className={orientation === o ? "on" : ""} onClick={() => setOrientation(o)}>{o === "landscape" ? "16:9" : o === "portrait" ? "9:16" : "1:1"}</button>
            ))}
          </div>
          {prod ? <Preview prod={prod} audio={null} orientation={orientation} /> : <div className="panel">Preparing the preview…</div>}
          <div className="panel stack">
            <h2 className="sec">Name and words</h2>
            <div className="grid2">
              <label className="field">Show name<input className="input" value={show.name} disabled={!editable} onChange={(e) => change({ ...show, name: e.target.value })} /></label>
              <label className="field">Tagline<input className="input" value={show.tagline} disabled={!editable} onChange={(e) => change({ ...show, tagline: e.target.value })} /></label>
              <label className="field">Wordmark on screen<input className="input" value={brand.wordmark} disabled={!editable} onChange={(e) => setBrand({ wordmark: e.target.value })} /></label>
              <label className="field">Byline<input className="input" value={brand.byline} disabled={!editable} onChange={(e) => setBrand({ byline: e.target.value })} /></label>
              <label className="field">Badge<input className="input" value={brand.badge} disabled={!editable} onChange={(e) => setBrand({ badge: e.target.value })} /></label>
            </div>
            <label className="field">AI disclosure (read by the host and printed on pages)<textarea className="input" rows={3} value={show.disclosure} disabled={!editable} onChange={(e) => change({ ...show, disclosure: e.target.value })} /></label>
          </div>
          <div className="panel stack">
            <h2 className="sec">End card</h2>
            <div className="grid2">
              <label className="field">Headline<input className="input" value={show.endCard.headline} disabled={!editable} onChange={(e) => change({ ...show, endCard: { ...show.endCard, headline: e.target.value } })} /></label>
              <label className="field">Line under it<input className="input" value={show.endCard.sub} disabled={!editable} onChange={(e) => change({ ...show, endCard: { ...show.endCard, sub: e.target.value } })} /></label>
              <label className="field">Link<input className="input" value={show.endCard.url} disabled={!editable} onChange={(e) => change({ ...show, endCard: { ...show.endCard, url: e.target.value } })} /></label>
              <label className="check"><input type="checkbox" checked={show.endCard.showQr} disabled={!editable} onChange={(e) => change({ ...show, endCard: { ...show.endCard, showQr: e.target.checked } })} />Show a QR code for the link</label>
            </div>
          </div>
        </div>
        <div className="stack">
          <div className="panel stack">
            <h2 className="sec">Brand guide</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Upload the guide as a PDF, a web page (.html) or the whole project folder as a .zip. The studio reads its colours, fonts and logo, including any font
              files in the folder, and fits them to the stage. You can change anything afterwards.
            </p>
            <label className="btn" style={{ justifySelf: "start" }} aria-disabled={!!guide || !editable}>
              {guide ? `${guide}…` : "Import a brand guide"}
              <input
                type="file"
                accept=".pdf,.html,.htm,.zip,application/pdf,text/html,application/zip,application/x-zip-compressed"
                hidden
                disabled={!!guide || !editable}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) importGuide(file);
                }}
              />
            </label>
            {imported && (
              <div className="stack tight" style={{ background: "var(--panel2)", borderRadius: 10, padding: 12 }}>
                <b>Imported from {imported.source}</b>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  {imported.lines.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
                {imported.notes && <span className="small muted">{imported.notes}</span>}
                <div className="row">
                  <button className="btn sm" onClick={() => { change(imported.before); setImported(null); app.toast("Brand restored"); }}>Undo import</button>
                  <button className="btn ghost sm" onClick={() => setImported(null)}>Keep it</button>
                </div>
              </div>
            )}
          </div>
          <div className="panel stack">
            <h2 className="sec">Logo and scene</h2>
            <div className="row">
              <span style={{ flex: 1 }}>{brand.logo ? brand.logo.name : "No logo (the wordmark is used)"}</span>
              {editable && (
                <label className="btn sm">
                  Upload logo
                  <input type="file" accept="image/png,image/svg+xml,image/webp" hidden onChange={async (e) => { const a = await upload(e.target.files?.[0], "logo", "logo"); if (a) setBrand({ logo: a }); }} />
                </label>
              )}
              {brand.logo && editable && <button className="icon-btn" onClick={() => setBrand({ logo: null })} aria-label="Remove logo">✕</button>}
            </div>
            <p className="small muted" style={{ margin: 0 }}>Use a transparent PNG made for dark backgrounds.</p>
            <label className="field">
              Background scene
              <select className="input" value={brand.scene} disabled={!editable} onChange={(e) => setBrand({ scene: e.target.value as SceneKind })}>
                <option value="bridge">Lagos bridge at night</option>
                <option value="gradient">Soft gradient</option>
                <option value="grid">Grid</option>
                <option value="image">My image</option>
                <option value="plain">Plain colour</option>
              </select>
            </label>
            {brand.scene === "image" && (
              <>
                <div className="row">
                  <span style={{ flex: 1 }}>{brand.backgroundImage?.name ?? "No image yet"}</span>
                  {editable && (
                    <label className="btn sm">
                      Upload image
                      <input type="file" accept="image/*" hidden onChange={async (e) => { const a = await upload(e.target.files?.[0], "image", "backgrounds"); if (a) setBrand({ backgroundImage: a }); }} />
                    </label>
                  )}
                </div>
                <label className="field">
                  Darken the image · {Math.round(brand.backgroundDim * 100)}%
                  <input type="range" min={0} max={0.9} step={0.05} value={brand.backgroundDim} disabled={!editable} onChange={(e) => setBrand({ backgroundDim: Number(e.target.value) })} />
                </label>
              </>
            )}
          </div>
          <div className="panel stack">
            <h2 className="sec">Colours</h2>
            <div className="palette">
              {(Object.keys(PALETTE_LABELS) as (keyof Palette)[]).map((k) => (
                <label key={k}>
                  <input type="color" className="swatch" value={brand.palette[k]} disabled={!editable} onChange={(e) => setBrand({ palette: { ...brand.palette, [k]: e.target.value.toUpperCase() } })} />
                  <span>{PALETTE_LABELS[k]}<br /><span className="small muted">{brand.palette[k]}</span></span>
                </label>
              ))}
            </div>
            {(inkContrast < 7 || dimContrast < 4.5) && (
              <div className="flag">
                {inkContrast < 7 && <>Main text on the background is {inkContrast.toFixed(1)}:1; aim for 7:1 so captions stay readable on phones. </>}
                {dimContrast < 4.5 && <>Secondary text is {dimContrast.toFixed(1)}:1; aim for 4.5:1.</>}
              </div>
            )}
          </div>
          <div className="panel stack">
            <h2 className="sec">Fonts</h2>
            {font("display", "Headlines and figures")}
            {font("body", "Captions and text")}
            {font("mono", "Labels")}
          </div>
          <div className="panel stack">
            <h2 className="sec">Music and sounds</h2>
            {musicSlot("sting", "Intro sting", "plays as the show opens")}
            {musicSlot("bed", "Music bed", "under the welcome")}
            {musicSlot("ident", "Chapter ident", "between parts")}
            {musicSlot("outro", "Outro", "under the sign-off")}
            {musicSlot("blip", "Voice-note blip", "before each voice note")}
            <label className="check"><input type="checkbox" checked={show.music.useDefaults} disabled={!editable} onChange={(e) => change({ ...show, music: { ...show.music, useDefaults: e.target.checked } })} />Use the built-in cue for any empty slot</label>
            <label className="field">
              Music under speech · {Math.round(show.music.duckLevel * 100)}%
              <input type="range" min={0} max={0.4} step={0.01} value={show.music.duckLevel} disabled={!editable} onChange={(e) => change({ ...show, music: { ...show.music, duckLevel: Number(e.target.value) } })} />
            </label>
            <p className="small muted" style={{ margin: 0 }}>Only upload music you own or have licensed for podcasts and social video.</p>
          </div>
          <div className="panel stack">
            <h2 className="sec">Intro and outro videos</h2>
            <p className="small muted" style={{ margin: 0 }}>Added before and after full-episode videos. Upload a version for each shape you export; otherwise the closest one is letterboxed.</p>
            <span className="eyebrow">Intro</span>
            {(["landscape", "portrait", "square"] as Orientation[]).map((o) => bookend("intro", o))}
            <span className="eyebrow">Outro</span>
            {(["landscape", "portrait", "square"] as Orientation[]).map((o) => bookend("outro", o))}
            <label className="check"><input type="checkbox" checked={show.includeBookendAudioInMp3} disabled={!editable} onChange={(e) => change({ ...show, includeBookendAudioInMp3: e.target.checked })} />Also put their sound at the start and end of the MP3</label>
          </div>
        </div>
      </div>
    </div>
  );
}
