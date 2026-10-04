import { PDFDocument, PDFPage, PDFName, PDFDict, PDFArray, PDFNumber, PDFRawStream, PDFStream, PDFRef, PDFString, PDFHexString, StandardFontEmbedder, decodePDFRawStream } from "pdf-lib";

/**
 * Removes what lies under a box from a page's content, not just covering it: a page's content stream is read operator
 * by operator with its transforms, fonts and text positions, and every glyph, picture or drawing under the box is taken
 * out (glyphs one by one, so the rest of the line keeps its place). The same reading keeps only what is inside a box,
 * so a vector crop does not carry the rest of its page hidden in it. What cannot be removed exactly (a picture or a
 * shading only partly under the box, a complex drawing crossing it, text in a font whose codes cannot be read) throws
 * Unclean, and the caller turns that page into a picture instead (desktop/pdf-edit-tools.ts).
 */
export type Box = [number, number, number, number];
export class Unclean extends Error {}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** m first, then n: what `cm` does (the new matrix times the current one). */
const mul = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const map = (m: Matrix, x0: number, y0: number, x1: number, y1: number): Box => {
  const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
};
const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const within = (a: Box, b: Box, slack = 0.01) => a[0] >= b[0] - slack && a[1] >= b[1] - slack && a[2] <= b[2] + slack && a[3] <= b[3] + slack;

// ---- Reading a content stream ----

type Value = number | boolean | null | { name: string } | { bytes: number[]; hex?: boolean } | Value[] | { dict: Map<string, Value> };
type Op = { op: string; args: Value[]; start: number; end: number; image?: string };
const SPACE = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([...SPACE, ...[..."()<>[]{}/%"].map((c) => c.charCodeAt(0))]);

/** Every operator of a content stream with its operands and where it is in the bytes (inline images kept whole). */
export function parseContent(src: string): Op[] {
  let i = 0;
  const ops: Op[] = [];
  let args: Value[] = [], start = -1;
  const skip = () => {
    while (i < src.length) {
      const c = src.charCodeAt(i);
      if (SPACE.has(c)) i++;
      else if (c === 37) { while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i++; }
      else break;
    }
  };
  const value = (): Value | { op: string } => {
    const c = src[i];
    if (c === "(") {
      const bytes: number[] = [];
      let depth = 1;
      i++;
      while (i < src.length && depth) {
        const ch = src[i++];
        if (ch === "\\") {
          const e = src[i++];
          const simple: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
          if (e in simple) bytes.push(simple[e]);
          else if (/[0-7]/.test(e)) { let oct = e; while (oct.length < 3 && /[0-7]/.test(src[i])) oct += src[i++]; bytes.push(parseInt(oct, 8) & 255); }
          else if (e === "\r") { if (src[i] === "\n") i++; }
          else if (e !== "\n") bytes.push(e.charCodeAt(0));
        } else if (ch === "(") { depth++; bytes.push(40); }
        else if (ch === ")") { if (--depth) bytes.push(41); }
        else bytes.push(ch.charCodeAt(0));
      }
      return { bytes };
    }
    if (c === "<" && src[i + 1] === "<") {
      i += 2;
      const dict = new Map<string, Value>();
      for (;;) {
        skip();
        if (src[i] === ">" && src[i + 1] === ">") { i += 2; break; }
        if (i >= src.length) throw new Unclean("A dictionary in the page never ends.");
        const key = value();
        skip();
        const val = value();
        if (key && typeof key === "object" && "name" in key) dict.set(key.name, val as Value);
      }
      return { dict };
    }
    if (c === "<") {
      const end = src.indexOf(">", i);
      if (end < 0) throw new Unclean("A string in the page never ends.");
      let hex = src.slice(i + 1, end).replace(/\s+/g, "");
      if (hex.length % 2) hex += "0";
      i = end + 1;
      const bytes: number[] = [];
      for (let k = 0; k < hex.length; k += 2) bytes.push(parseInt(hex.slice(k, k + 2), 16));
      return { bytes, hex: true };
    }
    if (c === "[") {
      i++;
      const list: Value[] = [];
      for (;;) {
        skip();
        if (src[i] === "]") { i++; break; }
        if (i >= src.length) throw new Unclean("An array in the page never ends.");
        const v = value();
        if (v && typeof v === "object" && "op" in v) continue;
        list.push(v as Value);
      }
      return list;
    }
    if (c === "/") {
      let j = i + 1;
      while (j < src.length && !DELIM.has(src.charCodeAt(j))) j++;
      const name = src.slice(i + 1, j).replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
      i = j;
      return { name };
    }
    let j = i;
    while (j < src.length && !DELIM.has(src.charCodeAt(j))) j++;
    if (j === i) { i++; return { op: src[i - 1] }; }
    const word = src.slice(i, j);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    if (word === "true" || word === "false") return word === "true";
    if (word === "null") return null;
    return { op: word };
  };
  for (;;) {
    skip();
    if (i >= src.length) break;
    if (start < 0) start = i;
    const v = value();
    if (v && typeof v === "object" && "op" in v) {
      const op: Op = { op: v.op, args, start, end: i };
      if (v.op === "BI") {
        // Inline image: its dictionary up to ID, one space, then raw data up to EI on its own.
        const id = src.indexOf("ID", i);
        if (id < 0) throw new Unclean("An inline image in the page never ends.");
        const data = id + 3, ei = /[\0\t\n\f\r ]EI(?=[\0\t\n\f\r ]|$)/g;
        ei.lastIndex = data;
        const m = ei.exec(src);
        if (!m) throw new Unclean("An inline image in the page never ends.");
        i = m.index + m[0].length;
        op.end = i;
        op.op = "BI";
        op.image = src.slice(start, i);
      }
      ops.push(op);
      args = [];
      start = -1;
    } else args.push(v as Value);
  }
  return ops;
}

