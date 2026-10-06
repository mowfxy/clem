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
      // One owner per UTF-16 unit, as `text` is indexed: a glyph outside the BMP (Word's 𝑥, an emoji) takes two.
      for (let k = 0; k < item.str.length; k++) owners.push(i);
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
  // Item ranges already re-set on each line; two edits whose runs overlap would draw over each other.
  const used = new Map<Line, [number, number][]>();
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
    const taken = used.get(line) || [];
    if (taken.some(([a, b]) => first <= b && a <= last)) throw Error(`Two edits change the same line on page ${edit.page}. Combine them into one.`);
    used.set(line, [...taken, [first, last]]);
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

/**
 * Where `find` is printed on a page: one box per place, each within one printed line, in page space. pdf.js gives a
 * run's width, not each letter's, so letters are placed along the run in proportion to `advance` (a letter's width in
 * a similar font; the same width for every letter when not given). Exact matches first; then ignoring runs of
 * whitespace, as for edits.
 */
export function textBoxes(items: TextItem[], find: string, advance: (ch: string, item: TextItem) => number = () => 1) {
  if (!find.trim()) return [];
  return locate(lines(items), find).map(({ line, start, end }) => {
    const at = edges(line, advance);
    const run = line.items.slice(line.owners[start], line.owners[end - 1] + 1);
    const size = Math.max(...run.map((i) => i.size)), base = Math.min(...run.map((i) => i.y));
    return { x0: at(start, false), y0: base - size * 0.22, x1: at(end - 1, true), y1: base + size * 0.78 };
  });
}

/** Where each character of a line starts (or ends, `after`): placed along its run in proportion to `advance`. */
function edges(line: Line, advance: (ch: string, item: TextItem) => number) {
  // Each character's place inside its run: a space added between runs belongs to the run before it.
  const local: number[] = [];
  line.owners.forEach((owner, c) => local.push(c && line.owners[c - 1] === owner ? local[c - 1] + 1 : 0));
  // Running widths of each run's letters, so a letter's left edge is the share of the run before it.
  const sums = new Map<TextItem, number[]>();
  const sum = (item: TextItem) => {
    let s = sums.get(item);
    // Per UTF-16 unit, like the owners: both halves of a surrogate pair end where the whole letter does.
    if (!s) { s = [0]; for (const ch of item.str) { const end = s[s.length - 1] + Math.max(0.05, advance(ch, item) || 0); for (let k = 0; k < ch.length; k++) s.push(end); } sums.set(item, s); }
    return s;
  };
  return (c: number, after: boolean) => {
    const item = line.items[line.owners[c]], s = sum(item), n = s.length - 1;
    return item.x + (item.width * s[Math.min(n, local[c] + (after ? 1 : 0))]) / Math.max(1e-6, s[n]);
  };
}

/**
 * The text printed inside a box, one string for each stretch of a line in it: a character counts when its middle is in
 * the box (as a redaction there takes glyphs). What a redaction by box removes, to clean it from the rest of the file.
 */
export function textInside(items: TextItem[], [x0, y0, x1, y1]: [number, number, number, number], advance: (ch: string, item: TextItem) => number = () => 1) {
  const out: string[] = [];
  for (const line of lines(items)) {
    const at = edges(line, advance);
    let run = "";
    for (let c = 0; c < line.owners.length; c++) {
      // A surrogate pair is one letter: placed and taken whole.
      const wide = line.text.codePointAt(c)! > 0xffff ? 1 : 0;
      const item = line.items[line.owners[c]], cx = (at(c, false) + at(c + wide, true)) / 2, cy = item.y + item.size * 0.28;
      if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) run += line.text.slice(c, c + 1 + wide);
      else { if (run.trim()) out.push(run.trim()); run = ""; }
      c += wide;
    }
    if (run.trim()) out.push(run.trim());
  }
  return out;
}
