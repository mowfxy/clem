import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
export async function textPdf(text: string) {
  if (text.length > 60000) throw Error("Use a shorter document.");
  const document = await PDFDocument.create(),
    font = await document.embedFont(StandardFonts.Helvetica);
  let page = document.addPage([595.28, 841.89]),
    y = 785;
  const margin = 50,
    width = 495;
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      // The standard-font exporter must reject unsupported Unicode rather than corrupt it.
      if (font.widthOfTextAtSize(word, 11) > width)
        throw Error("A word exceeds the page width.");
      const candidate = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(candidate, 11) > width) {
        draw(line);
        line = word;
      } else line = candidate;
    }
    draw(line);
    y -= 6;
  }
  function draw(line: string) {
    if (y < 60) {
      page = document.addPage([595.28, 841.89]);
      y = 785;
    }
    page.drawText(line, {
      x: margin,
      y,
      font,
      size: 11,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 16;
  }
  for (const [i, p] of document.getPages().entries())
    p.drawText(`Mowr | ${i + 1} / ${document.getPageCount()}`, {
      x: 50,
      y: 28,
      font,
      size: 8,
    });
  document.setCreator("Mowr");
  return document.save();
}