// ---- Fonts: how wide each code is and how many bytes it takes ----

type FontInfo = { bytes: 1 | 2; width: (code: number) => number; ascent: number; descent: number; matrix?: Matrix };
const num = (v: unknown, fallback = 0) => (v instanceof PDFNumber ? v.asNumber() : fallback);
const STANDARD: Record<string, string> = { "Times-Roman": "Times-Roman", "Times-Bold": "Times-Bold", "Times-Italic": "Times-Italic", "Times-BoldItalic": "Times-BoldItalic", Helvetica: "Helvetica", "Helvetica-Bold": "Helvetica-Bold", "Helvetica-Oblique": "Helvetica-Oblique", "Helvetica-BoldOblique": "Helvetica-BoldOblique", Courier: "Courier", "Courier-Bold": "Courier-Bold", "Courier-Oblique": "Courier-Oblique", "Courier-BoldOblique": "Courier-BoldOblique", Symbol: "Symbol", ZapfDingbats: "ZapfDingbats", Arial: "Helvetica", TimesNewRoman: "Times-Roman", CourierNew: "Courier" };

function fontInfo(font: PDFDict): FontInfo {
  const subtype = font.lookup(PDFName.of("Subtype"));
  const kind = subtype instanceof PDFName ? subtype.decodeText() : "";
  const descriptorOf = (f: PDFDict) => f.lookup(PDFName.of("FontDescriptor"));
  const metrics = (d: unknown) => d instanceof PDFDict ? { ascent: num(d.lookup(PDFName.of("Ascent")), 800) || 800, descent: num(d.lookup(PDFName.of("Descent")), -200) || -200, missing: num(d.lookup(PDFName.of("MissingWidth")), 0) } : { ascent: 800, descent: -200, missing: 0 };
  if (kind === "Type0") {
    const encoding = font.lookup(PDFName.of("Encoding"));
    const name = encoding instanceof PDFName ? encoding.decodeText() : "";
    // Codes of other CMaps have varying lengths; reading them is not done here.
    if (name !== "Identity-H") throw new Unclean(`text in a font with the "${name || "embedded"}" encoding`);
    const descendants = font.lookup(PDFName.of("DescendantFonts"));
    const cid = descendants instanceof PDFArray ? descendants.lookup(0) : undefined;
    if (!(cid instanceof PDFDict)) throw new Unclean("a composite font without its glyph widths");
    const dw = num(cid.lookup(PDFName.of("DW")), 1000), widths = new Map<number, number>();
    const w = cid.lookup(PDFName.of("W"));
    if (w instanceof PDFArray) {
      for (let k = 0; k < w.size(); ) {
        const first = num(w.lookup(k)), next = w.lookup(k + 1);
        if (next instanceof PDFArray) { for (let n = 0; n < next.size(); n++) widths.set(first + n, num(next.lookup(n))); k += 2; }
        else { const last = num(next), width = num(w.lookup(k + 2)); for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, width); k += 3; }
      }
    }
    const m = metrics(descriptorOf(cid));
    return { bytes: 2, width: (c) => widths.get(c) ?? dw, ascent: m.ascent, descent: m.descent };
  }
  const firstChar = num(font.lookup(PDFName.of("FirstChar")), 0), list = font.lookup(PDFName.of("Widths"));
  const widths = list instanceof PDFArray ? list.asArray().map((_, k) => num(list.lookup(k))) : null;
  if (kind === "Type3") {
    const fm = font.lookup(PDFName.of("FontMatrix")), bbox = font.lookup(PDFName.of("FontBBox"));
    const matrix = (fm instanceof PDFArray ? fm.asArray().map((_, k) => num(fm.lookup(k))) : [0.001, 0, 0, 0.001, 0, 0]) as Matrix;
    const b = bbox instanceof PDFArray ? bbox.asArray().map((_, k) => num(bbox.lookup(k))) : [0, -200, 1000, 800];
    // Widths in glyph space, turned into thousandths of the size like other fonts.
    return { bytes: 1, width: (c) => (widths?.[c - firstChar] ?? 0) * matrix[0] * 1000, ascent: Math.max(b[1], b[3]) * matrix[3] * 1000, descent: Math.min(b[1], b[3]) * matrix[3] * 1000 };
  }
  const m = metrics(descriptorOf(font));
  if (widths) return { bytes: 1, width: (c) => widths[c - firstChar] ?? (m.missing || 500), ascent: m.ascent, descent: m.descent };
  // A standard font named without widths: its own metrics.
  const base = font.lookup(PDFName.of("BaseFont"));
  const std = STANDARD[(base instanceof PDFName ? base.decodeText() : "").replace(/^[A-Z]{6}\+/, "").replace(/,/g, "-").replace(/MT$|PS$/, "")];
  if (!std) throw new Unclean("text in a font without its glyph widths");
  const embedder = StandardFontEmbedder.for(std as any);
  return { bytes: 1, width: (c) => { try { return embedder.widthOfTextAtSize(String.fromCharCode(c), 1000); } catch { return 500; } }, ascent: m.ascent, descent: m.descent };
}

// ---- Writing values back ----

