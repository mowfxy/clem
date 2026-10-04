/**
 * Builds the sample PDFs the region and crop tests run on, with their ground truth: a textbook page with a vector
 * circuit, a scanned page, a page with an embedded raster figure, and a two-column paper. Each figure's true box is
 * measured, not declared: the page is drawn again with only that figure on it, at 8 pixels per point, and the box is
 * where its ink is. Run: node --experimental-strip-types tests/fixtures/pdf/make.ts
 */
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const FONT_DATA = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts/").replace(/\\/g, "/");
type Box = [number, number, number, number];
type Fonts = { roman: PDFFont; italic: PDFFont; bold: PDFFont; sans: PDFFont; symbol: PDFFont };
/** Draws a page; `only` names the one part to draw (a figure, for measuring it), or null for everything. */
type Painter = (page: PDFPage, f: Fonts, part: (name: string, draw: () => void) => void) => void | Promise<void>;

const PROSE = "The analysis of a network begins with the elements it contains and the way they are joined. Each branch carries a current, and each node has a potential measured against a common reference. Kirchhoff's laws relate these quantities: the currents entering a node sum to zero, and the voltages around any closed loop sum to zero. With Ohm's law for every resistor, these relations give as many independent equations as there are unknowns, so the circuit can be solved completely. In practice the equations are written so that the number of unknowns stays small, either by choosing loop currents or node voltages as the variables. ".repeat(6).split(" ").filter(Boolean);

/** Left-aligned lines of body text filling `lines` lines from `y` down; returns the y under the last line. */
function prose(page: PDFPage, font: PDFFont, x: number, y: number, width: number, lines: number, size = 10, lead = 12.5, from = 0) {
  let at = from;
  for (let n = 0; n < lines; n++) {
    let line = "";
    while (at < PROSE.length && font.widthOfTextAtSize((line + " " + PROSE[at]).trim(), size) <= width) line = (line + " " + PROSE[at++]).trim();
    page.drawText(line, { x, y: y - n * lead, size, font });
  }
  return y - lines * lead;
}

function resistor(page: PDFPage, x0: number, y0: number, x1: number, y1: number) {
  // A zigzag of six teeth between two lead wires.
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, px = -uy, py = ux;
  const lead = (len - 36) / 2;
  const pts: [number, number][] = [[x0, y0], [x0 + ux * lead, y0 + uy * lead]];
  for (let i = 0; i < 6; i++) { const t = lead + 3 + i * 6, s = i % 2 ? -5 : 5; pts.push([x0 + ux * t + px * s, y0 + uy * t + py * s]); }
  pts.push([x0 + ux * (len - lead), y0 + uy * (len - lead)], [x1, y1]);
  for (let i = 1; i < pts.length; i++) page.drawLine({ start: { x: pts[i - 1][0], y: pts[i - 1][1] }, end: { x: pts[i][0], y: pts[i][1] }, thickness: 1.2 });
}
const wire = (page: PDFPage, x0: number, y0: number, x1: number, y1: number) => page.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 1.2 });
const dot = (page: PDFPage, x: number, y: number) => page.drawCircle({ x, y, size: 2.2, color: rgb(0, 0, 0) });

