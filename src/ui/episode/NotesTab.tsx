import { useState } from "react";
import { useApp } from "../ctx";
import { useEpisode } from "./state";
import { FileDrop } from "../components/FileDrop";
import { readNotesFile } from "../../lib/notes";
import { api, serverAvailable, waitForJob } from "../../lib/api";
import { uid } from "../../shared/ids";
import type { Script } from "../../shared/types";

export function NotesTab() {
  const app = useApp();
  const { ep, update, saveNow, reload } = useEpisode();
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState<{ msg: string; p: number } | null>(null);
  const notes = ep.notes?.text ?? "";
  const words = notes ? notes.split(/\s+/).length : 0;

  const onFile = async (files: File[]) => {
    try {
      const text = await readNotesFile(files[0]);
      update((e) => ({ ...e, notes: { fileName: files[0].name, text, uploadedAt: new Date().toISOString() } }));
      app.toast(`Read ${files[0].name}`);
    } catch (e) {
      app.toast((e as Error).message, true);
    }
  };

  const write = async () => {
    if (ep.script && !confirm("Write a new script from the notes? The current script is saved in Versions first.")) return;
    try {
      await saveNow();
      setBusy({ msg: "Starting", p: 2 });
      const { jobId } = await api.startAi({ kind: "script", showId: app.show.id, episodeId: ep.id, payload: { instructions } });
      await waitForJob(jobId, (msg, p) => setBusy({ msg, p }));
      await reload();
      app.toast("Script ready. Check the flags before generating voices.");
    } catch (e) {
      app.toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  const blank = () => {
    const host = app.characters.find((c) => c.kind === "host");
    const lineId = uid("l");
    const script: Script = {
      title: ep.title || "New episode",
      summary: "",
      personas: [],
      lines: [{ id: lineId, speaker: host?.id ?? app.characters[0]?.id ?? "", kind: "studio", text: "Welcome to The Bridge.", audio: null }],
      chapters: [{ id: uid("chap"), title: "Welcome", startLineId: lineId, cue: "sting" }],
      cards: [],
      polls: [],
      widgets: [],
      anonymisation: [],
      flags: [],
      social: null,
    };
    update((e) => ({ ...e, script }));
  };

  return (
    <div className="stack">
      <div className="grid2">
        <div className="panel stack">
          <h2 className="sec">Meeting notes</h2>
          <FileDrop accept=".docx,.pdf,.txt,.md,.vtt,.srt" onFiles={onFile}>
            <b>Drop the session notes here</b>
            <div className="small muted">Word, PDF, text or a transcript file. Gemini and Otter exports work as they are.</div>
          </FileDrop>
          {ep.notes && (
            <div className="small muted">
              {ep.notes.fileName} · {words.toLocaleString()} words · added {new Date(ep.notes.uploadedAt).toLocaleString()}
            </div>
          )}
          <label className="field">
            Or paste the notes
            <textarea
              className="input"
              rows={10}
              value={notes}
              onChange={(e) => update((x) => ({ ...x, notes: { fileName: x.notes?.fileName || "Pasted notes", text: e.target.value, uploadedAt: x.notes?.uploadedAt ?? new Date().toISOString() } }))}
              placeholder="Paste the transcript or notes from the session"
            />
          </label>
          <label className="field">
            Session date
            <input className="input" type="date" value={ep.sessionDate ?? ""} onChange={(e) => update((x) => ({ ...x, sessionDate: e.target.value || null }))} />
          </label>
        </div>
        <div className="panel stack">
          <h2 className="sec">Write the script</h2>
          <p className="small muted" style={{ margin: 0 }}>
            The AI picks the strongest questions, invents listeners so nobody can be identified, checks figures against your facts library and adds
            visuals and quiz questions. Using {app.show.aiProvider === "claude" ? "Claude" : "Gemini"} ({app.show.aiModels[app.show.aiProvider]}); change this in Settings.
          </p>
          <label className="field">
            Instructions for this episode (optional)
            <textarea className="input" rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Focus on the VAT questions. Leave out the career advice section." />
          </label>
          {busy ? (
            <div className="stack tight">
              <div className="progress"><i style={{ width: `${busy.p}%` }} /></div>
              <div className="small muted">{busy.msg}. This usually takes one to three minutes; you can leave this page.</div>
            </div>
          ) : (
            <div className="row">
              <button className="btn accent" disabled={!notes.trim() || !serverAvailable() || !app.can("edit")} onClick={write}>
                {ep.script ? "Rewrite from notes" : "Write the script"}
              </button>
              {!ep.script && (
                <button className="btn" onClick={blank} disabled={!app.can("edit")}>
                  Start a blank script
                </button>
              )}
            </div>
          )}
          {!serverAvailable() && <p className="small muted">AI writing needs the online studio. In demo mode, open the sample episode or start a blank script.</p>}
        </div>
      </div>
      {ep.script && ep.script.anonymisation.length > 0 && (
        <div className="panel">
          <h2 className="sec">What was anonymised</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>In the notes</th><th>In the episode</th><th>Type</th><th>Note</th></tr>
              </thead>
              <tbody>
                {ep.script.anonymisation.map((a, i) => (
                  <tr key={i}><td>{a.original}</td><td>{a.replacement}</td><td>{a.kind}</td><td className="muted">{a.note}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">Read the script once with this list in hand. The AI does most of the work, but a person signs off on anonymity.</p>
        </div>
      )}
    </div>
  );
}
