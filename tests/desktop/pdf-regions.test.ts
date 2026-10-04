import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kit, lib, fixture, open } from "./pdf-kit.ts";
import { analysePage, analysePicture, settlePdfCrop, settlePictureCrop } from "../../core/pdf-page.ts";
import { segmentBitmap, settleCrop, type Box } from "../../core/pdf-regions.ts";
import { chartPng } from "../fixtures/pdf/make.ts";

/** Ground truth: where each figure's ink really is, measured when the fixtures were built (tests/fixtures/pdf/make.ts). */
const truth: Record<string, Record<string, { kind: string; caption?: string; box: Box }>> = JSON.parse(readFileSync(new URL("../fixtures/pdf/truth.json", import.meta.url), "utf8"));
const contains = (outer: Box, inner: Box, slack = 0.5) => outer[0] <= inner[0] + slack && outer[1] <= inner[1] + slack && outer[2] >= inner[2] - slack && outer[3] >= inner[3] - slack;
const margin = (outer: Box, inner: Box) => Math.max(inner[0] - outer[0], inner[1] - outer[1], outer[2] - inner[2], outer[3] - inner[3]);
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const squash = (s = "") => s.replace(/\s+/g, "");

async function regions(name: string) {
  const pdf = await open(await fixture(name));
  return { pdf, analysis: await analysePage(lib, pdf, 1, kit) };
}
/** The candidate covering most of a true figure. */
const match = <T extends { box: Box }>(rs: T[], box: Box) => rs.slice().sort((a, b) => overlap(b.box, box) - overlap(a.box, box))[0];

for (const name of Object.keys(truth)) {
  const scan = name.startsWith("scanned");
  test(`regions on ${name}: every figure found whole, with its labels and caption, and only a small margin`, async () => {
    const { pdf, analysis } = await regions(name);
    try {
      assert.equal(analysis.kind, scan ? "scanned" : "vector");
      for (const [id, want] of Object.entries(truth[name])) {
        const got = match(analysis.regions, want.box);
        assert.ok(got && overlap(got.box, want.box) > 0, `${id}: no candidate`);
        // Structure boxes are font boxes, a little taller than the glyphs' ink; a scan is read at 150 dpi.
        assert.ok(contains(got.box, want.box, scan ? 1.5 : 0.5), `${id}: ${JSON.stringify(got.box)} does not contain ${JSON.stringify(want.box)}`);
        assert.ok(margin(got.box, want.box) <= 4, `${id}: margin ${margin(got.box, want.box).toFixed(2)} pt`);
        if (want.caption) assert.ok(squash(got.caption).startsWith(squash(want.caption)), `${id}: caption ${got.caption}`);
        if (want.kind !== "region") assert.equal(got.kind, want.kind, id);
      }
    } finally {
      await pdf.loadingTask.destroy();
    }
  });

  test(`crops on ${name} contain the whole figure, are trimmed to it, and carry exactly the padding asked for`, async () => {
    const { pdf, analysis } = await regions(name);
    try {
      for (const [id, want] of Object.entries(truth[name])) {
        const region = match(analysis.regions, want.box);
        const tight = await settlePdfCrop(pdf, 1, region.box, { pad: 0, dpi: 150 }, kit);
        assert.ok(contains(tight.box, want.box, 0.6), `${id}: crop ${JSON.stringify(tight.box)} clips ${JSON.stringify(want.box)}`);
        assert.ok(margin(tight.box, want.box) <= 1.5, `${id}: stray margin ${margin(tight.box, want.box).toFixed(2)} pt in ${JSON.stringify(tight.box)}`);
        assert.deepEqual(tight.hit, [], `${id}: drawing runs past the crop`);
        const padded = await settlePdfCrop(pdf, 1, region.box, { pad: 4, dpi: 150 }, kit);
        assert.ok(contains(padded.box, want.box, 0) && margin(padded.box, want.box) <= 5.5, `${id}: padded ${JSON.stringify(padded.box)}`);
        // A PNG at the resolution asked for: 150 dpi is about 2.08 pixels per point.
        assert.ok(Math.abs(tight.width - ((tight.box[2] - tight.box[0]) * 150) / 72) <= 2);
        assert.deepEqual([...tight.png.slice(1, 4)], [0x50, 0x4e, 0x47]);
      }
    } finally {
      await pdf.loadingTask.destroy();
    }
  });
}

