import { BrowserWindow } from "electron";
import { kinetraCall } from "./kinetra-runtime";
import { markContent } from "../core/provenance";
const escape = (text: unknown) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function illustratedPdf(spec: any) {
  if (
    typeof spec.title !== "string" ||
    !Array.isArray(spec.sections) ||
    spec.sections.length < 1 ||
    spec.sections.length > 40 ||
    JSON.stringify(spec).length > 100000
  )
    throw Error("Invalid PDF specification");
  let body = "<h1>" + escape(spec.title) + "</h1>";
  for (const section of spec.sections) {
    if (section.heading) body += "<h2>" + escape(section.heading) + "</h2>";
    if (section.text) body += "<p>" + escape(section.text) + "</p>";
    if (section.figure) {
      const svg = await kinetraCall(section.figure);
      if (
        typeof svg !== "string" ||
        !svg.includes("<svg") ||
        /<script|<foreignObject|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|file:|javascript:)/i.test(
          svg,
        )
      )
        throw Error("Invalid generated figure");
      body +=
        '<figure><img src="data:image/svg+xml;base64,' +
        Buffer.from(svg).toString("base64") +
        '"><figcaption>' +
        escape(section.caption) +
        "</figcaption></figure>";
    }
  }
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
    await page.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><style>@page{size:A4;margin:20mm}body{font:11pt Georgia;color:#202020}h1{font-size:25pt}h2{font-size:17pt;break-after:avoid}p{white-space:pre-wrap;line-height:1.6;overflow-wrap:anywhere}figure{margin:20pt 0;break-inside:avoid}img{width:100%;max-height:600px;object-fit:contain}figcaption{font:9pt Arial;color:#555;margin-top:8pt}</style>' +
            body,
        ),
    );
    const bytes = await page.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
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
