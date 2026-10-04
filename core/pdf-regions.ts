/**
 * Where the figures, tables and equations are on a PDF page, from the page's own structure: pdf.js's drawing
 * operators (paths, images, shadings, each with its box under the current transform) and its text positions. Pixels
 * are only the fallback, for scanned pages and pictures, where there is no structure to read. Pure: it takes pdf.js's
 * output (an operator list, OPS numbers, text items) and grey bitmaps, so the same code runs in the window and in tests.
 *
 * Boxes are [x0, y0, x1, y1]. On a PDF page they are in PDF points, origin bottom-left (what pdf-lib draws in); in a
 * bitmap they are pixels, origin top-left.
 */
export type Box = [number, number, number, number];
export type Mark = { box: Box; kind: "path" | "image" | "shading"; rule?: boolean };
export type Word = { str: string; box: Box; size: number; font?: string; vertical?: boolean };
export type Region = { id: string; kind: "figure" | "image" | "table" | "equation" | "region"; box: Box; caption?: string; captionBox?: Box; labels?: number };

const W = (b: Box) => b[2] - b[0], H = (b: Box) => b[3] - b[1];
const area = (b: Box) => Math.max(0, W(b)) * Math.max(0, H(b));
const union = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const intersect = (a: Box, b: Box): Box | null => { const r: Box = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]; return r[0] <= r[2] && r[1] <= r[3] ? r : null; };
/** Gap between two boxes (0 when they touch or overlap). */
export const gap = (a: Box, b: Box) => Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));
const grow = (b: Box, m: number): Box => [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
const inside = (inner: Box, outer: Box, slack = 0.5) => inner[0] >= outer[0] - slack && inner[1] >= outer[1] - slack && inner[2] <= outer[2] + slack && inner[3] <= outer[3] + slack;
const hOverlap = (a: Box, b: Box) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
const round = (b: Box): Box => b.map((v) => Math.round(v * 100) / 100) as Box;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** m applied first, then ctm: what `cm` does to the current transform. */
const compose = (a: Matrix, m: Matrix): Matrix => [a[0] * m[0] + a[2] * m[1], a[1] * m[0] + a[3] * m[1], a[0] * m[2] + a[2] * m[3], a[1] * m[2] + a[3] * m[3], a[0] * m[4] + a[2] * m[5] + a[4], a[1] * m[4] + a[3] * m[5] + a[5]];
const apply = (m: Matrix, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function mapBox(m: Matrix, x0: number, y0: number, x1: number, y1: number): Box {
  const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}
const isWhite = (color: unknown) => typeof color === "string" && /^#f[a-f0-9]f[a-f0-9]f[a-f0-9]$/i.test(color) && parseInt(color.slice(1, 3), 16) >= 0xf6 && parseInt(color.slice(3, 5), 16) >= 0xf6 && parseInt(color.slice(5, 7), 16) >= 0xf6;

/**
 * Every visible mark a page paints, with its box in page space. Clipping is followed (a huge path clipped to a small
 * box counts as the small box), white fills on white paper are left out (they paint nothing), and strokes are widened
 * by half their line width so a thick wire's edge is inside the box.
 */
export function marksFromOps(fnArray: ArrayLike<number>, argsArray: any[], OPS: Record<string, number>, page: Box): Mark[] {
  type State = { ctm: Matrix; clip: Box; fill: unknown; stroke: unknown; width: number; fillOff: boolean; strokeOff: boolean };
  let s: State = { ctm: IDENTITY, clip: page, fill: "#000000", stroke: "#000000", width: 1, fillOff: false, strokeOff: false };
  const stack: State[] = [];
  const out: Mark[] = [];
  const paintsStroke = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const paintsFill = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const push = (box: Box | null, kind: Mark["kind"]) => {
    if (!box) return;
    const clipped = intersect(box, s.clip);
    if (!clipped) return;
    const w = W(clipped), h = H(clipped);
    out.push({ box: clipped, kind, ...(kind === "path" && Math.min(w, h) <= 1.6 && Math.max(w, h) >= 4 ? { rule: true } : {}) });
  };
  const unit = () => mapBox(s.ctm, 0, 0, 1, 1);
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    if (fn === OPS.save) stack.push({ ...s });
    else if (fn === OPS.restore) s = stack.pop() || s;
    else if (fn === OPS.transform) s.ctm = compose(s.ctm, args as Matrix);
    else if (fn === OPS.setLineWidth) s.width = Number(args[0]) || 0;
    else if (fn === OPS.setFillRGBColor) { s.fill = args[0]; s.fillOff = false; }
    else if (fn === OPS.setStrokeRGBColor) { s.stroke = args[0]; s.strokeOff = false; }
    else if (fn === OPS.setFillTransparent) s.fillOff = true;
    else if (fn === OPS.setStrokeTransparent) s.strokeOff = true;
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ ...s });
      if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) s.ctm = compose(s.ctm, Array.from(args[0] as ArrayLike<number>) as Matrix);
      const b = args[1];
      if (b && b.length === 4) s.clip = intersect(mapBox(s.ctm, b[0], b[1], b[2], b[3]), s.clip) || [0, 0, 0, 0];
    } else if (fn === OPS.paintFormXObjectEnd) s = stack.pop() || s;
    else if (fn === OPS.constructPath) {
      const paint = args[0], minMax = args[2];
      if (!minMax || !Number.isFinite(minMax[0]) || !Number.isFinite(minMax[3])) continue;
      const box = mapBox(s.ctm, minMax[0], minMax[1], minMax[2], minMax[3]);
      if (paint === OPS.endPath) { s.clip = intersect(box, s.clip) || [0, 0, 0, 0]; continue; }
      const stroke = paintsStroke.has(paint) && !s.strokeOff && !isWhite(s.stroke);
      const fill = paintsFill.has(paint) && !s.fillOff && !isWhite(s.fill);
      if (!stroke && !fill) continue;
      // Half the line width, in page units (a zero-width line is drawn one device pixel wide).
      const half = stroke ? Math.max(0.25, (s.width * Math.sqrt(Math.abs(s.ctm[0] * s.ctm[3] - s.ctm[1] * s.ctm[2]))) / 2) : 0;
      push(grow(box, half), "path");
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintSolidColorImageMask) push(unit(), "image");
    else if (fn === OPS.paintImageXObjectRepeat || fn === OPS.paintImageMaskXObjectRepeat) {
      // args: id, scaleX, scaleY, positions (x, y pairs) for XObject repeats; mask repeats carry the same tail.
      const [sx, sy, positions] = fn === OPS.paintImageXObjectRepeat ? [args[1], args[2], args[3]] : [args[1], args[2], args[5] ?? args[3]];
      if (positions?.length) for (let j = 0; j + 1 < positions.length; j += 2) push(mapBox(s.ctm, positions[j], positions[j + 1], positions[j] + sx, positions[j + 1] + sy), "image");
      else push(unit(), "image");
    } else if (fn === OPS.paintInlineImageXObjectGroup || fn === OPS.paintImageMaskXObjectGroup) {
      for (const part of (fn === OPS.paintInlineImageXObjectGroup ? args[1] : args[0]) || []) if (part?.transform) push(mapBox(compose(s.ctm, part.transform), 0, 0, 1, 1), "image");
    } else if (fn === OPS.shadingFill) push(s.clip, "shading");
  }
  return out;
}

