// Real files on the VPS with the laptop off (docs/GUC-VPS-ENGINE.md "Files on the VPS"): a Telegram request makes a
// PDF, a deck, a Word report, a spreadsheet and a picture on the worker with the window's own makers, drawn in headless
// Chromium; each is saved in the VPS store, sent to Telegram (visuals as photos), and present in the desktop's workspace
// after it syncs. PDF pages are looked at, their figures found and cropped, and a PDF edited, all on the worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { applyPull } from "../core/workspace/ops.ts";
import { findChromium } from "../desktop/chromium-page.ts";
import { sha256 } from "../desktop/engine/storage.ts";
import { baseDesk, startPair } from "./vps-pair.ts";

const browser = findChromium();
const skip = browser ? false : "no Chromium on this machine";
const req = (o: object) => JSON.stringify({ kinetra: o });

test("a PDF, slides, a Word report, an Excel sheet and a picture are made on the worker and reach the desktop", { timeout: 240_000, skip }, async () => {
  let step = 0;
  const p = await startPair({
    complete: async ({ user }) => {
      step++;
      if (step === 1) {
        assert.match(user, /\[From Telegram\] make me a PDF summary of chapter 3/);
        return [
          req({ action: "pdf", title: "Chapter 3 summary", sections: [{ heading: "Forces", text: "Newton's second law: $F = ma$." }, { heading: "Energy", text: "- kinetic\n- potential" }] }),
          req({ action: "pptx", title: "My presentation", slides: [{ layout: "title", title: "Forces" }, { layout: "bullets", title: "Key points", bullets: ["Inertia", "F = ma", "Action and reaction"] }] }),
          req({ action: "docx", title: "Lab report", sections: [{ heading: "Method", text: "We timed the cart over 1 m." }] }),
          req({ action: "xlsx", title: "My grades", sheets: [{ name: "Grades", columns: [{ header: "Course" }, { header: "Grade" }], rows: [["Physics", 3.7], ["Math", 3.3]] }] }),
          req({ action: "image", name: "Force diagram", svg: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><rect x="20" y="40" width="120" height="80" fill="#4466cc"/><line x1="140" y1="80" x2="280" y2="80" stroke="#000" stroke-width="4"/></svg>' }),
        ].join("\n");
      }
      assert.match(user, /Chapter 3 summary\.pdf/);
      assert.doesNotMatch(user, /needs Clem open on the person's PC/, "nothing is refused for lack of the window");
      return 'Here they are.\n\n```visual\n{"kind":"plot","title":"Speed","x":{"min":0,"max":5},"y":{"min":0,"max":10},"layers":[{"type":"function","expr":"2*x"}]}\n```';
    },
  });
  try {
    let desk = baseDesk();
    await p.m.pushWorkspace(true, desk);
    const reply = await p.worker.host.converse!({ id: "tg-1", text: "make me a PDF summary of chapter 3, slides for my presentation, a Word report, an Excel sheet of my grades and a picture of the forces" });
    const sent = reply.files || [];
    const names = sent.filter((f) => !f.photo).map((f) => f.name).sort();
    assert.deepEqual(names, ["Chapter 3 summary.pdf", "Force diagram.png", "Lab report.docx", "My grades.xlsx", "My presentation.pptx"]);
    assert.equal(sent.filter((f) => f.photo).length, 1, "the answer's visual goes to Telegram as a photo");
    assert.deepEqual([...sent.find((f) => f.photo)!.bytes.subarray(1, 4)], [80, 78, 71], "a PNG");

    // Real files: a PDF with its text, Office files with their parts, a PNG.
    const pdf = sent.find((f) => f.name.endsWith(".pdf"))!;
    assert.equal(new TextDecoder().decode(pdf.bytes.subarray(0, 5)), "%PDF-");
    assert.equal((await PDFDocument.load(pdf.bytes)).getPageCount(), 1);
    const deck = unzipSync(sent.find((f) => f.name.endsWith(".pptx"))!.bytes);
    assert.ok(deck["ppt/slides/slide2.xml"] && strFromU8(deck["ppt/slides/slide2.xml"]).includes("Inertia"));
    const word = unzipSync(sent.find((f) => f.name.endsWith(".docx"))!.bytes);
    assert.match(strFromU8(word["word/document.xml"]), /timed the cart/);
    const book = unzipSync(sent.find((f) => f.name.endsWith(".xlsx"))!.bytes);
    assert.match(strFromU8(book["xl/sharedStrings.xml"] || book["xl/worksheets/sheet1.xml"]), /Physics/);

    // Saved on the VPS, content-addressed and checksummed, in the worker's copy of the workspace.
    const copy = (await p.worker.ws.state())!;
    const made = copy.files.filter((f: any) => f.made) as any[];
    assert.equal(made.length, 5);
    for (const f of made) {
      const bytes = new Uint8Array(await readFile(join(p.files, f.blob.sha256 + "." + f.blob.ext)));
      assert.equal(sha256(bytes), f.blob.sha256, f.name + " is in the VPS store");
    }
    // The desktop syncs: every file is in its workspace, its bytes registered as kept on the VPS.
    await p.m.heartbeat().catch(() => {});
    const batch = (await p.m.pullOps(desk.vpsSync))!;
    desk = applyPull(desk, batch);
    assert.deepEqual(desk.files.map((f: any) => f.name).sort(), names);
    assert.ok(desk.files.every((f: any) => !f.blob), "the desktop keeps its own record, without the worker's blob field");
    const router = await p.m.router();
    for (const f of desk.files) assert.equal((await router.row(f.id))?.location, "vps", f.name + " is a VPS file on the desktop");
  } finally { await p.stop(); }
});

test("PDF pages are looked at, their figures found and cropped, and a PDF edited on the worker", { timeout: 240_000, skip }, async () => {
  let step = 0;
  const p = await startPair({
    complete: async ({ user }) => {
      step++;
      if (step === 1) step++;
      if (step === 2) return [req({ action: "look", file: "Lecture 3.pdf", pages: [1] }), req({ action: "regions", file: "Lecture 3.pdf", page: 1 })].join("\n");
      if (step === 3) {
        const region = /"id":"(p1-\d+)"/.exec(user)?.[1];
        assert.ok(region, "regions found a figure on the page");
        return req({ action: "crop", file: "Lecture 3.pdf", page: 1, region });
      }
      if (step === 4) {
        assert.match(user, /"crop":\{"id":"crop-/);
        return req({ action: "editpdf", file: "Lecture 3.pdf", ops: [{ op: "stamp", pages: "all", text: "DRAFT" }] });
      }
      return "Done: page 1 is attached, the circuit is cropped, and the edited copy is saved.";
    },
  });
  try {
    // The lecture, kept on the VPS: a page of text with a circuit drawn in vectors.
    const doc = await PDFDocument.create(), page = doc.addPage([595, 842]), font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Lecture 3: a simple loop", { x: 72, y: 760, size: 18, font });
    page.drawText("The circuit below has one resistor and one source.", { x: 72, y: 730, size: 11, font });
    page.drawRectangle({ x: 150, y: 450, width: 300, height: 180, borderWidth: 3, borderColor: rgb(0, 0, 0) });
    for (let i = 0; i < 12; i++) page.drawLine({ start: { x: 200 + i * 15, y: 630 }, end: { x: 207 + i * 15, y: 645 }, thickness: 2 });
    page.drawCircle({ x: 150, y: 540, size: 20, borderWidth: 2, borderColor: rgb(0, 0, 0) });
    page.drawText("Figure 1: the loop", { x: 240, y: 425, size: 10, font });
    const bytes = await doc.save(), hash = sha256(bytes);
    await writeFile(join(p.files, hash + ".pdf"), bytes);
    await p.m.pushWorkspace(true, baseDesk({ files: [{ id: "lec3", name: "Lecture 3.pdf", size: bytes.length, type: "application/pdf", created: 1, spaceId: "math", blob: { sha256: hash, ext: "pdf", size: bytes.length } }] }));
    const reply = await p.worker.host.converse!({ id: "tg-2", text: "show me page 1 of lecture 3, crop its circuit and stamp it DRAFT" });
    const sent = reply.files || [];
    assert.ok(sent.some((f) => f.photo && /page 1 of 1/.test(f.name)), "the looked-at page goes to Telegram as a photo");
    const copy = (await p.worker.ws.state())!;
    const names = copy.files.map((f: any) => f.name);
    assert.ok(names.includes("Lecture 3.pdf"));
    assert.ok(step >= 4, "the crop was made from a region the page analysis found");
    const edited = copy.files.find((f: any) => / \(edited\)\.pdf$/.test(f.name));
    assert.ok(edited, "the edited copy is saved");
    assert.equal(new TextDecoder().decode((sent.find((f) => f.name === edited.name)!.bytes).subarray(0, 5)), "%PDF-");
    assert.ok(step >= 5);
  } finally { await p.stop(); }
});

test("without a browser engine, a PDF is refused in one plain sentence and a spreadsheet is still made", { timeout: 120_000 }, async () => {
  let step = 0, result = "";
  const p = await startPair({
    noBrowser: true,
    complete: async ({ user }) => {
      step++;
      if (step === 1) return [req({ action: "pdf", title: "Notes", sections: [{ heading: "A", text: "b" }] }), req({ action: "xlsx", title: "Grades", sheets: [{ name: "Grades", columns: [{ header: "Course" }], rows: [["Physics"]] }] })].join("\n");
      result = user;
      return "The spreadsheet is ready; the PDF needs Chromium on your VPS.";
    },
  });
  try {
    await p.m.pushWorkspace(true, baseDesk());
    const reply = await p.worker.host.converse!({ id: "tg-3", text: "a PDF of my notes and an Excel sheet of my grades" });
    assert.match(result, /install Chromium on my VPS/, "the model is told, in one sentence, what to say");
    assert.deepEqual((reply.files || []).map((f) => f.name), ["Grades.xlsx"]);
  } finally { await p.stop(); }
});
