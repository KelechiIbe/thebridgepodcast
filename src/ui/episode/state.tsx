import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Episode, Line, Script } from "../../shared/types";
import { hashString, toSpoken } from "../../shared/pronounce";
import { wordsFromAlignment } from "../../shared/timing";
import { store } from "../../lib/store";
import { api } from "../../lib/api";
import { lineHash, mixProduction, prepare, voiceCharacter, isStale, type Production } from "../../lib/engine";
import { toAudioBuffer, type MixResult } from "../../lib/audio/mixer";
import { useApp } from "../ctx";

export function scriptHash(s: Script | null): string {
  if (!s) return "";
  return hashString(JSON.stringify({ l: s.lines.map((l) => [l.speaker, l.text]), c: s.cards.map(({ id, image, ...c }) => c), p: s.polls }));
}

interface EpisodeState {
  ep: Episode;
  update: (fn: (e: Episode) => Episode) => void;
  updateScript: (fn: (s: Script) => Script) => void;
  prod: Production | null;
  prodVersion: number;
  mix: MixResult | null;
  mixBuffer: AudioBuffer | null;
  mixing: boolean;
  buildMix: () => Promise<MixResult | null>;
  generate: (lineIds: string[], onProgress?: (done: number, total: number) => void) => Promise<void>;
  busyLines: Set<string>;
  saving: boolean;
  saveNow: () => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<EpisodeState | null>(null);
export const useEpisode = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("Episode context missing");
  return v;
};

