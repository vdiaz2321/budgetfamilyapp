// Browser-only: turns a Social Security Statement PDF into plain text, entirely
// on this device. Nothing is uploaded, fetched, stored, or logged — the file's
// bytes go straight from the <input type="file"> into pdf.js in memory.
//
// pdf.js runs on the main thread: importing the worker bundle first sets
// `globalThis.pdfjsWorker`, which pdf.js then uses instead of spawning a Web
// Worker from a URL (fragile under Turbopack). Both imports are dynamic so
// pdf.js (~1.8 MB) stays out of the main bundle until a statement is chosen.
//
// The legacy build is used on purpose: the modern build calls
// Map.getOrInsertComputed / Math.sumPrecise without polyfills, which iPhone
// Safari does not have yet.

type TextItemLike = { str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean };

type Line = { y: number; items: { x: number; end: number; h: number; str: string }[] };

/**
 * Rebuilds lines from pdf.js text items: consecutive items on the same
 * baseline (transform[5]) form one line, sorted by x. Items are kept in the
 * PDF's own drawing order between lines rather than merged page-wide by y —
 * the statement has side-by-side columns, and a page-wide merge would splice
 * the two columns together mid-sentence ("date of … birth").
 */
export function itemsToLines(items: TextItemLike[]): string[] {
  const lines: Line[] = [];
  let line: Line | null = null;
  for (const it of items) {
    if (typeof it.str !== "string" || !it.transform) continue;
    if (it.str.length === 0) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = Math.abs(it.height || it.transform[3] || 10);
    const tol = Math.max(2, h * 0.4);
    if (!line || Math.abs(line.y - y) > tol) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ x, end: x + (it.width ?? 0), h, str: it.str });
  }
  return lines
    .map((l) => {
      l.items.sort((a, b) => a.x - b.x);
      let out = "";
      let prevEnd: number | null = null;
      for (const it of l.items) {
        if (prevEnd !== null && it.x - prevEnd > Math.max(1, it.h * 0.15) && !/\s$/.test(out) && !/^\s/.test(it.str)) {
          out += " ";
        }
        out += it.str;
        prevEnd = it.end;
      }
      return out.replace(/\s+/g, " ").trim();
    })
    .filter((s) => s.length > 0);
}

export async function readSsaStatementPdf(file: File): Promise<string> {
  // Worker bundle first: it registers globalThis.pdfjsWorker for main-thread use.
  await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    // Keep everything local: no CMap / font / wasm / ICC fetches, no font
    // injection into the page, no XFA, errors-only logging.
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: true,
    useWasm: false,
    enableXfa: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(itemsToLines(content.items as TextItemLike[]).join("\n"));
      page.cleanup();
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}
