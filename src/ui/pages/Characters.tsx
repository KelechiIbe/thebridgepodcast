import { useEffect, useState } from "react";
import type { Character, CharacterKind } from "../../shared/types";
import { DEFAULT_VOICE_SETTINGS } from "../../shared/defaults";
import { uid } from "../../shared/ids";
import { toSpoken } from "../../shared/pronounce";
import { store } from "../../lib/store";
import { uploadAsset } from "../../lib/assets";
import { api, serverAvailable } from "../../lib/api";
import { useApp } from "../ctx";
import { VoicePicker } from "./VoicePicker";

const KINDS: Record<CharacterKind, string> = { host: "Host", expert: "Tax expert", listener: "Listener voice" };

export function Characters() {
  const app = useApp();
  const add = async (kind: CharacterKind) => {
    const c: Character = {
      id: uid("ch"),
      showId: app.show.id,
      name: kind === "expert" ? "New expert" : kind === "host" ? "New host" : "Listener voice",
      role: kind === "expert" ? "Tax expert" : kind === "host" ? "Host" : "Voice for listeners",
      kind,
      color: kind === "expert" ? "#4CCB92" : "#F5C518",
      image: null,
      voice: { provider: "none", voiceId: "", voiceName: "", isClone: false, settings: { ...DEFAULT_VOICE_SETTINGS }, previewUrl: null },
      bio: "",
      consent: null,
      sortOrder: app.characters.length,
    };
    await store.saveCharacter(c);
    app.setCharacters([...app.characters, c]);
  };
  const groups: CharacterKind[] = ["host", "expert", "listener"];
  return (
    <div>
      <h1 className="page">Characters</h1>
      <p className="page-sub">
        The host and experts appear on screen with their photo and voice. Listener voices speak for the fictional listeners the script invents; the AI picks a
        male or female listener voice for each one.
      </p>
      {groups.map((g) => (
        <section key={g} className="stack" style={{ marginBottom: 28 }}>
          <div className="row">
            <h2 className="sec" style={{ margin: 0 }}>{g === "listener" ? "Listener voices" : `${KINDS[g]}s`}</h2>
            <span className="spacer" />
            {app.can("edit") && <button className="btn sm" onClick={() => add(g)}>Add {KINDS[g].toLowerCase()}</button>}
          </div>
          {app.characters.filter((c) => c.kind === g).map((c) => <CharacterCard key={c.id} c={c} />)}
        </section>
      ))}
    </div>
  );
}

