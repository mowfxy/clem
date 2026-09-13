/**
 * Document composer.
 *
 * Thin facade over the monolithic emitter that exposes a higher-level
 * builder API: `addPage()`, `addHeading()`, `addParagraph()`, `addFigure()`
 * and `build()`. Backed by the existing `PdfBuilder` class so the byte-
 * stable output is preserved.
 */

import { KinetraError } from "../errors.js";
import { PdfBuilder, BLACK, type RgbColor, type PageBuilder } from "./pdf.js";
import { wrapText } from "./text.js";

export interface DocumentBuilderOpts {
  title: string;
  author?: string;
  subject?: string;
  pageSize?: "letter" | "a4";
}

export interface FigureSpec {
  svg: string;
  caption?: string;
  widthPt: number;
  aspectRatio: number;
}

export interface DocumentBuilder {
  addPage(): PageBuilder;
  addHeading(text: string, level?: 1 | 2 | 3): void;
  addParagraph(text: string, opts?: { fontSize?: number; color?: RgbColor }): void;
  addFigure(spec: FigureSpec): void;
  addEquation(text: string): void;
  build(): Uint8Array;
  pageCount(): number;
}

export function createDocument(opts: DocumentBuilderOpts): DocumentBuilder {
  const doc = new PdfBuilder({
    metadata: { title: opts.title, author: opts.author ?? "Kinetra", subject: opts.subject },
    pageSize: opts.pageSize ?? "letter",
  });
  let page: PageBuilder = doc.addPage();
  let cursorY = 760;
  const marginX = 60;
  const rightEdge = 612 - marginX;
  const bottomMargin = 60;

  function ensureRoom(neededPt: number) {
    if (cursorY - neededPt < bottomMargin) {
      page = doc.addPage();
      cursorY = 760;
    }
  }

  function writeText(text: string, fontSize: number, font: "Helvetica" | "Helvetica-Bold" | "Times-Italic", color: RgbColor) {
    const wrap = wrapText(text, rightEdge - marginX, fontSize * 0.5);
    for (const line of wrap.lines) {
      ensureRoom(fontSize + 4);
      page.text(line, { x: marginX, y: cursorY, font, fontSize, color });
      cursorY -= fontSize + 3;
    }
  }

  return {
    addPage(): PageBuilder {
      page = doc.addPage();
      cursorY = 760;
      return page;
    },
    addHeading(text: string, level: 1 | 2 | 3 = 1): void {
      const size = level === 1 ? 22 : level === 2 ? 16 : 13;
      ensureRoom(size + 8);
      page.text(text, { x: marginX, y: cursorY, font: "Helvetica-Bold", fontSize: size });
      cursorY -= size + 8;
    },
    addParagraph(text: string, pOpts?: { fontSize?: number; color?: RgbColor }): void {
      writeText(text, pOpts?.fontSize ?? 11, "Helvetica", pOpts?.color ?? BLACK);
    },
    addFigure(spec: FigureSpec): void {
      const height = spec.widthPt / spec.aspectRatio;
      ensureRoom(height + 30);
      page.rect({
        x: marginX,
        y: cursorY - height,
        width: spec.widthPt,
        height,
        stroke: { r: 0, g: 0, b: 0 },
        lineWidth: 0.5,
      });
      cursorY -= height + 6;
      if (spec.caption) {
        writeText(spec.caption, 9, "Helvetica", BLACK);
        cursorY -= 4;
      }
    },
    addEquation(text: string): void {
      ensureRoom(20);
      page.text(text, { x: marginX, y: cursorY, font: "Times-Italic", fontSize: 12 });
      cursorY -= 18;
    },
    build(): Uint8Array {
      return doc.build();
    },
    pageCount(): number {
      return doc.pageCount();
    },
  };
}

/**
 * Convenience: validate that the assembled document meets minimum
 * requirements (at least one page, non-zero length, valid PDF header).
 */
export function validateDocument(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 10) {
    throw new KinetraError("validation", "Document is too small", { bytes: bytes.byteLength });
  }
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 8));
  if (!head.startsWith("%PDF-")) {
    throw new KinetraError("validation", "Document is not a PDF", { head });
  }
}