const textbook: Painter = (page, f, part) => {
  part("body", () => {
    page.drawText("2.3  Series and Parallel Combinations", { x: 72, y: 742, size: 9, font: f.italic });
    page.drawText("34", { x: 528, y: 742, size: 9, font: f.roman });
    page.drawLine({ start: { x: 72, y: 736 }, end: { x: 540, y: 736 }, thickness: 0.5 });
    page.drawText("Example 2.4", { x: 72, y: 708, size: 11, font: f.bold });
    prose(page, f.roman, 72, 690, 468, 9);
  });
  part("fig", () => {
    // Source on the left, R1 across the top, R2 and R3 in parallel on the right.
    const L = 200, R = 420, T = 520, B = 400;
    wire(page, L, B, L, 452); wire(page, L, 468, L, T);
    page.drawLine({ start: { x: L - 14, y: 468 }, end: { x: L + 14, y: 468 }, thickness: 1.2 });
    page.drawLine({ start: { x: L - 8, y: 452 }, end: { x: L + 8, y: 452 }, thickness: 2.4 });
    page.drawText("+", { x: L - 26, y: 470, size: 10, font: f.roman });
    page.drawText("Vs = 12 V", { x: L - 72, y: 456, size: 10, font: f.italic });
    resistor(page, L, T, 330, T); wire(page, 330, T, R, T);
    page.drawText("R1 = 4 ", { x: 238, y: T + 12, size: 10, font: f.italic });
    page.drawText("Ω", { x: 238 + f.italic.widthOfTextAtSize("R1 = 4 ", 10), y: T + 12, size: 10, font: f.symbol });
    dot(page, 330, T); dot(page, 330, B);
    resistor(page, 330, T, 330, B);
    page.drawText("R2 = 6 ", { x: 342, y: 456, size: 10, font: f.italic });
    page.drawText("Ω", { x: 342 + f.italic.widthOfTextAtSize("R2 = 6 ", 10), y: 456, size: 10, font: f.symbol });
    resistor(page, R, T, R, B);
    page.drawText("R3 = 12 ", { x: R + 12, y: 456, size: 10, font: f.italic });
    page.drawText("Ω", { x: R + 12 + f.italic.widthOfTextAtSize("R3 = 12 ", 10), y: 456, size: 10, font: f.symbol });
    wire(page, L, B, R, B);
    // The current arrow and its label above the top wire.
    page.drawLine({ start: { x: 352, y: T + 8 }, end: { x: 384, y: T + 8 }, thickness: 0.8 });
    page.drawSvgPath("M 0 0 L -6 3 L -6 -3 Z", { x: 388, y: T + 8, color: rgb(0, 0, 0) });
    page.drawText("I", { x: 366, y: T + 12, size: 10, font: f.italic });
    page.drawText("a", { x: 326, y: T + 8, size: 10, font: f.italic });
    page.drawText("b", { x: 326, y: B - 14, size: 10, font: f.italic });
  });
  part("caption", () => {
    page.drawText("Figure 2.4  A series–parallel circuit. The source drives R1 in series with the parallel", { x: 112, y: 362, size: 9, font: f.roman });
    page.drawText("pair R2 and R3; the current I divides at node a.", { x: 112, y: 351, size: 9, font: f.roman });
  });
  part("body", () => {
    const y = prose(page, f.roman, 72, 320, 468, 4, 10, 12.5, 160);
    page.drawText("Veq = R1 + R2 R3 / (R2 + R3)", { x: 230, y: y - 14, size: 11, font: f.italic });
    page.drawText("(2.3)", { x: 515, y: y - 14, size: 10, font: f.roman });
    prose(page, f.roman, 72, y - 44, 468, 8, 10, 12.5, 220);
  });
};

/** A bar chart with a wide white margin round it, as an exported figure often has. */
export function chartPng() {
  const c = createCanvas(900, 600), ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 900, 600);
  ctx.strokeStyle = "#222"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(110, 70); ctx.lineTo(110, 500); ctx.lineTo(820, 500); ctx.stroke();
  const bars = [210, 330, 280, 400, 360];
  bars.forEach((h, i) => { ctx.fillStyle = ["#3b6fb6", "#d1495b", "#edae49", "#00798c", "#66a182"][i]; ctx.fillRect(150 + i * 130, 500 - h, 80, h); });
  ctx.fillStyle = "#222"; ctx.font = "26px sans-serif";
  ["2019", "2020", "2021", "2022", "2023"].forEach((t, i) => ctx.fillText(t, 160 + i * 130, 535));
  [0, 100, 200, 300, 400].forEach((v) => ctx.fillText(String(v), 50, 508 - v));
  return c.toBuffer("image/png");
}

