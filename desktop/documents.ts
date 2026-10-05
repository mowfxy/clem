import {markContent} from "../core/provenance.ts";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFile } from "node:fs/promises";
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
  return new Uint8Array(await (await markContent(new Blob([new Uint8Array(await document.save())]),"document.pdf")).arrayBuffer());
}

/** Formats a copy may be opened in: the browser, or the app Windows associates with it. Anything else (programs,
 *  scripts, shortcuts, macro-enabled Office files, and the legacy .doc/.xls/.ppt/.rtf that can carry macros or OLE objects) is refused, since a file's name can come from someone else's
 *  study pack and opening it would run it. */
export const browserViewable = /\.(pdf|png|jpe?g|gif|webp|svg|txt|md|csv|json|html?|xml|mp4|webm|mp3|wav)$/i;
const openable = /\.(pdf|png|jpe?g|gif|webp|svg|bmp|tiff?|heic|avif|txt|md|csv|json|xml|html?|log|mp4|webm|mov|m4v|mkv|avi|mp3|wav|m4a|aac|ogg|flac|docx|xlsx|pptx|odt|ods|odp|epub)$/i;
/** The file name for a local read-only copy, or null when Mowr must not hand the file to Windows to open. */
export function viewCopyName(name: string) {
  // Windows drops trailing dots and spaces, so "setup.exe." would still be saved, and run, as "setup.exe".
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim().replace(/[. ]+$/, "") || "file";
  return openable.test(clean) ? clean : null;
}

/** Marks a copy as coming from the internet (Mark-of-the-Web), so Office opens it in Protected View and blocks its
 *  macros, as it would a downloaded file. A drive without alternate data streams (FAT, network shares) just skips it. */
export async function markFromInternet(path: string) {
  await writeFile(path + ":Zone.Identifier", "[ZoneTransfer]\r\nZoneId=3\r\n").catch(() => {});
}
