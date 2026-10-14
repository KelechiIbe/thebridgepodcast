import { useEffect, useState } from "react";
import { Modal } from "../components/Modal";
import { FileDrop } from "../components/FileDrop";
import { api, type VoiceInfo } from "../../lib/api";
import { useApp } from "../ctx";
import { uploadAsset } from "../../lib/assets";

type Pick = { voiceId: string; name: string; isClone: boolean; previewUrl: string | null };

let audio: HTMLAudioElement | null = null;
const preview = (url: string | null) => {
  if (!url) return;
  audio?.pause();
  audio = new Audio(url);
  audio.play().catch(() => {});
};

export function VoicePicker({ onPick, onClose, forName }: { onPick: (v: Pick) => void; onClose: () => void; forName: string }) {
  const [tab, setTab] = useState<"mine" | "library" | "clone">("library");
  return (
    <Modal title={`Choose a voice for ${forName}`} onClose={onClose} wide>
      <div className="tabs" style={{ margin: 0 }}>
        <button className={tab === "library" ? "on" : ""} onClick={() => setTab("library")}>Nigerian voice library</button>
        <button className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>My ElevenLabs voices</button>
        <button className={tab === "clone" ? "on" : ""} onClick={() => setTab("clone")}>Clone a voice</button>
      </div>
      {tab === "library" && <Library onPick={onPick} />}
      {tab === "mine" && <Mine onPick={onPick} />}
      {tab === "clone" && <Clone onPick={onPick} forName={forName} />}
    </Modal>
  );
}

function Mine({ onPick }: { onPick: (v: Pick) => void }) {
  const app = useApp();
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const [q, setQ] = useState("");
  const load = () => api.myVoices(q).then((r) => setVoices(r.voices)).catch((e) => app.toast(e.message, true));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="stack">
      <form className="row" onSubmit={(e) => (e.preventDefault(), load())}>
        <input className="input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your voices" aria-label="Search" />
        <button className="btn">Search</button>
      </form>
      <p className="small muted" style={{ margin: 0 }}>Cloned voices (yours or Kelechi's) appear here once they exist in the ElevenLabs account linked in Settings.</p>
      <VoiceList voices={voices} onPick={(v) => onPick({ voiceId: v.voiceId, name: v.name, isClone: !!v.isClone, previewUrl: v.previewUrl })} />
    </div>
  );
}

function Library({ onPick }: { onPick: (v: Pick) => void }) {
  const app = useApp();
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const [accent, setAccent] = useState("nigerian");
  const [gender, setGender] = useState("");
  const [q, setQ] = useState("");
  const load = () => {
    setVoices(null);
    api.libraryVoices({ accent, gender, search: q }).then((r) => setVoices(r.voices)).catch((e) => app.toast(e.message, true));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent, gender]);
  const use = async (v: VoiceInfo) => {
    try {
      const r = v.added ? { voiceId: v.voiceId } : await api.addSharedVoice({ publicOwnerId: v.publicOwnerId!, voiceId: v.voiceId, name: v.name });
      onPick({ voiceId: r.voiceId, name: v.name, isClone: false, previewUrl: v.previewUrl });
    } catch (e) {
      app.toast((e as Error).message, true);
    }
  };
  return (
    <div className="stack">
      <form className="row" onSubmit={(e) => (e.preventDefault(), load())}>
        <select className="input" style={{ maxWidth: 180 }} value={accent} onChange={(e) => setAccent(e.target.value)} aria-label="Accent">
          <option value="nigerian">Nigerian</option>
          <option value="african">African</option>
          <option value="ghanaian">Ghanaian</option>
          <option value="">Any accent</option>
        </select>
        <select className="input" style={{ maxWidth: 140 }} value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Gender">
          <option value="">Any voice</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </select>
        <input className="input" style={{ flex: 1, minWidth: 160 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. warm, podcast, Lagos" aria-label="Search" />
        <button className="btn">Search</button>
      </form>
      <VoiceList voices={voices} onPick={use} actionLabel="Use this voice" />
    </div>
  );
}

function VoiceList({ voices, onPick, actionLabel = "Use" }: { voices: VoiceInfo[] | null; onPick: (v: VoiceInfo) => void; actionLabel?: string }) {
  if (!voices) return <p className="muted">Loading voices…</p>;
  if (!voices.length) return <p className="muted">No voices found.</p>;
  return (
    <div className="voice-list">
      {voices.map((v) => (
        <div key={v.voiceId} className="voice">
          <div style={{ minWidth: 0 }}>
            <b>{v.name}</b>
            <div className="meta">{[v.accent, v.gender, v.age, v.useCase, v.isClone ? "cloned" : v.category].filter(Boolean).join(" · ")}</div>
            {v.description && <div className="meta">{v.description.slice(0, 160)}</div>}
          </div>
          <div className="row">
            {v.previewUrl && <button className="btn sm" onClick={() => preview(v.previewUrl)}>Listen</button>}
            <button className="btn sm primary" onClick={() => onPick(v)}>{actionLabel}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Clone({ onPick, forName }: { onPick: (v: Pick) => void; forName: string }) {
  const app = useApp();
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState(forName);
  const [consent, setConsent] = useState(false);
  const [denoise, setDenoise] = useState(false);
  const [busy, setBusy] = useState(false);
  const total = files.reduce((s, f) => s + f.size, 0);
  const go = async () => {
    setBusy(true);
    try {
      const paths: string[] = [];
      for (const f of files) paths.push((await uploadAsset(app.show.id, f, "audio", "voice-samples")).path);
      const r = await api.cloneVoice({ name, paths, removeNoise: denoise, consent, description: `Instant clone for ${forName}, created in The Bridge Studio` });
      app.toast(r.requiresVerification ? "Clone created. ElevenLabs asks the speaker to verify it before use." : "Clone created");
      onPick({ voiceId: r.voiceId, name, isClone: true, previewUrl: null });
    } catch (e) {
      app.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <p className="small" style={{ margin: 0 }}>
        Upload one to three minutes of the speaker talking naturally, alone, in a quiet room (MP3, WAV or M4A). This makes an ElevenLabs instant clone. For the best
        quality, make a professional clone in ElevenLabs with 30+ minutes of audio and then pick it under “My ElevenLabs voices”.
      </p>
      <FileDrop accept="audio/*,.m4a,.mp3,.wav" multiple onFiles={(f) => setFiles((x) => [...x, ...f])}>
        <b>Drop recordings here</b>
        <div className="small muted">{files.length ? `${files.length} file${files.length === 1 ? "" : "s"}, ${(total / 1e6).toFixed(1)} MB` : "or click to choose"}</div>
      </FileDrop>
      <label className="field">
        Voice name in ElevenLabs
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={denoise} onChange={(e) => setDenoise(e.target.checked)} />
        Remove background noise (only if the recording is noisy)
      </label>
      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        The speaker agreed in writing to have their voice cloned for The Bridge
      </label>
      <button className="btn accent" style={{ justifySelf: "start" }} disabled={!files.length || !consent || busy || !name.trim()} onClick={go}>
        {busy ? "Creating the clone…" : "Create clone"}
      </button>
    </div>
  );
}
