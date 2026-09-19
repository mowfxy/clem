export async function extractAttachment(
  bytes: Uint8Array,
  name: string,
  mime: string,
) {
  const blob = new Blob([new Uint8Array(bytes)], { type: mime });
  if (mime === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).href;
    const loading = pdfjs.getDocument({ data: bytes, useSystemFonts: false });
    const pdf = await loading.promise;
    let text = "";
    try {
      if (pdf.numPages > 100) throw Error("Choose at most 100 pages.");
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i),
          content = await page.getTextContent();
        text +=
          "\n[Page " +
          i +
          "] " +
          content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ");
        page.cleanup();
        if (text.length > 40000)
          throw Error("Document exceeds the context budget.");
      }
      if (!text.replace(/\[Page \d+\]/g, "").trim())
        throw Error("Scanned PDF needs OCR.");
      return text;
    } finally {
      await loading.destroy();
    }
  }
  if (/\.docx$/i.test(name) || mime.includes("wordprocessing"))
    return (await (await import("../office")).officeText(blob, name)).slice(
      0,
      40000,
    );
  if (mime === "text/plain") {
    if (bytes.length > 40000) throw Error("Text exceeds context budget.");
    return new TextDecoder().decode(bytes);
  }
  throw Error("Unsupported document.");
}
