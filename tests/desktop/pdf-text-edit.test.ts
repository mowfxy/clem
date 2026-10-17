import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { open } from "./pdf-kit.ts";
import { redactPage } from "../../desktop/pdf-redact.ts";
import { planEdits, type TextItem } from "../../core/pdf-edit.ts";

async function items(bytes: Uint8Array): Promise<TextItem[]> {
  const pdf = await open(bytes);
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    return (content.items as any[]).filter((i) => i.str).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], width: i.width, size: Math.hypot(i.transform[2], i.transform[3]) }));
  } finally {
    await pdf.loadingTask.destroy();
  }
}

test("an in-place PDF edit takes the old line's glyphs out, not just covers them (src/pdf/pdf-edit.ts)", async () => {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), page = doc.addPage([400, 300]);
  page.drawText("Total due: 120 dollars", { x: 40, y: 200, size: 12, font });
  page.drawText("Paid on time.", { x: 40, y: 184, size: 12, font });
  const before = await doc.save();
  const [p] = planEdits([await items(before)], [{ page: 1, find: "120", replace: "150" }]);
  const edited = await PDFDocument.load(before);
  redactPage(edited, edited.getPage(0), [[p.cover.x, p.cover.y, p.cover.x + p.cover.w, p.cover.y + p.cover.h]]);
  const left = (await items(await edited.save())).map((i) => i.str).join("\n");
  assert.doesNotMatch(left, /120/);
  assert.match(left, /Paid on time\./);
});
