import { BrowserWindow } from "electron";
import { markContent } from "../core/provenance";
import { renderFigures, documentHtml } from "./pdf-document";

/** Prints a document specification to a tagged A4 PDF. `checkVoice` is off only for exports of text the person already has. */
export async function illustratedPdf(spec: any, { checkVoice = true }: { checkVoice?: boolean } = {}) {
  const figures = await renderFigures(spec, { checkVoice });
  const page = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      javascript: false,
    },
  });
  try {
    await page.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(documentHtml(spec, figures)));
    const bytes = await page.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: '<div style="width:100%;margin:0 21mm;padding-top:5px;border-top:0.5px solid #c4c8cd;font:7.5px Segoe UI,Arial,sans-serif;color:#80868e;display:flex;justify-content:space-between"><span class="title" style="max-width:75%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis"></span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
      generateTaggedPDF: true,
    });
    return new Uint8Array(
      await (
        await markContent(new Blob([new Uint8Array(bytes)]), "document.pdf")
      ).arrayBuffer(),
    );
  } finally {
    page.destroy();
  }
}
