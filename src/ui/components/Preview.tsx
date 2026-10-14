import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Orientation } from "../../shared/types";
import { clock } from "../../shared/captions";
import type { Production } from "../../lib/engine";
import { StageRenderer } from "../../lib/render/stage";
import { ensureFonts } from "../../lib/render/fonts";

const ASPECT: Record<Orientation, number> = { landscape: 9 / 16, portrait: 16 / 9, square: 1 };

export interface PreviewHandle {
  seek: (t: number) => void;
  time: () => number;
}

export function Preview({
  prod,
  audio,
  orientation,
  onTime,
  handleRef,
  version,
}: {
  prod: Production;
  audio: AudioBuffer | null;
  orientation: Orientation;
  onTime?: (t: number) => void;
  handleRef?: (h: PreviewHandle) => void;
  version?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const clockRef = useRef({ t: 0, startedAt: 0, playing: false });
  const ac = useRef<AudioContext | null>(null);
  const src = useRef<AudioBufferSourceNode | null>(null);
  const stage = useMemo(() => new StageRenderer(prod.model), [prod, version]);
  const duration = prod.timeline.duration;

  useEffect(() => {
    let alive = true;
    ensureFonts(prod.model.show.brand).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [prod]);

  const now = useCallback(() => {
    const c = clockRef.current;
    if (!c.playing) return c.t;
    const elapsed = ac.current ? ac.current.currentTime - c.startedAt : (performance.now() - c.startedAt) / 1000;
    return Math.min(duration, c.t + elapsed);
  }, [duration]);

  const draw = useCallback(() => {
    const cv = canvas.current;
    const box = wrap.current;
    if (!cv || !box) return;
    const w = box.clientWidth;
    const h = Math.round(Math.min(w * ASPECT[orientation], window.innerHeight * 0.72));
    const width = orientation === "landscape" ? w : Math.round(h / ASPECT[orientation]);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(width * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(width * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${width}px`;
      cv.style.height = `${h}px`;
    }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stage.render(ctx, width, h, now());
  }, [orientation, stage, now]);

  const stopAudio = () => {
    try {
      src.current?.stop();
    } catch {
      /* already stopped */
    }
    src.current = null;
  };

  const pause = useCallback(() => {
    const c = clockRef.current;
    c.t = now();
    c.playing = false;
    stopAudio();
    setPlaying(false);
    setT(c.t);
  }, [now]);

  const play = useCallback(() => {
    const c = clockRef.current;
    if (c.t >= duration - 0.05) c.t = 0;
    if (audio) {
      ac.current ??= new AudioContext();
      ac.current.resume();
      stopAudio();
      const s = ac.current.createBufferSource();
      s.buffer = audio;
      s.connect(ac.current.destination);
      s.start(0, Math.min(c.t, audio.duration - 0.01));
      src.current = s;
      c.startedAt = ac.current.currentTime;
    } else {
      ac.current = null;
      c.startedAt = performance.now();
    }
    c.playing = true;
    setPlaying(true);
  }, [audio, duration]);

  const seek = useCallback(
    (to: number) => {
      const was = clockRef.current.playing;
      if (was) pause();
      clockRef.current.t = Math.max(0, Math.min(duration, to));
      setT(clockRef.current.t);
      if (was) play();
      else draw();
    },
    [pause, play, draw, duration],
  );

  useEffect(() => {
    handleRef?.({ seek, time: now });
  }, [handleRef, seek, now]);

  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let last = 0;
    const loop = (ts: number) => {
      draw();
      if (clockRef.current.playing) {
        const tt = now();
        if (ts - last > 200) {
          setT(tt);
          onTime?.(tt);
          last = ts;
        }
        if (tt >= duration) pause();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready, draw, now, duration, pause, onTime]);

  useEffect(() => () => stopAudio(), []);
  useEffect(() => {
    // new audio: restart playback from the same point
    if (clockRef.current.playing) {
      pause();
      play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio]);

  return (
    <div>
      <div ref={wrap} className="stage-box" style={{ display: "grid", placeItems: "center" }}>
        <canvas ref={canvas} aria-label="Episode preview" />
      </div>
      <div className="transport">
        <button className="btn primary sm" onClick={() => (playing ? pause() : play())} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "Pause" : "Play"}
        </button>
        <input type="range" min={0} max={Math.round(duration * 10)} value={Math.round(t * 10)} onChange={(e) => seek(Number(e.target.value) / 10)} aria-label="Seek" />
        <span className="time">
          {clock(t)} / {clock(duration)}
        </span>
      </div>
      {!audio && <p className="small muted" style={{ margin: "6px 0 0" }}>Silent preview with estimated timing. Generate voices to hear it.</p>}
    </div>
  );
}
