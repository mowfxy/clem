import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { kit, lib, fixture, open } from "./pdf-kit.ts";
import { analysePage, settlePdfCrop } from "../../core/pdf-page.ts";
import { CropAssets, cropTools, memoryIo, type WindowTask } from "../../desktop/pdf-assets.ts";
import { ACTIONS, toolRequests } from "../../desktop/kinetra-turn.ts";
import { kinetraToolSpec } from "../../desktop/kinetra-mcp.ts";
import { toolStatus } from "../../desktop/codex.ts";
import { fileToolsGuide } from "../../core/file-tools.ts";

/** The window's side, done here with the same core code (src/desktop/pdf-tasks.ts runs it in Chromium). */
const window: WindowTask = async (op, args: any) => {
  const bytes = new Uint8Array(await fixture(args.file));
  const pdf = await open(bytes);
  try {
    const a = await analysePage(lib, pdf, Number(args.page) || 1, kit);
    if (op === "regions") return { data: { file: args.file, type: "pdf", pages: 1, units: "pt", results: [{ page: 1, kind: a.kind, regions: a.regions }] }, images: [{ name: "page 1", data: "AAAA" }], files: [] };
    const region = a.regions.find((r) => r.id === args.region);
    const s = await settlePdfCrop(pdf, 1, region?.box ?? args.bbox, { pad: args.padding ?? 4, dpi: args.dpi ?? 150 }, kit);
    return { data: { file: args.file, page: 1, units: "pt", box: s.box, hit: s.hit, width: s.width, height: s.height, dpi: args.dpi ?? 150, vector: a.kind === "vector", ...(region ? { region } : {}) }, images: [{ name: "crop", data: "AAAA" }], files: a.kind === "vector" ? [s.png, bytes] : [s.png] };
  } finally {
    await pdf.loadingTask.destroy();
  }
};

test("regions then crop: the circuit is found, cut as vectors with its caption, kept under an id, and shown to the model", async () => {
  const assets = new CropAssets(memoryIo(), "chat-a");
  const run = cropTools(window, assets);
  const found = (await run({ action: "regions", file: "textbook-circuit.pdf", page: 1 }))!;
  const figure = (found.result.results as any)[0].regions.find((r: any) => r.kind === "figure");
  assert.match(String(found.result.note), /"action":"crop"/);
  assert.equal(found.pictures.length, 1);
  const cut = (await run({ action: "crop", file: "textbook-circuit.pdf", page: 1, region: figure.id }))!;
  const crop = cut.result.crop as any;
  assert.match(crop.id, /^crop-[a-f0-9]{16}$/);
  assert.equal(crop.vector, true);
  assert.match(crop.caption, /^Figure 2\.4/);
  assert.match(String(cut.result.check), /every edge on paper/);
  const stored = (await assets.get(crop.id))!;
  const page = (await PDFDocument.load(stored.pdf!)).getPage(0).getSize();
  assert.ok(Math.abs(page.width - (crop.box[2] - crop.box[0])) < 0.01);
  // A scan is cut as a picture only.
  const scan = (await run({ action: "crop", file: "scanned-page.pdf", page: 1, bbox: [150, 380, 450, 490] }))!;
  assert.equal((scan.result.crop as any).vector, false);
  assert.equal((await assets.get((scan.result.crop as any).id))!.pdf, undefined);
});

test("a crop whose drawing runs past the reach says which edges to check", async () => {
  const run = cropTools(async () => ({ data: { file: "a.pdf", page: 1, units: "pt", box: [0, 0, 10, 10], hit: ["left", "top"], width: 10, height: 10, vector: false }, images: [], files: [new Uint8Array([1])] }), new CropAssets(memoryIo(), "c"));
  assert.match(String((await run({ action: "crop", file: "a.pdf", page: 1, bbox: [0, 0, 10, 10] }))!.result.check), /past the left and top edges/);
});

test("bad requests are answered with what is missing, and other actions are not taken", async () => {
  const run = cropTools(async () => { throw Error("not called"); }, new CropAssets(memoryIo(), "c"));
  assert.match(String((await run({ action: "crop", file: "a.pdf" }))!.result.error), /"region"/);
  assert.match(String((await run({ action: "regions" }))!.result.error), /"file"/);
  assert.equal(await run({ action: "look", file: "a.pdf" }), undefined);
});

test("regions and crop are Kinetra actions in text and native calls, with a status, and the guide explains them", () => {
  assert.ok(ACTIONS.has("regions") && ACTIONS.has("crop"));
  assert.deepEqual(toolRequests('{"kinetra":{"action":"crop","file":"a.pdf","page":2,"region":"p2-1"}}'), [{ action: "crop", file: "a.pdf", page: 2, region: "p2-1" }]);
  assert.ok((kinetraToolSpec.inputSchema.properties.action.enum as string[]).includes("crop"));
  assert.equal(toolStatus({ action: "crop" }), "Cropping the figure…");
  const guide = fileToolsGuide([{ name: "a.pdf", text: "x" }]);
  assert.match(guide, /"action":"regions"/);
  assert.match(guide, /"action":"crop"/);
  // A chat with only pictures still learns how to crop them.
  assert.match(fileToolsGuide([], true), /"action":"crop"/);
  // A chat without files still learns to find the person's other files, but not the tools for files it does not have.
  assert.match(fileToolsGuide([]), /"action":"find"/);
  assert.doesNotMatch(fileToolsGuide([]), /"action":"crop"/);
});

test("editpdf is a file action like pdf: routed to file making, revised and appended to by its edit list, explained in the guide", async () => {
  const { FILE_ACTIONS, partsKey, sameFormat } = await import("../../desktop/file-guides.ts");
  assert.ok(ACTIONS.has("editpdf") && FILE_ACTIONS.has("editpdf"));
  assert.equal(partsKey.editpdf, "ops");
  assert.ok(sameFormat("editpdf", "lecture (edited).pdf") && !sameFormat("editpdf", "notes.docx"));
  assert.equal(toolStatus({ action: "editpdf" }), "Editing the PDF…");
  assert.match(fileToolsGuide([{ name: "a.pdf", text: "x" }]), /"action":"editpdf"/);
});