/** Words with page-space boxes, from pdf.js text items (`fonts` maps pdf.js's font ids to the fonts' real names). */
export function wordsFromText(items: any[], fonts: Record<string, string> = {}): Word[] {
  const out: Word[] = [];
  for (const item of items) {
    if (!item || typeof item.str !== "string" || !item.str.trim()) continue;
    const [a, b, c, d, e, f] = item.transform as number[];
    const size = Math.hypot(c, d) || Math.hypot(a, b) || Number(item.height) || 1;
    const len = Math.hypot(a, b) || 1, ux = a / len, uy = b / len;
    const width = Number(item.width) || size * item.str.length * 0.5;
    // The run's quad: along its direction for `width`, from just below the baseline to the ascender line.
    const px = -uy, py = ux;
    const pts = [[e - px * size * 0.22, f - py * size * 0.22], [e + ux * width - px * size * 0.22, f + uy * width - py * size * 0.22], [e + px * size * 0.78, f + py * size * 0.78], [e + ux * width + px * size * 0.78, f + uy * width + py * size * 0.78]];
    out.push({ str: item.str, size, font: fonts[item.fontName] || item.fontName, box: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))], ...(Math.abs(uy) > 0.5 ? { vertical: true } : {}) });
  }
  return out;
}

/** A run of words on one baseline, split wherever the gap is wider than a column gutter. */
export type Segment = { box: Box; text: string; size: number; words: Word[]; prose?: boolean; math?: boolean; caption?: boolean };
const MATH_FONT = /CMMI|CMSY|CMEX|CMBSY|MTMI|MTSY|MTEX|Math|Symbol|STIX|Euclid|rsfs|msbm|msam|txsy|pxsy|txmi|pxmi|LMMath|Asana|XITS/i;
const MATH_CHARS = /[=∑∫∮√±∓≤≥≈≠≡∞→←⇒⇔∂∇∈∉⊂⊆∪∩×÷·αβγδεζηθλμνξπρσςτφχψωΓΔΘΛΞΠΣΦΨΩ^_]/;
const CAPTION = /^\s*(fig(?:ure)?|table|tab|scheme|chart|plate|exhibit|graph|diagram|illustration|photo)\.?\s*(?:\d+|[IVXLC]+\b)(?:[.\-–:]\d+)*[a-z]?(?=[\s.:—–\-)]|$)/i;
const EQUATION_NUMBER = /\(\s*\d+(?:\.\d+)*[a-z]?\s*\)\s*$/;

