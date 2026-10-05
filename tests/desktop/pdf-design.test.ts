import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { designDocument } from "../../desktop/pdf-design.ts";
import { documentHtml, cropPlacement, designProblems, withDesign, layoutFor } from "../../desktop/pdf-document.ts";
import { assetSvg, assetOf, type CropAsset } from "../../desktop/pdf-assets.ts";
import { fitCrop, textColumn, editPdf } from "../../desktop/pdf-edit-tools.ts";
import { opticalCentre } from "../../core/pdf-regions.ts";

const sections = [{ heading: "Background", text: "Text." }, { heading: "Method", text: "Text." }];
const spec = (over: any = {}) => ({ title: "Photosynthesis in C4 plants", kind: "notes", sections, ...over });

test("documents on different subjects get different designs, each within its genre, and the same document always the same", () => {
  const a = designDocument(spec(), "notes"), b = designDocument(spec({ title: "Interest rates and bank lending" }), "notes");
  assert.deepEqual(designDocument(spec(), "notes"), a, "deterministic");
  assert.notEqual(a.design.accent, b.design.accent, "the subject sets the colour");
  // A plant subject leans green, a banking one blue.
  const hue = (hex: string) => { const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return g > r && g > bl ? "green" : bl > r && bl >= g ? "blue" : "other"; };
  assert.equal(hue(a.design.accent), "green");
  assert.equal(hue(b.design.accent), "blue");
  // Across many titles a genre uses more than one pairing, title block and heading style.
  const many = Array.from({ length: 40 }, (_, i) => designDocument(spec({ title: "Topic " + i }), "business"));
  for (const key of ["font", "titleStyle", "headingStyle"] as const) assert.ok(new Set(many.map((d) => key === "font" ? d.font : d.design[key])).size > 1, key + " varies");
  for (const d of many) assert.ok(["bar", "band", "plain", "rule"].includes(d.design.titleStyle));
  // Margins give a sensible line and stay within 20–28 mm.
  for (const d of many) assert.ok(d.design.margin! >= 20 && d.design.margin! <= 28);
  // Every derived design passes the design checks.
  for (const d of many) assert.deepEqual(designProblems(d.design), []);
});

test("what the person set wins, field by field; a chosen colour shows in the headings", () => {
  const d = designDocument(spec({ font: "Garamond", design: { accent: "#aa0000", columns: 2 } }), "notes");
  assert.equal(d.font, "Garamond");
  assert.equal(d.headingFont, "Garamond");
  assert.equal(d.design.accent, "#aa0000");
  assert.equal(d.design.headingStyle, "accent");
  assert.equal(d.design.margin, 18, "two columns get the narrow margin");
  // Mowr's own fonts never reach a document.
  assert.notEqual(designDocument(spec({ font: "Mowafy Serif" }), "notes").font, "Mowafy Serif");
  // Young readers get a friendly sans, larger.
  const kids = designDocument(spec({ title: "Plants for kids", kind: "handout" }), "notes");
  assert.match(kids.font, /Segoe|Trebuchet|Verdana|Candara/);
  assert.ok(kids.design.fontSize! >= 12);
  // Storing the result keeps the look: designing again changes nothing.
  const stored = withDesign(spec());
  assert.deepEqual(withDesign(stored), stored);
});

test("the page carries the title and heading styles; an unsuitable title style falls back to the genre's own", () => {
  const html = documentHtml(spec({ design: { titleStyle: "band", headingStyle: "bar" } }) as any, []);
  assert.match(html, /<body class="[^"]*\bt-band\b[^"]*\bh-bar\b/);
  const technical = documentHtml({ title: "T", kind: "report", sections, design: { titleStyle: "band" } } as any, []);
  assert.match(technical, /\bt-ruled\b/);
  assert.equal(layoutFor({ kind: "letter" }), "letter");
  assert.doesNotMatch(documentHtml({ title: "T", kind: "letter", sections } as any, []), /<body class="[^"]*\bt-\w+/);
  assert.deepEqual(designProblems({ titleStyle: "wavy" }), ["design.titleStyle must be one of ruled, center, left, rule, bar, band, plain."]);
});

