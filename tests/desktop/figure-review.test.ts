import test from "node:test";
import assert from "node:assert/strict";
import { deckSheets, documentFigures, figureCheck, figurePictures, newFigures, FIGURES_PER_RESULT, FIGURE_PIXELS, FIGURE_BYTES } from "../../desktop/figure-review.ts";
import { kinetraInstructions } from "../../desktop/kinetra-runtime.ts";

const svg = (n: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><text>${n}</text></svg>`;
const png = (bytes = 100) => new Uint8Array(bytes);

test("figures are named the way the document numbers them, with their section", () => {
  const spec = { title: "T", sections: [
    { heading: "Circuit", text: "x", figure: { module: "diagram/circuit_schematic", fn: "renderCircuit", args: [] } },
    { text: "no figure" },
    { text: "continues Circuit", figure: { module: "clem", fn: "plot", args: [] } },
    { heading: "Broken", figure: { module: "clem", fn: "chart", args: [] } },
  ] };
  const figures = documentFigures(spec, [svg(1), undefined, svg(2), undefined]);
  assert.deepEqual(figures.map((f) => f.where), ["Figure 1 (in “Circuit”)", "Figure 2 (in “Circuit”)"]);
  assert.equal(figures[0].figure?.fn, "renderCircuit");
});

test("only figures not yet seen in this answer are sent, at most the cap per result; the rest come with the next revise", async () => {
  const seen = new Set<string>();
  const drawnAt: { maxWidth?: number; maxHeight?: number; pixelRatio?: number }[] = [];
  const raster = { svg: async (_svg: string, o: any) => { drawnAt.push(o); return { png: png() }; } };
  const nine = Array.from({ length: 9 }, (_, i) => ({ svg: svg(i), where: `Figure ${i + 1}`, figure: { module: "clem", fn: "plot" } }));
  const first = await figurePictures(nine, seen, raster);
  assert.equal(first.pictures.length, FIGURES_PER_RESULT);
  assert.equal(first.more, 3);
  assert.equal(first.pictures[0].name, "Figure 1 — clem.plot");
  // Small pictures: bounded on both sides at one device pixel per CSS pixel.
  assert.ok(drawnAt.every((o) => o.maxWidth === FIGURE_PIXELS && o.maxHeight === FIGURE_PIXELS && o.pixelRatio === 1));
  // Appending a part re-renders the whole document: the figures already seen are not sent again.
  const second = await figurePictures(nine, seen, raster);
  assert.deepEqual(second.pictures.map((p) => p.name), ["Figure 7 — clem.plot", "Figure 8 — clem.plot", "Figure 9 — clem.plot"]);
  assert.equal((await figurePictures(nine, seen, raster)).pictures.length, 0);
  // A changed figure is new again.
  assert.equal(newFigures([{ svg: svg(99), where: "Figure 1" }], seen).fresh.length, 1);
  // The same drawing twice in one file is one picture.
  assert.equal(newFigures([{ svg: svg(5), where: "a" }, { svg: svg(5), where: "b" }], new Set()).fresh.length, 1);
});

test("a picture that is too large or cannot be drawn is skipped, never failing the file", async () => {
  const seen = new Set<string>();
  let n = 0;
  const raster = { svg: async () => { n++; if (n === 1) throw Error("capture failed"); return { png: png(n === 2 ? FIGURE_BYTES + 1 : 10) }; } };
  const { pictures } = await figurePictures([1, 2, 3].map((i) => ({ svg: svg(i), where: `Figure ${i}` })), seen, raster);
  assert.deepEqual(pictures.map((p) => p.name), ["Figure 3"]);
});

test("the model is asked to compare each figure with its source and revise when they differ", () => {
  assert.equal(figureCheck([], 0), undefined);
  const note = figureCheck(["Figure 1 — diagram/circuit_schematic.renderCircuit"], 2)!;
  assert.match(note, /compare it with the source it was copied from/);
  assert.match(note, /connection or topology, label, value/);
  assert.match(note, /"revise"/);
  assert.match(note, /2 more new figures were not attached/);
  assert.match(kinetraInstructions, /pictures of its new figures come back with the result/);
});

test("a deck's changed sheets go first, and slides never pictured are named, not claimed as checked", () => {
  const sheet = (first: number, last: number, tag = "") => ({ name: `slides ${first}–${last}`, first, last, jpeg: new TextEncoder().encode(`${first}-${last}${tag}`) });
  const seen = new Set<string>();
  const deck = { slides: 160, sheets: Array.from({ length: 12 }, (_, i) => sheet(i * 12 + 1, i * 12 + 12)) };
  const first = deckSheets(deck, seen);
  assert.deepEqual(first.shown.map((s) => s.first), [1, 13, 25, 37]);
  assert.match(first.note, /Slides 49–60, .*133–144, 145–160 are not pictured/);
  // Slides 61–72 changed: their sheet goes, not the unchanged ones already seen.
  const changed = { ...deck, sheets: deck.sheets.map((s) => (s.first === 61 ? sheet(61, 72, "x") : s)) };
  const second = deckSheets(changed, seen);
  assert.equal(second.shown[0].first, 49);
  assert.ok(second.shown.some((s) => s.first === 61));
  assert.match(second.note, /Slides 1–12, 13–24, 25–36, 37–48 look exactly as/);
  assert.doesNotMatch(second.note, /Every slide/);
  // Every sheet seen and the whole deck covered: only then is every slide said to be unchanged.
  const small = { slides: 2, sheets: [sheet(1, 2)] };
  deckSheets(small, seen);
  assert.equal(deckSheets(small, seen).note, "Every slide looks exactly as in the contact sheets already attached in this answer.");
});
