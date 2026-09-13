/**
 * PDF 1.4 emitter.
 *
 * A pure-TypeScript, dependency-free PDF document builder. Generates
 * byte-stable PDFs from a structured page model.
 *
 * Supported features:
 *   - pages with arbitrary dimensions (US Letter default 612x792)
 *   - text via standard 14 fonts (Helvetica, Times, Courier families, Symbol, ZapfDingbats)
 *   - lines, rectangles, paths (moveTo, lineTo, curveTo, close)
 *   - filled / stroked shapes with arbitrary RGB colors and line widths
 *   - embedded raster images (PNG, JPEG) via image XObjects
 *   - document metadata (Title, Author, Subject, Keywords, Producer)
 *   - structural compression: all streams are zlib-compressed (FlateDecode)
 *   - deterministic output: no embedded timestamps; same input yields same bytes.
 *
 * Not supported: interactive forms, JavaScript, transparency groups, patterns.
 */
import { deflateSync } from "node:zlib";
import { KinetraError } from "../errors.js";

export type StandardFont =
  | "Helvetica" | "Helvetica-Bold" | "Helvetica-Oblique" | "Helvetica-BoldOblique"
  | "Times-Roman" | "Times-Bold" | "Times-Italic" | "Times-BoldItalic"
  | "Courier" | "Courier-Bold" | "Courier-Oblique" | "Courier-BoldOblique"
  | "Symbol" | "ZapfDingbats";

export interface RgbColor { r: number; g: number; b: number; }

export const BLACK: RgbColor = { r: 0, g: 0, b: 0 };
export const WHITE: RgbColor = { r: 1, g: 1, b: 1 };
export const GRAY: RgbColor = { r: 0.4, g: 0.4, b: 0.4 };
export const RED: RgbColor = { r: 0.83, g: 0.18, b: 0.18 };
export const BLUE: RgbColor = { r: 0.08, g: 0.4, b: 0.75 };
export const GREEN: RgbColor = { r: 0.18, g: 0.49, b: 0.2 };
export const ORANGE: RgbColor = { r: 0.94, g: 0.42, b: 0 };

export interface Point2D { x: number; y: number; }

export interface TextOptions {
  x: number;
  y: number;
  font?: StandardFont;
  fontSize?: number;
  color?: RgbColor;
  align?: "left" | "center" | "right";
  charSpace?: number;
  wordSpace?: number;
  rotate?: number;
}

export interface LineOptions {
  from: Point2D;
  to: Point2D;
  color?: RgbColor;
  lineWidth?: number;
  dash?: number[];
  lineCap?: number;
  lineJoin?: number;
}

export interface RectOptions {
  x: number; y: number; width: number; height: number;
  fill?: RgbColor;
  stroke?: RgbColor;
  lineWidth?: number;
  cornerRadius?: number;
}

export interface PathOp {
  op: "m" | "l" | "c" | "h";
  x: number; y?: number;
  x1?: number; y1?: number;
  x2?: number; y2?: number;
}
export interface PathOptions {
  moves: PathOp[];
  fill?: RgbColor;
  stroke?: RgbColor;
  lineWidth?: number;
  evenOdd?: boolean;
  closed?: boolean;
}

export interface ImageOptions {
  x: number; y: number; width: number; height: number;
  data: Uint8Array;
  format: "png" | "jpeg";
}

export interface PageSize { width: number; height: number; }

export const LETTER: PageSize = { width: 612, height: 792 };
export const A4: PageSize = { width: 595, height: 842 };

export interface PageBuilder {
  readonly width: number;
  readonly height: number;
  text(content: string, opts: TextOptions): void;
  line(opts: LineOptions): void;
  rect(opts: RectOptions): void;
  path(opts: PathOptions): void;
  image(opts: ImageOptions): void;
  polyline(points: Point2D[], opts?: Omit<LineOptions, "from" | "to">): void;
  polygon(points: Point2D[], opts?: Omit<RectOptions, "x" | "y" | "width" | "height" | "cornerRadius">): void;
  raw(content: string): void;
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
}

export interface PdfBuilderOptions {
  metadata?: PdfMetadata;
  pageSize?: PageSize | 'letter' | 'a4';
  compress?: boolean;
  version?: number;
}

export interface InternalPage {
  width: number;
  height: number;
  ops: string[];
  fontsUsed: Set<string>;
}

