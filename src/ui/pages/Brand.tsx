import { useEffect, useRef, useState } from "react";
import type { AssetRef, FontChoice, Orientation, Palette, SceneKind, Show } from "../../shared/types";
import type { MusicSlot } from "../../shared/timeline";
import sample from "../../shared/sampleEpisode.json";
import type { Episode } from "../../shared/types";
import { store } from "../../lib/store";
import { uploadAsset } from "../../lib/assets";
import { prepare, DEFAULT_MUSIC, type Production } from "../../lib/engine";
import { pdfColours, pdfText } from "../../lib/notes";
import { api, serverAvailable, waitForJob } from "../../lib/api";
import { luminance } from "../../lib/render/text";
import { useApp } from "../ctx";
import { Preview } from "../components/Preview";

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
    try {
      setGuide("Reading the guide");
      const [text, colors] = await Promise.all([pdfText(f, 30), pdfColours(f)]);
      const { jobId } = await api.startAi({ kind: "brand", showId: app.show.id, payload: { text, colors } });
      const job: any = await waitForJob(jobId, (m) => setGuide(m));
      const r = job.result;
      const hex = /^#[0-9a-fA-F]{6}$/;
      const palette = { ...brand.palette };
      for (const k of Object.keys(palette) as (keyof Palette)[]) if (hex.test(r.palette?.[k] ?? "")) palette[k] = r.palette[k].toUpperCase();
      change({
        ...show,
        brand: {
          ...brand,
          palette,
          wordmark: r.wordmark || brand.wordmark,
          byline: r.byline || brand.byline,
          fonts: {
            display: r.displayFont ? { family: r.displayFont, source: "google" } : brand.fonts.display,
            body: r.bodyFont ? { family: r.bodyFont, source: "google" } : brand.fonts.body,
            mono: r.monoFont ? { family: r.monoFont, source: "google" } : brand.fonts.mono,
          },
        },
      });
      app.toast(r.notes ? `Applied. ${r.notes}` : "Applied the brand guide");
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
                if (a) set({ ...f, assetPath: a.path });
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
            <p className="small muted" style={{ margin: 0 }}>Upload the brand guide as a PDF and the AI suggests colours, fonts and wording. You can change anything afterwards.</p>
            <label className="btn" style={{ justifySelf: "start" }} aria-disabled={!serverAvailable() || !!guide}>
              {guide ?? "Import a brand guide (PDF)"}
              <input type="file" accept="application/pdf" hidden disabled={!serverAvailable() || !!guide || !editable} onChange={(e) => e.target.files?.[0] && importGuide(e.target.files[0])} />
            </label>
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