export function segments(words: Word[]): Segment[] {
  const horizontal = words.filter((w) => !w.vertical).sort((a, b) => b.box[1] - a.box[1] || a.box[0] - b.box[0]);
  const rows: Word[][] = [];
  for (const word of horizontal) {
    // Same row: their boxes share most of the smaller one's height.
    const row = rows.find((r) => { const o = Math.min(r[0].box[3], word.box[3]) - Math.max(r[0].box[1], word.box[1]); return o >= 0.5 * Math.min(H(r[0].box), H(word.box)); });
    if (row) row.push(word); else rows.push([word]);
  }
  const out: Segment[] = [];
  const close = (run: Word[]) => {
    const box = run.slice(1).reduce((b, w) => union(b, w.box), run[0].box);
    let text = "";
    run.forEach((w, i) => { if (i && w.box[0] - run[i - 1].box[2] > w.size * 0.15 && !text.endsWith(" ") && !w.str.startsWith(" ")) text += " "; text += w.str; });
    const size = run.reduce((m, w) => Math.max(m, w.size), 0);
    const mathWords = run.filter((w) => MATH_FONT.test(w.font || "") || MATH_CHARS.test(w.str)).length;
    out.push({ box, text: text.trim(), size, words: run, ...(mathWords / run.length >= 0.4 || (EQUATION_NUMBER.test(text) && mathWords) ? { math: true } : {}) });
  };
  for (const row of rows) {
    row.sort((a, b) => a.box[0] - b.box[0]);
    let run: Word[] = [row[0]];
    for (let i = 1; i < row.length; i++) {
      const w = row[i], prev = row[i - 1];
      // Wider than about two em: a column gutter or a figure label beside text, not a space.
      if (w.box[0] - prev.box[2] > Math.max(w.size, prev.size) * 2.2) { close(run); run = [w]; } else run.push(w);
    }
    close(run);
  }
  // Vertical words (rotated axis titles) are single segments of their own.
  for (const w of words.filter((w) => w.vertical)) out.push({ box: w.box, text: w.str.trim(), size: w.size, words: [w] });
  return out;
}

/** Body text: lines about as wide as the page's typical full line, or a paragraph's last line under one. */
function markProse(segs: Segment[]) {
  const long = segs.filter((s) => s.text.length >= 40 && !s.math).map((s) => W(s.box)).sort((a, b) => a - b);
  const body = long.length ? long[Math.floor(long.length * 0.75)] : Infinity;
  for (const s of segs) s.prose = !s.math && s.text.length >= 25 && s.text.split(/\s+/).length >= 4 && W(s.box) >= 0.6 * body;
  // A short last line of a paragraph: directly under a prose line that starts at the same place.
  for (const s of segs) {
    if (s.prose || s.math || s.text.split(/\s+/).length < 2) continue;
    const above = segs.find((t) => t.prose && Math.abs(t.box[0] - s.box[0]) <= s.size * 0.6 && t.box[1] > s.box[3] - 1 && t.box[1] - s.box[3] <= s.size * 0.9);
    if (above) s.prose = true;
  }
  return body;
}

/** A caption and the lines that continue it, as one block. */
function captionBlocks(segs: Segment[]) {
  const blocks: { box: Box; text: string; size: number; table: boolean; members: Segment[] }[] = [];
  for (const s of segs.filter((t) => CAPTION.test(t.text)).sort((a, b) => b.box[3] - a.box[3])) {
    if (blocks.some((b) => b.members.includes(s))) continue;
    const members = [s];
    let last = s, lead = 0;
    for (let n = 0; n < 10; n++) {
      // A caption's own lines: the same size, set tight, at a steady leading. Body text after it is set looser
      // or at another size, so it never joins.
      const next = segs.filter((t) => !members.includes(t) && !CAPTION.test(t.text) && Math.abs(t.size - s.size) <= s.size * 0.06 && t.box[3] <= last.box[1] + 1 && last.box[1] - t.box[3] <= s.size * 0.45 && hOverlap(t.box, s.box) > 0 && t.box[0] >= s.box[0] - s.size * 3).sort((a, b) => b.box[3] - a.box[3])[0];
      if (!next || (lead && Math.abs(last.box[1] - next.box[1] - lead) > 1)) break;
      lead = last.box[1] - next.box[1];
      members.push(next);
      last = next;
    }
    members.forEach((m) => (m.caption = true));
    blocks.push({ box: members.slice(1).reduce((b, m) => union(b, m.box), s.box), text: members.map((m) => m.text).join(" ").replace(/\s+/g, " ").trim(), size: s.size, table: /^\s*tab/i.test(s.text), members });
  }
  return blocks;
}

