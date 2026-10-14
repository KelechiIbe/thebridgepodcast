import { useRef, useState } from "react";
import type { Orientation, Script, Show } from "../../shared/types";
import { applyOps } from "../../shared/aiSchema";
import { useApp } from "../ctx";
import { useEpisode } from "./state";
import { Preview, type PreviewHandle } from "../components/Preview";
import { api, serverAvailable } from "../../lib/api";

interface Msg {
  role: "user" | "ai";
  text: string;
  applied?: string[];
  skipped?: string[];
}

const SUGGESTIONS = [
  "Make the captions boxed and turn on the progress bar",
  "Add a steps card when Kelechi explains how to register",
  "Shorten Funke's first voice note",
  "Use a warmer accent colour",
];

export function StudioTab() {
  const app = useApp();
  const { ep, prod, prodVersion, mixBuffer, mixing, buildMix, updateScript } = useEpisode();
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const undo = useRef<{ script: Script; show: Show }[]>([]);
  const handle = useRef<PreviewHandle | null>(null);
  const hasAudio = !!ep.script?.lines.some((l) => l.audio);

  const send = async (text: string) => {
    if (!text.trim() || !ep.script) return;
    const history = msgs.map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setThinking(true);
    try {
      const out = await api.edit({ script: ep.script, show: app.show, characters: app.characters, message: text, history });
      const res = applyOps(ep.script, app.show, out.ops);
      if (res.applied.length) {
        undo.current.push({ script: ep.script, show: app.show });
        updateScript(() => res.script);
        if (JSON.stringify(res.show) !== JSON.stringify(app.show)) await app.saveShow(res.show);
      }
      setMsgs((m) => [...m, { role: "ai", text: out.reply, applied: res.applied, skipped: res.skipped }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "ai", text: (e as Error).message }]);
    } finally {
      setThinking(false);
    }
  };

  const undoLast = async () => {
    const last = undo.current.pop();
    if (!last) return;
    updateScript(() => last.script);
    await app.saveShow(last.show);
    setMsgs((m) => [...m, { role: "ai", text: "Undid the last change." }]);
  };

  if (!ep.script) return <div className="panel">No script yet.</div>;
  return (
    <div className="studio">
      <div className="stack">
        <div className="row">
          <div className="seg" role="group" aria-label="Orientation">
            {(["landscape", "portrait", "square"] as Orientation[]).map((o) => (
              <button key={o} className={orientation === o ? "on" : ""} onClick={() => setOrientation(o)}>
                {o === "landscape" ? "16:9" : o === "portrait" ? "9:16" : "1:1"}
              </button>
            ))}
          </div>
          <span className="spacer" />
          {hasAudio && (
            <button className="btn sm" onClick={buildMix} disabled={mixing || !prod}>
              {!prod ? "Preparing…" : mixing ? "Mixing audio…" : mixBuffer ? "Remix audio" : "Load audio"}
            </button>
          )}
        </div>
        {prod ? (
          <Preview prod={prod} audio={mixBuffer} orientation={orientation} version={prodVersion} handleRef={(h) => (handle.current = h)} />
        ) : (
          <div className="panel">Preparing the preview…</div>
        )}
        <QuickLayout />
      </div>
      <div className="panel chat">
        <div className="row">
          <h2 className="sec" style={{ margin: 0 }}>Ask for changes</h2>
          <span className="spacer" />
          {undo.current.length > 0 && <button className="btn ghost sm" onClick={undoLast}>Undo last</button>}
        </div>
        <div className="chat-log" aria-live="polite">
          {!msgs.length && (
            <div className="stack tight">
              <p className="small muted" style={{ margin: 0 }}>
                Describe what should change on screen or in the script. The AI edits cards, lines, quiz questions, colours and layout; you see it in the preview straight away.
              </p>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn sm" style={{ justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left" }} onClick={() => send(s)} disabled={!serverAvailable() || !app.can("edit")}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.text}
              {!!m.applied?.length && <ul>{m.applied.map((a, j) => <li key={j}>{a}</li>)}</ul>}
              {!!m.skipped?.length && <ul>{m.skipped.map((a, j) => <li key={j} style={{ color: "var(--warn)" }}>Skipped: {a}</li>)}</ul>}
            </div>
          ))}
          {thinking && <div className="msg ai muted">Working on it…</div>}
        </div>
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            className="input"
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={serverAvailable() ? "e.g. Put the ₦5m penalty card in red" : "Chat edits need the online studio"}
            disabled={!serverAvailable() || thinking || !app.can("edit")}
            aria-label="Describe a change"
          />
          <button className="btn primary" disabled={!serverAvailable() || thinking || !input.trim()}>Send</button>
        </form>
      </div>
    </div>
  );
}

function QuickLayout() {
  const app = useApp();
  const l = app.show.layout;
  const set = (patch: Partial<typeof l>) => app.saveShow({ ...app.show, layout: { ...l, ...patch } });
  const toggle = (key: keyof typeof l, label: string) => (
    <label className="check small">
      <input type="checkbox" checked={!!l[key]} onChange={(e) => set({ [key]: e.target.checked } as Partial<typeof l>)} disabled={!app.can("edit")} />
      {label}
    </label>
  );
  return (
    <div className="panel flat stack tight">
      <span className="eyebrow">On screen (applies to every episode)</span>
      <div className="row">
        {toggle("showSpeakers", "Speakers")}
        {toggle("showCaptions", "Captions")}
        {toggle("showChapterLabel", "Chapter label")}
        {toggle("showBadge", "AI badge")}
        {toggle("showLogo", "Logo")}
        {toggle("showProgress", "Progress bar")}
      </div>
      <div className="row">
        <label className="field" style={{ minWidth: 160 }}>
          Captions
          <select className="input" value={l.captionStyle} onChange={(e) => set({ captionStyle: e.target.value as typeof l.captionStyle })} disabled={!app.can("edit")}>
            <option value="karaoke">Word by word</option>
            <option value="plain">Plain</option>
            <option value="boxed">Boxed</option>
          </select>
        </label>
        <label className="field" style={{ minWidth: 160 }}>
          Speakers shown as
          <select className="input" value={l.speakerStyle} onChange={(e) => set({ speakerStyle: e.target.value as typeof l.speakerStyle })} disabled={!app.can("edit")}>
            <option value="portrait">Photos</option>
            <option value="initials">Initials</option>
          </select>
        </label>
        <label className="field" style={{ minWidth: 160 }}>
          End card (seconds)
          <input className="input" type="number" min={2} max={20} value={l.endCardSeconds} onChange={(e) => set({ endCardSeconds: Number(e.target.value) || 5 })} disabled={!app.can("edit")} />
        </label>
      </div>
    </div>
  );
}
