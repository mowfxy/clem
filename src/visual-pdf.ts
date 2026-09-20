import { PDFDocument } from "pdf-lib";
import { downloadMade } from "./store";
export async function exportDiagramPdf(svg: string) {
  const image = new Image(),
    url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(Error("Could not render diagram."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || 1200;
    canvas.height = image.naturalHeight || 800;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    const pdf = await PDFDocument.create();
    const png = await pdf.embedPng(canvas.toDataURL("image/png"));
    const page = pdf.addPage([842, 595]);
    const fit = png.scaleToFit(762, 515);
    page.drawImage(png, {
      x: (842 - fit.width) / 2,
      y: (595 - fit.height) / 2,
      ...fit,
    });
    pdf.setCreator("Mowr");
    await downloadMade(
      new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" }),
      "projectile.pdf",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