class Groups {
  parent: number[];
  constructor(n: number) { this.parent = Array.from({ length: n }, (_, i) => i); }
  find(i: number): number { while (this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]]; return i; }
  join(a: number, b: number) { this.parent[this.find(a)] = this.find(b); }
}

/** Joins every pair of boxes within `within` of each other, using a grid so thousands of marks stay fast. */
function cluster(boxes: Box[], within: number) {
  const groups = new Groups(boxes.length);
  const cell = 48, grid = new Map<string, number[]>();
  boxes.forEach((b, i) => {
    const g = grow(b, within / 2);
    for (let x = Math.floor(g[0] / cell); x <= Math.floor(g[2] / cell); x++) for (let y = Math.floor(g[1] / cell); y <= Math.floor(g[3] / cell); y++) {
      const key = x + "," + y, list = grid.get(key);
      if (list) { for (const j of list) if (groups.find(i) !== groups.find(j) && gap(b, boxes[j]) <= within) groups.join(i, j); list.push(i); } else grid.set(key, [i]);
    }
  });
  const out = new Map<number, number[]>();
  boxes.forEach((_, i) => { const r = groups.find(i); out.set(r, [...(out.get(r) || []), i]); });
  return [...out.values()];
}

type Candidate = { box: Box; marks: Mark[]; segs: Segment[]; kind?: Region["kind"]; caption?: ReturnType<typeof captionBlocks>[number] };

/** Ruled tables: two or more horizontal rules of about the same width, stacked with no body text between them. */
function ruledTables(rules: Mark[], segs: Segment[]) {
  const flat = rules.filter((r) => H(r.box) <= 1.6 && W(r.box) >= 30).sort((a, b) => b.box[1] - a.box[1]);
  const used = new Set<Mark>();
  const out: Candidate[] = [];
  for (const top of flat) {
    if (used.has(top)) continue;
    const stack = [top];
    for (const r of flat) {
      if (r === top || used.has(r) || r.box[1] >= stack.at(-1)!.box[1]) continue;
      const last = stack.at(-1)!;
      if (Math.abs(r.box[0] - top.box[0]) > 8 || Math.abs(r.box[2] - top.box[2]) > 8) continue;
      // Body text between two rules means they belong to different things (a header rule and a footer rule).
      const between: Box = [top.box[0], r.box[3], top.box[2], last.box[1]];
      if (segs.some((s) => s.prose && !s.caption && intersect(s.box, between) && area(intersect(s.box, between)!) > 0.5 * area(s.box))) break;
      if (last.box[1] - r.box[3] > 400) break;
      stack.push(r);
    }
    if (stack.length < 2) continue;
    const box = stack.slice(1).reduce((b, r) => union(b, r.box), top.box);
    const cells = segs.filter((s) => !s.caption && inside(s.box, grow(box, 2)) && !s.prose);
    // Two rules with nothing between them are a decoration, not a table.
    if (!cells.length && stack.length < 3) continue;
    stack.forEach((r) => used.add(r));
    out.push({ box: cells.reduce((b, s) => union(b, s.box), box), marks: stack, segs: cells, kind: "table" });
  }
  return { tables: out, used };
}

/**
 * Figure, table and equation candidates on one PDF page, top to bottom. `page` is the page's view box. Graphics are
 * grouped by distance; labels (short text in or right beside a drawing) join their drawing; the nearest "Figure N" /
 * "Table N" caption is attached; a caption with no drawing near it marks a text-only figure or table.
 */