const hex = (codes: number[], bytes: 1 | 2) => "<" + codes.map((c) => c.toString(16).padStart(bytes * 2, "0")).join("") + ">";
const fmt = (n: number) => (Math.abs(n) < 1e-6 ? "0" : Number(n.toFixed(4)).toString());
function write(v: Value): string {
  if (typeof v === "number") return fmt(v);
  if (typeof v === "boolean") return String(v);
  if (v === null) return "null";
  if (Array.isArray(v)) return "[" + v.map(write).join(" ") + "]";
  if ("name" in v) return "/" + v.name.replace(/[^!-~]|[()<>[\]{}/%#]/g, (c) => "#" + c.charCodeAt(0).toString(16).padStart(2, "0"));
  if ("bytes" in v) return "<" + v.bytes.map((b) => b.toString(16).padStart(2, "0")).join("") + ">";
  return "<<" + [...v.dict].map(([k, val]) => write({ name: k }) + " " + write(val)).join(" ") + ">>";
}

// ---- The rewrite ----

/** What to do with each thing a page draws, by its box in page space. */
export type Policy = {
  /** Keep this glyph? */
  glyph(box: Box): boolean;
  /** A path (with how many segments it has), a picture or a shading: keep, drop, or give up on clean removal. */
  mark(box: Box, kind: "path" | "image" | "shading", segments: number): "keep" | "drop" | "fail";
  /** A form XObject: keep it whole, drop it, or rewrite a copy of it with the same policy. */
  form(box: Box): "keep" | "drop" | "recurse";
};

type State = { ctm: Matrix; font?: FontInfo; size: number; tc: number; tw: number; th: number; tl: number; rise: number; clip: Box };
const latin1 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return s; };
const fromLatin1 = (s: string) => { const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255; return out; };

/** A stream's decoded bytes (any filter pdf-lib can read). */
export function streamBytes(stream: unknown): Uint8Array {
  if (stream instanceof PDFRawStream) return stream.dict.lookup(PDFName.of("Filter")) ? decodePDFRawStream(stream).decode() : stream.contents;
  const s = stream as any;
  if (typeof s?.getUnencodedContents === "function") return s.getUnencodedContents();
  if (typeof s?.getContents === "function") return s.getContents();
  throw new Unclean("a content stream that cannot be read");
}

/**
 * Rewrites one content stream under `policy`. `resources` are the stream's (a page's or a form's); `ctm` is where it
 * is drawn. Returns the new bytes, or null when nothing changed.
 */
export function rewriteContent(doc: PDFDocument, bytes: Uint8Array, resources: PDFDict | undefined, ctm: Matrix, page: Box, policy: Policy, depth = 0): Uint8Array | null {
  if (depth > 6) throw new Unclean("forms nested too deeply");
  const src = latin1(bytes), ops = parseContent(src);
  const fonts = new Map<string, FontInfo | Unclean>();
  const fontOf = (name: string) => {
    if (!fonts.has(name)) {
      const dict = (resources?.lookup(PDFName.of("Font")) as PDFDict | undefined)?.lookup(PDFName.of(name));
      try { fonts.set(name, dict instanceof PDFDict ? fontInfo(dict) : new Unclean(`the font ${name} is missing`)); } catch (e) { fonts.set(name, e instanceof Unclean ? e : new Unclean(String((e as Error).message))); }
    }
    return fonts.get(name)!;
  };
  const xobject = (name: string) => (resources?.lookup(PDFName.of("XObject")) as PDFDict | undefined)?.lookup(PDFName.of(name));
  let s: State = { ctm, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, clip: page };
  const stack: State[] = [];
  let fontError: Unclean | null = null;
  let tm: Matrix = IDENTITY, tlm: Matrix = IDENTITY;
  // Positions are unknown after text in a font that could not be read, until the next line positioning.
  let lost = false;
  const replace = new Map<number, string>();
  let path: { from: number; segments: number; box: Box | null } | null = null;
  let changed = false;
  const nums = (args: Value[]) => args.map((a) => (typeof a === "number" ? a : 0));
  // Marked content around a removed glyph loses its ActualText, Alt and E: they would still say what was there.
  const marked: number[] = [], scrub = new Set<number>();

  /** Shows `strings` (and TJ spacings) and returns the operator text with the glyphs the policy drops removed, or null. */
  const show = (items: Value[]) => {
    const f = s.font;
    if (!f) { if (fontError) throw fontError; throw new Unclean("text with no font set"); }
    const out: (number[] | number)[] = [];
    let dropped = false;
    for (const item of items) {
      if (typeof item === "number") { tm = mul([1, 0, 0, 1, (-item / 1000) * s.size * s.th, 0], tm); out.push(item); continue; }
      if (!item || typeof item !== "object" || !("bytes" in item)) continue;
      const b = item.bytes;
      let kept: number[] = [];
      for (let k = 0; k + f.bytes <= b.length; k += f.bytes) {
        const code = f.bytes === 2 ? (b[k] << 8) | b[k + 1] : b[k];
        const w0 = f.width(code) / 1000;
        const trm = mul([s.size * s.th, 0, 0, s.size, 0, s.rise], mul(tm, s.ctm));
        const box = map(trm, 0, f.descent / 1000, w0 || 0.5, f.ascent / 1000);
        const advance = (w0 * s.size + s.tc + (f.bytes === 1 && code === 32 ? s.tw : 0)) * s.th;
        if (lost && !policy.glyph(box)) throw new Unclean("text placed after text in an unreadable font");
        if (policy.glyph(box)) kept.push(code);
        else {
          dropped = true;
          marked.forEach((m) => scrub.add(m));
          if (kept.length) { out.push(kept); kept = []; }
          // The dropped glyph's advance, as a TJ spacing in thousandths of the size.
          out.push(s.size ? (-advance / s.th / s.size) * 1000 : 0);
        }
        tm = mul([1, 0, 0, 1, advance, 0], tm);
      }
      if (kept.length) out.push(kept);
    }
    if (!dropped) return null;
    changed = true;
    return "[" + out.map((p) => (typeof p === "number" ? fmt(p) : hex(p, f.bytes))).join(" ") + "] TJ";
  };

  for (let k = 0; k < ops.length; k++) {
    const { op, args } = ops[k];
    switch (op) {
      case "q": stack.push({ ...s }); break;
      case "BMC": case "BDC": marked.push(k); break;
      case "EMC": marked.pop(); break;
      case "Q": s = stack.pop() || s; break;
      case "cm": s.ctm = mul(nums(args) as Matrix, s.ctm); break;
      case "BT": tm = tlm = IDENTITY; lost = false; break;
      case "Tf": {
        const name = (args[0] as { name: string })?.name;
        const info = name ? fontOf(name) : new Unclean("a font without a name");
        s.size = typeof args[1] === "number" ? args[1] : 0;
        if (info instanceof Unclean) { s.font = undefined; fontError = info; } else { s.font = info; fontError = null; }
        break;
      }
      case "Tc": s.tc = nums(args)[0]; break;
      case "Tw": s.tw = nums(args)[0]; break;
      case "Tz": s.th = nums(args)[0] / 100; break;
      case "TL": s.tl = nums(args)[0]; break;
      case "Ts": s.rise = nums(args)[0]; break;
      case "Td": { const [x, y] = nums(args); tm = tlm = mul([1, 0, 0, 1, x, y], tlm); lost = false; break; }
      case "TD": { const [x, y] = nums(args); s.tl = -y; tm = tlm = mul([1, 0, 0, 1, x, y], tlm); lost = false; break; }
      case "Tm": tm = tlm = nums(args) as Matrix; lost = false; break;
      case "T*": tm = tlm = mul([1, 0, 0, 1, 0, -s.tl], tlm); lost = false; break;
      case "Tj": case "TJ": case "'": case '"': {
        if (op === "'" || op === '"') { tm = tlm = mul([1, 0, 0, 1, 0, -s.tl], tlm); lost = false; }
        if (op === '"') { s.tw = nums(args)[0]; s.tc = nums(args)[1]; }
        const items = op === "TJ" ? (Array.isArray(args[0]) ? args[0] : []) : [args[op === '"' ? 2 : 0]];
        if (!s.font) {
          // A font that cannot be read: harmless unless this text could be what the policy removes. Where it starts is
          // known; its length is not, so it is taken as one em per byte.
          const length = items.reduce((n: number, it) => n + (it && typeof it === "object" && "bytes" in it ? it.bytes.length : 0), 0);
          const rough = map(mul([s.size * s.th, 0, 0, s.size, 0, s.rise], mul(tm, s.ctm)), 0, -0.3, Math.max(1, length), 1);
          if (lost || !policy.glyph(rough)) throw fontError ?? new Unclean("text in a font that cannot be read");
          lost = true;
          break;
        }
        const text = show(items);
        if (text !== null) replace.set(k, (op === "'" ? "T* " : op === '"' ? `${fmt(s.tw)} Tw ${fmt(s.tc)} Tc T* ` : "") + text);
        break;
      }
      case "m": case "l": case "c": case "v": case "y": case "re": {
        const v = nums(args);
        if (!path) path = { from: k, segments: 0, box: null };
        const pts: [number, number][] = op === "re" ? [[v[0], v[1]], [v[0] + v[2], v[1] + v[3]]] : Array.from({ length: v.length / 2 }, (_, j) => [v[2 * j], v[2 * j + 1]] as [number, number]);
        for (const [x, y] of pts) {
          const b = map(s.ctm, x, y, x, y);
          path.box = path.box ? [Math.min(path.box[0], b[0]), Math.min(path.box[1], b[1]), Math.max(path.box[2], b[2]), Math.max(path.box[3], b[3])] : b;
        }
        path.segments++;
        break;
      }
      case "h": break;
      case "W": case "W*": if (path) (path as any).clip = true; break;
      case "S": case "s": case "f": case "F": case "f*": case "B": case "B*": case "b": case "b*": case "n": {
        if (path?.box) {
          const clip = (path as any).clip;
          if (clip) s.clip = intersectBox(s.clip, path.box);
          if (op !== "n" && !clip) {
            // Lines are widened by half their width at most; a box test with the bare path is close enough.
            const decision = policy.mark(path.box, "path", path.segments);
            if (decision === "fail") throw new Unclean("a drawing crossing the box");
            if (decision === "drop") { for (let j = path.from; j <= k; j++) replace.set(j, ""); changed = true; }
          }
        }
        path = null;
        break;
      }
      case "sh": {
        const decision = policy.mark(s.clip, "shading", 1);
        if (decision === "fail") throw new Unclean("a shading crossing the box");
        if (decision === "drop") { replace.set(k, ""); changed = true; }
        break;
      }
      case "BI": {
        const decision = policy.mark(map(s.ctm, 0, 0, 1, 1), "image", 1);
        if (decision === "fail") throw new Unclean("a picture partly under the box");
        if (decision === "drop") { replace.set(k, ""); changed = true; }
        break;
      }
      case "Do": {
        const name = (args[0] as { name: string })?.name;
        const x = xobject(name);
        if (!(x instanceof PDFStream)) break;
        const type = x.dict.lookup(PDFName.of("Subtype"));
        if (type === PDFName.of("Image")) {
          const decision = policy.mark(map(s.ctm, 0, 0, 1, 1), "image", 1);
          if (decision === "fail") throw new Unclean("a picture partly under the box");
          if (decision === "drop") { replace.set(k, ""); changed = true; }
        } else if (type === PDFName.of("Form")) {
          const fm = x.dict.lookup(PDFName.of("Matrix")), bb = x.dict.lookup(PDFName.of("BBox"));
          const matrix = (fm instanceof PDFArray ? fm.asArray().map((_, j) => num(fm.lookup(j))) : IDENTITY) as Matrix;
          const b = bb instanceof PDFArray ? bb.asArray().map((_, j) => num(bb.lookup(j))) : [0, 0, 0, 0];
          const at = mul(matrix, s.ctm), box = map(at, b[0], b[1], b[2], b[3]);
          const decision = policy.form(intersectBox(box, s.clip));
          if (decision === "drop") { replace.set(k, ""); changed = true; }
          else if (decision === "recurse") {
            const res = x.dict.lookup(PDFName.of("Resources"));
            const inner = rewriteContent(doc, streamBytes(x), res instanceof PDFDict ? res : resources, at, page, policy, depth + 1);
            if (inner) {
              // A copy of the form with the new content (the original may be drawn elsewhere too), under a new name.
              const dict = x.dict.clone(doc.context);
              dict.delete(PDFName.of("Filter"));
              dict.delete(PDFName.of("DecodeParms"));
              dict.delete(PDFName.of("Length"));
              const own = res instanceof PDFDict ? res : resources;
              if (own) dict.set(PDFName.of("Resources"), pruned(doc, own, inner));
              const copy = doc.context.register(doc.context.flateStream(inner, Object.fromEntries([...dict.entries()].map(([key, val]) => [key.decodeText(), val]))));
              const xobjects = resources!.lookup(PDFName.of("XObject")) as PDFDict;
              let fresh = name + "_r";
              while (xobjects.has(PDFName.of(fresh))) fresh += "r";
              xobjects.set(PDFName.of(fresh), copy);
              replace.set(k, `/${fresh} Do`);
              changed = true;
            }
          }
        }
        break;
      }
    }
  }
  if (!changed) return null;
  for (const m of scrub) {
    const dict = ops[m].args[1];
    if (ops[m].op !== "BDC" || !dict || typeof dict !== "object" || !("dict" in dict) || replace.has(m)) continue;
    const rest = new Map([...dict.dict].filter(([key]) => !["ActualText", "Alt", "E"].includes(key)));
    replace.set(m, write(ops[m].args[0]) + " " + write({ dict: rest }) + " BDC");
  }
  let out = "", at = 0;
  ops.forEach((o, k) => {
    if (!replace.has(k)) return;
    out += src.slice(at, o.start) + replace.get(k) + "\n";
    at = o.end;
  });
  out += src.slice(at);
  return fromLatin1(out);
}
const intersectBox = (a: Box, b: Box): Box => { const r: Box = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]; return r[0] <= r[2] && r[1] <= r[3] ? r : [0, 0, 0, 0]; };

