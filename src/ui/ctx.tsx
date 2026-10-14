import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Character, Fact, Profile, Pronunciation, Show } from "../shared/types";
import { DEFAULT_SHOW_ID } from "../shared/defaults";
import { store } from "../lib/store";

interface Toast {
  id: number;
  text: string;
  error?: boolean;
}

interface AppState {
  user: Profile;
  show: Show;
  characters: Character[];
  pronunciations: Pronunciation[];
  facts: Fact[];
  saveShow: (s: Show) => Promise<void>;
  reload: () => Promise<void>;
  setCharacters: (c: Character[]) => void;
  setPronunciations: (p: Pronunciation[]) => void;
  setFacts: (f: Fact[]) => void;
  toast: (text: string, error?: boolean) => void;
  can: (what: "edit" | "approve" | "admin") => boolean;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("App context missing");
  return v;
}

export function AppProvider({ user, children }: { user: Profile; children: ReactNode }) {
  const [show, setShow] = useState<Show | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [pronunciations, setPronunciations] = useState<Pronunciation[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [failed, setFailed] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const s = await store.getShow(DEFAULT_SHOW_ID);
      if (!s) throw new Error("The show hasn't been set up yet. Ask an admin to sign in first.");
      const [c, p, f] = await Promise.all([store.listCharacters(s.id), store.listPronunciations(s.id), store.listFacts(s.id)]);
      setShow(s);
      setCharacters(c);
      setPronunciations(p.sort((a, b) => a.term.localeCompare(b.term)));
      setFacts(f);
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const toast = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 7000 : 3500);
  }, []);

  const saveShow = useCallback(async (s: Show) => {
    setShow(s);
    await store.saveShow(s);
  }, []);

  const can = useCallback(
    (what: "edit" | "approve" | "admin") =>
      what === "admin" ? user.role === "admin" : what === "approve" ? user.role === "admin" || user.role === "reviewer" : user.role !== "reviewer",
    [user.role],
  );

  const value = useMemo(
    () => (show ? { user, show, characters, pronunciations, facts, saveShow, reload, setCharacters, setPronunciations, setFacts, toast, can } : null),
    [user, show, characters, pronunciations, facts, saveShow, reload, toast, can],
  );

  if (failed) return <div className="login"><div className="panel"><h2 className="sec">Can't load the studio</h2><p>{failed}</p></div></div>;
  if (!value) return <div className="login"><p className="muted">Loading the studio…</p></div>;
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.error ? " err" : ""}`}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useHashRoute(): string[] {
  // a hash like #access_token=… or #error=… belongs to a sign-in link, not to a page
  const read = () => (location.hash.includes("=") ? [] : location.hash.replace(/^#\/?/, "").split("/").filter(Boolean));
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return parts;
}

export const go = (path: string) => {
  location.hash = `#/${path.replace(/^\//, "")}`;
};
