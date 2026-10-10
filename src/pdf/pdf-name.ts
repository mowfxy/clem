/** Reads what a PDF, Word or PowerPoint file says on its first page, so files with machine-made or bare names
 *  (GUC_45_64_46266_2024-09-07T10_43_25.pdf, scan0001.pdf, Lec03.pptx…) are saved under a readable one. */

import { betterFileName, isGenericName, saysEnough, type NameLine, type NameSource } from '../../core/file-naming';
import { desktop } from '../desktop/bridge';

export { isGenericName };

const tidy = (text: string) => text.replace(/\s+/g, ' ').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();

/** The title and page-one lines of a PDF, largest text first in importance. */
async function pdfSource(blob: Blob): Promise<NameSource | undefined> {
  const lib = await import('pdfjs-dist');
  lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  const task = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  try {
    const pdf = await task.promise;
    const meta = await pdf.getMetadata().catch(() => undefined);
    const title = tidy(String((meta?.info as { Title?: string } | undefined)?.Title || ''));
    const content = await (await pdf.getPage(1)).getTextContent();
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
    const ordered: NameLine[] = [...lines.values()].sort((p, q) => q.y - p.y || p.x - q.x).map((l) => ({ text: tidy(l.text), size: l.size })).filter((l) => /\p{L}{2}/u.test(l.text));
    return { title: title.length >= 4 && !/\.(docx?|pptx?|tex|dvi)$/i.test(title) ? title : undefined, lines: ordered };
  } finally {
    await task.destroy();
  }
}

const xmlText = (xml: string) => xml.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The title and first slide or first paragraphs of a Word or PowerPoint file; titles count as larger text. */
async function officeSource(blob: Blob, kind: 'pptx' | 'docx'): Promise<NameSource | undefined> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const want = kind === 'pptx' ? 'ppt/slides/slide1.xml' : 'word/document.xml';
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()), { filter: (f) => f.name === want || f.name === 'docProps/core.xml' });
  const core = zip['docProps/core.xml'] ? strFromU8(zip['docProps/core.xml']) : '';
  const title = tidy(xmlText(core.match(/<dc:title>([\s\S]*?)<\/dc:title>/)?.[1] || ''));
  const body = zip[want] ? strFromU8(zip[want]) : '';
  const lines: NameLine[] = [];
  if (kind === 'pptx') {
    for (const shape of body.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) {
      const ph = shape.match(/<p:ph[^>]*type="(\w+)"/)?.[1];
      const size = ph === 'title' || ph === 'ctrTitle' ? 3 : ph === 'subTitle' ? 2 : 1;
      for (const para of shape.match(/<a:p>[\s\S]*?<\/a:p>/g) || []) {
        const text = tidy((para.match(/<a:t>[\s\S]*?<\/a:t>/g) || []).map(xmlText).join(''));
        if (text) lines.push({ text, size });
      }
    }
  } else {
    for (const para of (body.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).slice(0, 25)) {
      const text = tidy((para.match(/<w:t[ >][\s\S]*?<\/w:t>/g) || []).map(xmlText).join(''));
      if (!text) continue;
      const style = para.match(/<w:pStyle w:val="([^"]+)"/)?.[1] || '';
      lines.push({ text, size: /^title$/i.test(style) ? 3 : /heading1|^subtitle$/i.test(style) ? 2 : 1 });
    }
  }
  return { title: title.length >= 4 ? title : undefined, lines };
}

/** What a document's first page says, for naming it; undefined for formats that are not read. */
export async function nameSource(file: Blob & { name: string }): Promise<NameSource | undefined> {
  if (/\.pdf$/i.test(file.name)) return pdfSource(file);
  if (/\.pptx$/i.test(file.name)) return officeSource(file, 'pptx');
  if (/\.docx$/i.test(file.name)) return officeSource(file, 'docx');
  return undefined;
}

/**
 * A PDF's first page as the naming AI reads it, the way it reads PDFs in chat (src/desktop/page-images.ts pdfView):
 * the page as a one-page PDF (Claude, Grok) and drawn as a picture (ChatGPT). Undefined for a very large first page.
 */
async function firstPage(file: Blob): Promise<{ pdf: Uint8Array<ArrayBuffer>; picture: string } | undefined> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { PDFDocument } = await import('pdf-lib');
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const one = await PDFDocument.create();
  // The first two pages: a cover page alone often says only the course, the second what this file covers.
  for (const page of await one.copyPages(source, source.getPageIndices().slice(0, 2))) one.addPage(page);
  const pdf = new Uint8Array(await one.save());
  if (pdf.length > 15_000_000) return undefined;
  const lib = await import('pdfjs-dist');
  lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  const task = lib.getDocument({ data: pdf.slice() });
  try {
    const page = await (await task.promise).getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 1200 / Math.max(base.width, base.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    // Print intent: the display intent waits for animation frames, which never come while the window is hidden.
    await page.render({ canvasContext: context, viewport, canvas, intent: 'print' } as any).promise;
    const url = canvas.toDataURL('image/jpeg', 0.85);
    return { pdf, picture: url.slice(url.indexOf(',') + 1) };
  } finally {
    await task.destroy();
  }
}

/**
 * The file name to store: the original when it reads well, otherwise one drawn from the document and where it is saved.
 * `place` is the name of the subject or project the file goes into, if any.
 */
export async function readableName(file: File, place?: string) {
  return (await namedFile(file, place)).name;
}

/**
 * The file's name from the rules (`name`, the fallback), and `refine`: the AI's name when the file's own name does not
 * already say what it is (worksheets, sheets, assignments, labs and project documents as much as lectures). A PDF is
 * read as it is drawn, its first pages themselves, never from Mowr's text of it; Word and PowerPoint files from their
 * text. `siblings`: the names of the other files where it goes, so the name follows the pattern they share ("… –
 * Lecture 5"). `refine` resolves to undefined when there is nothing better, or outside the desktop app.
 */
export async function namedFile(file: File, place?: string, siblings: string[] = []) {
  const source = await Promise.race([nameSource(file).catch(() => undefined), new Promise<undefined>((r) => setTimeout(r, 6000))]);
  const name = betterFileName(file.name, source, place);
  const refine = async () => {
    const pdf = /\.pdf$/i.test(file.name);
    if (!desktop || saysEnough(file.name, place) || (!pdf && !source?.lines.length)) return undefined;
    const page = pdf ? await firstPage(file).catch(() => undefined) : undefined;
    if (pdf && !page) return undefined;
    const result = await desktop.invoke({ action: 'fileName', original: file.name.slice(0, 260), ...(pdf ? { lines: [] } : { title: source!.title?.slice(0, 300), lines: source!.lines.slice(0, 40).map((l) => l.text.slice(0, 400)) }), place: place?.slice(0, 200), suggestion: name.slice(0, 260), siblings: siblings.slice(0, 40).map((s) => s.slice(0, 160)), ...(page ? { page } : {}) }).catch(() => undefined);
    const better = typeof result?.name === 'string' ? result.name : undefined;
    return better && better !== name ? better : undefined;
  };
  return { name, refine };
}