export function findRegions(pageNo: number, page: Box, marks: Mark[], words: Word[]): Region[] {
  const pageArea = area(page);
  // A background (or a full-page scan, handled by the pixel fallback) is not a figure.
  const visible = marks.filter((m) => area(m.box) < 0.8 * pageArea || m.kind === "path" && m.rule);
  const segs = segments(words);
  markProse(segs);
  const captions = captionBlocks(segs);
  const { tables, used } = ruledTables(visible.filter((m) => m.rule), segs);
  // Lone short rules (underlines, list dashes) never make a figure on their own, but join one they touch.
  const graphic = visible.filter((m) => !used.has(m));
  let cands: Candidate[] = cluster(graphic.map((m) => m.box), 6).map((idx) => {
    const ms = idx.map((i) => graphic[i]);
    return { box: ms.slice(1).reduce((b, m) => union(b, m.box), ms[0].box), marks: ms, segs: [] };
  });
  // Labels join their drawing; drawings that labels bring together merge. A few rounds settle it.
  // A label reached only through another label (a tick number beside an axis title) joins on a later round.
  for (let round = 0; round < 6; round++) {
    let joined = false;
    for (const c of cands) {
      for (const s of segs) {
        if (s.caption || c.segs.includes(s)) continue;
        const near = s.prose ? inside(s.box, c.box, 1) && c.marks.length > 4 : gap(s.box, c.box) <= Math.max(4, s.size * 1.1);
        if (near) { c.segs.push(s); c.box = union(c.box, s.box); joined = true; }
      }
    }
    const merged = cluster(cands.map((c) => c.box), 4).map((idx) => idx.map((i) => cands[i]).reduce((a, b) => ({ box: union(a.box, b.box), marks: [...a.marks, ...b.marks], segs: [...new Set([...a.segs, ...b.segs])] })));
    if (merged.length === cands.length && !joined) break;
    cands = merged;
  }
  cands = cands.filter((c) => {
    const onlyRules = c.marks.every((m) => m.rule);
    if (onlyRules && !c.segs.some((s) => s.math)) return false;
    // A frame around body text (a boxed note), not a drawing.
    if (c.marks.length <= 4 && c.segs.some((s) => s.prose)) return false;
    return area(c.box) >= 300 && Math.max(W(c.box), H(c.box)) >= 18;
  });
  for (const c of cands) {
    const images = c.marks.filter((m) => m.kind === "image").reduce((n, m) => n + area(m.box), 0);
    const mathText = c.segs.length && c.segs.every((s) => s.math || s.text.length <= 3) && c.marks.every((m) => m.rule);
    c.kind = mathText ? "equation" : images >= 0.5 * area(c.box) ? "image" : "figure";
  }
  cands.push(...tables);
  // Display equations made of text only: maths lines (with or without a number), not inside anything else.
  const mathSegs = segs.filter((s) => s.math && !s.prose && !s.caption && !cands.some((c) => inside(s.box, c.box, 1)));
  for (const idx of cluster(mathSegs.map((s) => s.box), 3)) {
    const ss = idx.map((i) => mathSegs[i]);
    const box = ss.slice(1).reduce((b, s) => union(b, s.box), ss[0].box);
    // The equation number on the same baseline, at the right.
    for (const s of segs) if (!ss.includes(s) && EQUATION_NUMBER.test(s.text) && s.text.length <= 10 && Math.abs(s.box[1] - box[1]) <= s.size && s.box[0] >= box[2]) { ss.push(s); }
    const full = ss.slice(1).reduce((b, s) => union(b, s.box), ss[0].box);
    if (ss.join("").length >= 1 && W(full) >= 24) cands.push({ box: full, marks: [], segs: ss, kind: "equation" });
  }
  // Captions: the nearest one with the drawing above it (figures) or below it (tables), each used once.
  const free = new Set(captions);
  const pairs: { c: Candidate; cap: (typeof captions)[number]; d: number }[] = [];
  for (const c of cands) for (const cap of captions) {
    if (c.kind === "equation" || hOverlap(c.box, cap.box) < 0.3 * Math.min(W(c.box), W(cap.box))) continue;
    const below = c.box[1] - cap.box[3], above = cap.box[1] - c.box[3];
    const d = below >= -2 ? below : above >= -2 ? above : Infinity;
    if (d > cap.size * 4 + 12) continue;
    // Tables are captioned above, figures below: the expected side wins a tie.
    pairs.push({ c, cap, d: d + ((cap.table ? above >= -2 : below >= -2) ? 0 : cap.size * 1.5) });
  }
  for (const { c, cap } of pairs.sort((a, b) => a.d - b.d)) {
    if (c.caption || !free.has(cap)) {
      // Panels (a), (b) above one caption are one figure.
      const owner = cands.find((o) => o.caption === cap);
      if (owner && owner !== c && !c.caption && Math.min(owner.box[3], c.box[3]) - Math.max(owner.box[1], c.box[1]) > 0.3 * Math.min(H(owner.box), H(c.box))) { owner.box = union(owner.box, c.box); owner.marks.push(...c.marks); owner.segs.push(...c.segs); c.kind = undefined; }
      continue;
    }
    c.caption = cap;
    free.delete(cap);
    if (cap.table) c.kind = "table";
  }
  cands = cands.filter((c) => c.kind);
  // Panels: drawings in a row with a captioned one (or stacked above it), with only paper between, are part of it.
  for (let changed = true; changed; ) {
    changed = false;
    for (const owner of cands) {
      if (!owner.kind || !owner.caption || owner.kind === "table" || owner.kind === "equation") continue;
      for (const c of cands) {
        if (c === owner || c.caption || !c.kind || c.kind === "equation" || c.kind === "table") continue;
        const vo = Math.min(owner.box[3], c.box[3]) - Math.max(owner.box[1], c.box[1]);
        const row = vo >= 0.5 * Math.min(H(owner.box), H(c.box)) && gap(owner.box, c.box) <= Math.max(24, 0.6 * Math.max(H(owner.box), H(c.box)));
        const column = hOverlap(owner.box, c.box) >= 0.5 * Math.min(W(owner.box), W(c.box)) && c.box[1] >= owner.box[3] - 2 && gap(owner.box, c.box) <= 24;
        if (!row && !column) continue;
        const span = union(owner.box, c.box);
        if (segs.some((s) => s.prose && !s.caption && !owner.segs.includes(s) && !c.segs.includes(s) && intersect(s.box, span))) continue;
        owner.box = span; owner.marks.push(...c.marks); owner.segs.push(...c.segs); c.kind = undefined; changed = true;
      }
    }
    cands = cands.filter((c) => c.kind);
  }
  // A caption with nothing drawn by it: the figure or table is text (a grid of short lines) on the expected side.
  for (const cap of free) {
    const side = (s: Segment) => (cap.table ? s.box[1] >= cap.box[3] - 1 : s.box[3] <= cap.box[1] + 1);
    const block: Segment[] = [];
    let edge = cap.table ? cap.box[3] : cap.box[1];
    for (const s of segs.filter((s) => !s.caption && !s.prose && side(s) && hOverlap(s.box, grow(cap.box, cap.size * 6)) > 0).sort((a, b) => (cap.table ? a.box[1] - b.box[1] : b.box[3] - a.box[3]))) {
      const dist = cap.table ? s.box[1] - edge : edge - s.box[3];
      if (dist > s.size * 2.5) break;
      if (cands.some((c) => intersect(c.box, s.box))) break;
      block.push(s);
      edge = cap.table ? Math.max(edge, s.box[3]) : Math.min(edge, s.box[1]);
    }
    if (block.length >= 2) cands.push({ box: block.slice(1).reduce((b, s) => union(b, s.box), block[0].box), marks: [], segs: block, kind: cap.table ? "table" : "figure", caption: cap });
  }
  return cands
    .sort((a, b) => b.box[3] - a.box[3] || a.box[0] - b.box[0])
    .map((c, i) => ({
      id: `p${pageNo}-${i + 1}`,
      kind: c.kind!,
      box: round(intersect(c.box, page) || c.box),
      ...(c.caption ? { caption: c.caption.text.slice(0, 300), captionBox: round(c.caption.box) } : {}),
      ...(c.segs.length ? { labels: c.segs.length } : {}),
    }));
}

