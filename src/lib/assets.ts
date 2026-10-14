import { uid } from "../shared/ids";
import type { AssetKind, AssetRef } from "../shared/types";
import { store } from "./store";

const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-60) || "file";

async function probe(file: File, kind: AssetKind): Promise<Partial<AssetRef>> {
  try {
    if (kind === "image" || kind === "logo") {
      const bmp = await createImageBitmap(file);
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
