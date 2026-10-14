import { uid } from "../shared/ids";
import type { AssetKind, AssetRef } from "../shared/types";
import { store } from "./store";

/** Gives an SVG a pixel size from its viewBox when it has none, so browsers can draw it. */
export function sizedSvg(text: string, fallback = 1000): string {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== "svg") return text;
  const px = (v: string | null) => (v && /^[\d.]+(px)?$/.test(v.trim()) ? parseFloat(v) : 0);
  let w = px(svg.getAttribute("width"));
  let h = px(svg.getAttribute("height"));
  if (!w || !h) {
    const vb = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
    const [vw, vh] = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? [vb[2], vb[3]] : [fallback, fallback];
    w = w || (h ? (h * vw) / vh : vw);
    h = h || (w * vh) / vw;
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
  }
  if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(doc);
}

/** Draws an SVG into a PNG about `target` pixels on its long side. Canvas and video export can't use SVG files directly. */
export async function svgToPng(blob: Blob, name: string, target = 1600): Promise<File> {
  const url = URL.createObjectURL(new Blob([sizedSvg(await blob.text())], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth || 1000;
    const h0 = img.naturalHeight || 1000;
    const k = target / Math.max(w0, h0);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w0 * k));
    c.height = Math.max(1, Math.round(h0 * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const png = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't convert the SVG"))), "image/png"));
    return new File([png], name.replace(/\.svg$/i, "") + ".png", { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decodes any image blob, SVG included, into a bitmap for the canvas. */
export async function blobToBitmap(b: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(b);
  } catch (e) {
    if (!/svg/.test(b.type) && !(await b.slice(0, 512).text()).includes("<svg")) throw e;
    return createImageBitmap(await svgToPng(b, "image.svg"));
  }
}

const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-60) || "file";

async function probe(file: File, kind: AssetKind): Promise<Partial<AssetRef>> {
  try {
    if (kind === "image" || kind === "logo") {
      const bmp = await blobToBitmap(file);
      return { width: bmp.width, height: bmp.height };
    }
    if (kind === "audio" || kind === "video") {
      const url = URL.createObjectURL(file);
      const el = document.createElement(kind === "audio" ? "audio" : "video");
      el.preload = "metadata";
      el.src = url;
      const d = await new Promise<number>((r) => {
        el.onloadedmetadata = () => r(el.duration);
        el.onerror = () => r(0);
        setTimeout(() => r(0), 8000);
      });
      const extra = kind === "video" ? { width: (el as HTMLVideoElement).videoWidth, height: (el as HTMLVideoElement).videoHeight } : {};
      URL.revokeObjectURL(url);
      return { duration: isFinite(d) ? d : 0, ...extra };
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** Uploads a file to storage and records it in the show's asset library. */
export async function uploadAsset(showId: string, file: File, kind: AssetKind, folder: string = kind): Promise<AssetRef> {
  // logos and pictures are stored as PNG when they arrive as SVG, so every export can draw them
  if ((kind === "logo" || kind === "image") && (file.type === "image/svg+xml" || /\.svg$/i.test(file.name))) file = await svgToPng(file, file.name);
  const id = uid("asset");
  const path = `shows/${showId}/${folder}/${id}-${safe(file.name)}`;
  await store.upload(path, file, file.type);
  const ref: AssetRef = { id, path, name: file.name, mime: file.type, kind, size: file.size, ...(await probe(file, kind)) };
  await store.saveAsset(showId, ref);
  return ref;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
