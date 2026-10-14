import { useEffect, useState } from "react";
import type { Comment, EpisodeStatus } from "../../shared/types";
import { uid } from "../../shared/ids";
import { useApp } from "../ctx";
import { useEpisode, scriptHash, staleLines } from "./state";
import { store } from "../../lib/store";
import type { Version } from "../../lib/store/types";
import { api, serverAvailable, waitForJob } from "../../lib/api";

export function ReviewTab() {
  const app = useApp();
  const { ep, update, updateScript, saveNow } = useEpisode();
  const [comments, setComments] = useState<Comment[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [body, setBody] = useState("");
  const [lineId, setLineId] = useState("");
  const [checking, setChecking] = useState<string | null>(null);
  const script = ep.script;

  const load = async () => {
    setComments(await store.listComments(ep.id));
    setVersions(await store.listVersions(ep.id));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep.id]);

  if (!script) return <div className="panel">No script yet.</div>;
  const openFlags = script.flags.filter((f) => !f.resolved);
  const stale = staleLines(ep, app);
  const outdated = ep.approval && ep.approval.hash !== scriptHash(script);

  const setStatus = async (status: EpisodeStatus) => {
    if (status === "approved") {
      const warn: string[] = [];
      if (openFlags.length) warn.push(`${openFlags.length} unresolved check${openFlags.length === 1 ? "" : "s"}`);
      if (stale.length) warn.push(`${stale.length} line${stale.length === 1 ? "" : "s"} without current voices`);
      if (warn.length && !confirm(`Approve with ${warn.join(" and ")}?`)) return;
      update((e) => ({ ...e, status, approval: { by: app.user.id, byName: app.user.fullName || app.user.email, at: new Date().toISOString(), hash: scriptHash(e.script) } }));
      await store.snapshot({ ...ep, status }, `Approved by ${app.user.fullName || app.user.email}`);
    } else {
      update((e) => ({ ...e, status }));
    }
    await saveNow();
    app.toast(status === "approved" ? "Approved. Exports no longer carry the draft watermark." : `Status: ${status}`);
  };

  const addComment = async () => {
    if (!body.trim()) return;
    const c: Comment = { id: uid("cm"), episodeId: ep.id, lineId: lineId || null, authorId: app.user.id, authorName: app.user.fullName || app.user.email, body: body.trim(), resolved: false, createdAt: new Date().toISOString() };
    await store.saveComment(c);
    setBody("");
    setComments((x) => [...x, c]);
  };

  const factCheck = async () => {
    try {
      setChecking("Starting");
      const { jobId } = await api.startAi({ kind: "factcheck", showId: app.show.id, episodeId: ep.id, payload: { script } });
      const job: any = await waitForJob(jobId, (m) => setChecking(m));
      const flags = (job.result?.flags ?? []) as { lineId: string; claim: string; issue: string; suggestion: string; severity: "info" | "warn" | "error" }[];
      const valid = flags.filter((f) => script.lines.some((l) => l.id === f.lineId));
      updateScript((s) => ({ ...s, flags: [...s.flags, ...valid.map((f) => ({ ...f, id: uid("flag"), resolved: false }))] }));
      app.toast(valid.length ? `${valid.length} new item${valid.length === 1 ? "" : "s"} to check` : "No new issues found");
    } catch (e) {
      app.toast((e as Error).message, true);
    } finally {
      setChecking(null);
    }
  };

  const restore = async (v: Version) => {
    if (!confirm(`Restore the version from ${new Date(v.createdAt).toLocaleString()}? The current one is saved first.`)) return;
    await store.snapshot(ep, "Before restoring an older version");
    update(() => ({ ...v.episode, id: ep.id, status: "draft", approval: null }));
    await saveNow();
    await load();
  };

  const lineText = (id: string | null) => (id ? script.lines.find((l) => l.id === id)?.text.slice(0, 80) : null);

  return (
    <div className="grid2" style={{ alignItems: "start" }}>
      <div className="stack">
        <div className="panel stack">
          <h2 className="sec">Approval</h2>
          <dl className="kv">
            <dt>Status</dt>
            <dd><span className={`pill ${ep.status}`}>{ep.status}</span></dd>
            <dt>Approved</dt>
            <dd>{ep.approval ? `${ep.approval.byName}, ${new Date(ep.approval.at).toLocaleString()}${outdated ? " (script changed since)" : ""}` : "Not yet"}</dd>
            <dt>Open checks</dt>
            <dd>{openFlags.length}</dd>
            <dt>Voices to generate</dt>
            <dd>{stale.length}</dd>
          </dl>
          <p className="small muted" style={{ margin: 0 }}>
            The expert whose answers are used should read the whole script before approving. Any edit after approval sends the episode back to review.
          </p>
          <div className="row">
            {ep.status === "draft" && app.can("edit") && <button className="btn" onClick={() => setStatus("review")}>Send for review</button>}
            {(ep.status === "review" || ep.status === "draft") && app.can("approve") && <button className="btn accent" onClick={() => setStatus("approved")}>Approve</button>}
            {ep.status === "approved" && app.can("approve") && <button className="btn primary" onClick={() => setStatus("published")}>Mark as published</button>}
            {ep.status !== "draft" && (app.can("approve") || app.can("edit")) && <button className="btn ghost" onClick={() => setStatus("draft")}>Back to draft</button>}
          </div>
        </div>
        <div className="panel stack">
          <div className="row">
            <h2 className="sec" style={{ margin: 0 }}>Checks</h2>
            <span className="spacer" />
            {serverAvailable() && app.can("edit") && (
              <button className="btn sm" onClick={factCheck} disabled={!!checking}>{checking ?? "Run a fact check"}</button>
            )}
          </div>
          {!script.flags.length && <p className="small muted">Nothing flagged.</p>}
          {script.flags.map((f) => (
            <div key={f.id} className={`flag ${f.severity}${f.resolved ? " resolved" : ""}`}>
              <div className="small muted">{lineText(f.lineId)}…</div>
              <b>“{f.claim}”</b> · {f.issue} {f.suggestion && <span className="muted">{f.suggestion}</span>}
              <div>
                <label className="check small">
                  <input type="checkbox" checked={f.resolved} onChange={(e) => updateScript((s) => ({ ...s, flags: s.flags.map((x) => (x.id === f.id ? { ...x, resolved: e.target.checked } : x)) }))} />
                  Resolved
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="stack">
        <div className="panel stack">
          <h2 className="sec">Comments</h2>
          {comments.map((c) => (
            <div key={c.id} className="panel flat" style={{ padding: 10, opacity: c.resolved ? 0.55 : 1 }}>
              <div className="small muted">
                {c.authorName} · {new Date(c.createdAt).toLocaleString()}
                {c.lineId && <> · on “{lineText(c.lineId)}…”</>}
              </div>
              <div>{c.body}</div>
              <label className="check small">
                <input
                  type="checkbox"
                  checked={c.resolved}
                  onChange={async (e) => {
                    const next = { ...c, resolved: e.target.checked };
                    await store.saveComment(next);
                    setComments((x) => x.map((y) => (y.id === c.id ? next : y)));
                  }}
                />
                Resolved
              </label>
            </div>
          ))}
          <label className="field">
            About
            <select className="input" value={lineId} onChange={(e) => setLineId(e.target.value)}>
              <option value="">The whole episode</option>
              {script.lines.map((l, i) => (
                <option key={l.id} value={l.id}>{i + 1}. {l.text.slice(0, 70)}</option>
              ))}
            </select>
          </label>
          <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Leave a note for the team" />
          <button className="btn" style={{ justifySelf: "start" }} onClick={addComment} disabled={!body.trim()}>Add comment</button>
        </div>
        <div className="panel stack">
          <h2 className="sec">Versions</h2>
          {!versions.length && <p className="small muted">Versions are saved before AI rewrites, approvals and restores.</p>}
          {versions.map((v) => (
            <div key={v.id} className="row">
              <span className="small">{new Date(v.createdAt).toLocaleString()} · {v.note}</span>
              <span className="spacer" />
              {app.can("edit") && <button className="btn sm" onClick={() => restore(v)}>Restore</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
