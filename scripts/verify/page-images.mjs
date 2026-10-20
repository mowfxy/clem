// Checks src/desktop/page-images.ts in a real Chromium renderer: which pages of a PDF are sent as pictures, and the
// pictures found inside a Word file. Usage: node scripts/verify/page-images.mjs <file.pdf> [file.docx]
import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join, basename } from "node:path";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";

const files = process.argv.slice(2).map((f) => resolve(f));
const out = join(tmpdir(), "clem-verify-pages");
await mkdir(out, { recursive: true });
// The page module reads files through the app's store; here the store serves the files given on the command line.
const store = `export async function getBlob(id){const f=window.__files[id];return f?new Blob([f.bytes],{type:f.type}):undefined;}`;
await writeFile(join(out, "store.js"), store);
await build({
  stdin: { contents: `import {conversationPictures} from ${JSON.stringify(resolve("src/desktop/page-images.ts"))};window.run=async(files,prompt)=>{const pics=await conversationPictures({files,attached:files.map(f=>f.id),earlier:[],prompt});return pics.map(p=>p.name+" ("+Math.round(p.data.length*0.75/1024)+" KB)");};`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, format: "esm", platform: "browser", outfile: join(out, "page.js"), logLevel: "warning",
  loader: { ".mjs": "js" },
  plugins: [{ name: "store", setup(b) { b.onResolve({ filter: /\/store$/ }, () => ({ path: join(out, "store.js") })); } }],
});
const worker = createRequire(import.meta.url).resolve("pdfjs-dist/build/pdf.worker.min.mjs");
// page-images asks for the worker at pdfjs-dist/build/ next to the page, as Vite serves it in the app.
await mkdir(join(out, "pdfjs-dist", "build"), { recursive: true });
await writeFile(join(out, "pdfjs-dist", "build", "pdf.worker.min.mjs"), await readFile(worker));
await writeFile(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><script type="module" src="page.js"></script>`);
const payload = await Promise.all(files.map(async (f, i) => ({ id: "f" + i, name: basename(f), type: f.endsWith(".pdf") ? "application/pdf" : "application/octet-stream", size: 1, created: 1, spaceId: null, path: f })));
await writeFile(join(out, "main.cjs"), `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, webSecurity: false } });
  await w.loadFile(${JSON.stringify(join(out, "index.html"))});
  const files = ${JSON.stringify(payload)};
  await w.webContents.executeJavaScript("window.__files={}");
  for (const f of files) await w.webContents.executeJavaScript("window.__files[" + JSON.stringify(f.id) + "]={type:" + JSON.stringify(f.type) + ",bytes:new Uint8Array(" + JSON.stringify([...fs.readFileSync(f.path)]) + ")}");
  const names = await w.webContents.executeJavaScript("window.run(" + JSON.stringify(files) + ", " + JSON.stringify("explain the circuit on page 2") + ")");
  console.log(names.join("\\n"));
  app.quit();
});`);
const electron = createRequire(import.meta.url)("electron");
const result = spawnSync(electron, [join(out, "main.cjs")], { stdio: "inherit" });
process.exit(result.status ?? 1);