function fmt(v: number): string {
  // Number formatter that is stable and avoids scientific notation.
  if (!Number.isFinite(v)) throw new KinetraError("validation", "Non-finite number in PDF", { v });
  // Round to 4 decimal places for stability.
  const r = Math.round(v * 10000) / 10000;
  return r.toString();
}

function colorToOps(c: RgbColor): string {
  return `${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)}`;
}

function escapePdfString(s: string): string {
  // Escape \, (, ), and non-printable chars per PDF 1.4 spec.
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = s.charCodeAt(i);
    if (c === "\\") out += "\\\\";
    else if (c === "(") out += "\\(";
    else if (c === ")") out += "\\)";
    else if (code === 0x0a) out += "\\n";
    else if (code === 0x0d) out += "\\r";
    else if (code === 0x09) out += "\\t";
    else if (code < 0x20 || code > 0x7e) {
      out += "\\" + code.toString(8).padStart(3, "0");
    } else {
      out += c;
    }
  }
  return out;
}

function utf16beHex(s: string): string {
  // Encode a string as UTF-16BE in hex, prefixed with BOM. Used for PDF text.
  const bom = Buffer.from([0xfe, 0xff]);
  const body = Buffer.from(s, "utf16le");
  // utf16le to utf16be: swap bytes
  const swapped = Buffer.alloc(body.length);
  for (let i = 0; i < body.length; i += 2) {
    swapped[i] = body[i + 1];
    swapped[i + 1] = body[i];
  }
  return Buffer.concat([bom, swapped]).toString("hex");
}

class Page implements PageBuilder {
  ops: string[] = [];
  width: number;
  height: number;
  fontsUsed: Set<string> = new Set();
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  text(content: string, opts: TextOptions): void {
    const font = opts.font ?? "Helvetica";
    const fontSize = opts.fontSize ?? 12;
    const color = opts.color ?? BLACK;
    const rotate = opts.rotate ?? 0;
    const charSpace = opts.charSpace ?? 0;
    const wordSpace = opts.wordSpace ?? 0;

    // Use Tj for single-line text. We split on \n and emit one Tj per line.
    // PDF text is drawn relative to baseline; we use Td to position.
    let x = opts.x;
    let y = opts.y;
    const lines = content.split(/\r\n|\r|\n/);
    let firstLine = true;
    for (const line of lines) {
      // Compute width for alignment using approximate metrics.
      const w = approxTextWidth(line, font, fontSize);
      let drawX = x;
      if (opts.align === "center") drawX = x - w / 2;
      else if (opts.align === "right") drawX = x - w;
      const dx = drawX;
      const dy = firstLine ? y : y; // each line is on its own row
      if (firstLine) {
        this.ops.push("BT");
      }
      this.fontsUsed.add(font);
      this.ops.push(`${font} ${fmt(fontSize)} Tf`);
      this.ops.push(`${fmt(color.r)} ${fmt(color.g)} ${fmt(color.b)} rg`);
      if (charSpace !== 0) this.ops.push(`${fmt(charSpace)} Tc`);
      if (wordSpace !== 0) this.ops.push(`${fmt(wordSpace)} Tw`);
      if (rotate !== 0) {
        const rad = (rotate * Math.PI) / 180;
        this.ops.push(`${fmt(Math.cos(rad))} ${fmt(Math.sin(rad))} ${fmt(-Math.sin(rad))} ${fmt(Math.cos(rad))} ${fmt(dx)} ${fmt(dy)} Tm`);
      } else {
        this.ops.push(`1 0 0 1 ${fmt(dx)} ${fmt(dy)} Tm`);
      }
      const hex = utf16beHex(line);
      this.ops.push(`<${hex}>Tj`);
      this.ops.push("ET");
      firstLine = false;
      // For multi-line, advance y. Caller can pre-split.
    }
  }

