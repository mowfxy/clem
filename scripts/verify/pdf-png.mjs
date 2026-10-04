// Draws the pages of a PDF as PNG files with pdf.js in Electron, to look at Word, PowerPoint or Excel files after
// exporting them to PDF through Office. Usage: node scripts/verify/pdf-png.mjs <file.pdf> <out dir> [width px = 900] [first page = 1] [last page = 12]
import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join, basename } from "node:path";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";

const [pdf, outDir, width = "900", first = "1", last = "12"] = process.argv.slice(2);
const out = join(tmpdir(), "mowr-verify-pdfpng");
await mkdir(out, { recursive: true });
await mkdir(resolve(outDir), { recursive: true });
await build({
  stdin: { contents: `import * as pdfjs from "pdfjs-dist";pdfjs.GlobalWorkerOptions.workerSrc="./pdf.worker.min.mjs";window.render=async(bytes,width,first,last)=>{const doc=await pdfjs.getDocument({data:new Uint8Array(bytes)}).promise;const pages=[];for(let n=first;n<=Math.min(last,doc.numPages);n++){const page=await doc.getPage(n);const base=page.getViewport({scale:1});const viewport=page.getViewport({scale:width/base.width});const canvas=document.createElement("canvas");canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;pages.push(canvas.toDataURL("image/png").split(",")[1]);}return {pages,count:doc.numPages};};`, resolveDir: process.cwd(), loader: "js" },
  bundle: true, format: "esm", platform: "browser", outfile: join(out, "page.js"), logLevel: "warning",
});
await writeFile(join(out, "pdf.worker.min.mjs"), await readFile(createRequire(import.meta.url).resolve("pdfjs-dist/build/pdf.worker.min.mjs")));
await writeFile(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><script type="module" src="page.js"></script>`);
await writeFile(join(out, "main.cjs"), `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, webSecurity: false } });
  await w.loadFile(${JSON.stringify(join(out, "index.html"))});
  await new Promise((r) => setTimeout(r, 400));
  const bytes = [...fs.readFileSync(${JSON.stringify(resolve(pdf))})];
  const result = await w.webContents.executeJavaScript("window.render(" + JSON.stringify(bytes) + ", ${Number(width)}, ${Number(first)}, ${Number(last)})");
  result.pages.forEach((b64, i) => fs.writeFileSync(${JSON.stringify(resolve(outDir))} + "/" + ${JSON.stringify(basename(pdf, ".pdf"))} + "-p" + String(${Number(first)} + i).padStart(2, "0") + ".png", Buffer.from(b64, "base64")));
  console.log(result.pages.length + " of " + result.count + " pages written");
  app.quit();
});`);
const electron = createRequire(import.meta.url)("electron");
process.exit(spawnSync(electron, [join(out, "main.cjs")], { stdio: "inherit" }).status ?? 1);