function CharacterCard({ c }: { c: Character }) {
  const app = useApp();
  const [draft, setDraft] = useState(c);
  const [picking, setPicking] = useState(false);
  const [sample, setSample] = useState("");
  const [testing, setTesting] = useState(false);
  const [img, setImg] = useState<string | null>(null);
  const editable = app.can("edit");
  useEffect(() => setDraft(c), [c]);
  useEffect(() => {
    if (draft.image) store.fileUrl(draft.image.path).then(setImg).catch(() => setImg(null));
    else setImg(null);
  }, [draft.image]);

  const save = async (next: Character) => {
    setDraft(next);
    await store.saveCharacter(next);
    app.setCharacters(app.characters.map((x) => (x.id === next.id ? next : x)));
  };
  const remove = async () => {
    if (!confirm(`Remove ${c.name}? Lines spoken by ${c.name} will need a new speaker.`)) return;
    await store.deleteCharacter(c.id);
    app.setCharacters(app.characters.filter((x) => x.id !== c.id));
  };
  const test = async () => {
    setTesting(true);
    try {
      const text = toSpoken(sample || `Hello, I'm ${draft.name}. Welcome to ${app.show.name}. This is how I sound reading a tax question about VAT and the CAC.`, app.pronunciations).spoken;
      const r = await api.tts({ text, voiceId: draft.voice.voiceId, modelId: app.show.ttsModel, settings: draft.voice.settings, preview: true });
      new Audio(`data:audio/mpeg;base64,${r.audioBase64}`).play();
    } catch (e) {
      app.toast((e as Error).message, true);
    } finally {
      setTesting(false);
    }
  };
  const initials = draft.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const vs = draft.voice.settings;
  const slider = (key: keyof typeof vs, label: string, min: number, max: number, step: number, hint: string) => (
    <label className="field">
      {label} · {Number(vs[key]).toFixed(2)} <span className="small muted">{hint}</span>
      <input type="range" min={min} max={max} step={step} value={Number(vs[key])} disabled={!editable} onChange={(e) => setDraft({ ...draft, voice: { ...draft.voice, settings: { ...vs, [key]: Number(e.target.value) } } })} onMouseUp={() => save(draft)} onKeyUp={() => save(draft)} onTouchEnd={() => save(draft)} />
    </label>
  );

  return (
    <div className="panel">
      <div className="char-card">
        <div className="stack tight" style={{ justifyItems: "center" }}>
          <div className="avatar" style={{ background: img ? `url(${img}) center/cover` : draft.color }}>{!img && initials}</div>
          {editable && draft.kind !== "listener" && (
            <label className="btn sm">
              Photo
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const a = await uploadAsset(app.show.id, f, "image", "portraits");
                  await save({ ...draft, image: a });
                }}
              />
            </label>
          )}
          {draft.image && editable && <button className="btn ghost sm" onClick={() => save({ ...draft, image: null })}>Remove</button>}
        </div>
        <div className="stack">
          <div className="grid2">
            <label className="field">
              Name
              <input className="input" value={draft.name} disabled={!editable} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={() => save(draft)} />
            </label>
            <label className="field">
              Shown as
              <input className="input" value={draft.role} disabled={!editable} onChange={(e) => setDraft({ ...draft, role: e.target.value })} onBlur={() => save(draft)} />
            </label>
            <label className="field">
              Colour
              <input type="color" className="swatch" value={draft.color} disabled={!editable} onChange={(e) => setDraft({ ...draft, color: e.target.value })} onBlur={() => save(draft)} />
            </label>
          </div>
          {draft.kind !== "listener" && (
            <label className="field">
              About (helps the script writer)
              <textarea className="input" rows={2} value={draft.bio} disabled={!editable} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} onBlur={() => save(draft)} />
            </label>
          )}
          <div className="panel flat stack tight">
            <div className="row">
              <span className="eyebrow">Voice</span>
              <b>{draft.voice.voiceId ? draft.voice.voiceName : "None yet"}</b>
              {draft.voice.isClone && <span className="pill ok">Cloned voice</span>}
              <span className="spacer" />
              {editable && serverAvailable() && <button className="btn sm" onClick={() => setPicking(true)}>{draft.voice.voiceId ? "Change voice" : "Choose a voice"}</button>}
            </div>
            {draft.voice.voiceId && (
              <>
                <div className="grid2">
                  {slider("stability", "Stability", 0, 1, 0.05, "lower is more expressive")}
                  {slider("similarity", "Likeness", 0, 1, 0.05, "how closely it sticks to the voice")}
                  {slider("style", "Style", 0, 1, 0.05, "adds flair, costs stability")}
                  {slider("speed", "Speed", 0.7, 1.2, 0.01, "1 is normal")}
                </div>
                <div className="row">
                  <input className="input" style={{ flex: 1, minWidth: 200 }} value={sample} onChange={(e) => setSample(e.target.value)} placeholder="Type a line to hear it in this voice" aria-label="Test line" />
                  <button className="btn sm" disabled={testing || !serverAvailable()} onClick={test}>{testing ? "Generating…" : "Listen"}</button>
                </div>
              </>
            )}
            {!serverAvailable() && <span className="small muted">Voices are chosen in the online studio.</span>}
          </div>
          {draft.voice.isClone && (
            <div className="panel flat stack tight">
              <span className="eyebrow">Consent for this cloned voice</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!draft.consent?.confirmed}
                  disabled={!editable}
                  onChange={(e) => save({ ...draft, consent: { confirmed: e.target.checked, by: app.user.fullName || app.user.email, at: new Date().toISOString(), note: draft.consent?.note ?? "" } })}
                />
                {draft.name} agreed to have their voice cloned and used in The Bridge
              </label>
              <input className="input" value={draft.consent?.note ?? ""} placeholder="Where the written consent is kept" disabled={!editable} onChange={(e) => setDraft({ ...draft, consent: { ...(draft.consent ?? { confirmed: false, by: "", at: "" }), note: e.target.value } })} onBlur={() => save(draft)} />
              {draft.consent?.confirmed && <span className="small muted">Recorded by {draft.consent.by} on {new Date(draft.consent.at).toLocaleDateString()}</span>}
            </div>
          )}
          {editable && (
            <div className="row end">
              <button className="btn ghost sm danger" onClick={remove}>Remove {KINDS[draft.kind].toLowerCase()}</button>
            </div>
          )}
        </div>
      </div>
      {picking && (
        <VoicePicker
          forName={draft.name}
          onClose={() => setPicking(false)}
          onPick={async (v) => {
            setPicking(false);
            await save({ ...draft, voice: { ...draft.voice, provider: "elevenlabs", voiceId: v.voiceId, voiceName: v.name, isClone: v.isClone, previewUrl: v.previewUrl } });
            app.toast(`${draft.name} now uses ${v.name}`);
          }}
        />
      )}
    </div>
  );
}
