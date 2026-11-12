// Writes the tiny PDF and PowerPoint that tests/guc-ai-tools.test.ts reads (tests/fixtures/guc/lecture.pdf, deck.pptx).
// Run once: node scripts/make-guc-text-fixtures.mjs
import { writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import PptxGenJS from "pptxgenjs";

const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
for (const [i, line] of ["Embedded systems: interrupts", "Timers and watchdogs", "Memory-mapped IO"].entries()) {
  const page = pdf.addPage([300, 200]);
  page.drawText(`Page ${i + 1}. ${line}`, { x: 20, y: 100, size: 12, font });
}
await writeFile("tests/fixtures/guc/lecture.pdf", await pdf.save({ useObjectStreams: false }));

const deck = new PptxGenJS();
for (const title of ["Pipelining basics", "Hazards and forwarding"]) deck.addSlide().addText(title, { x: 1, y: 1, w: 8, h: 1 });
await writeFile("tests/fixtures/guc/deck.pptx", Buffer.from(await deck.write({ outputType: "arraybuffer" })));
console.log("written");
