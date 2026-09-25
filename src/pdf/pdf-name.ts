/** Gives PDFs with machine-made names (GUC_45_64_46266_2024-09-07T10_43_25.pdf, scan0001.pdf…)
 *  a readable name taken from the document itself: its title metadata, or the largest text on page one. */

const FILLER = new Set(['scan', 'scanned', 'doc', 'document', 'file', 'img', 'image', 'print', 'untitled', 'download', 'downloads', 'copy', 'new', 'final', 'pdf', 'page', 'export', 'output', 'attachment', 'tmp', 'temp', 'microsoft', 'word']);

export function isGenericName(name: string) {
  const base = name.replace(/\.[^.]+$/, '');
  const chars = base.replace(/[\s_\-.()[\]]/g, '');
  if (!chars) return true;
  if (/^[A-Za-z ]+$/.test(base) && !FILLER.has(base.trim().toLowerCase())) return false;
  const digits = (chars.match(/\d/g) || []).length;
  if (digits / chars.length >= 0.4) return true;
  if (/[@#$%^&*=+~`|]/.test(base)) return true;
  const words = base.split(/[\s_\-.()[\]]+/).filter((t) => /^[A-Za-zÀ-ɏ؀-ۿ]{3,}$/.test(t) && !FILLER.has(t.toLowerCase()) && !(t.length <= 4 && t === t.toUpperCase()));
  return words.length === 0;
}

const tidy = (text: string) => text.replace(/\s+/g, ' ').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
const titled = (text: string) => text === text.toUpperCase() && /[A-Z]{4}/.test(text) ? text.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : text;

export async function suggestPdfName(blob: Blob): Promise<string | undefined> {
  const lib = await import('pdfjs-dist');
  lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  const task = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  try {
    const pdf = await task.promise;
    const meta = await pdf.getMetadata().catch(() => undefined);
    const title = tidy(String((meta?.info as { Title?: string } | undefined)?.Title || ''));
    if (title.length >= 4 && !isGenericName(title + '.pdf') && !/^(microsoft|untitled|slide ?1|powerpoint)/i.test(title) && !/\.(docx?|pptx?|tex|dvi)$/i.test(title)) return titled(title).slice(0, 80);
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    // Group text runs into lines, keeping each line's largest font size.
    const lines = new Map<number, { y: number; x: number; size: number; text: string }>();
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const [a, b, c, d, x, y] = item.transform as number[];
      const size = Math.hypot(c, d) || Math.hypot(a, b);
      const key = Math.round(y / 3);
      const line = lines.get(key) || { y, x, size: 0, text: '' };
      line.text += (line.text && !line.text.endsWith(' ') ? ' ' : '') + item.str;
      line.size = Math.max(line.size, size);
      line.x = Math.min(line.x, x);
      lines.set(key, line);
    }
    const all = [...lines.values()].map((l) => ({ ...l, text: tidy(l.text) })).filter((l) => /\p{L}{2}/u.test(l.text) && l.text.length <= 90);
    if (!all.length) return undefined;
    const largest = Math.max(...all.map((l) => l.size));
    const picked = all.filter((l) => l.size >= largest * 0.8).sort((p, q) => q.y - p.y || p.x - q.x).map((l) => titled(l.text));
    const name = [...new Set(picked)].slice(0, 3).join(' – ');
    return name.length >= 3 ? name.slice(0, 80).replace(/[\s–-]+$/, '') : undefined;
  } finally {
    await task.destroy();
  }
}

/** The file name to store: the original when it reads well, otherwise one drawn from the PDF. */
export async function readablePdfName(file: File) {
  if (!/\.pdf$/i.test(file.name) || !isGenericName(file.name)) return file.name;
  const found = await Promise.race([suggestPdfName(file).catch(() => undefined), new Promise<undefined>((r) => setTimeout(r, 6000))]);
  return found ? found + '.pdf' : file.name;
}