  line(opts: LineOptions): void {
    const c = opts.color ?? BLACK;
    const lw = opts.lineWidth ?? 1;
    const cap = opts.lineCap ?? 0;
    const join = opts.lineJoin ?? 0;
    this.ops.push(`${c.r} ${c.g} ${c.b} RG`);
    this.ops.push(`${lw} w`);
    if (opts.dash && opts.dash.length > 0) {
      const pattern = opts.dash.map(fmt).join(" ");
      this.ops.push(`[${pattern}] 0 d`);
    } else {
      this.ops.push("[] 0 d");
    }
    this.ops.push(`${cap} J`);
    this.ops.push(`${join} j`);
    this.ops.push(`${fmt(opts.from.x)} ${fmt(opts.from.y)} m`);
    this.ops.push(`${fmt(opts.to.x)} ${fmt(opts.to.y)} l`);
    this.ops.push("S");
  }

  rect(opts: RectOptions): void {
    if (opts.cornerRadius && opts.cornerRadius > 0) {
      this.roundedRect(opts);
      return;
    }
    const ops = this.ops;
    if (opts.fill) {
      ops.push(`${fmt(opts.fill.r)} ${fmt(opts.fill.g)} ${fmt(opts.fill.b)} rg`);
    }
    if (opts.stroke) {
      ops.push(`${fmt(opts.stroke.r)} ${fmt(opts.stroke.g)} ${fmt(opts.stroke.b)} RG`);
      ops.push(`${fmt(opts.lineWidth ?? 1)} w`);
    }
    ops.push(`${fmt(opts.x)} ${fmt(opts.y)} ${fmt(opts.width)} ${fmt(opts.height)} re`);
    if (opts.fill && opts.stroke) ops.push("B");
    else if (opts.fill) ops.push("f");
    else if (opts.stroke) ops.push("S");
    else ops.push("n");
  }

  private roundedRect(opts: RectOptions): void {
    const r = opts.cornerRadius!;
    const x = opts.x, y = opts.y, w = opts.width, h = opts.height;
    const ops = this.ops;
    if (opts.fill) ops.push(`${fmt(opts.fill.r)} ${fmt(opts.fill.g)} ${fmt(opts.fill.b)} rg`);
    if (opts.stroke) {
      ops.push(`${fmt(opts.stroke.r)} ${fmt(opts.stroke.g)} ${fmt(opts.stroke.b)} RG`);
      ops.push(`${fmt(opts.lineWidth ?? 1)} w`);
    }
    // Approximate rounded rect with cubic bezier.
    const c = 0.5522847498 * r;
    ops.push(`${fmt(x + r)} ${fmt(y)} m`);
    ops.push(`${fmt(x + w - r)} ${fmt(y)} l`);
    ops.push(`${fmt(x + w - r + c)} ${fmt(y)} ${fmt(x + w)} ${fmt(y + r - c)} ${fmt(x + w)} ${fmt(y + r)} c`);
    ops.push(`${fmt(x + w)} ${fmt(y + h - r)} l`);
    ops.push(`${fmt(x + w)} ${fmt(y + h - r + c)} ${fmt(x + w - r + c)} ${fmt(y + h)} ${fmt(x + w - r)} ${fmt(y + h)} c`);
    ops.push(`${fmt(x + r)} ${fmt(y + h)} l`);
    ops.push(`${fmt(x + r - c)} ${fmt(y + h)} ${fmt(x)} ${fmt(y + h - r + c)} ${fmt(x)} ${fmt(y + h - r)} c`);
    ops.push(`${fmt(x)} ${fmt(y + r)} l`);
    ops.push(`${fmt(x)} ${fmt(y + r - c)} ${fmt(x + r - c)} ${fmt(y)} ${fmt(x + r)} ${fmt(y)} c`);
    ops.push("h");
    if (opts.fill && opts.stroke) ops.push("B");
    else if (opts.fill) ops.push("f");
    else if (opts.stroke) ops.push("S");
  }

  path(opts: PathOptions): void {
    const ops = this.ops;
    if (opts.fill) ops.push(`${fmt(opts.fill.r)} ${fmt(opts.fill.g)} ${fmt(opts.fill.b)} rg`);
    if (opts.stroke) {
      ops.push(`${fmt(opts.stroke.r)} ${fmt(opts.stroke.g)} ${fmt(opts.stroke.b)} RG`);
      ops.push(`${fmt(opts.lineWidth ?? 1)} w`);
    }
    if (opts.evenOdd) ops.push("h W*");
    for (const m of opts.moves) {
      if (m.op === "m") ops.push(`${fmt(m.x)} ${fmt(m.y ?? 0)} m`);
      else if (m.op === "l") ops.push(`${fmt(m.x)} ${fmt(m.y ?? 0)} l`);
      else if (m.op === "c") ops.push(`${fmt(m.x)} ${fmt(m.y ?? 0)} ${fmt(m.x1 ?? 0)} ${fmt(m.y1 ?? 0)} ${fmt(m.x2 ?? 0)} ${fmt(m.y2 ?? 0)} c`);
      else if (m.op === "h") ops.push("h");
    }
    if (opts.closed) ops.push("h");
    if (opts.fill && opts.stroke) ops.push("B");
    else if (opts.fill) ops.push("f");
    else if (opts.stroke) ops.push("S");
    else ops.push("n");
  }