/** A page's content as one stream of bytes (its parts joined). */
function pageContent(page: PDFPage) {
  const contents = page.node.Contents();
  const parts = contents instanceof PDFArray ? contents.asArray().map((_, i) => contents.lookup(i)) : contents ? [contents] : [];
  const chunks = parts.map((p) => streamBytes(p));
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length + 1, 0));
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; all[at++] = 10; }
  return all;
}
/** The page's new content, and its resources without the pictures and forms it no longer draws. */
function setContent(doc: PDFDocument, page: PDFPage, bytes: Uint8Array) {
  // Wrapped in q … Q: content that leaves the coordinates changed (Chromium's flips them) must not move what is drawn
  // after it, and pdf-lib does not wrap a page's content before adding to it.
  const head = new TextEncoder().encode("q\n"), tail = new TextEncoder().encode("\nQ\n"), all = new Uint8Array(head.length + bytes.length + tail.length);
  all.set(head, 0); all.set(bytes, head.length); all.set(tail, head.length + bytes.length);
  // An array, as pdf-lib keeps every page's contents (it adds to it, and reads it when placing the page elsewhere).
  page.node.set(PDFName.of("Contents"), doc.context.obj([doc.context.register(doc.context.flateStream(all))]));
  // pdf-lib keeps the stream it last drew into; it is part of the old content now, so the next drawing starts a new one.
  (page as any).contentStream = undefined;
  (page as any).contentStreamRef = undefined;
  const resources = page.node.Resources();
  if (resources) page.node.set(PDFName.of("Resources"), pruned(doc, resources, bytes));
}