/** Pages whose content is one picture covering most of the page: a scan, read from its pixels. */
export const scannedPage = (page: Box, marks: Mark[]) => marks.some((m) => m.kind === "image" && area(intersect(m.box, page) || [0, 0, 0, 0]) >= 0.6 * area(page));

// ---- Pixels: scans and pictures ----

/** The grey level that separates ink from paper (Otsu's method), never above 235 so faint paper texture is paper. */
export function inkLevel(grey: Uint8Array) {
  const hist = new Float64Array(256);
  for (let i = 0; i < grey.length; i++) hist[grey[i]]++;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let back = 0, backSum = 0, best = 0, level = 160;
  for (let t = 0; t < 256; t++) {
    back += hist[t];
    if (!back) continue;
    const fore = grey.length - back;
    if (!fore) break;
    backSum += t * hist[t];
    const mb = backSum / back, mf = (sum - backSum) / fore, between = back * fore * (mb - mf) ** 2;
    if (between > best) { best = between; level = t; }
  }
  return Math.min(235, Math.max(60, level));
}

/** Ink counts summed over rectangles in constant time. */
class Ink {
  sums: Int32Array;
  w: number;
  h: number;
  constructor(grey: Uint8Array, w: number, h: number, level: number) {
    this.w = w;
    this.h = h;
    this.sums = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += grey[y * w + x] < level ? 1 : 0; this.sums[(y + 1) * (w + 1) + x + 1] = this.sums[y * (w + 1) + x + 1] + row; }
    }
  }
  /** Ink pixels in [x0, x1) × [y0, y1). */
  count(x0: number, y0: number, x1: number, y1: number) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(this.w, x1); y1 = Math.min(this.h, y1);
    if (x1 <= x0 || y1 <= y0) return 0;
    const s = this.sums, W1 = this.w + 1;
    return s[y1 * W1 + x1] - s[y0 * W1 + x1] - s[y1 * W1 + x0] + s[y0 * W1 + x0];
  }
  /** The box shrunk to its ink, or null when it has none. */
  bounds(b: Box, noise = 0): Box | null {
    let [x0, y0, x1, y1] = b;
    const rowInk = (y: number) => this.count(x0, y, x1, y + 1) > noise, colInk = (x: number) => this.count(x, y0, x + 1, y1) > noise;
    while (y0 < y1 && !rowInk(y0)) y0++;
    while (y1 > y0 && !rowInk(y1 - 1)) y1--;
    while (x0 < x1 && !colInk(x0)) x0++;
    while (x1 > x0 && !colInk(x1 - 1)) x1--;
    return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
  }
}