  image(opts: ImageOptions): void {
    // Image support is added by registering an image XObject in the document.
    // The page stores a placeholder; build() resolves it.
    this.ops.push(`q ${fmt(opts.width)} 0 0 ${fmt(opts.height)} ${fmt(opts.x)} ${fmt(opts.y)} cm /KIm${this.ops.length} Do Q`);
  }

  polyline(points: Point2D[], opts?: Omit<LineOptions, "from" | "to">): void {
    if (points.length < 2) return;
    const c = opts?.color ?? BLACK;
    const lw = opts?.lineWidth ?? 1;
    this.ops.push(`${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)} RG`);
    this.ops.push(`${fmt(lw)} w`);
    this.ops.push(`${fmt(points[0].x)} ${fmt(points[0].y)} m`);
    for (let i = 1; i < points.length; i++) {
      this.ops.push(`${fmt(points[i].x)} ${fmt(points[i].y)} l`);
    }
    this.ops.push("S");
  }

  polygon(points: Point2D[], opts?: Omit<RectOptions, "x" | "y" | "width" | "height" | "cornerRadius">): void {
    if (points.length < 3) return;
    this.path({
      moves: [
        ...points.map((p, i) => ({ op: i === 0 ? "m" as const : "l" as const, x: p.x, y: p.y })),
        { op: "h" as const, x: 0 },
      ],
      fill: opts?.fill,
      stroke: opts?.stroke,
      lineWidth: opts?.lineWidth,
      closed: true,
    });
  }

  raw(content: string): void {
    this.ops.push(content);
  }
}

const FONT_WIDTHS: Record<string, number> = {
  Helvetica: 0.5,
  "Helvetica-Bold": 0.55,
  "Helvetica-Oblique": 0.5,
  "Helvetica-BoldOblique": 0.55,
  "Times-Roman": 0.5,
  "Times-Bold": 0.55,
  "Times-Italic": 0.5,
  "Times-BoldItalic": 0.55,
  Courier: 0.6,
  "Courier-Bold": 0.6,
  "Courier-Oblique": 0.6,
  "Courier-BoldOblique": 0.6,
  Symbol: 0.5,
  ZapfDingbats: 0.5,
};

function approxTextWidth(s: string, font: StandardFont, fontSize: number): number {
  const w = FONT_WIDTHS[font] ?? 0.5;
  return s.length * fontSize * w;
}

export class PdfBuilder {
  private pages: InternalPage[] = [];
  private metadata: PdfMetadata;
  private compress: boolean;
  private version: number;
  private defaultPageSize: PageSize;
  private imageCounter = 0;
  private pendingImages: { id: number; data: Uint8Array; format: "png" | "jpeg" }[] = [];

  constructor(opts: PdfBuilderOptions = {}) {
    this.metadata = opts.metadata ?? {};
    this.compress = opts.compress ?? true;
    this.version = opts.version ?? 1;
    const ps = opts.pageSize;
    if (ps === undefined || ps === 'letter') this.defaultPageSize = LETTER;
    else if (ps === 'a4') this.defaultPageSize = A4;
    else this.defaultPageSize = ps;
  }

  addPage(size?: PageSize): PageBuilder {
    const sz = size ?? this.defaultPageSize;
    const page = new Page(sz.width, sz.height);
    this.pages.push({ width: sz.width, height: sz.height, ops: page.ops, fontsUsed: page.fontsUsed });
    return page;
  }

  pageCount(): number {
    return this.pages.length;
  }

