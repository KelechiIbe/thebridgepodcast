// Reads uploaded meeting notes (Word, PDF, text, captions) into plain text.

export async function readNotesFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) {
    const mammoth: any = await import("mammoth/mammoth.browser.js");
    const out = await (mammoth.default ?? mammoth).extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return clean(out.value);
  }
  if (name.endsWith(".pdf")) return clean(await pdfText(file));
  if (name.endsWith(".doc")) throw new Error("Old .doc files can't be read. Save it as .docx or PDF and upload again.");
  return clean(await file.text());
}

export async function pdfText(file: Blob, maxPages = 200): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    parts.push(tc.items.map((it: any) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join(""));
  }
  return parts.join("\n\n");
}

/** Most common colours on the first pages of a PDF (for brand-guide import). */
export async function pdfColours(file: Blob, pages = 4): Promise<string[]> {
  const pdfjs: any = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const counts = new Map<string, number>();
  for (let i = 1; i <= Math.min(doc.numPages, pages); i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 0.5 });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let p = 0; p < d.length; p += 16) {
      const q = (v: number) => Math.min(255, Math.round(v / 24) * 24);
      const hex = `#${[d[p], d[p + 1], d[p + 2]].map((v) => q(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([h]) => h);
}

function clean(s: string): string {
  return s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
