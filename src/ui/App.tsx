import { useEffect, useState } from "react";
import type { Profile } from "../shared/types";
import { store, ensureSeed } from "../lib/store";
import { AppProvider, useApp, useHashRoute } from "./ctx";
import { Episodes } from "./pages/Episodes";
import { EpisodePage } from "./episode/EpisodePage";
import { Characters } from "./pages/Characters";
import { Pronunciations, Facts } from "./pages/Library";
import { Brand } from "./pages/Brand";
import { Team, Settings, Account } from "./pages/Admin";

export function App() {
  const [user, setUser] = useState<Profile | null | undefined>(undefined);
  const [seeded, setSeeded] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  useEffect(() => {
    const check = () => store.currentUser().then(setUser);
    check();
    return store.onAuthChange(check);
  }, []);
  useEffect(() => {
    if (!user || user.outsider) return;
    ensureSeed()
      .catch((e) => {
        if (user.role === "admin") setSeedError((e as Error).message);
      })
      .finally(() => setSeeded(true));
  }, [user]);
  if (user === undefined) return <div className="login"><p className="muted">Loading…</p></div>;
  if (user === null) return <Login />;
  if (user.outsider)
    return (
      <div className="login">
        <div className="panel stack">
          <h2 className="sec">You're signed in, but not on the team yet</h2>
          <p style={{ margin: 0 }}>{user.email} hasn't been added to this studio. Ask an admin to invite you from the Team page, then sign in again.</p>
          <button className="btn" style={{ justifySelf: "start" }} onClick={() => store.signOut()}>Sign out</button>
        </div>
      </div>
    );
  if (seedError) return <div className="login"><div className="panel"><h2 className="sec">Setup problem</h2><p>{seedError}</p><p className="small muted">Check that the database migration has been run (see the README).</p></div></div>;
  if (!seeded) return <div className="login"><p className="muted">Setting up the studio…</p></div>;
  return (
    <AppProvider user={user}>
      <Shell />
    </AppProvider>
  );
}

const NAV = [
  ["", "Episodes"],
  ["characters", "Characters"],
  ["pronunciation", "Pronunciation"],
  ["brand", "Brand"],
  ["facts", "Tax facts"],
  ["team", "Team"],
  ["settings", "Settings"],
] as const;

function Shell() {
  const app = useApp();
  const route = useHashRoute();
  const section = route[0] ?? "";
  const active = section === "episode" ? "" : section;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brandmark">
          <b>{app.show.brand.wordmark || app.show.name}</b>
          <span>Studio</span>
        </div>
        <nav className="nav" aria-label="Sections">
          {NAV.map(([k, label]) => (
            <a key={k} href={`#/${k}`} className={active === k ? "on" : ""} aria-current={active === k ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <a href="#/account">{app.user.fullName || app.user.email}</a>
          <span>{app.user.role}</span>
          {store.mode === "supabase" && <button className="btn sm" onClick={() => store.signOut()}>Sign out</button>}
        </div>
      </aside>
      <main className="main">
        {store.mode === "local" && (
          <div className="demo-banner">
            Demo mode: work is saved in this browser only, and AI writing and voices are switched off. Connect Supabase and Netlify (see the README) to turn on the full studio for your team.
          </div>
        )}
        {section === "" && <Episodes />}
        {section === "episode" && route[1] && <EpisodePage id={route[1]} tab={route[2]} />}
        {section === "characters" && <Characters />}
        {section === "pronunciation" && <Pronunciations />}
        {section === "brand" && <Brand />}
        {section === "facts" && <Facts />}
        {section === "team" && <Team />}
        {section === "settings" && <Settings />}
        {section === "account" && <Account />}
      </main>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ text: ok });
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="panel" onSubmit={(e) => (e.preventDefault(), run(() => store.signIn(email, password)))}>
        <div className="brandmark" style={{ padding: 0 }}>
          <b>The Bridge</b>
          <span>Studio · TaxStreem team only</span>
        </div>
        <label className="field">Email<input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        <label className="field">Password<input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        <button className="btn primary" disabled={busy || !password}>Sign in</button>
        <div className="row">
          <button type="button" className="btn ghost sm" disabled={busy || !email} onClick={() => run(() => store.sendMagicLink(email), "Check your email for a sign-in link.")}>Email me a sign-in link</button>
          <button type="button" className="btn ghost sm" disabled={busy || !email} onClick={() => run(() => store.sendPasswordReset(email), "Check your email to reset your password.")}>Forgot password</button>
        </div>
        {msg && <p className="small" style={{ margin: 0, color: msg.error ? "var(--bad)" : undefined }} role="status">{msg.text}</p>}
        <p className="small muted" style={{ margin: 0 }}>No account? Ask a studio admin to invite you.</p>
      </form>
    </div>
  );
}
