import type { Brand, Palette } from "../shared/types";

export function playerCss(p: Palette, fonts: Brand["fonts"]): string {
  const display = `"${fonts.display.family}", "Arial Narrow", sans-serif`;
  const body = `"${fonts.body.family}", "Segoe UI", system-ui, sans-serif`;
  const mono = `"${fonts.mono.family}", ui-monospace, Menlo, monospace`;
  return `
:root { color-scheme: dark; --bg:${p.bg}; --bg2:${p.bg2}; --ink:${p.ink}; --dim:${p.dim}; --accent:${p.accent}; --accent2:${p.accent2}; --good:${p.good}; --bad:${p.bad}; --mid:${p.mid}; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); font: 400 16px/1.55 ${body}; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 28px max(16px, env(safe-area-inset-right)) 64px max(16px, env(safe-area-inset-left)); display: grid; gap: 22px; }
.mast { display: grid; gap: 8px; }
.eyebrow { font: 500 12px/1.2 ${mono}; letter-spacing: .14em; text-transform: uppercase; color: var(--dim); }
.show { margin: 0; font: 900 clamp(44px, 9vw, 88px)/.9 ${display}; text-transform: uppercase; color: var(--accent); }
.ep { font: 600 clamp(17px, 2.3vw, 21px)/1.3 ${body}; }
.summary { margin: 0; color: var(--dim); max-width: 64ch; }
.stage { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 14px; overflow: hidden; background: var(--bg); }
.stage.portrait { aspect-ratio: 4 / 5; }
.stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.bigplay { position: absolute; left: 3.2%; bottom: 5%; display: inline-flex; align-items: center; gap: 12px; border: 0; cursor: pointer; background: var(--accent); color: var(--bg); font: 700 clamp(14px, 1.8vw, 19px)/1 ${body}; padding: 14px 24px 14px 20px; border-radius: 99px; }
.bigplay i { width: 0; height: 0; border-left: 14px solid currentColor; border-top: 9px solid transparent; border-bottom: 9px solid transparent; }
.bigplay[hidden] { display: none; }
.poll { position: absolute; inset: 0; background: rgba(0,0,0,.78); display: grid; place-items: center; padding: 4%; }
.poll[hidden] { display: none; }
.poll-in { width: min(100%, 640px); display: grid; gap: 14px; }
.poll-k { font: 500 12px/1 ${mono}; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
.poll-q { font: 700 clamp(18px, 3vw, 30px)/1.15 ${body}; }
.poll-opts { display: grid; gap: 10px; }
.poll-opts button { text-align: left; border: 1px solid rgba(255,255,255,.28); background: rgba(255,255,255,.06); color: var(--ink); font: 600 clamp(14px, 1.8vw, 18px)/1.25 ${body}; padding: 12px 16px; border-radius: 10px; cursor: pointer; }
.poll-opts button.right { border-color: var(--good); background: color-mix(in srgb, var(--good) 20%, transparent); }
.poll-opts button.wrong { border-color: var(--bad); background: color-mix(in srgb, var(--bad) 16%, transparent); }
.poll-why { color: var(--mid); min-height: 1.4em; }
.poll-go { display: flex; gap: 10px; flex-wrap: wrap; }
.poll-go button { border: 0; border-radius: 99px; padding: 11px 20px; font: 700 15px/1 ${body}; cursor: pointer; }
.poll-go .go { background: var(--accent); color: var(--bg); }
.poll-go .skip { background: transparent; color: var(--dim); border: 1px solid rgba(255,255,255,.25); }
.poll-go button[hidden] { display: none; }
.transport { display: grid; grid-template-columns: auto 1fr auto; gap: 14px; align-items: center; }
.pp { width: 48px; height: 48px; border-radius: 50%; border: 0; background: var(--ink); color: var(--bg); display: grid; place-items: center; cursor: pointer; }
.pp svg { width: 20px; height: 20px; fill: currentColor; }
.scrub { position: relative; height: 32px; display: grid; align-items: center; }
.scrub input { width: 100%; margin: 0; accent-color: var(--accent); position: relative; z-index: 1; }
.ticks { position: absolute; inset: 50% 0 auto 0; height: 0; pointer-events: none; }
.ticks i { position: absolute; top: -9px; width: 2px; height: 18px; background: var(--dim); opacity: .5; }
.ticks b { position: absolute; top: -13px; width: 8px; height: 8px; margin-left: -4px; border-radius: 50%; background: var(--accent); }
.time { font: 500 13px/1 ${mono}; color: var(--dim); font-variant-numeric: tabular-nums; }
.opts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.chip { border: 1px solid rgba(255,255,255,.2); background: transparent; color: var(--ink); border-radius: 99px; padding: 7px 13px; font: 500 13px/1 ${body}; cursor: pointer; display: inline-flex; gap: 7px; align-items: center; }
.chip .dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,.25); }
.chip[aria-pressed="true"] .dot { background: var(--good); }
.score { margin-left: auto; font: 500 13px/1 ${mono}; color: var(--dim); }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.cols { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.3fr); gap: 36px; align-items: start; margin-top: 12px; }
.sec h2 { margin: 0 0 12px; font: 800 28px/1 ${display}; text-transform: uppercase; }
.lede { margin: -4px 0 12px; color: var(--dim); }
.chapters { display: grid; border-top: 1px solid rgba(255,255,255,.12); }
.chapter { all: unset; cursor: pointer; display: grid; grid-template-columns: 28px 1fr auto; gap: 12px; padding: 12px 4px; border-bottom: 1px solid rgba(255,255,255,.12); }
.chapter .n { font: 800 19px/1 ${display}; color: var(--dim); }
.chapter .t { font-weight: 600; }
.chapter .ts { font: 500 13px/1 ${mono}; color: var(--dim); }
.chapter.on .n, .chapter.on .t { color: var(--accent); }
.calc { border: 1px solid rgba(255,255,255,.14); border-radius: 12px; padding: 18px; display: grid; gap: 12px; margin-bottom: 16px; background: color-mix(in srgb, var(--bg2) 40%, transparent); }
.calc h3 { margin: 0; font: 700 17px/1.25 ${body}; }
.fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.fields label { display: grid; gap: 6px; font: 500 13px/1.2 ${body}; color: var(--dim); }
.fields input { font: 500 16px/1 ${mono}; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.18); background: var(--bg); color: var(--ink); width: 100%; }
.out { display: grid; gap: 10px; }
.orow { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 4px 12px; align-items: center; }
.orow .ok { font-size: 14px; color: var(--dim); }
.orow .ov { font: 800 21px/1 ${display}; }
.orow .ob { grid-column: 1 / -1; height: 10px; border-radius: 99px; background: rgba(255,255,255,.1); overflow: hidden; }
.orow .ob i { display: block; height: 100%; border-radius: 99px; background: var(--mid); }
.orow.good .ob i { background: var(--good); } .orow.bad .ob i { background: var(--bad); }
.verdict { font-weight: 600; }
.fine { margin: 0; font-size: 12.5px; color: var(--dim); }
.transcript { display: grid; gap: 22px; }
.tchap h3 { margin: 0 0 6px; font: 800 19px/1 ${display}; text-transform: uppercase; color: var(--dim); }
.tline { all: unset; cursor: pointer; display: grid; grid-template-columns: 52px minmax(0,1fr); gap: 2px 12px; padding: 8px; border-radius: 8px; }
.tline:hover { background: rgba(255,255,255,.04); }
.tline.on { background: rgba(255,255,255,.07); box-shadow: inset 3px 0 0 var(--accent); }
.tline .ts { font: 500 12px/1.7 ${mono}; color: var(--dim); grid-row: span 2; }
.tline .sp { font: 600 13px/1.3 ${body}; }
.tline .sp em { font-style: normal; font-weight: 400; color: var(--dim); }
.foot { border-top: 1px solid rgba(255,255,255,.12); padding-top: 18px; display: grid; gap: 8px; color: var(--dim); font-size: 14px; max-width: 72ch; }
.foot b { color: var(--ink); } .foot a { color: var(--accent); margin-left: 6px; }
@media (max-width: 860px) { .cols { grid-template-columns: minmax(0,1fr); } }
@media (max-width: 560px) { .transport { grid-template-columns: auto 1fr; } .time { grid-column: 2; justify-self: end; } .score { margin-left: 0; width: 100%; } }
`;
}