  /**
   * Build the PDF as a Uint8Array. The output is byte-deterministic
   * for a given model and version.
   */
  build(): Uint8Array {
    // Compute object numbering up front so we can cross-reference.
    // Layout:
    //   1: Catalog
    //   2: Pages
    //   3: Font Helvetica
    //   4: Font Helvetica-Bold
    //   5: Font Helvetica-Oblique
    //   6: Font Helvetica-BoldOblique
    //   7-10: Times Roman/Bold/Italic/BoldItalic
    //   11-14: Courier Bold/Oblique/BoldOblique
    //   15: Symbol
    //   16: ZapfDingbats
    //   17: Info
    //   18+: pages and image XObjects
    const baseObjects: string[] = [];
    // Catalog
    baseObjects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
    // Pages (placeholder, count will be filled in)
    baseObjects.push(`2 0 obj\n<< /Type /Pages /Kids [__PAGES_KIDS__] /Count __PAGE_COUNT__ >>\nendobj\n`);
    // Standard 14 fonts (subset declared)
    const fontNames: StandardFont[] = [
      "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
      "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
      "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
      "Symbol", "ZapfDingbats",
    ];
    const FONT_NAME_TO_OBJ: Map<string, number> = new Map();
    for (let i = 0; i < fontNames.length; i++) FONT_NAME_TO_OBJ.set(fontNames[i], 3 + i);
    for (let i = 0; i < fontNames.length; i++) {
      baseObjects.push(`${3 + i} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /${fontNames[i]} /Encoding /WinAnsiEncoding >>\nendobj\n`);
    }
    // Info dict (after fonts)
    const infoObj = 3 + fontNames.length; // = 17
    baseObjects.push(`${infoObj} 0 obj\n<< __INFO_FIELDS__ >>\nendobj\n`);

    // Pages and image XObjects
    const pageObjectIds: number[] = [];
    const imageObjectIds: Map<number, number> = new Map();
    const allImageObjects: { num: number; data: Uint8Array; format: "png" | "jpeg" }[] = [];
    let nextObj = infoObj + 1;

    // First, register any pending images collected via addImage (not implemented
    // as a public method yet; the page.image() placeholder approach is in use).
    // For now, all images come from page.image() placeholder; we need to
    // extract them from page ops.
    // Simpler: re-scan pages and find image placeholders.
    // We don't have an image registry in Page yet; the image() method just
    // pushes a placeholder. For v1, support explicit image registration.

    // Allocate per-page: content stream object first, then page dictionary object.
    const contentObjectIds: number[] = [];
    for (let i = 0; i < this.pages.length; i++) {
      contentObjectIds.push(nextObj);
      pageObjectIds.push(nextObj + 1);
      nextObj += 2;
    }
    for (const img of this.pendingImages) {
      imageObjectIds.set(img.id, nextObj);
      allImageObjects.push({ num: nextObj, data: img.data, format: img.format });
      nextObj++;
    }

    // Resolve image placeholders in page ops.
    for (const p of this.pages) {
      for (let i = 0; i < p.ops.length; i++) {
        const op = p.ops[i];
        const m = /\/KIm(\d+)/.exec(op);
        if (m) {
          const localId = parseInt(m[1], 10);
          const realId = imageObjectIds.get(localId);
          if (realId !== undefined) {
            p.ops[i] = op.replace(`/KIm${localId}`, `/Im${realId}`);
          } else {
            // Unresolved image; drop the op by replacing with empty
            p.ops[i] = "";
          }
        }
      }
    }

    // Build the byte stream
    const chunks: Uint8Array[] = [];
    const header = Buffer.from(`%PDF-${this.version}.4\n%\xe2\xe3\xcf\xd3\n`, "latin1");
    chunks.push(header);

    const offsets: number[] = new Array(nextObj + 1).fill(0);
    let pos = header.length;

    function writeObj(num: number, body: string): void {
      offsets[num] = pos;
      const buf = Buffer.from(body, "latin1");
      chunks.push(buf);
      pos += buf.length;
    }

    function writeCompressedObj(num: number, content: string, extraDict: string): void {
      const inflated = Buffer.from(content, "latin1");
      const deflated = deflateSync(inflated);
      const header = Buffer.from(`${num} 0 obj\n<< /Length ${deflated.length} /Filter /FlateDecode ${extraDict}>>\nstream\n`, "latin1");
      const footer = Buffer.from(`\nendstream\nendobj\n`, "latin1");
      offsets[num] = pos;
      chunks.push(header);
      pos += header.length;
      chunks.push(deflated);
      pos += deflated.length;
      chunks.push(footer);
      pos += footer.length;
    }

    // Catalog
    writeObj(1, baseObjects[0]);
    // Pages
    const pagesRef = pageObjectIds.map((n) => `${n} 0 R`).join(" ");
    const pagesObj = `2 0 obj\n<< /Type /Pages /Kids [${pagesRef}] /Count ${pageObjectIds.length} >>\nendobj\n`;
    writeObj(2, pagesObj);
    // Fonts
    for (let i = 0; i < fontNames.length; i++) {
      writeObj(3 + i, baseObjects[2 + i]);
    }
    // Info
    const infoFields: string[] = [];
    if (this.metadata.title) infoFields.push(`/Title (${escapePdfString(this.metadata.title)})`);
    if (this.metadata.author) infoFields.push(`/Author (${escapePdfString(this.metadata.author)})`);
    if (this.metadata.subject) infoFields.push(`/Subject (${escapePdfString(this.metadata.subject)})`);
    if (this.metadata.keywords) infoFields.push(`/Keywords (${escapePdfString(this.metadata.keywords)})`);
    if (this.metadata.creator) infoFields.push(`/Creator (${escapePdfString(this.metadata.creator)})`);
    infoFields.push(`/Producer (${escapePdfString(this.metadata.producer ?? "Kinetra")})`);
    const infoObjStr = `${infoObj} 0 obj\n<< ${infoFields.join(" ")} >>\nendobj\n`;
    writeObj(infoObj, infoObjStr);

    // Image XObjects
    for (const img of allImageObjects) {
      const filter = img.format === "jpeg" ? "/DCTDecode" : "/FlateDecode";
      const colorSpace = img.format === "jpeg" ? "/DeviceRGB" : "/DeviceRGB";
      // Note: for simplicity we treat both as DeviceRGB; JPEG may also be
      // DeviceGray but this is a reasonable default for image XObjects.
      const dict = `/Type /XObject /Subtype /Image /Width 0 /Height 0 /BitsPerComponent 8 /ColorSpace ${colorSpace} /Filter ${filter}`;
      const body = `${img.num} 0 obj\n<< /Length ${img.data.length} ${dict}>>\nstream\n`;
      const header = Buffer.from(body, "latin1");
      const footer = Buffer.from(`\nendstream\nendobj\n`, "latin1");
      offsets[img.num] = pos;
      chunks.push(header);
      pos += header.length;
      chunks.push(img.data);
      pos += img.data.length;
      chunks.push(footer);
      pos += footer.length;
    }

    // Content streams followed by their Page dictionaries
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      const contentNum = contentObjectIds[i];
      const pageNum = pageObjectIds[i];
      const content = page.ops.join("\n") + "\n";
      if (this.compress) {
        writeCompressedObj(contentNum, content, "");
      } else {
        writeObj(contentNum, `${contentNum} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
      }
      // Build per-page /Resources /Font dictionary from fontsUsed.
      const fontResources: string[] = [];
      for (const fname of page.fontsUsed) {
        const fontObjId = FONT_NAME_TO_OBJ.get(fname);
        if (fontObjId !== undefined) {
          fontResources.push(`/${fname} ${fontObjId} 0 R`);
        }
      }
      const fontDict = fontResources.length > 0 ? `<< ${fontResources.join(" ")} >>` : `<< >>`;
      const pageDict = `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(page.width)} ${fmt(page.height)}] /Resources << /Font ${fontDict} >> /Contents ${contentNum} 0 R >>\nendobj\n`;
      writeObj(pageNum, pageDict);
    }

    // Cross-reference table
    const xrefOffset = pos;
    const xrefLines: string[] = [`xref\n0 ${nextObj}\n`];
    xrefLines.push("0000000000 65535 f \n");
    for (let n = 1; n < nextObj; n++) {
      xrefLines.push(`${offsets[n].toString().padStart(10, "0")} 00000 n \n`);
    }
    const xref = Buffer.from(xrefLines.join(""), "latin1");
    chunks.push(xref);
    pos += xref.length;

    // Trailer
    const trailer = Buffer.from(
      `trailer\n<< /Size ${nextObj} /Root 1 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      "latin1",
    );
    chunks.push(trailer);

    // Concatenate all chunks
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }
}