/** Typical height of a text line on the bitmap: the median height of runs of inked rows in narrow strips. */
function lineHeight(ink: Ink) {
  const runs: number[] = [];
  const strip = Math.max(40, Math.round(ink.w / 6));
  for (let x = 0; x < ink.w; x += strip) {
    let run = 0;
    for (let y = 0; y < ink.h; y++) {
      if (ink.count(x, y, x + strip, y + 1) > 1) run++;
      else { if (run >= 3) runs.push(run); run = 0; }
    }
  }
  runs.sort((a, b) => a - b);
  return runs.length ? Math.max(6, runs[Math.floor(runs.length / 2)]) : Math.max(8, Math.round(ink.h / 80));
}

/**
 * Blocks of a scanned page or picture, by recursive cuts along whitespace (XY-cut), each judged text or figure.
 * Text has a regular rhythm of line-high ink rows; a figure has tall ink or dense areas. Figure pieces split by their
 * own whitespace, and the short text beside them (labels), are joined back together.
 */
export function segmentBitmap(grey: Uint8Array, w: number, h: number): { box: Box; kind: "text" | "figure" }[] {
  const ink = new Ink(grey, w, h, inkLevel(grey));
  const L = lineHeight(ink);
  const noise = (len: number) => Math.max(1, Math.floor(len * 0.002));
  const leaves: Box[] = [];
  const cut = (b: Box, depth: number) => {
    const t = ink.bounds(b, noise(Math.max(W(b), H(b))));
    if (!t) return;
    if (depth > 24) { leaves.push(t); return; }
    const [x0, y0, x1, y1] = t;
    // The widest blank band across (rows) and down (columns).
    const best = (along: "y" | "x") => {
      let start = -1, top = { at: 0, len: 0 };
      const [from, to] = along === "y" ? [y0, y1] : [x0, x1];
      for (let i = from; i < to; i++) {
        const blank = along === "y" ? ink.count(x0, i, x1, i + 1) <= noise(x1 - x0) : ink.count(i, y0, i + 1, y1) <= noise(y1 - y0);
        if (blank) { if (start < 0) start = i; } else if (start >= 0) { if (i - start > top.len) top = { at: start, len: i - start }; start = -1; }
      }
      return top;
    };
    const rows = best("y"), cols = best("x");
    const rowOk = rows.len >= L * 1.1, colOk = cols.len >= L * 1.4;
    if (!rowOk && !colOk) { leaves.push(t); return; }
    if (rowOk && (!colOk || rows.len / L >= cols.len / (L * 1.3))) { cut([x0, y0, x1, rows.at], depth + 1); cut([x0, rows.at + rows.len, x1, y1], depth + 1); }
    else { cut([x0, y0, cols.at, y1], depth + 1); cut([cols.at + cols.len, y0, x1, y1], depth + 1); }
  };
  cut([0, 0, w, h], 0);
  const judged = leaves.map((box) => {
    const dense = ink.count(box[0], box[1], box[2], box[3]) / Math.max(1, area(box));
    // Inked row runs within the block: text shows several, each about one line high.
    const runs: number[] = [];
    let run = 0;
    for (let y = box[1]; y < box[3]; y++) { if (ink.count(box[0], y, box[2], y + 1) > noise(W(box))) run++; else { if (run) runs.push(run); run = 0; } }
    if (run) runs.push(run);
    const lineLike = runs.length && runs.every((r) => r <= L * 1.8) && runs.filter((r) => r >= L * 0.45).length >= Math.max(1, runs.length * 0.6);
    const kind: "text" | "figure" = dense > 0.35 || !lineLike ? "figure" : "text";
    return { box, kind };
  });
  // Figure pieces close together, and small text right beside them (labels, axis numbers), are one figure.
  let figures = judged.filter((j) => j.kind === "figure" && Math.max(W(j.box), H(j.box)) >= L * 1.8).map((j) => j.box);
  const texts = judged.filter((j) => j.kind === "text").map((j) => j.box);
  for (let round = 0; round < 4; round++) {
    const groups = cluster(figures, L * 1.6);
    const next = groups.map((g) => g.map((i) => figures[i]).reduce(union));
    // A word or two (an axis title) may sit a little apart; longer lines must touch.
    for (let i = 0; i < next.length; i++) for (const t of texts) if (H(t) <= L * 2.2 && W(t) <= W(next[i]) * 0.6 && gap(t, next[i]) <= (W(t) <= L * 6 ? L * 2.5 : L * 0.9)) next[i] = union(next[i], t);
    if (next.length === figures.length && next.every((b, i) => b.every((v, k) => v === figures[i][k]))) break;
    figures = next;
  }
  const absorbed = (t: Box) => figures.some((f) => inside(t, f, 0));
  return [...figures.map((box) => ({ box, kind: "figure" as const })), ...texts.filter((t) => !absorbed(t)).map((box) => ({ box, kind: "text" as const }))].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
}