export function EpisodeProvider({ initial, children }: { initial: Episode; children: ReactNode }) {
  const app = useApp();
  const [ep, setEp] = useState(initial);
  const [prod, setProd] = useState<Production | null>(null);
  const [prodVersion, setProdVersion] = useState(0);
  const [mix, setMix] = useState<MixResult | null>(null);
  const [mixBuffer, setMixBuffer] = useState<AudioBuffer | null>(null);
  const [mixing, setMixing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyLines, setBusy] = useState<Set<string>>(new Set());
  const dirty = useRef(false);
  const latest = useRef(ep);
  latest.current = ep;
  const timer = useRef<number>(0);

  const saveNow = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setSaving(true);
    try {
      await store.saveEpisode(latest.current);
    } catch (e) {
      dirty.current = true;
      app.toast(`Couldn't save: ${(e as Error).message}`, true);
    } finally {
      setSaving(false);
    }
  }, [app]);

  const update = useCallback(
    (fn: (e: Episode) => Episode) => {
      setEp((prev) => {
        let next = fn(prev);
        // editing an approved script sends it back for review
        if ((next.status === "approved" || next.status === "published") && next.approval && scriptHash(next.script) !== next.approval.hash) {
          next = { ...next, status: "review" };
        }
        latest.current = next;
        return next;
      });
      dirty.current = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(saveNow, 1200);
    },
    [saveNow],
  );

  const updateScript = useCallback((fn: (s: Script) => Script) => update((e) => (e.script ? { ...e, script: fn(e.script) } : e)), [update]);

  useEffect(() => {
    const flush = () => {
      if (dirty.current) store.saveEpisode(latest.current);
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  // rebuild the preview model when content changes
  useEffect(() => {
    if (!ep.script) {
      setProd(null);
      return;
    }
    let alive = true;
    const id = window.setTimeout(async () => {
      const p = await prepare({
        show: app.show,
        characters: app.characters,
        script: ep.script!,
        library: app.pronunciations,
        episodeNumber: ep.number,
        draft: app.show.requireApproval && ep.status !== "approved" && ep.status !== "published",
      });
      if (!alive) return;
      if (mix && mixBuffer) {
        p.model.envVoice = mix.envVoice;
        p.model.envMusic = mix.envMusic;
      }
      setProd(p);
      setProdVersion((v) => v + 1);
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep.script, ep.status, ep.number, app.show, app.characters, app.pronunciations]);

  // audio is out of date whenever the timeline changes
  useEffect(() => {
    setMix(null);
    setMixBuffer(null);
  }, [prod?.timeline]);

  const buildMix = useCallback(async () => {
    if (!prod) {
      app.toast("The preview is still loading. Try again in a moment.", true);
      return null;
    }
    setMixing(true);
    try {
      const m = await mixProduction(prod);
      setMix(m);
      setMixBuffer(toAudioBuffer(m));
      setProdVersion((v) => v + 1);
      return m;
    } catch (e) {
      app.toast(`Couldn't build the audio: ${(e as Error).message}`, true);
      return null;
    } finally {
      setMixing(false);
    }
  }, [prod, app]);

  const generate = useCallback(
    async (lineIds: string[], onProgress?: (done: number, total: number) => void) => {
      const script = latest.current.script;
      if (!script) return;
      const library = app.pronunciations;
      const todo = lineIds.map((id) => script.lines.find((l) => l.id === id)).filter((l): l is Line => !!l);
      let done = 0;
      const results: Record<string, Line["audio"]> = {};
      const errors: string[] = [];
      const work = async (line: Line) => {
        const ch = voiceCharacter(line, app.characters, script.personas);
        if (!ch || ch.voice.provider !== "elevenlabs" || !ch.voice.voiceId) {
          errors.push(`${ch?.name ?? "A speaker"} has no voice yet`);
          return;
        }
        setBusy((b) => new Set(b).add(line.id));
        try {
          const idx = script.lines.findIndex((l) => l.id === line.id);
          const { spoken, spans } = toSpoken(line.text, library);
          const prev = script.lines[idx - 1];
          const next = script.lines[idx + 1];
          const hash = lineHash(line, ch, app.show, library);
          const res = await api.tts({
            episodeId: latest.current.id,
            lineId: line.id,
            hash,
            text: spoken,
            voiceId: ch.voice.voiceId,
            modelId: app.show.ttsModel,
            settings: ch.voice.settings,
            previousText: prev && prev.speaker === line.speaker ? toSpoken(prev.text, library).spoken : undefined,
            nextText: next && next.speaker === line.speaker ? toSpoken(next.text, library).spoken : undefined,
          });
          const words = wordsFromAlignment(line.text, spoken, spans, res.alignment);
          const ends = res.alignment.character_end_times_seconds;
          const duration = Math.round(((ends[ends.length - 1] ?? words[words.length - 1]?.e ?? 1) + 0.15) * 1000) / 1000;
          results[line.id] = { path: res.path!, hash, duration, words, voiceId: ch.voice.voiceId, createdAt: new Date().toISOString(), qa: null };
          // save as we go so nothing is lost if the tab closes
          update((e) =>
            e.script
              ? { ...e, script: { ...e.script, lines: e.script.lines.map((l) => (l.id === line.id ? { ...l, audio: results[line.id] } : l)) } }
              : e,
          );
        } catch (e) {
          errors.push((e as Error).message);
        } finally {
          setBusy((b) => {
            const n = new Set(b);
            n.delete(line.id);
            return n;
          });
          done++;
          onProgress?.(done, todo.length);
        }
      };
      const queue = [...todo];
      const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
        while (queue.length) {
          const l = queue.shift()!;
          await work(l);
          if (errors.some((m) => /key|plan|quota|401|unauthor/i.test(m))) break;
        }
      });
      await Promise.all(workers);
      if (errors.length) app.toast([...new Set(errors)].slice(0, 2).join(". "), true);
      else if (todo.length > 1) app.toast(`Generated ${todo.length} lines`);
    },
    [app, update],
  );

  const reload = useCallback(async () => {
    const fresh = await store.getEpisode(ep.id);
    if (fresh) {
      latest.current = fresh;
      setEp(fresh);
    }
  }, [ep.id]);

  return (
    <Ctx.Provider value={{ ep, update, updateScript, prod, prodVersion, mix, mixBuffer, mixing, buildMix, generate, busyLines, saving, saveNow, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export function staleLines(ep: Episode, app: ReturnType<typeof useApp>): string[] {
  if (!ep.script) return [];
  return ep.script.lines.filter((l) => isStale(l, voiceCharacter(l, app.characters, ep.script!.personas), app.show, app.pronunciations)).map((l) => l.id);
}