/** The XObjects a content stream draws, by name. */
function drawn(bytes: Uint8Array) {
  const names = new Set<string>();
  for (const m of latin1(bytes).matchAll(/\/([^\s/<>[\]()%]+)\s+Do\b/g)) names.add(m[1].replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))));
  return names;
}
/** A copy of `resources` whose XObjects are only those `content` draws: a removed picture must not stay reachable. */
function pruned(doc: PDFDocument, resources: PDFDict, content: Uint8Array) {
  const copy = resources.clone(doc.context);
  const xobjects = copy.lookup(PDFName.of("XObject"));
  if (xobjects instanceof PDFDict) {
    const keep = drawn(content), own = xobjects.clone(doc.context);
    for (const key of own.keys()) if (!keep.has(key.decodeText())) own.delete(key);
    copy.set(PDFName.of("XObject"), own);
  }
  return copy;
}

/**
 * Deletes every object nothing in the document points to. pdf-lib writes every object it read, used or not, so a
 * page's old content stream, a removed picture or an earlier revision's objects would otherwise still be in the file.
 */
export function collectGarbage(doc: PDFDocument) {
  const seen = new Set<string>(), queue: unknown[] = [];
  const trailer = doc.context.trailerInfo as Record<string, unknown>;
  for (const key of ["Root", "Info", "Encrypt"]) if (trailer[key]) queue.push(trailer[key]);
  while (queue.length) {
    const v = queue.pop();
    if (v instanceof PDFRef) {
      const tag = v.toString();
      if (seen.has(tag)) continue;
      seen.add(tag);
      queue.push(doc.context.lookup(v));
    } else if (v instanceof PDFDict) for (const [, val] of v.entries()) queue.push(val);
    else if (v instanceof PDFArray) for (let i = 0; i < v.size(); i++) queue.push(v.get(i));
    else if (v instanceof PDFStream) queue.push(v.dict);
  }
  let removed = 0;
  for (const [ref] of doc.context.enumerateIndirectObjects()) if (!seen.has(ref.toString())) { doc.context.delete(ref); removed++; }
  return removed;
}
const pageBox = (page: PDFPage): Box => { const m = page.getMediaBox(); return [m.x, m.y, m.x + m.width, m.y + m.height]; };

