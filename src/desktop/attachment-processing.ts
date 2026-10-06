/** A document's text. `limit` is the most characters read. */
export async function extractAttachment(
  bytes: Uint8Array,
  name: string,
  mime: string,
  limit = 40000,
) {
  const blob = new Blob([new Uint8Array(bytes)], { type: mime });
  if (mime === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).href;
    // Taken before pdf.js is given the bytes: it moves them to its worker, which leaves `bytes` empty here.
    const ocrKey = `${name}:${bytes.length}`;
    const loading = pdfjs.getDocument({ data: bytes, useSystemFonts: false });
    const pdf = await loading.promise;
    let text = "", read = 0;
    try {
      // A long PDF gives the text that fits; the model sees its pages themselves (src/desktop/page-images.ts pdfView).
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i),
          content = await page.getTextContent();
        const part = `\n[${name}, page ${i}]\n` + content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + "\n";
        page.cleanup();
        if (text.length + part.length > limit) break;
        text += part;
        read = i;
      }
      if (!text.replace(/\[[^\n]*?, page \d+\]/g, "").trim()) {
        // A scan: its pages are read with Windows' OCR, as far as time and the text limit allow (src/desktop/ocr.ts).
        const { scannedText, OCR_PENDING } = await import("./ocr");
        const pages = Array.from({ length: Math.min(pdf.numPages, Math.max(1, Math.floor(limit / 1500))) }, (_, i) => i + 1);
        const ocr = await scannedText(pdf, pages, ocrKey, Date.now() + 20_000).catch(() => undefined);
        const read = ocr ? pages.map((p) => `\n[${name}, page ${p}]\n${ocr.pending.includes(p) ? OCR_PENDING : ocr.texts.get(p) ? "(text read from the scanned page)\n" + ocr.texts.get(p) : ""}\n`).join("").slice(0, limit) : "";
        if (ocr && [...ocr.texts.values()].some((t) => t.trim())) return read + (pages.length < pdf.numPages ? `\n[${name}: ${pdf.numPages} pages; read later pages from the pages themselves.]` : "");
        return `[${name}: a scanned or image-only PDF of ${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"} whose text could not be read. Read it from its pages as they are shown to you.]`;
      }
      if (read < pdf.numPages) text += `\n[${name}: the text above runs to page ${read} of ${pdf.numPages}; read later pages from the pages themselves.]`;
      return text;
    } finally {
      await loading.destroy();
    }
  }
  if (/\.docx$/i.test(name) || mime.includes("wordprocessing"))
    return (await (await import("../office")).officeText(blob, name)).slice(
      0,
      limit,
    );
  if (mime.startsWith("text/") || /^application\/(json|xml|javascript)/.test(mime) || (await import("../documents")).textFile.test(name)) {
    if (bytes.length > limit) throw Error("Text exceeds context budget.");
    return new TextDecoder().decode(bytes);
  }
  throw Error("Unsupported document.");
}
