import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { kit, lib, fixture, open } from "./pdf-kit.ts";
import { analysePage, settlePdfCrop } from "../../core/pdf-page.ts";
import { SLOT, vectorCrop, type CropAsset } from "../../desktop/pdf-assets.ts";

/** Where a run of text sits on page 1 of a PDF. */
async function find(bytes: Uint8Array, text: string) {
  const pdf = await open(bytes);
  try {
    const items = (await (await pdf.getPage(1)).getTextContent()).items as any[];
    const item = items.find((i) => i.str.includes(text));
    return item ? { x: item.transform[4] as number, y: item.transform[5] as number } : undefined;
  } finally {
    await pdf.loadingTask.destroy();
  }
}
async function pageInfo(bytes: Uint8Array) {
  const pdf = await open(bytes);
  try {
    const page = await pdf.getPage(1);
    const [ops, text, annots] = await Promise.all([page.getOperatorList(), page.getTextContent(), page.getAnnotations()]);
    return { ops: ops.fnArray as number[], text: (text.items as any[]).map((i) => i.str).join(" ").replace(/\s+/g, " "), links: annots.map((a: any) => a.url || "").filter((u: string) => u.startsWith(SLOT)) };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/**
 * Crops reused in files Mowr makes, end to end in Electron (scripts/verify/pdf-crops.ts): the circuit cut from the
 * textbook page goes into a PDF as vectors, exactly where its placeholder printed and at its own proportions, with its
 * caption and source; into Word and PowerPoint as the very PNG that was cut; and a crop whose vector copy is missing
 * still prints, as its PNG.
 */
test("a crop is a figure in PDFs (as vectors), Word documents and decks (as its PNG)", { timeout: 600_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "mowr-crops-"));
  const source = new Uint8Array(await fixture("textbook-circuit.pdf"));
  const pdf = await open(source);
  const a = await analysePage(lib, pdf, 1, kit);
  const figure = a.regions.find((r) => r.kind === "figure")!;
  const settled = await settlePdfCrop(pdf, 1, figure.box, { pad: 3, dpi: 200 }, kit);
  await pdf.loadingTask.destroy();
  const vector = (await vectorCrop(source, 1, settled.box))!;
  const meta = (id: string): CropAsset => ({ id, file: "textbook-circuit.pdf", page: 1, box: settled.box, units: "pt", width: settled.width, height: settled.height, dpi: 200, vector: true, caption: figure.caption, created: 0 });
  writeFileSync(join(dir, "crop-0000aaaa-meta"), JSON.stringify(meta("crop-0000aaaa")));
  writeFileSync(join(dir, "crop-0000aaaa-png"), settled.png);
  writeFileSync(join(dir, "crop-0000aaaa-pdf"), vector);
  // Its vector copy is gone: the PDF maker must fall back to the PNG.
  writeFileSync(join(dir, "crop-0000bbbb-meta"), JSON.stringify(meta("crop-0000bbbb")));
  writeFileSync(join(dir, "crop-0000bbbb-png"), settled.png);
  const doc = (id: string) => ({ kind: "report", title: "Series and parallel resistors", sections: [{ heading: "The circuit", text: "The network below combines a series resistor with a parallel pair.", figure: { asset: id, source: true } }, { heading: "Analysis", text: "The equivalent resistance follows from the series and parallel rules." }] });
  const deck = { title: "Resistor networks", slides: [{ layout: "title" }, { layout: "figure", title: "The circuit", figure: { asset: "crop-0000aaaa", source: "Textbook, chapter 2" } }, { layout: "closing", title: "Questions" }] };
  writeFileSync(join(dir, "jobs.json"), JSON.stringify([["pdf", "report.pdf", doc("crop-0000aaaa")], ["pdf", "fallback.pdf", doc("crop-0000bbbb")], ["docx", "report.docx", doc("crop-0000aaaa")], ["pptx", "deck.pptx", deck], ["pdf", "missing.pdf", doc("crop-0000cccc")], ["editpdf", "edited.pdf", { file: "report.pdf", ops: [{ op: "stamp", text: "DRAFT" }, { op: "crops", assets: ["crop-0000aaaa"] }] }], ["editpdf", "translated.pdf", { file: "report.pdf", ops: [{ op: "replace", page: 1, bbox: [60, 150, 540, 200], text: "تحليل الشبكة يبدأ بالعناصر التي تحتويها", background: "white" }] }]]));
  const run = spawnSync(process.execPath, ["scripts/verify/pdf-crops.mjs", dir], { encoding: "utf8", timeout: 600_000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  for (const name of ["report.pdf", "fallback.pdf", "report.docx", "deck.pptx"]) assert.match(run.stdout, new RegExp(`ok ${name.replace(".", "\\.")}`), run.stdout);
  // An edit of a PDF Mowr just made: a new file named after it, with its edits listed and its source kept as a copy.
  const edited = JSON.parse(/ok edited\.pdf \d+ (.*)/.exec(run.stdout)![1]);
  assert.equal(edited.name, "report (edited).pdf");
  assert.equal(edited.info.pages, 2);
  assert.deepEqual(edited.info.changedPages, [1, 2]);
  assert.match(edited.spec.source, /^src-/);
  // A translation in another script, typeset by Chromium and placed where the original was, readable as text.
  assert.match(run.stdout, /ok translated\.pdf/, run.stdout);
  // Chromium writes Arabic as its shaped letter forms in visual order: folded back, the words read right to left.
  const arabic = (await pageInfo(new Uint8Array(readFileSync(join(dir, "translated.pdf"))))).text.normalize("NFKC").replace(/\s+/g, "");
  assert.ok(arabic.includes([..."الشبكة"].reverse().join("")), arabic);
  // An id that is no crop is reported, and nothing is made.
  assert.match(run.stdout, /FAIL missing\.pdf .*no crop "crop-0000cccc"/);

  const report = new Uint8Array(readFileSync(join(dir, "report.pdf")));
  const info = await pageInfo(report);
  // Vectors: the circuit's labels are text in the document, drawn from a placed page, not a picture.
  assert.match(info.text, /R1 = 4/);
  assert.match(info.text, /Vs = 12 V/);
  assert.ok(info.ops.includes(lib.OPS.paintFormXObjectBegin));
  assert.ok(!info.ops.includes(lib.OPS.paintImageXObject), "no picture of the crop underneath");
  assert.deepEqual(info.links, [], "the placeholder links are gone");
  assert.match(info.text, /Figure 1: A series–parallel circuit\. .*Source: textbook-circuit\.pdf, p\. 1\./);
  // Its own proportions: label positions keep the same ratio across and down as in the crop.
  const [c1, c3, cV] = await Promise.all(["R1 = 4", "R3 = 12", "Vs = 12 V"].map((t) => find(vector, t)));
  const [o1, o3, oV] = await Promise.all(["R1 = 4", "R3 = 12", "Vs = 12 V"].map((t) => find(report, t)));
  const sx = (o3!.x - oV!.x) / (c3!.x - cV!.x), sy = (o1!.y - oV!.y) / (c1!.y - cV!.y);
  assert.ok(sx > 0.3 && Math.abs(sx - sy) / sx < 0.01, `scaled ${sx.toFixed(3)} across, ${sy.toFixed(3)} down`);

  const fallback = await pageInfo(new Uint8Array(readFileSync(join(dir, "fallback.pdf"))));
  assert.ok(fallback.ops.includes(lib.OPS.paintImageXObject), "printed as its PNG");
  assert.doesNotMatch(fallback.text, /R1 = 4/);
  assert.deepEqual(fallback.links, []);

  // Word and PowerPoint get the PNG exactly as it was cut.
  const same = (files: Record<string, Uint8Array>, prefix: string) => Object.entries(files).some(([name, bytes]) => name.startsWith(prefix) && Buffer.from(bytes).equals(Buffer.from(settled.png)));
  assert.ok(same(unzipSync(new Uint8Array(readFileSync(join(dir, "report.docx")))), "word/media/"), "docx holds the crop's PNG");
  const pptx = unzipSync(new Uint8Array(readFileSync(join(dir, "deck.pptx"))));
  assert.ok(same(pptx, "ppt/media/"), "pptx holds the crop's PNG");
  const slides = Object.entries(pptx).filter(([n]) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(([, b]) => Buffer.from(b).toString("utf8")).join("");
  assert.match(slides, /Source: Textbook, chapter 2\./);
});