/** Glyphs count as under a box when a fifth of them or their middle is. */
const covered = (glyph: Box, regions: Box[]) => regions.some((r) => {
  const cx = (glyph[0] + glyph[2]) / 2, cy = (glyph[1] + glyph[3]) / 2;
  return overlap(glyph, r) >= 0.2 * Math.max(1e-6, area(glyph)) || (cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3]);
});

/**
 * Takes everything under `regions` off the page: glyphs one by one, pictures and drawings that lie inside, annotations
 * over it, form fields there with their values. A simple shape crossing a box edge (a rule, a cell border) stays, under
 * the box drawn over it; anything else only partly under a box throws Unclean.
 */
export function redactPage(doc: PDFDocument, page: PDFPage, regions: Box[]) {
  const policy: Policy = {
    glyph: (box) => !covered(box, regions),
    mark: (box, kind, segments) => {
      const hits = regions.filter((r) => overlap(box, r) > 0 || (area(box) === 0 && within(box, r)));
      if (!hits.length) return "keep";
      if (hits.some((r) => within(box, r))) return "drop";
      return kind === "path" && segments <= 24 ? "keep" : "fail";
    },
    form: (box) => (!regions.some((r) => overlap(box, r) > 0) ? "keep" : regions.some((r) => within(box, r)) ? "drop" : "recurse"),
  };
  const resources = page.node.Resources();
  const next = rewriteContent(doc, pageContent(page), resources, IDENTITY, pageBox(page), policy);
  if (next) setContent(doc, page, next);
  // Annotations over a box go too; a form field's widget there takes its value with it.
  const annots = page.node.lookup(PDFName.of("Annots"));
  if (annots instanceof PDFArray) {
    for (let i = annots.size() - 1; i >= 0; i--) {
      const a = annots.lookup(i);
      const rect = a instanceof PDFDict ? a.lookup(PDFName.of("Rect")) : undefined;
      if (!(rect instanceof PDFArray)) continue;
      const r = rect.asArray().map((_, j) => num(rect.lookup(j)));
      const box: Box = [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
      if (!regions.some((g) => overlap(box, g) > 0)) continue;
      if (a instanceof PDFDict && a.lookup(PDFName.of("Subtype")) === PDFName.of("Widget")) dropField(doc, a, annots.get(i));
      annots.remove(i);
    }
  }
}

/** Makes `box` the whole page, with its corner at (0, 0): pages placed elsewhere (pdf-lib embedPage) assume that origin. */
export function cropTo(doc: PDFDocument, page: PDFPage, [x0, y0, x1, y1]: Box) {
  const head = new TextEncoder().encode(`q 1 0 0 1 ${fmt(-x0)} ${fmt(-y0)} cm\n`), body = pageContent(page), tail = new TextEncoder().encode("\nQ\n");
  const all = new Uint8Array(head.length + body.length + tail.length);
  all.set(head, 0); all.set(body, head.length); all.set(tail, head.length + body.length);
  setContent(doc, page, all);
  page.setMediaBox(0, 0, x1 - x0, y1 - y0);
  page.setCropBox(0, 0, x1 - x0, y1 - y0);
}

/**
 * A form field whose widget is under a box goes whole: its value, its drawn appearance (which holds the value as text)
 * and its place in the form. A field with other widgets elsewhere keeps them but loses its value.
 */
function dropField(doc: PDFDocument, widget: PDFDict, ref: unknown) {
  widget.delete(PDFName.of("AP"));
  const parent = widget.lookup(PDFName.of("Parent"));
  const field = parent instanceof PDFDict ? parent : widget;
  for (const key of ["V", "DV", "RV"]) field.delete(PDFName.of(key));
  const kids = parent instanceof PDFDict ? parent.lookup(PDFName.of("Kids")) : undefined;
  if (kids instanceof PDFArray) {
    const at = kids.asArray().findIndex((k) => k === ref || kids.lookup(kids.asArray().indexOf(k)) === widget);
    if (at >= 0) kids.remove(at);
    if (kids.size()) return;
  }
  // No widget left: out of the form's list of fields.
  const acro = doc.catalog.lookup(PDFName.of("AcroForm"));
  const fields = acro instanceof PDFDict ? acro.lookup(PDFName.of("Fields")) : undefined;
  if (fields instanceof PDFArray) for (let k = fields.size() - 1; k >= 0; k--) if (fields.lookup(k) === field) fields.remove(k);
}

// ---- The removed words elsewhere in the file ----

/** Any of `texts`, ignoring case, with any whitespace (or none) where they have some; longest first. */
const wordsPattern = (texts: string[]) => new RegExp([...texts].sort((a, b) => b.length - a.length).map((t) => t.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*")).join("|"), "giu");
const blot = (m: string) => "█".repeat([...m].length);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()]);
const escapeXml = (s: string, quote = "") => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(quote ? new RegExp(quote, "g") : /(?!)/, quote === '"' ? "&quot;" : "&apos;");

/**
 * XML (XMP, rich-text comments) with the words blotted in its text nodes, CDATA, comments and attribute values, read
 * with their entities; markup and every untouched part stay byte for byte, so it stays valid.
 */
export function scrubXml(xml: string, re: RegExp) {
  const text = (s: string, quote = "") => { const plain = unescapeXml(s), out = plain.replace(re, blot); return out === plain ? s : escapeXml(out, quote); };
  return xml.replace(/(<!\[CDATA\[)([\s\S]*?)(\]\]>)|(<!--)([\s\S]*?)(-->)|(<\?[\s\S]*?\?>)|(<[^>]*>)|([^<]+)/g, (all, c0, cdata, c1, k0, comment, k1, pi, tag, body) => {
    if (cdata !== undefined) return c0 + cdata.replace(re, blot) + c1;
    if (comment !== undefined) return k0 + comment.replace(re, blot) + k1;
    if (pi) return pi;
    if (tag) return tag.replace(/(=\s*)(?:"([^"]*)"|'([^']*)')/g, (_: string, eq: string, d?: string, s?: string) => d !== undefined ? `${eq}"${text(d, '"')}"` : `${eq}'${text(s!, "'")}'`);
    return text(body);
  });
}

/** A text string's value, read as PDF reads it (UTF-16BE or UTF-8 with their marks, else PDFDocEncoding). */
function readString(v: PDFString | PDFHexString) {
  const b = v.asBytes();
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: new TextDecoder().decode(b.subarray(3)), utf8: true };
  return { text: v.decodeText(), utf8: false };
}
/** The blotted text as a string again: UTF-16BE with its mark (█ is not in PDFDocEncoding), or UTF-8 if it was. */
const writeString = (text: string, utf8: boolean) => utf8 ? PDFHexString.of("EFBBBF" + [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, "0")).join("")) : PDFHexString.fromText(text);
/** A name's text (names hold UTF-8 bytes) and the name for blotted text. */
const nameText = (n: PDFName) => { const raw = n.decodeText(); try { return new TextDecoder("utf-8", { fatal: true }).decode(fromLatin1(raw)); } catch { return raw; } };
const nameOf = (text: string) => PDFName.of(latin1(new TextEncoder().encode(text)));

/**
 * Takes `texts` (what a redaction removed from a page) out of every other place a PDF keeps words: bookmark titles,
 * the Info dictionary, XMP metadata, the structure tree's alternative texts, annotations' comments, and named
 * destinations (with the links to them). Each occurrence becomes █ of the same length. Returns what was cleaned, for
 * the person ("2 bookmarks", "the document title").
 */
export function scrubText(doc: PDFDocument, texts: string[]): string[] {
  texts = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  if (!texts.length) return [];
  const re = wordsPattern(texts), ctx = doc.context;
  /** Blots dict[key] when it is a string holding the words; true when it did. */
  const clean = (dict: PDFDict, key: string, xml = false) => {
    const v = dict.lookup(PDFName.of(key));
    if (!(v instanceof PDFString || v instanceof PDFHexString)) return false;
    const { text, utf8 } = readString(v), out = xml ? scrubXml(text, re) : text.replace(re, blot);
    if (out === text) return false;
    dict.set(PDFName.of(key), writeString(out, utf8));
    return true;
  };
  /** A destination given by name (a link, an outline, a GoTo action) follows its renamed destination. */
  const follow = (dict: PDFDict) => {
    clean(dict, "Dest");
    const dest = dict.lookup(PDFName.of("Dest"));
    if (dest instanceof PDFName) dict.set(PDFName.of("Dest"), nameOf(nameText(dest).replace(re, blot)));
    const action = dict.lookup(PDFName.of("A"));
    if (action instanceof PDFDict) {
      clean(action, "D");
      const d = action.lookup(PDFName.of("D"));
      if (d instanceof PDFName) action.set(PDFName.of("D"), nameOf(nameText(d).replace(re, blot)));
    }
  };
  const said: string[] = [], count = (n: number, one: string, many = one + "s") => { if (n) said.push(`${n} ${n === 1 ? one : many}`); };
  const catalog = doc.catalog;
  // Bookmarks, each once (a broken outline may loop).
  const seen = new Set<unknown>();
  let bookmarks = 0;
  const outlines = catalog.lookup(PDFName.of("Outlines"));
  const items = outlines instanceof PDFDict ? [outlines.lookup(PDFName.of("First"))] : [];
  while (items.length) {
    const item = items.pop();
    if (!(item instanceof PDFDict) || seen.has(item)) continue;
    seen.add(item);
    if (clean(item, "Title")) bookmarks++;
    follow(item);
    items.push(item.lookup(PDFName.of("Next")), item.lookup(PDFName.of("First")));
  }
  count(bookmarks, "bookmark");
  // The document's properties.
  const info = ctx.lookup((ctx.trailerInfo as Record<string, unknown>).Info as PDFRef);
  if (info instanceof PDFDict) {
    const LABEL: Record<string, string> = { Title: "title", Author: "author", Subject: "subject", Keywords: "keywords" };
    const hit = new Set<string>();
    for (const [key] of info.entries()) if (clean(info, key.decodeText())) hit.add(LABEL[key.decodeText()] ?? "properties");
    const list = [...hit].sort((a, b) => Object.values(LABEL).concat("properties").indexOf(a) - Object.values(LABEL).concat("properties").indexOf(b));
    if (list.length) said.push("the document " + (list.length > 1 ? list.slice(0, -1).join(", ") + " and " + list[list.length - 1] : list[0]));
  }
  // XMP packets: the document's and any other (pages, pictures, structure elements may carry their own).
  let xmp = false;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream) || obj.dict.lookup(PDFName.of("Type")) !== PDFName.of("Metadata")) continue;
    let bytes: Uint8Array;
    try { bytes = streamBytes(obj); } catch { continue; }
    const xml = new TextDecoder().decode(bytes), out = scrubXml(xml, re);
    if (out === xml) continue;
    const dict = obj.dict.clone(ctx);
    for (const key of ["Filter", "DecodeParms", "Length"]) dict.delete(PDFName.of(key));
    // Left unfiltered, as XMP is, so tools that scan files for it still find it.
    ctx.assign(ref, PDFRawStream.of(dict, new TextEncoder().encode(out)));
    xmp = true;
  }
  if (xmp) said.push("the XMP metadata");
  // The structure tree: what assistive technology reads out for each element.
  let tags = 0;
  const nodes: unknown[] = [catalog.lookup(PDFName.of("StructTreeRoot"))];
  while (nodes.length) {
    const node = nodes.pop();
    if (node instanceof PDFArray) { for (let i = 0; i < node.size(); i++) nodes.push(node.lookup(i)); continue; }
    if (!(node instanceof PDFDict) || seen.has(node)) continue;
    seen.add(node);
    if (["Alt", "ActualText", "E", "T"].map((k) => clean(node, k)).some(Boolean)) tags++;
    nodes.push(node.lookup(PDFName.of("K")));
  }
  count(tags, "tagged element");
  // Comments and their pop-ups on every page; links to a renamed destination follow it.
  let comments = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    const list = annots instanceof PDFArray ? annots.asArray().map((_, i) => annots.lookup(i)) : [];
    while (list.length) {
      const a = list.pop();
      if (!(a instanceof PDFDict) || seen.has(a)) continue;
      seen.add(a);
      if ([clean(a, "Contents"), clean(a, "RC", true), clean(a, "T"), clean(a, "Subj")].some(Boolean)) comments++;
      follow(a);
      list.push(a.lookup(PDFName.of("Popup")));
    }
  }
  count(comments, "comment");
  // Named destinations: the names tree (string keys, kept in order) and the older dictionary (name keys).
  let names = 0;
  const open = catalog.lookup(PDFName.of("OpenAction"));
  if (open instanceof PDFDict) follow(open);
  const tree = (catalog.lookup(PDFName.of("Names")) as PDFDict | undefined)?.lookup?.(PDFName.of("Dests"));
  const limits = (node: unknown): [PDFString | PDFHexString, PDFString | PDFHexString] | null => {
    if (!(node instanceof PDFDict) || seen.has(node)) return null;
    seen.add(node);
    const kids = node.lookup(PDFName.of("Kids")), leaf = node.lookup(PDFName.of("Names"));
    let ends: [PDFString | PDFHexString, PDFString | PDFHexString] | null = null;
    if (leaf instanceof PDFArray) {
      const pairs: [PDFString | PDFHexString, unknown][] = [];
      for (let i = 0; i + 1 < leaf.size(); i += 2) {
        const key = leaf.lookup(i);
        if (!(key instanceof PDFString || key instanceof PDFHexString)) continue;
        const { text, utf8 } = readString(key), out = text.replace(re, blot);
        if (out !== text) names++;
        pairs.push([out !== text ? writeString(out, utf8) : key, leaf.get(i + 1)]);
      }
      // Keys are compared as bytes; viewers search them in order.
      const order = (k: PDFString | PDFHexString) => latin1(k.asBytes());
      pairs.sort((a, b) => (order(a[0]) < order(b[0]) ? -1 : order(a[0]) > order(b[0]) ? 1 : 0));
      node.set(PDFName.of("Names"), ctx.obj(pairs.flat() as any));
      if (pairs.length) ends = [pairs[0][0], pairs[pairs.length - 1][0]];
    } else if (kids instanceof PDFArray) {
      const all = kids.asArray().map((_, i) => limits(kids.lookup(i))).filter((e) => e !== null);
      if (all.length) ends = [all[0]![0], all[all.length - 1]![1]];
    }
    if (ends && node.has(PDFName.of("Limits"))) node.set(PDFName.of("Limits"), ctx.obj([ends[0], ends[1]]));
    return ends;
  };
  limits(tree);
  const dests = catalog.lookup(PDFName.of("Dests"));
  if (dests instanceof PDFDict) for (const [key, value] of dests.entries()) {
    const text = nameText(key), out = text.replace(re, blot);
    if (out === text) continue;
    dests.delete(key);
    dests.set(nameOf(out), value);
    names++;
  }
  count(names, "named destination");
  return said;
}

/** Keeps only what is (at least partly) inside `box`: the rest of the page is taken out of a vector crop. */
export function keepInside(doc: PDFDocument, page: PDFPage, box: Box) {
  const policy: Policy = {
    glyph: (g) => overlap(g, box) > 0,
    mark: (b) => (overlap(b, box) > 0 || within(b, box) ? "keep" : "drop"),
    form: (b) => (overlap(b, box) <= 0 ? "drop" : within(b, box) ? "keep" : "recurse"),
  };
  const next = rewriteContent(doc, pageContent(page), page.node.Resources(), IDENTITY, pageBox(page), policy);
  if (next) setContent(doc, page, next);
}