const rasterFigure: Painter = async (page, f, part) => {
  part("body", () => { page.drawText("Results", { x: 72, y: 730, size: 13, font: f.bold }); prose(page, f.roman, 72, 710, 468, 14, 10, 12.5, 30); });
  const png = await page.doc.embedPng(chartPng());
  part("fig", () => {
    page.drawImage(png, { x: 156, y: 300, width: 300, height: 200 });
    // The axis title is text in the PDF, beside the picture, turned on its side.
    page.drawText("Enrolment", { x: 166, y: 362, size: 9, font: f.sans, rotate: degrees(90) });
  });
  part("caption", () => page.drawText("Fig. 3. Enrolment by year, 2019–2023.", { x: 230, y: 282, size: 9, font: f.roman }));
  part("body", () => prose(page, f.roman, 72, 250, 468, 12, 10, 12.5, 200));
};

const twoColumn: Painter = (page, f, part) => {
  const colW = 222, left = 72, right = 318;
  part("body", () => {
    page.drawText("Loop and Node Methods for Linear Networks", { x: 140, y: 740, size: 15, font: f.bold });
    page.drawText("A. Author and B. Author", { x: 245, y: 720, size: 10, font: f.roman });
    prose(page, f.roman, left, 690, colW, 8, 9, 11, 0);
    prose(page, f.roman, right, 690, colW, 3, 9, 11, 120);
    prose(page, f.roman, left, 418, colW, 5, 9, 11, 200);
    prose(page, f.roman, right, 418, colW, 1, 9, 11, 260);
  });
  part("fig1", () => {
    // A plotted response in the left column: axes, ticks, a curve of many short segments, labels.
    const x0 = 100, y0 = 470, w = 170, h = 110;
    wire(page, x0, y0, x0 + w, y0); wire(page, x0, y0, x0, y0 + h);
    for (let i = 0; i <= 4; i++) { page.drawLine({ start: { x: x0 + (i * w) / 4, y: y0 }, end: { x: x0 + (i * w) / 4, y: y0 - 3 }, thickness: 0.6 }); page.drawText(String(i), { x: x0 + (i * w) / 4 - 2, y: y0 - 12, size: 7, font: f.sans }); }
    for (let i = 1; i <= 2; i++) page.drawText(String(i * 0.5), { x: x0 - 14, y: y0 + (i * h) / 2 - 2, size: 7, font: f.sans });
    let px = x0, py = y0;
    for (let i = 1; i <= 60; i++) { const t = i / 60, nx = x0 + t * w, ny = y0 + h * (1 - Math.exp(-4 * t)) * 0.95; page.drawLine({ start: { x: px, y: py }, end: { x: nx, y: ny }, thickness: 1 }); px = nx; py = ny; }
    page.drawText("t (ms)", { x: x0 + w - 20, y: y0 - 22, size: 7, font: f.italic });
    page.drawText("v(t)", { x: x0 - 8, y: y0 + h + 6, size: 7, font: f.italic });
  });
  part("caption1", () => page.drawText("Fig. 1. Step response of the RC network.", { x: 96, y: 432, size: 8, font: f.roman }));
  part("fig2", () => {
    // A block diagram in the right column: three boxes joined by arrows, a label in each.
    const y = 600;
    [["Source", 322], ["Filter", 400], ["Load", 478]].forEach(([name, x]) => {
      page.drawRectangle({ x: Number(x), y, width: 58, height: 26, borderWidth: 1, borderColor: rgb(0, 0, 0) });
      page.drawText(String(name), { x: Number(x) + 10, y: y + 9, size: 8, font: f.sans });
    });
    [[380, 400], [458, 478]].forEach(([a, b]) => { wire(page, a, y + 13, b - 5, y + 13); page.drawSvgPath("M 0 0 L -5 2.5 L -5 -2.5 Z", { x: b, y: y + 13, color: rgb(0, 0, 0) }); });
  });
  part("caption2", () => page.drawText("Fig. 2. Signal path of the measurement.", { x: 350, y: 585, size: 8, font: f.roman }));
  part("tablecap", () => page.drawText("TABLE I  Element values", { x: 384, y: 552, size: 8, font: f.roman }));
  part("table", () => {
    page.drawLine({ start: { x: right + 20, y: 544 }, end: { x: right + 200, y: 544 }, thickness: 0.8 });
    page.drawLine({ start: { x: right + 20, y: 528 }, end: { x: right + 200, y: 528 }, thickness: 0.5 });
    page.drawLine({ start: { x: right + 20, y: 480 }, end: { x: right + 200, y: 480 }, thickness: 0.8 });
    [["Element", "Value", "Tolerance"], ["R1", "4.7 k", "1 %"], ["R2", "10 k", "1 %"], ["C1", "100 n", "5 %"]].forEach((row, r) => row.forEach((cell, c) => page.drawText(cell, { x: right + 26 + c * 62, y: 533 - r * 15 - (r ? 3 : 0), size: 8, font: r ? f.roman : f.bold })));
  });
  part("fig3", () => {
    // A figure across both columns: a row of filled squares with numbers under them.
    for (let i = 0; i < 8; i++) { page.drawRectangle({ x: 92 + i * 56, y: 200, width: 36, height: 36, color: rgb(0.2 + i * 0.08, 0.3, 0.6 - i * 0.05) }); page.drawText(String(i + 1), { x: 107 + i * 56, y: 188, size: 8, font: f.sans }); }
  });
  part("caption3", () => page.drawText("Fig. 3. The eight test configurations, left to right.", { x: 220, y: 168, size: 8, font: f.roman }));
  part("body", () => { prose(page, f.roman, left, 140, colW, 6, 9, 11, 300); prose(page, f.roman, right, 140, colW, 6, 9, 11, 340); });
};

