// Builds a single self-contained HTML file: the player script, episode data, images, fonts and audio.

import type { Character, Show } from "../../shared/types";
import type { PlayerData } from "../../player/main";
import type { Production } from "../engine";
import { store } from "../store";
import QRCode from "qrcode";

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

async function fileDataUrl(path?: string | null): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    return await blobToDataUrl(await store.download(path));
  } catch {
    return undefined;
  }
}

function publicShow(show: Show): Show {
  return { ...show, scriptGuide: "", aiModels: { claude: "", gemini: "" }, music: { ...show.music, sting: null, bed: null, ident: null, outro: null, blip: null } };
}

function publicCharacter(c: Character): Character {
  return { ...c, voice: { provider: "none", voiceId: "", voiceName: "", isClone: false, settings: c.voice.settings }, bio: "", consent: null, image: null };
}

export async function buildInteractiveHtml(prod: Production, mp3: Blob, envelopes: { voice: number[]; music: number[] }): Promise<Blob> {
  const m = prod.model;
  const res = await fetch("/player/player.js");
  if (!res.ok) throw new Error("The player bundle is missing. Run `npm run build:player` and redeploy.");
  const playerJs = await res.text();
  const show = m.show;
  const portraits: Record<string, string> = {};
  for (const c of m.characters) {
    const url = await fileDataUrl(c.image?.path);
    if (url) portraits[c.id] = url;
  }
  const cards: Record<string, string> = {};
  for (const c of m.script.cards) {
    const url = await fileDataUrl(c.image?.path);
    if (url) cards[c.id] = url;
  }
  const qr = show.endCard.showQr && show.endCard.url ? await QRCode.toDataURL(show.endCard.url, { margin: 0, width: 512, color: { dark: "#0B191C", light: "#FFFFFF" } }) : undefined;
  const fonts = show.brand.fonts;
  const google = [...new Set([fonts.display, fonts.body, fonts.mono].filter((f) => f.source === "google").map((f) => f.family))];
  const uploads: { family: string; url: string }[] = [];
  for (const f of [fonts.display, fonts.body, fonts.mono]) {
    if (f.source === "upload" && f.assetPath) {
      const url = await fileDataUrl(f.assetPath);
      if (url) uploads.push({ family: f.family, url });
    }
  }
  const script = { ...m.script, lines: m.script.lines.map((l) => ({ ...l, audio: null })), anonymisation: [], flags: [], social: null };
  const data: PlayerData = {
    model: {
      show: publicShow(show),
      characters: m.characters.map(publicCharacter),
      script,
      timeline: m.timeline,
      episodeNumber: m.episodeNumber,
      envVoice: envelopes.voice,
      envMusic: envelopes.music,
      fps: m.fps,
      draft: m.draft,
    },
    images: {
      logo: await fileDataUrl(show.brand.logo?.path),
      background: show.brand.scene === "image" ? await fileDataUrl(show.brand.backgroundImage?.path) : undefined,
      qr,
      portraits,
      cards,
    },
    audio: await blobToDataUrl(mp3),
    fonts: { google, uploads },
    showName: show.name,
    tagline: show.tagline,
    disclosure: show.disclosure,
  };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const title = `${show.name} · Episode ${m.episodeNumber}: ${m.script.title}`.replace(/</g, "");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${m.script.summary.replace(/"/g, "&quot;").replace(/</g, "")}">
</head>
<body>
<script>window.__BRIDGE__ = ${json};</script>
<script>${playerJs.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>`;
  return new Blob([html], { type: "text/html" });
}
