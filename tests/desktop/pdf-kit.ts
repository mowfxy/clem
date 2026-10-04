/** pdf.js and a canvas in Node, for the region and crop tests (the window uses its own). */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFile } from "node:fs/promises";
import type { CanvasKit } from "../../core/pdf-page.ts";
import { FONT_DATA } from "../fixtures/pdf/make.ts";

export const kit: CanvasKit = {
  create: (w, h) => createCanvas(w, h) as any,
  encode: async (c: any, type, quality) => new Uint8Array(type === "image/png" ? c.toBuffer("image/png") : c.toBuffer("image/jpeg", Math.round((quality ?? 0.9) * 100))),
  picture: async (bytes) => { const img = await loadImage(Buffer.from(bytes)); const c = createCanvas(img.width, img.height); c.getContext("2d").drawImage(img, 0, 0); return c as any; },
};
export const lib = pdfjs;
export const fixture = (name: string) => readFile(new URL("../fixtures/pdf/" + name, import.meta.url));
export const open = async (bytes: Uint8Array) => pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: FONT_DATA, verbosity: 0 }).promise;
