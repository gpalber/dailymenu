// PDF → text via pdfjs-dist (free, local). Menus are usually one or two pages of
// short lines, so we keep line structure by grouping text items on their y position.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function pdfToText(data: Uint8Array, maxPages = 8): Promise<string> {
  // pdfjs mutates the buffer it's given; hand it a copy so callers can reuse theirs.
  const doc = await getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;

  const pages: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Group items into lines by rounded y, then order lines top→bottom, items left→right.
    const lines = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as { str: string; transform: number[] }[]) {
      if (!item.str?.trim()) continue;
      const x = item.transform[4];
      const y = Math.round(item.transform[5]);
      (lines.get(y) ?? lines.set(y, []).get(y)!).push({ x, str: item.str });
    }
    const ordered = [...lines.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    pages.push(ordered.join("\n"));
    page.cleanup();
  }
  await doc.cleanup?.();
  return pages.join("\n");
}