async function build(paint: Painter, only: string | null) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0)); doc.setProducer("mowr-fixture");
  const page = doc.addPage([612, 792]);
  const fonts = { roman: await doc.embedFont(StandardFonts.TimesRoman), italic: await doc.embedFont(StandardFonts.TimesRomanItalic), bold: await doc.embedFont(StandardFonts.TimesRomanBold), sans: await doc.embedFont(StandardFonts.Helvetica), symbol: await doc.embedFont(StandardFonts.Symbol) };
  await paint(page, fonts, (name, draw) => { if (only === null || only === name) draw(); });
  return doc.save({ useObjectStreams: false });
}

/** Where the ink of a one-figure page is, in points, measured at 8 pixels per point. */
export async function inkBox(bytes: Uint8Array, scale = 8): Promise<Box> {
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONT_DATA, verbosity: 0 }).promise;
  const page = await pdf.getPage(1), vp = page.getViewport({ scale });
  const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height)), ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx as any, viewport: vp, canvas: c as any }).promise;
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (px[i] < 230 || px[i + 1] < 230 || px[i + 2] < 230) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); } }
  await pdf.loadingTask.destroy();
  const r = (v: number) => Math.round(v * 100) / 100;
  return [r(x0 / scale), r(792 - y1 / scale), r(x1 / scale), r(792 - y0 / scale)];
}