test("the optical centre is the drawing's, not its box's: a thin label to one side does not move it", () => {
  const w = 200, h = 100, grey = new Uint8Array(w * h).fill(255);
  // A solid drawing from x 20 to 140, and a thin label far to the right at x 185–195.
  for (let y = 10; y < 90; y++) for (let x = 20; x < 140; x++) grey[y * w + x] = 0;
  for (let y = 45; y < 55; y++) for (let x = 185; x < 195; x++) grey[y * w + x] = 0;
  const c = opticalCentre(grey, w, h);
  assert.ok(Math.abs(c - 0.4) < 0.03, `centre ${c}`);
  assert.equal(opticalCentre(new Uint8Array(w * h).fill(255), w, h), 0.5);
});

test("crops print at their source size, small ones enlarged, large ones fitted, with the drawing on the column's centre", () => {
  const column = 600;
  assert.equal(cropPlacement({ width: 400, height: 200, units: "pt" }, { column }).width, 400);
  assert.equal(cropPlacement({ width: 100, height: 50, units: "pt" }, { column }).width, 150, "at most 1.5×");
  assert.equal(cropPlacement({ width: 200, height: 100, units: "pt" }, { column }).width, 270, "towards 45% of the column");
  assert.equal(cropPlacement({ width: 200, height: 100, units: "px" }, { column }).width, 200, "pictures are not enlarged");
  assert.equal(cropPlacement({ width: 900, height: 300, units: "pt" }, { column }).width, 600);
  assert.ok(cropPlacement({ width: 400, height: 1200, units: "pt" }, { column }).width < 170, "tall crops fit 130 mm");
  assert.equal(cropPlacement({ width: 400, height: 200 }, { column, share: 0.5 }).width, 300);
  // Drawing left of the crop's middle: the box moves right by (0.5 − 0.4) × width.
  assert.equal(cropPlacement({ width: 400, height: 200, centre: 0.4 }, { column }).left, "clamp(0px, calc(50% - 160px), max(0px, calc(100% - 400px)))");
  assert.equal(cropPlacement({ width: 400, height: 200, centre: 0.1 }, { column }).left, "clamp(0px, calc(50% - 152px), max(0px, calc(100% - 400px)))", "at most 12%");
  assert.equal(cropPlacement({ width: 400, height: 200, centre: 0.4 }, { column, align: "box" }).left, "clamp(0px, calc(50% - 200px), max(0px, calc(100% - 400px)))");
  assert.equal(cropPlacement({ width: 400, height: 200 }, { column, align: "left" }).left, "0px");
});

test("a crop's units and optical centre travel with its drawing into the page", () => {
  const meta: CropAsset = { id: "crop-0000aaaa", file: "a.pdf", page: 1, box: [0, 0, 150, 75], units: "pt", width: 600, height: 300, vector: false, centre: 0.42, created: 0 };
  const svg = assetSvg(meta, new Uint8Array([137, 80, 78, 71]));
  assert.deepEqual({ units: assetOf(svg)!.units, centre: assetOf(svg)!.centre }, { units: "pt", centre: 0.42 });
  const html = documentHtml({ title: "T", kind: "report", sections: [{ heading: "A", text: "x", figure: { asset: meta.id, svg, width: 0.5 } as any }] } as any, [svg]);
  assert.match(html, /<a class="asset-slot" style="width:[\d.]+px;margin-left:clamp\([^"]+\);margin-right:0" href="https:\/\/asset\.mowr\.invalid\/crop-0000aaaa\/1\/p">/);
});

