import { useEffect, useState } from "react";
import type { AiProvider, Role } from "../../shared/types";
import { api, serverAvailable } from "../../lib/api";
import { store } from "../../lib/store";
import { useApp } from "../ctx";
import { Modal } from "../components/Modal";

const ROLE_HELP: Record<Role, string> = {
  admin: "Everything, including team, keys and settings",
  producer: "Creates and edits episodes, voices and brand",
  reviewer: "Reads, comments and approves episodes",
};

// readable temporary passwords: no 0/O or 1/l mix-ups when read out over the phone
function makePassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function Team() {
  const app = useApp();
  const [members, setMembers] = useState<{ id: string; email: string; fullName: string; role: string }[] | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("producer");
  const [how, setHow] = useState<"password" | "email">("password");
  const [password, setPassword] = useState(makePassword);
  const [added, setAdded] = useState<{ email: string; password: string } | null>(null);
  const [resetFor, setResetFor] = useState<{ id: string; email: string; password: string; done?: boolean } | null>(null);
  const copy = (text: string) =>
    navigator.clipboard
      ?.writeText(text)
      .then(() => app.toast("Copied"))
      .catch(() => app.toast("Couldn't copy. Select the text and copy it yourself.", true));
  const load = () => api.team().then((r) => setMembers(r.members)).catch((e) => app.toast(e.message, true));
  useEffect(() => {
    if (serverAvailable()) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!serverAvailable()) return <Offline title="Team" />;
  const act = async (b: Parameters<typeof api.teamAction>[0], done: string) => {
    try {
      await api.teamAction(b);
      app.toast(done);
      load();
      return true;
    } catch (e) {
      app.toast((e as Error).message, true);
      return false;
    }
  };
  const addPerson = async () => {
    const ok =
      how === "password"
        ? await act({ action: "create", email, fullName: name, role, password }, `${email} can sign in now`)
        : await act({ action: "invite", email, fullName: name, role }, `Invitation sent to ${email}`);
    if (!ok) return;
    if (how === "password") setAdded({ email, password });
    setEmail("");
    setName("");
    setPassword(makePassword());
  };
  return (
    <div>
      <h1 className="page">Team</h1>
      <p className="page-sub">Only people you add here can use the studio.</p>
      <div className="stack">
        <div className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
              <tbody>
                {members?.map((m) => (
                  <tr key={m.id}>
                    <td>{m.fullName || "—"}</td>
                    <td>{m.email}</td>
                    <td>
                      <select className="input" style={{ minWidth: 120 }} value={m.role} disabled={!app.can("admin")} onChange={(e) => act({ action: "role", userId: m.id, role: e.target.value }, "Role updated")} aria-label={`Role for ${m.email}`}>
                        <option value="admin">Admin</option>
                        <option value="producer">Producer</option>
                        <option value="reviewer">Reviewer</option>
                      </select>
                    </td>
                    <td>
                      {app.can("admin") && (
                        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                          <button className="btn ghost sm" onClick={() => setResetFor({ id: m.id, email: m.email, password: makePassword() })}>New password</button>
                          {m.id !== app.user.id && <button className="btn ghost sm danger" onClick={() => confirm(`Remove ${m.email}?`) && act({ action: "remove", userId: m.id }, "Removed")}>Remove</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {app.can("admin") && (
          <form className="panel stack" style={{ maxWidth: 640 }} onSubmit={(e) => { e.preventDefault(); addPerson(); }}>
            <h2 className="sec">Add someone</h2>
            <label className="field">Email<input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field">
              Role
              <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {(Object.keys(ROLE_HELP) as Role[]).map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}: {ROLE_HELP[r]}</option>)}
              </select>
            </label>
            <fieldset className="stack tight" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="small muted" style={{ marginBottom: 6 }}>How they'll get in</legend>
              <label className="check">
                <input type="radio" name="how" checked={how === "password"} onChange={() => setHow("password")} />
                I'll give them a temporary password
              </label>
              <label className="check">
                <input type="radio" name="how" checked={how === "email"} onChange={() => setHow("email")} />
                Email them an invitation link (only works once email sending is set up)
              </label>
            </fieldset>
            {how === "password" && (
              <label className="field">
                Temporary password
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input className="input" style={{ flex: 1 }} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
                  <button type="button" className="btn sm" onClick={() => setPassword(makePassword())}>New one</button>
                </div>
              </label>
            )}
            <button className="btn accent" style={{ justifySelf: "start" }}>{how === "password" ? "Add to the team" : "Send invitation"}</button>
            {added && (
              <div className="panel stack tight" style={{ background: "var(--panel2)" }}>
                <b>Send these to {added.email}</b>
                <span className="small">
                  Studio: {location.origin}
                  <br />
                  Email: {added.email}
                  <br />
                  Temporary password: <code>{added.password}</code>
                </span>
                <span className="small muted">Ask them to change the password from the account link at the bottom left after they sign in.</span>
                <div className="row">
                  <button type="button" className="btn sm" onClick={() => copy(`The Bridge Studio: ${location.origin}\nEmail: ${added.email}\nTemporary password: ${added.password}`)}>Copy</button>
                  <button type="button" className="btn ghost sm" onClick={() => setAdded(null)}>Done</button>
                </div>
              </div>
            )}
          </form>
        )}
        {resetFor && (
          <Modal title={`New password for ${resetFor.email}`} onClose={() => setResetFor(null)}>
            <p className="small muted" style={{ margin: 0 }}>Use this when someone forgets their password. Their old one stops working straight away.</p>
            {resetFor.done ? (
              <>
                <p style={{ margin: 0 }}>
                  Done. Their new password is <code>{resetFor.password}</code>
                </p>
                <div className="row">
                  <button className="btn" onClick={() => copy(resetFor.password)}>Copy it</button>
                  <button className="btn ghost" onClick={() => setResetFor(null)}>Close</button>
                </div>
              </>
            ) : (
              <>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input className="input" style={{ flex: 1 }} value={resetFor.password} onChange={(e) => setResetFor({ ...resetFor, password: e.target.value })} aria-label="New password" autoComplete="off" />
                  <button className="btn sm" onClick={() => setResetFor({ ...resetFor, password: makePassword() })}>New one</button>
                </div>
                <div className="row">
                  <button
                    className="btn accent"
                    disabled={resetFor.password.length < 8}
                    onClick={async () => {
                      if (await act({ action: "password", userId: resetFor.id, password: resetFor.password }, "Password changed")) setResetFor({ ...resetFor, done: true });
                    }}
                  >
                    Set this password
                  </button>
                </div>
              </>
            )}
          </Modal>
        )}
      </div>
    </div>
  );
}

export function Settings() {
  const app = useApp();
  const s = app.show;
  const [keys, setKeys] = useState<Awaited<ReturnType<typeof api.keys>> | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (serverAvailable()) api.keys().then(setKeys).catch(() => {});
  }, []);
  const editable = app.can("admin");
  const keyRow = (name: "elevenlabs" | "anthropic" | "gemini", label: string, where: string) => (
    <div className="stack tight" key={name}>
      <div className="row">
        <b style={{ minWidth: 150 }}>{label}</b>
        {keys?.[name]?.set ? <span className="pill ok">Saved · ends {keys[name].last4} · {keys[name].source}</span> : <span className="pill none">Not set</span>}
      </div>
      {editable && (
        <div className="row">
          <input className="input" style={{ flex: 1, minWidth: 220 }} type="password" autoComplete="off" placeholder={`Paste the ${label} API key`} value={values[name] ?? ""} onChange={(e) => setValues({ ...values, [name]: e.target.value })} aria-label={`${label} key`} />
          <button className="btn sm" disabled={!values[name]} onClick={async () => { try { setKeys(await api.saveKey(name, values[name])); setValues({ ...values, [name]: "" }); app.toast("Key saved"); } catch (e) { app.toast((e as Error).message, true); } }}>Save</button>
          <button className="btn sm" disabled={!keys?.[name]?.set} onClick={async () => { try { app.toast((await api.testKey(name)).message); } catch (e) { app.toast((e as Error).message, true); } }}>Test</button>
          {keys?.[name]?.source === "settings" && <button className="btn sm ghost" onClick={async () => setKeys(await api.saveKey(name, ""))}>Remove</button>}
        </div>
      )}
      <span className="small muted">{where}</span>
    </div>
  );
  return (
    <div>
      <h1 className="page">Settings</h1>
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="panel stack">
          <h2 className="sec">AI</h2>
          <label className="field">
            Writes scripts, checks facts and makes chat edits
            <select className="input" value={s.aiProvider} disabled={!editable} onChange={(e) => app.saveShow({ ...s, aiProvider: e.target.value as AiProvider })}>
              <option value="claude">Claude (Anthropic)</option>
              <option value="gemini">Gemini (Google)</option>
            </select>
          </label>
          <div className="grid2">
            <label className="field">Claude model<input className="input" value={s.aiModels.claude} disabled={!editable} onChange={(e) => app.saveShow({ ...s, aiModels: { ...s.aiModels, claude: e.target.value } })} /></label>
            <label className="field">Gemini model<input className="input" value={s.aiModels.gemini} disabled={!editable} onChange={(e) => app.saveShow({ ...s, aiModels: { ...s.aiModels, gemini: e.target.value } })} /></label>
          </div>
          <label className="field">
            House style and standing instructions for the script writer
            <textarea className="input" rows={8} value={s.scriptGuide} disabled={!app.can("edit")} onChange={(e) => app.saveShow({ ...s, scriptGuide: e.target.value })} />
          </label>
          <h2 className="sec" style={{ marginTop: 8 }}>Voices</h2>
          <label className="field">
            ElevenLabs model
            <select className="input" value={s.ttsModel} disabled={!editable} onChange={(e) => app.saveShow({ ...s, ttsModel: e.target.value })}>
              <option value="eleven_multilingual_v2">Multilingual v2 (steady, recommended)</option>
              <option value="eleven_v4">Eleven v4 (newest, long-form)</option>
              <option value="eleven_v3">Eleven v3 (most expressive)</option>
              <option value="eleven_flash_v2_5">Flash v2.5 (fast, cheaper)</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.requireApproval} disabled={!editable} onChange={(e) => app.saveShow({ ...s, requireApproval: e.target.checked })} />
            Mark exports as drafts until a reviewer approves the episode
          </label>
        </div>
        <div className="panel stack">
          <h2 className="sec">API keys</h2>
          {!serverAvailable() ? (
            <p className="small muted">Keys are stored on the server, encrypted. Set up the online studio first (see the README).</p>
          ) : (
            <>
              {keyRow("elevenlabs", "ElevenLabs", "elevenlabs.io → Profile → API keys. The account that holds your cloned voices.")}
              {keyRow("anthropic", "Claude", "platform.claude.com → API keys.")}
              {keyRow("gemini", "Gemini", "aistudio.google.com → Get API key.")}
              <p className="small muted" style={{ margin: 0 }}>Keys are encrypted before they're stored and never sent back to the browser.</p>
            </>
          )}
          <h2 className="sec" style={{ marginTop: 8 }}>Storage</h2>
          <dl className="kv">
            <dt>Mode</dt>
            <dd>{store.mode === "supabase" ? "Online studio (Supabase)" : "Demo, saved in this browser only"}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

export function Account() {
  const app = useApp();
  const [pw, setPw] = useState("");
  return (
    <div>
      <h1 className="page">Your account</h1>
      <div className="panel stack" style={{ maxWidth: 480 }}>
        <dl className="kv">
          <dt>Email</dt><dd>{app.user.email}</dd>
          <dt>Role</dt><dd>{app.user.role}</dd>
        </dl>
        {serverAvailable() && (
          <form className="stack tight" onSubmit={async (e) => { e.preventDefault(); try { await store.updatePassword(pw); setPw(""); app.toast("Password updated"); } catch (err) { app.toast((err as Error).message, true); } }}>
            <label className="field">New password<input className="input" type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
            <button className="btn" style={{ justifySelf: "start" }}>Set password</button>
          </form>
        )}
      </div>
    </div>
  );
}

function Offline({ title }: { title: string }) {
  return (
    <div>
      <h1 className="page">{title}</h1>
      <div className="panel">This needs the online studio. In demo mode everything is saved in this browser only, for one person.</div>
    </div>
  );
}