/** A textbook page photographed onto grey paper: one JPEG covering the page, no text layer. */
async function scanned() {
  const scale = 150 / 72, c = createCanvas(Math.round(612 * scale), Math.round(792 * scale)), ctx = c.getContext("2d");
  ctx.fillStyle = "#f2efe6"; ctx.fillRect(0, 0, c.width, c.height);
  // Speckle, as a scanner leaves.
  let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1500; i++) { ctx.fillStyle = `rgba(80,80,80,${0.2 + rand() * 0.3})`; ctx.fillRect(rand() * c.width, rand() * c.height, 1.5, 1.5); }
  ctx.fillStyle = "#1c1c1c"; ctx.font = `${Math.round(10 * scale)}px serif`;
  const text = (lines: number, y: number) => { for (let n = 0; n < lines; n++) ctx.fillText(PROSE.slice(n * 13, n * 13 + 13).join(" ").slice(0, 92), 72 * scale, (y + n * 12.5) * scale); };
  text(16, 90);
  // The figure: a sine wave with axes and two labels, drawn in points from the top.
  const fig = (draw: typeof ctx) => {
    draw.strokeStyle = "#1c1c1c"; draw.fillStyle = "#1c1c1c"; draw.lineWidth = 1.4 * scale;
    draw.beginPath(); draw.moveTo(170 * scale, 420 * scale); draw.lineTo(170 * scale, 300 * scale); draw.moveTo(170 * scale, 360 * scale); draw.lineTo(450 * scale, 360 * scale); draw.stroke();
    draw.beginPath(); for (let i = 0; i <= 200; i++) { const x = 170 + i * 1.4, y = 360 - 45 * Math.sin(i / 16); if (i) draw.lineTo(x * scale, y * scale); else draw.moveTo(x * scale, y * scale); } draw.stroke();
    draw.font = `italic ${Math.round(10 * scale)}px serif`; draw.fillText("x(t)", 140 * scale, 304 * scale); draw.fillText("t", 455 * scale, 364 * scale);
  };
  fig(ctx);
  ctx.font = `${Math.round(9 * scale)}px serif`; ctx.fillText("Figure 1.2  A sampled sinusoid.", 230 * scale, 440 * scale);
  ctx.font = `${Math.round(10 * scale)}px serif`;
  text(20, 470);
  // Ground truth from the figure alone on white.
  const t = createCanvas(c.width, c.height), tctx = t.getContext("2d");
  tctx.fillStyle = "#fff"; tctx.fillRect(0, 0, t.width, t.height); fig(tctx);
  const px = tctx.getImageData(0, 0, t.width, t.height).data;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) if (px[(y * t.width + x) * 4] < 230) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0)); doc.setProducer("mowr-fixture");
  const page = doc.addPage([612, 792]);
  page.drawImage(await doc.embedJpg(c.toBuffer("image/jpeg", 88)), { x: 0, y: 0, width: 612, height: 792 });
  const r = (v: number) => Math.round(v * 100) / 100;
  return { bytes: await doc.save({ useObjectStreams: false }), truth: { fig: [r(x0 / scale), r(792 - y1 / scale), r(x1 / scale), r(792 - y0 / scale)] as Box } };
}

export const FIXTURES: Record<string, { paint: Painter; figures: Record<string, { parts: string[]; kind: string; caption?: string }> }> = {
  "textbook-circuit.pdf": { paint: textbook, figures: { fig: { parts: ["fig"], kind: "figure", caption: "Figure 2.4" } } },
  "raster-figure.pdf": { paint: rasterFigure, figures: { fig: { parts: ["fig"], kind: "image", caption: "Fig. 3." } } },
  "two-column.pdf": { paint: twoColumn, figures: { fig1: { parts: ["fig1"], kind: "figure", caption: "Fig. 1." }, fig2: { parts: ["fig2"], kind: "figure", caption: "Fig. 2." }, table: { parts: ["table"], kind: "table", caption: "TABLE I" }, fig3: { parts: ["fig3"], kind: "figure", caption: "Fig. 3." } } },
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const truth: Record<string, unknown> = {};
  for (const [name, { paint, figures }] of Object.entries(FIXTURES)) {
    await writeFile(join(here, name), await build(paint, null));
    const boxes: Record<string, unknown> = {};
    for (const [id, f] of Object.entries(figures)) boxes[id] = { ...f, box: await inkBox(await build(paint, f.parts[0])) };
    truth[name] = boxes;
  }
  const scan = await scanned();
  await writeFile(join(here, "scanned-page.pdf"), scan.bytes);
  truth["scanned-page.pdf"] = { fig: { parts: ["fig"], kind: "region", box: scan.truth.fig } };
  await writeFile(join(here, "truth.json"), JSON.stringify(truth, null, 1) + "\n");
  console.log(JSON.stringify(truth, null, 1));
}
