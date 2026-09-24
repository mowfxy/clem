/**
 * Plans text replacements inside an existing PDF page. Text is found on a single printed line
 * (as pdf.js reports it) and the whole run of items it touches is re-set, so the rest of the page
 * — images, drawings, other text — is never redrawn. Pure so it can be tested without a PDF.
 */
export type TextItem = { str: string; x: number; y: number; width: number; size: number; font?: string };
export type PdfTextEdit = { page: number; find: string; replace: string };
export type Placement = { page: number; text: string; x: number; y: number; size: number; font?: string; cover: { x: number; y: number; w: number; h: number }; width: number; before: string };

type Line = { items: TextItem[]; text: string; owners: number[] };

/** Items on the same baseline, left to right, joined the way a reader would see them. */
export function lines(items: TextItem[]): Line[] {
  const sorted = items.filter((i) => i.str.length).slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextItem[][] = [];
  for (const item of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - item.y) < Math.max(1.5, r[0].size * 0.35));
    if (row) row.push(item); else rows.push([item]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let text = "";
    const owners: number[] = [];
    row.forEach((item, i) => {
      if (i) {
        const prev = row[i - 1], gap = item.x - (prev.x + prev.width);
        if (gap > item.size * 0.18 && !text.endsWith(" ") && !item.str.startsWith(" ")) { text += " "; owners.push(i - 1); }
      }
      for (const _ of item.str) owners.push(i);
      text += item.str;
    });
    return { items: row, text, owners };
  });
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Where `find` sits on the page. Exact first; then ignoring runs of whitespace. */
function locate(page: Line[], find: string) {
  const hits: { line: Line; start: number; end: number }[] = [];
  for (const line of page) {
    let at = line.text.indexOf(find);
    while (at >= 0) { hits.push({ line, start: at, end: at + find.length }); at = line.text.indexOf(find, at + 1); }
  }
  if (hits.length) return hits;
  const target = squash(find);
  for (const line of page) {
    // Map a whitespace-collapsed copy back to original offsets.
    let flat = "", map: number[] = [];
    for (let i = 0; i < line.text.length; i++) { const c = line.text[i]; if (/\s/.test(c)) { if (flat && !flat.endsWith(" ")) { flat += " "; map.push(i); } } else { flat += c; map.push(i); } }
    let at = flat.indexOf(target);
    while (at >= 0) { hits.push({ line, start: map[at], end: map[at + target.length - 1] + 1 }); at = flat.indexOf(target, at + 1); }
  }
  return hits;
}

export function planEdits(pages: TextItem[][], edits: PdfTextEdit[]): Placement[] {
  const byPage = new Map<number, Line[]>();
  const out: Placement[] = [];
  const used = new Set<string>();
  for (const edit of edits) {
    if (!edit.find.trim()) throw Error("An edit is missing the text to replace.");
    if (edit.find.includes("\n")) throw Error(`“${edit.find.slice(0, 40)}” spans more than one line. Change one line at a time.`);
    const items = pages[edit.page - 1];
    if (!items) throw Error(`Page ${edit.page} is not in this PDF.`);
    if (!byPage.has(edit.page)) byPage.set(edit.page, lines(items));
    const hits = locate(byPage.get(edit.page)!, edit.find);
    if (!hits.length) throw Error(`Could not find “${edit.find.slice(0, 60)}” on page ${edit.page}.`);
    if (hits.length > 1) throw Error(`“${edit.find.slice(0, 60)}” appears ${hits.length} times on page ${edit.page}. Quote more of the line.`);
    const { line, start, end } = hits[0];
    const first = line.owners[start], last = line.owners[end - 1];
    const key = edit.page + ":" + line.items[first].y + ":" + first;
    if (used.has(key)) throw Error(`Two edits change the same line on page ${edit.page}. Combine them into one.`);
    used.add(key);
    // Re-set the whole run of items the match touches, keeping their untouched text.
    const runStart = line.owners.indexOf(first), runEnd = line.owners.lastIndexOf(last) + 1;
    const before = line.text.slice(runStart, runEnd);
    const text = line.text.slice(runStart, start) + edit.replace + line.text.slice(end, runEnd);
    const run = line.items.slice(first, last + 1);
    const x = run[0].x, right = Math.max(...run.map((i) => i.x + i.width)), size = Math.max(...run.map((i) => i.size));
    out.push({ page: edit.page, text: text.trim() === "" ? "" : text, before, x, y: run[0].y, size, font: run[0].font, width: right - x, cover: { x: x - 0.8, y: run[0].y - size * 0.28, w: right - x + 1.6, h: size * 1.22 } });
  }
  return out;
}