test("a sloppy box is corrected: one cutting through the drawing grows to its labels, one far too big shrinks to it", async () => {
  const { pdf } = await regions("textbook-circuit.pdf");
  try {
    const want = truth["textbook-circuit.pdf"].fig.box;
    const small = await settlePdfCrop(pdf, 1, [want[0] + 8, want[1] + 8, want[2] - 8, want[3] - 8], { pad: 0, dpi: 100 }, kit);
    assert.ok(contains(small.box, want, 0.6), `grown ${JSON.stringify(small.box)}`);
    const big = await settlePdfCrop(pdf, 1, [want[0] - 12, want[1] - 12, want[2] + 12, want[3] + 12], { pad: 0, dpi: 100 }, kit);
    assert.ok(contains(big.box, want, 0.6) && margin(big.box, want) <= 1.5, `shrunk ${JSON.stringify(big.box)}`);
    // Trimming off: the box is kept as given, plus the padding.
    const exact = await settlePdfCrop(pdf, 1, [200, 400, 300, 450], { pad: 2, dpi: 72, trim: false }, kit);
    assert.deepEqual(exact.box, [198, 398, 302, 452]);
  } finally {
    await pdf.loadingTask.destroy();
  }
});

test("columns are never merged: no candidate on the two-column paper reaches into the other column, and body text is never one", async () => {
  const { pdf, analysis } = await regions("two-column.pdf");
  try {
    for (const r of analysis.regions.filter((r) => r.box[2] - r.box[0] < 300)) assert.ok(r.box[2] < 306 || r.box[0] > 306, `${r.id} crosses the gutter: ${JSON.stringify(r.box)}`);
    assert.equal(analysis.regions.length, Object.keys(truth["two-column.pdf"]).length);
  } finally {
    await pdf.loadingTask.destroy();
  }
});

test("display equations are found from the text, with their number", async () => {
  const { pdf, analysis } = await regions("textbook-circuit.pdf");
  try {
    const eq = analysis.regions.find((r) => r.kind === "equation");
    assert.ok(eq, "no equation");
    assert.ok(eq!.box[2] > 530, "the equation number (2.3) is part of it");
  } finally {
    await pdf.loadingTask.destroy();
  }
});

test("a picture file: its chart is found from the pixels, and a box cutting through it grows to all of it", async () => {
  const canvas = await kit.picture!(new Uint8Array(chartPng()));
  const rs = analysePicture(canvas);
  assert.equal(rs.length, 1);
  // The chart's ink runs from the y-axis numbers (x 50) to the axis end (820), the axis top (y 70) to the years (y 535).
  const [x0, y0, x1, y1] = rs[0].box;
  assert.ok(x0 <= 52 && y0 <= 72 && x1 >= 818 && y1 >= 533 && x0 >= 30 && y1 <= 560, JSON.stringify(rs[0].box));
  const crop = await settlePictureCrop(canvas, [200, 200, 700, 450], { pad: 0 }, kit);
  assert.ok(crop.box[0] <= 112 && crop.box[1] <= 100 && crop.box[2] >= 818 && crop.box[3] >= 500, JSON.stringify(crop.box));
});

test("settleCrop: grows across ink to paper, trims to ink, pads, and reports an edge it could not finish", () => {
  const w = 100, h = 60, grey = new Uint8Array(w * h).fill(255);
  for (let x = 20; x < 80; x++) for (let y = 20; y < 40; y++) grey[y * w + x] = 0;
  assert.deepEqual(settleCrop(grey, w, h, [30, 25, 60, 35]).box, [20, 20, 80, 40]);
  assert.deepEqual(settleCrop(grey, w, h, [5, 5, 95, 55], { pad: 3 }).box, [17, 17, 83, 43]);
  assert.deepEqual(settleCrop(grey, w, h, [30, 25, 60, 35], { limit: 4 }).hit.sort(), ["bottom", "left", "right", "top"]);
  assert.equal(settleCrop(new Uint8Array(w * h).fill(255), w, h, [10, 10, 20, 20]).box, null);
});

test("segmentBitmap tells a text block from a figure", () => {
  const w = 400, h = 300, grey = new Uint8Array(w * h).fill(255);
  // Five text lines (8 px high, 6 px apart) and, below, a filled 120 × 100 picture.
  for (let line = 0; line < 5; line++) for (let y = 20 + line * 14; y < 28 + line * 14; y++) for (let x = 20; x < 380; x++) if (x % 9 < 3) grey[y * w + x] = 0;
  for (let y = 150; y < 250; y++) for (let x = 140; x < 260; x++) grey[y * w + x] = 40;
  const blocks = segmentBitmap(grey, w, h);
  assert.deepEqual(blocks.map((b) => b.kind), ["text", "figure"]);
  assert.deepEqual(blocks[1].box, [140, 150, 260, 250]);
});
