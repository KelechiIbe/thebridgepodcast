import { useMemo, useRef, useState } from "react";
import type { Card, Chapter, ChapterCue, Line, LineKind, Persona, Poll, Script, WidgetType } from "../../shared/types";
import { uid } from "../../shared/ids";
import { toSpoken } from "../../shared/pronounce";
import { missingWords } from "../../shared/qa";
import { useApp } from "../ctx";
import { useEpisode, staleLines } from "./state";
import { CardForm, CARD_LABELS } from "./CardForm";
import { voiceCharacter, isStale } from "../../lib/engine";
import { api, serverAvailable } from "../../lib/api";
import { store } from "../../lib/store";

const CUES: Record<ChapterCue, string> = { none: "No music", sting: "Intro sting + bed", ident: "Chapter ident", outro: "Outro music" };
const WIDGETS: Record<WidgetType, string> = { "vat-commission": "VAT on fee vs package", "company-vs-bn": "Company vs business name", pit: "Personal income tax" };

let player: HTMLAudioElement | null = null;
async function playLine(path: string) {
  player?.pause();
  player = new Audio(await store.fileUrl(path));
  player.play().catch(() => {});
}

export function ScriptTab() {
  const app = useApp();
  const { ep, updateScript, generate, busyLines } = useEpisode();
  const script = ep.script;
  const stale = useMemo(() => new Set(staleLines(ep, app)), [ep, app]);
  if (!script) return <div className="panel">No script yet. Start from the Notes tab.</div>;
  const editable = app.can("edit");

  const chapterOf = new Map<string, Chapter>();
  script.chapters.forEach((c) => chapterOf.set(c.startLineId, c));

  const speakers = [
    ...app.characters.filter((c) => c.kind !== "listener").map((c) => ({ id: c.id, name: c.name })),
    ...script.personas.map((p) => ({ id: p.id, name: `${p.name} (listener)` })),
  ];

  const setLine = (id: string, patch: Partial<Line>) =>
    updateScript((s) => ({ ...s, lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const setCard = (c: Card) => updateScript((s) => ({ ...s, cards: s.cards.map((x) => (x.id === c.id ? c : x)) }));
  const setPoll = (p: Poll) => updateScript((s) => ({ ...s, polls: s.polls.map((x) => (x.id === p.id ? p : x)) }));
  const setChapter = (c: Chapter) => updateScript((s) => ({ ...s, chapters: s.chapters.map((x) => (x.id === c.id ? c : x)) }));
  const insertAfter = (id: string) =>
    updateScript((s) => {
      const i = s.lines.findIndex((l) => l.id === id);
      const src = s.lines[i];
      const line: Line = { id: uid("l"), speaker: src.speaker, kind: src.kind, text: "", audio: null };
      return { ...s, lines: [...s.lines.slice(0, i + 1), line, ...s.lines.slice(i + 1)] };
    });
  const removeLine = (id: string) =>
    updateScript((s) => {
      const i = s.lines.findIndex((l) => l.id === id);
      const next = s.lines[i + 1]?.id ?? s.lines[i - 1]?.id;
      return {
        ...s,
        lines: s.lines.filter((l) => l.id !== id),
        cards: s.cards.filter((c) => c.lineId !== id),
        polls: s.polls.filter((p) => p.afterLineId !== id),
        chapters: s.chapters.map((c) => (c.startLineId === id ? { ...c, startLineId: next ?? "" } : c)).filter((c) => c.startLineId),
      };
    });
  const move = (id: string, dir: -1 | 1) =>
    updateScript((s) => {
      const i = s.lines.findIndex((l) => l.id === id);
      const j = i + dir;
      if (j < 0 || j >= s.lines.length) return s;
      const lines = [...s.lines];
      [lines[i], lines[j]] = [lines[j], lines[i]];
      // chapters keep their position in the running order
      const chapters = s.chapters.map((c) => (c.startLineId === lines[j].id ? { ...c, startLineId: lines[i].id } : c.startLineId === lines[i].id ? { ...c, startLineId: lines[j].id } : c));
      return { ...s, lines, chapters };
    });
  const newChapter = (id: string) =>
    updateScript((s) => (s.chapters.some((c) => c.startLineId === id) ? s : { ...s, chapters: [...s.chapters, { id: uid("chap"), title: "New part", startLineId: id, cue: "ident" }] }));
  const addCard = (line: Line) =>
    updateScript((s) => ({ ...s, cards: [...s.cards, { id: uid("card"), lineId: line.id, anchor: line.text.split(/\s+/).slice(0, 2).join(" "), type: "stat", big: "", label: "" }] }));
  const addPoll = (line: Line) =>
    updateScript((s) => ({ ...s, polls: [...s.polls, { id: uid("poll"), afterLineId: line.id, question: "What do you think?", options: ["Option A", "Option B"], answer: 0, why: "" }] }));

  return (
    <div className="stack">
      <div className="panel stack">
        <div className="grid2">
          <label className="field">
            Episode title
            <input className="input" value={script.title} onChange={(e) => updateScript((s) => ({ ...s, title: e.target.value }))} disabled={!editable} />
          </label>
          <label className="field">
            One-line summary
            <input className="input" value={script.summary} onChange={(e) => updateScript((s) => ({ ...s, summary: e.target.value }))} disabled={!editable} />
          </label>
        </div>
        <Personas script={script} onChange={(personas) => updateScript((s) => ({ ...s, personas }))} editable={editable} />
        <div className="row small">
          <span className="eyebrow">Calculators on the episode page</span>
          {(Object.keys(WIDGETS) as WidgetType[]).map((w) => (
            <label key={w} className="check">
              <input
                type="checkbox"
                checked={script.widgets.some((x) => x.type === w)}
                disabled={!editable}
                onChange={(e) =>
                  updateScript((s) => ({ ...s, widgets: e.target.checked ? [...s.widgets, { id: uid("w"), type: w }] : s.widgets.filter((x) => x.type !== w) }))
                }
              />
              {WIDGETS[w]}
            </label>
          ))}
        </div>
        <div className="row">
          <span className="small muted">
            {script.lines.length} lines · {script.cards.length} visuals · {script.polls.length} quiz questions · {stale.size} lines need voices
          </span>
          <span className="spacer" />
          {stale.size > 0 && serverAvailable() && editable && (
            <button className="btn accent sm" onClick={() => generate([...stale])}>
              Generate {stale.size} voice{stale.size === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>

      <div>
        {script.lines.map((line, idx) => {
          const ch = chapterOf.get(line.id);
          const voiceChar = voiceCharacter(line, app.characters, script.personas);
          const busy = busyLines.has(line.id);
          const isStaleLine = isStale(line, voiceChar, app.show, app.pronunciations);
          const cards = script.cards.filter((c) => c.lineId === line.id);
          const polls = script.polls.filter((p) => p.afterLineId === line.id);
          const flags = script.flags.filter((f) => f.lineId === line.id);
          return (
            <div key={line.id}>
              {ch && (
                <div className="chapter-head">
                  <label className="field">
                    <span className="eyebrow">Part {script.chapters.indexOf(ch) + 1}</span>
                    <input className="input" value={ch.title} onChange={(e) => setChapter({ ...ch, title: e.target.value })} disabled={!editable} style={{ fontWeight: 700 }} />
                  </label>
                  <label className="field">
                    Music
                    <select className="input" value={ch.cue} onChange={(e) => setChapter({ ...ch, cue: e.target.value as ChapterCue })} disabled={!editable}>
                      {Object.entries(CUES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  {idx > 0 && editable && (
                    <button className="btn ghost sm" onClick={() => updateScript((s) => ({ ...s, chapters: s.chapters.filter((c) => c.id !== ch.id) }))}>
                      Merge into previous
                    </button>
                  )}
                </div>
              )}
              <LineRow
                line={line}
                speakers={speakers}
                editable={editable}
                busy={busy}
                stale={isStaleLine}
                hasVoice={!!voiceChar?.voice.voiceId}
                onChange={(p) => setLine(line.id, p)}
                onGenerate={() => generate([line.id])}
                onInsert={() => insertAfter(line.id)}
                onDelete={() => removeLine(line.id)}
                onMove={(d) => move(line.id, d)}
                onChapter={() => newChapter(line.id)}
                onAddCard={() => addCard(line)}
                onAddPoll={() => addPoll(line)}
              >
                {cards.map((c) => (
                  <CardItem key={c.id} card={c} line={line} editable={editable} onChange={setCard} onDelete={() => updateScript((s) => ({ ...s, cards: s.cards.filter((x) => x.id !== c.id) }))} />
                ))}
                {polls.map((p) => (
                  <PollItem key={p.id} poll={p} editable={editable} onChange={setPoll} onDelete={() => updateScript((s) => ({ ...s, polls: s.polls.filter((x) => x.id !== p.id) }))} />
                ))}
                {flags.map((f) => (
                  <div key={f.id} className={`flag ${f.severity}${f.resolved ? " resolved" : ""}`}>
                    <b>{f.severity === "info" ? "Note" : "Check"}:</b> “{f.claim}” · {f.issue} {f.suggestion && <span className="muted">{f.suggestion}</span>}
                    <div className="row" style={{ marginTop: 4 }}>
                      <label className="check small">
                        <input
                          type="checkbox"
                          checked={f.resolved}
                          disabled={!app.can("edit") && !app.can("approve")}
                          onChange={(e) => updateScript((s) => ({ ...s, flags: s.flags.map((x) => (x.id === f.id ? { ...x, resolved: e.target.checked } : x)) }))}
                        />
                        Resolved
                      </label>
                    </div>
                  </div>
                ))}
              </LineRow>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Personas({ script, onChange, editable }: { script: Script; onChange: (p: Persona[]) => void; editable: boolean }) {
  const app = useApp();
  const voices = app.characters.filter((c) => c.kind === "listener");
  if (!script.personas.length && !editable) return null;
  return (
    <div className="stack tight">
      <span className="eyebrow">Listeners in this episode (fictional)</span>
      {script.personas.map((p) => (
        <div className="row" key={p.id}>
          <input className="input" style={{ maxWidth: 160 }} value={p.name} disabled={!editable} onChange={(e) => onChange(script.personas.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))} aria-label="Listener name" />
          <input className="input" style={{ flex: 1, minWidth: 180 }} value={p.role} disabled={!editable} onChange={(e) => onChange(script.personas.map((x) => (x.id === p.id ? { ...x, role: e.target.value } : x)))} aria-label="What they do" />
          <select className="input" style={{ maxWidth: 220 }} value={p.voiceCharacterId} disabled={!editable} onChange={(e) => onChange(script.personas.map((x) => (x.id === p.id ? { ...x, voiceCharacterId: e.target.value } : x)))} aria-label="Voice">
            {voices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.voice.voiceName ? ` · ${v.voice.voiceName}` : ""}</option>)}
          </select>
          <input type="color" className="swatch" value={p.color} disabled={!editable} onChange={(e) => onChange(script.personas.map((x) => (x.id === p.id ? { ...x, color: e.target.value } : x)))} aria-label="Avatar colour" />
        </div>
      ))}
      {editable && (
        <button
          className="btn sm"
          style={{ justifySelf: "start" }}
          onClick={() => onChange([...script.personas, { id: uid("p"), name: "New listener", role: "What they do and where", voiceCharacterId: voices[0]?.id ?? "", color: "#9CC3FF" }])}
        >
          Add listener
        </button>
      )}
    </div>
  );
}

function LineRow(props: {
  line: Line;
  speakers: { id: string; name: string }[];
  editable: boolean;
  busy: boolean;
  stale: boolean;
  hasVoice: boolean;
  onChange: (p: Partial<Line>) => void;
  onGenerate: () => void;
  onInsert: () => void;
  onDelete: () => void;
  onMove: (d: -1 | 1) => void;
  onChapter: () => void;
  onAddCard: () => void;
  onAddPoll: () => void;
  children: React.ReactNode;
}) {
  const app = useApp();
  const { line, editable } = props;
  const [checking, setChecking] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const status = props.busy ? (
    <span className="pill warn">Generating…</span>
  ) : !line.audio ? (
    <span className="pill none">No voice yet</span>
  ) : props.stale ? (
    <span className="pill stale">Out of date</span>
  ) : (
    <span className="pill ok">Voice ready · {line.audio.duration.toFixed(1)}s</span>
  );
  const qa = line.audio?.qa;
  const check = async () => {
    if (!line.audio) return;
    setChecking(true);
    try {
      const r = await api.sttCheck(line.audio.path);
      const expected = toSpoken(line.text, app.pronunciations).spoken;
      const mismatches = missingWords(expected, r.text);
      props.onChange({ audio: { ...line.audio, qa: { checkedAt: new Date().toISOString(), heard: r.text, mismatches } } });
      app.toast(mismatches.length ? `Check ${mismatches.length} word${mismatches.length === 1 ? "" : "s"} in this line` : "Every word came through clearly");
    } catch (e) {
      app.toast((e as Error).message, true);
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className={`line${line.kind === "voicenote" ? " vn" : ""}`}>
      <div className="who">
        <select className="input" value={line.speaker} disabled={!editable} onChange={(e) => props.onChange({ speaker: e.target.value })} aria-label="Speaker">
          {props.speakers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="input" value={line.kind} disabled={!editable} onChange={(e) => props.onChange({ kind: e.target.value as LineKind })} aria-label="Line type">
          <option value="studio">Studio</option>
          <option value="voicenote">Voice note</option>
          <option value="letter">Written question</option>
        </select>
      </div>
      <div style={{ minWidth: 0 }}>
        <textarea
          ref={ta}
          className="input"
          rows={Math.max(2, Math.ceil(line.text.length / 90))}
          value={line.text}
          disabled={!editable}
          onChange={(e) => props.onChange({ text: e.target.value })}
          aria-label="Line text"
        />
        <div className="line-meta">
          {status}
          {qa && (
            <span>
              {qa.mismatches.length ? (
                <>Check: {qa.mismatches.map((m, i) => <span key={i} className="qa-miss">{m}</span>).reduce<React.ReactNode[]>((acc, x, i) => (i ? [...acc, " ", x] : [x]), [])}</>
              ) : (
                "Pronunciation checked"
              )}
            </span>
          )}
        </div>
        {(Array.isArray(props.children) ? props.children.flat().filter(Boolean).length > 0 : !!props.children) && <div className="attach">{props.children}</div>}
      </div>
      <div className="tools">
        {line.audio && <button className="btn sm" onClick={() => playLine(line.audio!.path)}>Play</button>}
        {editable && serverAvailable() && (
          <button className="btn sm" disabled={props.busy || !props.hasVoice || !line.text.trim()} onClick={props.onGenerate} title={props.hasVoice ? "" : "Give this speaker a voice under Characters"}>
            {line.audio ? "Regenerate" : "Generate voice"}
          </button>
        )}
        {line.audio && serverAvailable() && (
          <button className="btn sm" disabled={checking} onClick={check}>
            {checking ? "Listening…" : "Check words"}
          </button>
        )}
        {editable && (
          <details>
            <summary className="btn sm ghost" style={{ listStyle: "none" }}>More</summary>
            <div className="stack tight" style={{ marginTop: 6 }}>
              <button className="btn sm" onClick={props.onAddCard}>Add visual</button>
              <button className="btn sm" onClick={props.onAddPoll}>Add quiz question</button>
              <button className="btn sm" onClick={props.onInsert}>Insert line below</button>
              <button className="btn sm" onClick={props.onChapter}>Start new part here</button>
              <div className="row">
                <button className="btn sm" onClick={() => props.onMove(-1)} aria-label="Move up">↑</button>
                <button className="btn sm" onClick={() => props.onMove(1)} aria-label="Move down">↓</button>
              </div>
              <button className="btn sm danger" onClick={props.onDelete}>Delete line</button>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function CardItem({ card, line, editable, onChange, onDelete }: { card: Card; line: Line; editable: boolean; onChange: (c: Card) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const summary = card.big || card.quote || card.label || card.unit || card.doText || (card.steps ?? card.parts ?? []).join(" · ");
  return (
    <div className="attach-item" style={{ display: "block" }}>
      <div className="row">
        <span className="kind">{CARD_LABELS[card.type]}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
        <span className="small muted">at “{card.anchor}”</span>
        {editable && <button className="btn ghost sm" onClick={() => setOpen(!open)}>{open ? "Done" : "Edit"}</button>}
        {editable && <button className="icon-btn" onClick={onDelete} aria-label="Delete visual">✕</button>}
      </div>
      {open && <div style={{ marginTop: 10 }}><CardForm card={card} onChange={onChange} lineText={line.text} /></div>}
    </div>
  );
}

function PollItem({ poll, editable, onChange, onDelete }: { poll: Poll; editable: boolean; onChange: (p: Poll) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="attach-item" style={{ display: "block" }}>
      <div className="row">
        <span className="kind">Quiz</span>
        <span style={{ flex: 1 }}>{poll.question}</span>
        {editable && <button className="btn ghost sm" onClick={() => setOpen(!open)}>{open ? "Done" : "Edit"}</button>}
        {editable && <button className="icon-btn" onClick={onDelete} aria-label="Delete quiz question">✕</button>}
      </div>
      {open && (
        <div className="stack tight" style={{ marginTop: 10 }}>
          <label className="field">
            Question
            <input className="input" value={poll.question} onChange={(e) => onChange({ ...poll, question: e.target.value })} />
          </label>
          {poll.options.map((o, i) => (
            <div className="row" key={i}>
              <input type="radio" name={`ans-${poll.id}`} checked={poll.answer === i} onChange={() => onChange({ ...poll, answer: i })} aria-label="Correct answer" />
              <input className="input" style={{ flex: 1 }} value={o} onChange={(e) => onChange({ ...poll, options: poll.options.map((x, j) => (j === i ? e.target.value : x)) })} />
              {poll.options.length > 2 && <button className="icon-btn" onClick={() => onChange({ ...poll, options: poll.options.filter((_, j) => j !== i), answer: Math.min(poll.answer, poll.options.length - 2) })}>✕</button>}
            </div>
          ))}
          {poll.options.length < 4 && <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => onChange({ ...poll, options: [...poll.options, "Another option"] })}>Add option</button>}
          <label className="field">
            Why (shown after answering)
            <input className="input" value={poll.why} onChange={(e) => onChange({ ...poll, why: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}
