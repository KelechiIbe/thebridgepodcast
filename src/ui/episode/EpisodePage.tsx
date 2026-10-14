import { lazy, Suspense, useEffect, useState } from "react";
import type { Episode } from "../../shared/types";
import { store } from "../../lib/store";
import { go, useApp } from "../ctx";
import { EpisodeProvider, useEpisode } from "./state";
import { NotesTab } from "./NotesTab";
import { ScriptTab } from "./ScriptTab";
import { StudioTab } from "./StudioTab";
import { VoicesTab } from "./VoicesTab";
import { ReviewTab } from "./ReviewTab";

// the export code (video encoder, MP3 encoder, player bundle) only loads when someone opens Export
const ExportTab = lazy(() => import("./ExportTab").then((m) => ({ default: m.ExportTab })));

const TABS = [
  ["notes", "Notes"],
  ["script", "Script"],
  ["studio", "Visuals"],
  ["voices", "Voices"],
  ["review", "Review"],
  ["export", "Export"],
] as const;
type Tab = (typeof TABS)[number][0];

export function EpisodePage({ id, tab }: { id: string; tab?: string }) {
  const [ep, setEp] = useState<Episode | null | undefined>(undefined);
  useEffect(() => {
    setEp(undefined);
    store.getEpisode(id).then(setEp);
  }, [id]);
  if (ep === undefined) return <p className="muted">Loading…</p>;
  if (ep === null) return <p>Episode not found. <a href="#/">Back to episodes</a></p>;
  return (
    <EpisodeProvider key={ep.id} initial={ep}>
      <EpisodeView tab={(TABS.find((t) => t[0] === tab)?.[0] ?? (ep.script ? "script" : "notes")) as Tab} />
    </EpisodeProvider>
  );
}

function EpisodeView({ tab }: { tab: Tab }) {
  const app = useApp();
  const { ep, update, saving } = useEpisode();
  const flagCount = ep.script?.flags.filter((f) => !f.resolved).length ?? 0;
  const remove = async () => {
    if (!confirm(`Delete episode ${ep.number}, “${ep.title}”? This can't be undone.`)) return;
    await store.deleteEpisode(ep.id);
    go("");
  };
  return (
    <div>
      <a href="#/" className="small">← All episodes</a>
      <div className="row" style={{ marginTop: 8, alignItems: "flex-end" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="eyebrow">Episode {ep.number}{ep.sessionDate ? ` · session of ${new Date(ep.sessionDate).toLocaleDateString()}` : ""}</div>
          <h1 className="page" style={{ marginTop: 4 }}>{ep.script?.title || ep.title || "Untitled episode"}</h1>
        </div>
        <span className={`pill ${ep.status}`}>{ep.status}</span>
        <span className="small muted" aria-live="polite">{saving ? "Saving…" : "Saved"}</span>
        {app.can("edit") && (
          <details>
            <summary className="btn sm ghost" style={{ listStyle: "none" }}>Episode settings</summary>
            <div className="panel stack tight" style={{ position: "absolute", right: 24, zIndex: 5, width: 260 }}>
              <label className="field">
                Episode number
                <input className="input" type="number" min={1} value={ep.number} onChange={(e) => update((x) => ({ ...x, number: Math.max(1, Number(e.target.value) || 1) }))} />
              </label>
              <button className="btn danger sm" onClick={remove}>Delete episode</button>
            </div>
          </details>
        )}
      </div>
      <nav className="tabs" aria-label="Episode sections">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => go(`episode/${ep.id}/${k}`)} disabled={!ep.script && k !== "notes"}>
            {label}
            {k === "review" && flagCount > 0 ? ` (${flagCount})` : ""}
          </button>
        ))}
      </nav>
      {tab === "notes" && <NotesTab />}
      {tab === "script" && <ScriptTab />}
      {tab === "studio" && <StudioTab />}
      {tab === "voices" && <VoicesTab />}
      {tab === "review" && <ReviewTab />}
      {tab === "export" && (
        <Suspense fallback={<div className="panel">Loading export tools…</div>}>
          <ExportTab />
        </Suspense>
      )}
    </div>
  );
}
