import { useRef, useState } from "react";
import type { Orientation, SocialPack } from "../../shared/types";
import { toSrt, toTranscript, toVtt, clock } from "../../shared/captions";
import { useApp } from "../ctx";
import { useEpisode } from "./state";
import { download, slugify } from "../../lib/assets";
import { encodeMp3 } from "../../lib/audio/mp3";
import { encodeWav } from "../../lib/audio/wav";
import { mixProduction, bookend } from "../../lib/engine";
import { renderVideo, SIZES } from "../../lib/export/mp4";
import { bookendAudio } from "../../lib/export/bookends";
import { buildInteractiveHtml } from "../../lib/export/interactive";
import { StageRenderer } from "../../lib/render/stage";
import { ensureFonts } from "../../lib/render/fonts";
import { store } from "../../lib/store";
import { api, serverAvailable, waitForJob } from "../../lib/api";

export function ExportTab() {
  const app = useApp();
  const { ep, prod, mix, buildMix, updateScript } = useEpisode();
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [withBookends, setWithBookends] = useState(true);
  const [job, setJob] = useState<{ label: string; p: number } | null>(null);
  const [social, setSocial] = useState<SocialPack | null>(ep.script?.social ?? null);
  const abort = useRef<AbortController | null>(null);
  if (!ep.script) return <div className="panel">No script yet.</div>;
  if (!prod) return <div className="panel">Preparing the export options…</div>;
  const script = ep.script;
  const base = `${slugify(app.show.name)}-ep${String(ep.number).padStart(2, "0")}`;
  const names: Record<string, string> = {};
  app.characters.forEach((c) => (names[c.id] = c.name));
  script.personas.forEach((p) => (names[p.id] = p.name));
  const draft = prod.model.draft;
  const silentLines = prod.timeline.lines.filter((l) => l.estimated).length;
  const intro = bookend(app.show, "intro", orientation);
  const outro = bookend(app.show, "outro", orientation);

  const ensureMix = async () => mix ?? (await buildMix());

  const run = async (label: string, fn: (progress: (p: number, l?: string) => void, signal: AbortSignal) => Promise<void>) => {
    abort.current = new AbortController();
    setJob({ label, p: 0 });
    try {
      await fn((p, l) => setJob({ label: l ?? label, p }), abort.current.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") app.toast((e as Error).message, true);
    } finally {
      setJob(null);
      abort.current = null;
    }
  };

  const exportMp3 = () =>
    run("Encoding MP3", async (progress) => {
      let m = await ensureMix();
      if (!m) return;
      const pre = bookend(app.show, "intro", "landscape");
      const post = bookend(app.show, "outro", "landscape");
      if (app.show.includeBookendAudioInMp3 && (pre || post)) {
        progress(0, "Adding intro and outro sound");
        m = await mixProduction(prod, {
          bookends: {
            pre: pre ? await bookendAudio(await store.download(pre.path)) : null,
            post: post ? await bookendAudio(await store.download(post.path)) : null,
          },
        });
      }
      const blob = await encodeMp3(m.channels[0], m.channels[1], m.rate, 128, (p) => progress(p));
      download(blob, `${base}.mp3`);
    });

  const exportWav = () =>
    run("Writing WAV", async () => {
      const m = await ensureMix();
      if (m) download(encodeWav(m.channels, m.rate), `${base}.wav`);
    });

  const exportMp4 = () =>
    run("Preparing video", async (progress, signal) => {
      await ensureFonts(app.show.brand);
      const size = SIZES[orientation];
      const lines = prod.timeline.lines;
      const r = range ? { start: Math.max(0, (lines.find((l) => l.id === range.start)?.s ?? 0) - 0.6), end: (lines.find((l) => l.id === range.end)?.e ?? prod.timeline.duration) + 1 } : null;
      let introBlob: Blob | null = null;
      let outroBlob: Blob | null = null;
      let m = await ensureMix();
      if (!m) return;
      if (!r && withBookends && (intro || outro)) {
        progress(0, "Reading intro and outro");
        introBlob = intro ? await store.download(intro.path) : null;
        outroBlob = outro ? await store.download(outro.path) : null;
        m = await mixProduction(prod, { bookends: { pre: introBlob ? await bookendAudio(introBlob) : null, post: outroBlob ? await bookendAudio(outroBlob) : null } });
      }
      const { blob, format } = await renderVideo({
        model: prod.model,
        mix: m,
        width: size.w,
        height: size.h,
        range: r,
        intro: introBlob,
        outro: outroBlob,
        signal,
        onProgress: (p, l) => progress(p, l),
      });
      download(blob, `${base}-${orientation}${r ? "-clip" : ""}.${format.container}`);
      if (format.container === "webm") app.toast("This browser can't make MP4, so the video was saved as WebM. Use Chrome or Edge for MP4.", true);
    });

  const exportInteractive = () =>
    run("Building the interactive page", async (progress) => {
      const m = await ensureMix();
      if (!m) return;
      progress(0.1, "Encoding audio");
      const mp3 = await encodeMp3(m.channels[0], m.channels[1], m.rate, 96, (p) => progress(0.1 + p * 0.7, "Encoding audio"));
      progress(0.85, "Packing the page");
      const html = await buildInteractiveHtml(prod, mp3, { voice: m.envVoice, music: m.envMusic });
      download(html, `${base}-interactive.html`);
    });

  const exportCover = () =>
    run("Drawing cover art", async () => {
      await ensureFonts(app.show.brand);
      const c = document.createElement("canvas");
      c.width = 1400;
      c.height = 1400;
      new StageRenderer({ ...prod.model, draft: false }).render(c.getContext("2d")!, 1400, 1400, 0.2);
      c.toBlob((b) => b && download(b, `${base}-cover.png`), "image/png");
    });

  const text = (s: string, name: string, type = "text/plain") => download(new Blob([s], { type }), name);

  const makeSocial = () =>
    run("Writing launch copy", async (progress) => {
      const lineSeconds: Record<string, number> = {};
      prod.timeline.lines.forEach((l) => (lineSeconds[l.id] = l.e - l.s));
      const { jobId } = await api.startAi({
        kind: "social",
        showId: app.show.id,
        episodeId: ep.id,
        payload: { script, show: app.show, chapterTimes: prod.timeline.chapters.map((c) => ({ title: c.title, at: clock(c.t) })), lineSeconds, names },
      });
      const job: any = await waitForJob(jobId, (msg, p) => progress(p / 100, msg));
      const pack = job.result as SocialPack;
      pack.clips = (pack.clips ?? []).filter((c) => script.lines.some((l) => l.id === c.startLineId) && script.lines.some((l) => l.id === c.endLineId));
      setSocial(pack);
      updateScript((s) => ({ ...s, social: pack }));
    });

  return (
    <div className="stack">
      {(draft || silentLines > 0) && (
        <div className="demo-banner">
          {draft && <>This episode isn't approved, so videos and pages carry a “Draft” watermark. </>}
          {silentLines > 0 && <>{silentLines} line{silentLines === 1 ? " has" : "s have"} no current voice and will be silent.</>}
        </div>
      )}
      {job && (
        <div className="panel stack tight">
          <div className="row">
            <b>{job.label}</b>
            <span className="spacer" />
            <span className="time">{Math.round(job.p * 100)}%</span>
            {abort.current && <button className="btn sm" onClick={() => abort.current?.abort()}>Cancel</button>}
          </div>
          <div className="progress"><i style={{ width: `${Math.round(job.p * 100)}%` }} /></div>
        </div>
      )}
      <div className="grid2">
        <div className="panel stack">
          <h2 className="sec">Video</h2>
          <div className="seg" role="group" aria-label="Orientation">
            {(["landscape", "portrait", "square"] as Orientation[]).map((o) => (
              <button key={o} className={orientation === o ? "on" : ""} onClick={() => setOrientation(o)}>
                {o === "landscape" ? "Landscape 16:9" : o === "portrait" ? "Portrait 9:16" : "Square 1:1"}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={!!range} onChange={(e) => setRange(e.target.checked ? { start: script.lines[0].id, end: script.lines[Math.min(4, script.lines.length - 1)].id } : null)} />
            Export a clip instead of the full episode
          </label>
          {range && (
            <div className="grid2">
              <label className="field">
                From
                <select className="input" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })}>
                  {script.lines.map((l, i) => <option key={l.id} value={l.id}>{i + 1}. {names[l.speaker]}: {l.text.slice(0, 50)}</option>)}
                </select>
              </label>
              <label className="field">
                To
                <select className="input" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })}>
                  {script.lines.map((l, i) => <option key={l.id} value={l.id}>{i + 1}. {names[l.speaker]}: {l.text.slice(0, 50)}</option>)}
                </select>
              </label>
            </div>
          )}
          {!range && (intro || outro) && (
            <label className="check">
              <input type="checkbox" checked={withBookends} onChange={(e) => setWithBookends(e.target.checked)} />
              Add the {intro ? "intro" : ""}{intro && outro ? " and " : ""}{outro ? "outro" : ""} video
            </label>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            Rendered on this computer in Chrome or Edge. A full episode takes about as long as the episode itself; keep this tab open.
          </p>
          <button className="btn accent" style={{ justifySelf: "start" }} disabled={!!job} onClick={exportMp4}>Export MP4</button>
        </div>
        <div className="panel stack">
          <h2 className="sec">Audio and page</h2>
          <div className="row">
            <button className="btn" disabled={!!job} onClick={exportMp3}>MP3 for podcast apps</button>
            <button className="btn" disabled={!!job} onClick={exportWav}>WAV master</button>
          </div>
          <div className="row">
            <button className="btn" disabled={!!job} onClick={exportInteractive}>Interactive page (.html)</button>
            <button className="btn" disabled={!!job} onClick={exportCover}>Cover art (.png)</button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            The interactive page is a single file with the audio, visuals, quiz pauses, calculators and transcript. Upload it to your website or share it as is.
          </p>
          <span className="eyebrow">Text</span>
          <div className="row">
            <button className="btn sm" onClick={() => text(toSrt(prod.timeline, names), `${base}.srt`)}>Captions .srt</button>
            <button className="btn sm" onClick={() => text(toVtt(prod.timeline, names), `${base}.vtt`, "text/vtt")}>Captions .vtt</button>
            <button className="btn sm" onClick={() => text(toTranscript(prod.timeline, names), `${base}-transcript.txt`)}>Transcript</button>
          </div>
        </div>
      </div>
      <div className="panel stack">
        <div className="row">
          <h2 className="sec" style={{ margin: 0 }}>Launch pack</h2>
          <span className="spacer" />
          {serverAvailable() && app.can("edit") && <button className="btn sm" disabled={!!job} onClick={makeSocial}>{social ? "Write again" : "Write show notes, posts and clip picks"}</button>}
        </div>
        {!social && <p className="small muted" style={{ margin: 0 }}>Show notes with chapters, a LinkedIn post, a WhatsApp broadcast, a short post for X and the three best moments for vertical clips.</p>}
        {social && (
          <div className="grid2">
            {(["showNotes", "linkedin", "whatsapp", "x"] as const).map((k) => (
              <label className="field" key={k}>
                {k === "showNotes" ? "Show notes" : k === "linkedin" ? "LinkedIn" : k === "whatsapp" ? "WhatsApp broadcast" : "X"}
                <textarea className="input" rows={k === "showNotes" || k === "linkedin" ? 9 : 4} value={social[k]} onChange={(e) => setSocial({ ...social, [k]: e.target.value })} />
                <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => navigator.clipboard.writeText(social[k]).then(() => app.toast("Copied"))}>Copy</button>
              </label>
            ))}
            <div className="stack tight">
              <span className="eyebrow">Clip picks</span>
              {social.clips.map((c, i) => (
                <div key={i} className="panel flat" style={{ padding: 10 }}>
                  <b>{c.title}</b>
                  <div className="small muted">{c.why}</div>
                  <button
                    className="btn sm"
                    style={{ marginTop: 6 }}
                    onClick={() => {
                      setRange({ start: c.startLineId, end: c.endLineId });
                      setOrientation("portrait");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Set up this clip (9:16)
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
