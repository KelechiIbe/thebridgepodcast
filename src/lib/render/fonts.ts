import type { Brand, FontChoice } from "../../shared/types";
import { store } from "../store";

const loadedLinks = new Set<string>();

/**
 * The weight an uploaded font file is registered at. A file of known weight keeps it, so a bold
 * headline face and a regular text face of the same family can sit side by side; a file of
 * unknown weight covers every weight, so the browser never fakes bold on top of it.
 */
export function faceWeight(f: Pick<FontChoice, "weight" | "weightMax">): string {
  if (!f.weight) return "100 900";
  return f.weightMax && f.weightMax !== f.weight ? `${f.weight} ${f.weightMax}` : String(f.weight);
}
const loadedFaces = new Set<string>();

/** Makes sure the brand's fonts are ready before drawing text on the canvas. */
export async function ensureFonts(brand: Brand): Promise<void> {
  const list = [brand.fonts.display, brand.fonts.body, brand.fonts.mono];
  const google = [...new Set(list.filter((f) => f.source === "google").map((f) => f.family))];
  const missing = google.filter((g) => !loadedLinks.has(g));
  if (missing.length) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${missing.map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700;800;900`).join("&")}&display=swap`;
    document.head.append(link);
    missing.forEach((m) => loadedLinks.add(m));
    await new Promise((r) => {
      link.onload = r;
      link.onerror = r;
      setTimeout(r, 4000);
    });
  }
  for (const f of list) {
    if (f.source !== "upload" || !f.assetPath || loadedFaces.has(f.family + f.assetPath)) continue;
    try {
      const url = await store.fileUrl(f.assetPath);
      const face = new FontFace(f.family, `url(${url})`, { weight: faceWeight(f) });
      document.fonts.add(await face.load());
      loadedFaces.add(f.family + f.assetPath);
    } catch {
      /* fall back */
    }
  }
  const weights: [string, number][] = [
    [brand.fonts.display.family, 900],
    [brand.fonts.display.family, 800],
    [brand.fonts.body.family, 400],
    [brand.fonts.body.family, 600],
    [brand.fonts.body.family, 700],
    [brand.fonts.mono.family, 500],
  ];
  await Promise.race([Promise.all(weights.map(([fam, w]) => document.fonts.load(`${w} 24px "${fam}"`).catch(() => null))), new Promise((r) => setTimeout(r, 5000))]);
}