/** The box shrunk to the ink inside it (bitmap pixels), or null when there is none. */
export function inkBounds(grey: Uint8Array, w: number, h: number, box: Box = [0, 0, w, h], level?: number) {
  const ink = new Ink(grey, w, h, level ?? Math.min(235, inkLevel(grey) + 25));
  return ink.bounds(box.map(Math.round) as Box, 0);
}

/**
 * Settles a crop on a bitmap of the area around it. Every edge with ink within `reach` pixels outside it moves outward
 * until it has that much paper beyond it, so a label is never cut, whether the edge crosses a glyph, falls in the gap
 * between two letters or stops just short of a word; then every edge moves inward to the ink, so there is no stray
 * margin; then `pad` pixels of paper go around it. `limit` bounds how far an edge may grow; an edge that hit it is reported.
 */
export function settleCrop(grey: Uint8Array, w: number, h: number, target: Box, { pad = 0, limit = Infinity, reach = 2, level }: { pad?: number; limit?: number; reach?: number; level?: number } = {}) {
  const ink = new Ink(grey, w, h, level ?? Math.min(235, inkLevel(grey) + 25));
  let [x0, y0, x1, y1] = target.map(Math.round) as Box;
  const start: Box = [x0, y0, x1, y1];
  const stray = (len: number) => Math.max(0, Math.floor(len * 0.001));
  const r = Math.max(1, Math.round(reach));
  const hit = new Set<string>();
  for (let moved = true, guard = 0; moved && guard < 100000; guard++) {
    moved = false;
    if (y0 > 0 && ink.count(x0, y0 - r, x1, y0) > stray(x1 - x0)) { if (start[1] - y0 < limit) { y0--; moved = true; } else hit.add("top"); }
    if (y1 < h && ink.count(x0, y1, x1, y1 + r) > stray(x1 - x0)) { if (y1 - start[3] < limit) { y1++; moved = true; } else hit.add("bottom"); }
    if (x0 > 0 && ink.count(x0 - r, y0, x0, y1) > stray(y1 - y0)) { if (start[0] - x0 < limit) { x0--; moved = true; } else hit.add("left"); }
    if (x1 < w && ink.count(x1, y0, x1 + r, y1) > stray(y1 - y0)) { if (x1 - start[2] < limit) { x1++; moved = true; } else hit.add("right"); }
  }
  // An edge still on ink at the edge of the drawn area cannot grow further.
  if (y0 === 0 && ink.count(x0, 0, x1, 1)) hit.add("top");
  if (y1 === h && ink.count(x0, h - 1, x1, h)) hit.add("bottom");
  if (x0 === 0 && ink.count(0, y0, 1, y1)) hit.add("left");
  if (x1 === w && ink.count(w - 1, y0, w, y1)) hit.add("right");
  const tight = ink.bounds([x0, y0, x1, y1], 0);
  if (!tight) return { box: null, hit: [...hit] };
  const box: Box = [Math.max(0, tight[0] - pad), Math.max(0, tight[1] - pad), Math.min(w, tight[2] + pad), Math.min(h, tight[3] + pad)];
  return { box, hit: [...hit] };
}
