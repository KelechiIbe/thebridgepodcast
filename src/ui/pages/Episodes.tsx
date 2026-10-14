import { useEffect, useState } from "react";
import type { Episode } from "../../shared/types";
import { uid } from "../../shared/ids";
import { store } from "../../lib/store";
import { go, useApp } from "../ctx";

export function Episodes() {
  const app = useApp();
  const [eps, setEps] = useState<Episode[] | null>(null);
  useEffect(() => {
    store.listEpisodes(app.show.id).then(setEps);
  }, [app.show.id]);
  const create = async () => {
    const number = Math.max(0, ...(eps ?? []).map((e) => e.number)) + 1;
    const now = new Date().toISOString();
    const ep: Episode = { id: uid("ep"), showId: app.show.id, number, title: "", status: "draft", sessionDate: null, notes: null, script: null, approval: null, job: null, createdAt: now, updatedAt: now };
    await store.saveEpisode(ep);
    go(`episode/${ep.id}/notes`);
  };
  return (
    <div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div>
          <h1 className="page">Episodes</h1>
          <p className="page-sub">Upload the notes from a Friday session, let the AI draft the episode, then review, voice and export it.</p>
        </div>
        <span className="spacer" />
        {app.can("edit") && <button className="btn accent" onClick={create}>New episode</button>}
      </div>
      {!eps && <p className="muted">Loading…</p>}
      {eps && !eps.length && <div className="panel">No episodes yet. Start one from last Friday's notes.</div>}
      <div className="ep-list">
        {eps?.map((e) => {
          const lines = e.script?.lines.length ?? 0;
          const voiced = e.script?.lines.filter((l) => l.audio).length ?? 0;
          return (
            <a key={e.id} className="ep-row" href={`#/episode/${e.id}`}>
              <div className="ep-num">{String(e.number).padStart(2, "0")}</div>
              <div style={{ minWidth: 0 }}>
                <div className="ep-title">{e.script?.title || e.title || "Untitled episode"}</div>
                <div className="small muted">
                  {e.script ? `${lines} lines · ${voiced} voiced · ${e.script.cards.length} visuals` : e.notes ? "Notes uploaded, no script yet" : "No notes yet"}
                  {" · "}updated {new Date(e.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <span className={`pill ${e.status}`}>{e.status}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
