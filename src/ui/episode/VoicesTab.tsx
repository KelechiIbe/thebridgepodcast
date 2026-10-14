import { useEffect, useState } from "react";
import { toSpoken } from "../../shared/pronounce";
import { missingWords } from "../../shared/qa";
import { useApp } from "../ctx";
import { useEpisode, staleLines } from "./state";
import { voiceCharacter } from "../../lib/engine";
import { api, serverAvailable } from "../../lib/api";
import type { UsageInfo } from "../../shared/types";

export function VoicesTab() {
  const app = useApp();
  const { ep, generate, updateScript } = useEpisode();
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const script = ep.script;
  useEffect(() => {
    if (serverAvailable()) api.usage().then(setUsage).catch(() => {});
  }, [progress === null]);
  if (!script) return <div className="panel">No script yet.</div>;
  const stale = staleLines(ep, app);
  const chars = stale.reduce((s, id) => s + toSpoken(script.lines.find((l) => l.id === id)!.text, app.pronunciations).spoken.length, 0);
  const cast = new Map<string, { name: string; voice: string; lines: number; ok: boolean }>();
  for (const l of script.lines) {
    const ch = voiceCharacter(l, app.characters, script.personas);
    const key = ch?.id ?? "none";
    const cur = cast.get(key) ?? { name: ch?.name ?? "Unassigned", voice: ch?.voice.voiceName || "No voice chosen", lines: 0, ok: !!ch?.voice.voiceId };
    cur.lines++;
    cast.set(key, cur);
  }
  const withAudio = script.lines.filter((l) => l.audio && !stale.includes(l.id));

  const generateAll = async () => {
    setProgress({ label: "Generating voices", done: 0, total: stale.length });
    await generate(stale, (done, total) => setProgress({ label: "Generating voices", done, total }));
    setProgress(null);
  };

  const checkAll = async () => {
    setProgress({ label: "Listening back", done: 0, total: withAudio.length });
    let flagged = 0;
    for (const [i, l] of withAudio.entries()) {
      try {
        const r = await api.sttCheck(l.audio!.path);
        const mismatches = missingWords(toSpoken(l.text, app.pronunciations).spoken, r.text);
        if (mismatches.length) flagged++;
        updateScript((s) => ({ ...s, lines: s.lines.map((x) => (x.id === l.id && x.audio ? { ...x, audio: { ...x.audio, qa: { checkedAt: new Date().toISOString(), heard: r.text, mismatches } } } : x)) }));
      } catch (e) {
        app.toast((e as Error).message, true);
        break;
      }
      setProgress({ label: "Listening back", done: i + 1, total: withAudio.length });
    }
    setProgress(null);
    app.toast(flagged ? `${flagged} line${flagged === 1 ? "" : "s"} to check in the Script tab` : "Every line came through clearly");
  };

  return (
    <div className="grid2" style={{ alignItems: "start" }}>
      <div className="panel stack">
        <h2 className="sec">Voices</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Speaker</th><th>Voice</th><th>Lines</th></tr></thead>
            <tbody>
              {[...cast.values()].map((c) => (
                <tr key={c.name}><td>{c.name}</td><td>{c.ok ? c.voice : <span style={{ color: "var(--warn)" }}>{c.voice}</span>}</td><td>{c.lines}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Change voices under <a href="#/characters">Characters</a>. Listeners use the listener voices you set there.</p>
        {progress ? (
          <div className="stack tight">
            <div className="row small"><b>{progress.label}</b><span className="spacer" />{progress.done} / {progress.total}</div>
            <div className="progress"><i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
          </div>
        ) : (
          <div className="row">
            <button className="btn accent" disabled={!serverAvailable() || !stale.length || !app.can("edit")} onClick={generateAll}>
              {stale.length ? `Generate ${stale.length} line${stale.length === 1 ? "" : "s"}` : "All voices are up to date"}
            </button>
            <button className="btn" disabled={!serverAvailable() || !withAudio.length} onClick={checkAll}>Check every word</button>
          </div>
        )}
        {stale.length > 0 && <p className="small muted" style={{ margin: 0 }}>About {chars.toLocaleString()} characters of ElevenLabs credit.</p>}
        {!serverAvailable() && <p className="small muted">Voices need the online studio with an ElevenLabs key.</p>}
      </div>
      <div className="panel stack">
        <h2 className="sec">ElevenLabs credit</h2>
        {usage ? (
          <>
            <div className="progress"><i style={{ width: `${Math.min(100, (usage.used / Math.max(1, usage.limit)) * 100)}%` }} /></div>
            <div className="small">
              {usage.used.toLocaleString()} of {usage.limit.toLocaleString()} characters used on the {usage.tier} plan
              {usage.resetsAt && <> · resets {new Date(usage.resetsAt).toLocaleDateString()}</>}
            </div>
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>{serverAvailable() ? "Add an ElevenLabs key in Settings to see your usage." : "Shown in the online studio."}</p>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Words the voice keeps getting wrong belong in the <a href="#/pronunciation">pronunciation library</a>. After adding one, regenerate the affected lines.
        </p>
      </div>
    </div>
  );
}