test("placing a crop in a PDF: on the page's text column, refused over text, and replace centres the drawing", async () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ str: "A line of body text", x: 72, y: 700 - i * 14, width: 451, size: 10 }));
  assert.deepEqual(textColumn(items), [72, 523]);
  assert.equal(textColumn(items.slice(0, 2)), undefined);
  const meta = { box: [0, 0, 200, 100] as [number, number, number, number], units: "pt" as const, centre: 0.5 };
  // An area across the whole page: the crop goes on the column's centre (297.5), not the page's.
  const at = fitCrop(meta, [0, 100, 612, 400], [72, 523]);
  assert.equal(Math.round(at.x + at.width / 2), 298);
  assert.ok(Math.abs(at.width - 0.45 * 451) < 1);
  // Its drawing left of the middle moves it right.
  assert.ok(fitCrop({ ...meta, centre: 0.4 }, [0, 100, 612, 400], [72, 523]).x > at.x);
  // In a narrow area beside the text, it is centred in the area and never leaves it.
  const side = fitCrop(meta, [400, 100, 560, 400], [72, 523]);
  assert.ok(side.x >= 400 && side.x + side.width <= 560);
  // The real edit: refused over text, placed on empty paper.
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([612, 792]);
  for (let i = 0; i < 10; i++) p.drawText("A line of body text that runs on", { x: 72, y: 700 - i * 14, size: 10, font: f });
  const crop = await PDFDocument.create();
  crop.addPage([200, 100]).drawRectangle({ x: 10, y: 10, width: 180, height: 80 });
  const asset = { meta: { id: "crop-0000aaaa", file: "a.pdf", page: 1, box: [0, 0, 200, 100], units: "pt", width: 800, height: 400, vector: true, created: 0, caption: "Figure 3: A network." } as CropAsset, png: new Uint8Array(), pdf: await crop.save() };
  const { open } = await import("./pdf-kit.ts");
  const h: any = {
    load: async () => ({ bytes: await doc.save(), source: "src-1", name: "a.pdf" }),
    words: async (bytes: Uint8Array, page: number) => { const pdf = await open(bytes); try { return ((await (await pdf.getPage(page)).getTextContent()).items as any[]).filter((i) => i.str).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], width: i.width, size: 10 })); } finally { await pdf.loadingTask.destroy(); } },
    crop: async () => asset,
  };
  await assert.rejects(editPdf({ file: "a.pdf", ops: [{ op: "place", page: 1, asset: "crop-0000aaaa", bbox: [0, 600, 612, 720] }] }, h), /would cover text/);
  const r = await editPdf({ file: "a.pdf", ops: [{ op: "place", page: 1, asset: "crop-0000aaaa", bbox: [0, 100, 612, 500], caption: true }] }, h);
  assert.match(r.done[0], /placed crop-0000aaaa on page 1 .* centred on the text, captioned/);
});

test("placement is a layout decision: small figures beside enough text, larger ones in the column, and any choice honoured", async () => {
  const { figureLayout } = await import("../../desktop/pdf-document.ts");
  assert.equal(figureLayout(250, 600, { words: 200 }), "wrap-right");
  assert.equal(figureLayout(250, 600, { words: 40 }), "center", "too little text to run beside it");
  assert.equal(figureLayout(400, 600, { words: 400 }), "center", "too wide to sit beside the text");
  assert.equal(figureLayout(250, 600, { words: 400, columns: 2 }), "center");
  assert.equal(figureLayout(250, 600, { words: 400, layout: "letter" }), "center");
  const meta: CropAsset = { id: "crop-0000aaaa", file: "a.pdf", page: 1, box: [0, 0, 150, 75], units: "pt", width: 200, height: 100, vector: true, created: 0 };
  const svg = assetSvg(meta, new Uint8Array([137, 80, 78, 71]));
  const long = Array.from({ length: 150 }, () => "word").join(" ");
  const html = (figure: any, text = long) => documentHtml({ title: "T", kind: "notes", sections: [{ heading: "A", text, figure: { asset: meta.id, svg, ...figure } }] } as any, [svg]);
  // Beside the text: the figure comes before the text, floated; the section contains it.
  assert.match(html({}), /<section class="unnumbered has-wrap"><h2[^>]*>.*?<\/h2><figure id="fig-1" class="align-wrap-right">/);
  assert.match(html({ align: "wrap-left" }), /class="align-wrap-left"/);
  // In the column, after the text.
  assert.match(html({}, "Short."), /<p>Short\.<\/p><figure id="fig-1"><a class="asset-slot"/);
  assert.match(html({ align: "right" }), /<figure id="fig-1" class="align-right">/);
  // A drawing (not a crop) is marked too, so its page can be shown.
  const drawn = documentHtml({ title: "T", sections: [{ text: "x", figure: { module: "m", fn: "f", args: [] } }] } as any, ['<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"></svg>']);
  assert.match(drawn, /<a class="figure-slot" style="" href="https:\/\/asset\.mowr\.invalid\/figure\/1\/p"><img/);
});

test("the pages shown for figures: where each printed, and the page before when one starts a page", async () => {
  const { figurePages } = await import("../../desktop/pdf-assets.ts");
  const spot = (page: number, top: number) => ({ id: "figure", figure: 1, page, rect: [80, top - 200, 500, top] as [number, number, number, number], sheet: [595, 842] as [number, number] });
  assert.deepEqual(figurePages([spot(3, 500)]), [3]);
  assert.deepEqual(figurePages([spot(3, 770), spot(5, 400)]), [2, 3, 5]);
  assert.deepEqual(figurePages([spot(1, 770)]), [1]);
});
