import { useState } from "react";
import type { Fact, Pronunciation } from "../../shared/types";
import { uid } from "../../shared/ids";
import { toSpoken } from "../../shared/pronounce";
import { store } from "../../lib/store";
import { api, serverAvailable } from "../../lib/api";
import { useApp } from "../ctx";
import { download } from "../../lib/assets";

export function Pronunciations() {
  const app = useApp();
  const [test, setTest] = useState("Register your business name with CAC, then download your TCC from Rev360.");
  const [voiceId, setVoiceId] = useState(app.characters.find((c) => c.voice.voiceId)?.id ?? "");
  const [busy, setBusy] = useState(false);
  const editable = app.can("edit");
  const list = app.pronunciations;
  const save = async (p: Pronunciation) => {
    await store.savePronunciation(app.show.id, p);
    app.setPronunciations(list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p]);
  };
  const remove = async (id: string) => {
    await store.deletePronunciation(id);
    app.setPronunciations(list.filter((x) => x.id !== id));
  };
  const listen = async (text: string) => {
    const ch = app.characters.find((c) => c.id === voiceId);
    if (!ch?.voice.voiceId) return app.toast("Pick a character that has a voice", true);
    setBusy(true);
    try {
      const r = await api.tts({ text: toSpoken(text, list).spoken, voiceId: ch.voice.voiceId, modelId: app.show.ttsModel, settings: ch.voice.settings, preview: true });
      new Audio(`data:audio/mpeg;base64,${r.audioBase64}`).play();
    } catch (e) {
      app.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const importCsv = async (f: File) => {
    const rows = (await f.text()).split(/\r?\n/).slice(1).filter(Boolean);
    for (const r of rows) {
      const [term, sayAs, cs, ...note] = r.split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
      if (term && sayAs) await save({ id: uid("pr"), term, sayAs, caseSensitive: cs !== "no", note: note.join(",") });
    }
    app.toast(`Imported ${rows.length} entries`);
  };
  return (
    <div>
      <h1 className="page">Pronunciation</h1>
      <p className="page-sub">
        Teach the voices how to say acronyms, names and brands. Captions keep the written form; only the voice hears the “say as” version. Naira amounts like
        ₦3m are read as “3 million naira” automatically.
      </p>
      <div className="panel stack" style={{ marginBottom: 18 }}>
        <span className="eyebrow">Try it</span>
        <div className="row">
          <input className="input" style={{ flex: 1, minWidth: 240 }} value={test} onChange={(e) => setTest(e.target.value)} aria-label="Test sentence" />
          <select className="input" style={{ maxWidth: 200 }} value={voiceId} onChange={(e) => setVoiceId(e.target.value)} aria-label="Voice">
            {app.characters.filter((c) => c.voice.voiceId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn" disabled={busy || !serverAvailable()} onClick={() => listen(test)}>{busy ? "Generating…" : "Listen"}</button>
        </div>
        <div className="small muted">The voice reads: “{toSpoken(test, list).spoken}”</div>
      </div>
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Written</th><th>Say as</th><th>Match case</th><th>Note</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <PronRow key={p.id} p={p} onSave={save} onDelete={() => remove(p.id)} onListen={() => listen(p.term)} editable={editable} />
              ))}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn sm" onClick={() => save({ id: uid("pr"), term: "", sayAs: "", caseSensitive: true, note: "" })}>Add word</button>
            <label className="btn sm">
              Import CSV
              <input type="file" accept=".csv" hidden onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
            </label>
            <button
              className="btn sm ghost"
              onClick={() => download(new Blob([["term,say_as,match_case,note", ...list.map((p) => [p.term, p.sayAs, p.caseSensitive ? "yes" : "no", p.note].map((x) => `"${x.replace(/"/g, "'")}"`).join(","))].join("\n")], { type: "text/csv" }), "pronunciation-library.csv")}
            >
              Export CSV
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PronRow({ p, onSave, onDelete, onListen, editable }: { p: Pronunciation; onSave: (p: Pronunciation) => void; onDelete: () => void; onListen: () => void; editable: boolean }) {
  const [d, setD] = useState(p);
  const commit = () => JSON.stringify(d) !== JSON.stringify(p) && onSave(d);
  return (
    <tr>
      <td><input className="input" value={d.term} disabled={!editable} onChange={(e) => setD({ ...d, term: e.target.value })} onBlur={commit} aria-label="Written form" /></td>
      <td><input className="input" value={d.sayAs} disabled={!editable} onChange={(e) => setD({ ...d, sayAs: e.target.value })} onBlur={commit} aria-label="Say as" /></td>
      <td><input type="checkbox" checked={d.caseSensitive} disabled={!editable} onChange={(e) => onSave({ ...d, caseSensitive: e.target.checked })} aria-label="Match case" /></td>
      <td><input className="input" value={d.note} disabled={!editable} onChange={(e) => setD({ ...d, note: e.target.value })} onBlur={commit} aria-label="Note" /></td>
      <td className="row" style={{ flexWrap: "nowrap" }}>
        {serverAvailable() && <button className="btn sm" onClick={onListen} disabled={!d.term}>Listen</button>}
        {editable && <button className="icon-btn" onClick={onDelete} aria-label="Delete">✕</button>}
      </td>
    </tr>
  );
}

export function Facts() {
  const app = useApp();
  const editable = app.can("edit");
  const save = async (f: Fact) => {
    await store.saveFact(app.show.id, f);
    app.setFacts(app.facts.some((x) => x.id === f.id) ? app.facts.map((x) => (x.id === f.id ? f : x)) : [...app.facts, f]);
  };
  const remove = async (id: string) => {
    await store.deleteFact(id);
    app.setFacts(app.facts.filter((x) => x.id !== id));
  };
  return (
    <div>
      <h1 className="page">Tax facts</h1>
      <p className="page-sub">
        The script writer treats these as the current law. If an expert's answer in the notes disagrees, the script uses the figure here and flags the change for
        the expert. Keep it short and current; review it whenever rules change.
      </p>
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th style={{ width: "26%" }}>Fact</th><th>Value</th><th style={{ width: "20%" }}>Source</th><th style={{ width: 120 }}>From</th><th></th></tr>
            </thead>
            <tbody>
              {app.facts.map((f) => <FactRow key={f.id} f={f} onSave={save} onDelete={() => remove(f.id)} editable={editable} />)}
            </tbody>
          </table>
        </div>
        {editable && (
          <button className="btn sm" style={{ marginTop: 12 }} onClick={() => save({ id: uid("fact"), key: "", label: "New fact", value: "", source: "", effectiveFrom: new Date().toISOString().slice(0, 10), notes: "" })}>
            Add fact
          </button>
        )}
      </div>
    </div>
  );
}

function FactRow({ f, onSave, onDelete, editable }: { f: Fact; onSave: (f: Fact) => void; onDelete: () => void; editable: boolean }) {
  const [d, setD] = useState(f);
  const commit = () => JSON.stringify(d) !== JSON.stringify(f) && onSave(d);
  const cell = (k: keyof Fact, multi = false) =>
    multi ? (
      <textarea className="input" rows={2} value={d[k]} disabled={!editable} onChange={(e) => setD({ ...d, [k]: e.target.value })} onBlur={commit} aria-label={k} />
    ) : (
      <input className="input" value={d[k]} disabled={!editable} onChange={(e) => setD({ ...d, [k]: e.target.value })} onBlur={commit} aria-label={k} />
    );
  return (
    <tr>
      <td>{cell("label", true)}</td>
      <td>{cell("value", true)}</td>
      <td>{cell("source", true)}</td>
      <td><input className="input" type="date" value={d.effectiveFrom} disabled={!editable} onChange={(e) => onSave({ ...d, effectiveFrom: e.target.value })} aria-label="Effective from" /></td>
      <td>{editable && <button className="icon-btn" onClick={onDelete} aria-label="Delete">✕</button>}</td>
    </tr>
  );
}
