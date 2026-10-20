// Draws an Office file with the in-app viewer (src/office-preview) in Chromium and saves each slide, page or sheet as a PNG,
// to compare with what Office itself draws. Usage: node scripts/verify/office-preview.mjs <file.pptx|docx|xlsx> <out dir> [width px = 1000]
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join, basename } from "node:path";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";

// With no file given (as in verify:all) it draws the briefing in tests/fixtures/office.
const [file = "tests/fixtures/office/brief.docx", outDir = "test-results/office-preview", width = "1000"] = process.argv.slice(2);
const out = join(tmpdir(), "clem-verify-preview");
await mkdir(out, { recursive: true });
await mkdir(resolve(outDir), { recursive: true });
await build({
  stdin: { contents: `import {createRoot} from "react-dom/client";import OfficePreview from "./src/office-preview/index.tsx";
window.draw=(bytes,name,changed=[])=>{const blob=new Blob([new Uint8Array(bytes)]);createRoot(document.getElementById("root")).render(<OfficePreview blob={blob} name={name} changed={new Set(changed)} fallback={<p id="fallback">FALLBACK: the file could not be drawn</p>}/>);};`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, format: "esm", platform: "browser", outfile: join(out, "page.js"), logLevel: "warning", jsx: "automatic", loader: { ".css": "css" },
});
await writeFile(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="page.css"><style>:root{--sans:"Segoe UI",sans-serif;--serif:Georgia,serif}html,body{margin:0;background:#141413;color:#eee}</style><div id="root"></div><script type="module" src="page.js"></script>`);
await writeFile(join(out, "main.cjs"), `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: ${Number(width)}, height: 900, webPreferences: { offscreen: true, contextIsolation: false, webSecurity: false } });
  w.webContents.on("console-message", (_e, level, message) => { if (level >= 2) console.log("console:", message.slice(0, 300)); });
  await w.loadFile(${JSON.stringify(join(out, "index.html"))});
  const bytes = [...fs.readFileSync(${JSON.stringify(resolve(file))})];
  await w.webContents.executeJavaScript("window.draw(" + JSON.stringify(bytes) + ", " + JSON.stringify(${JSON.stringify(basename(file))}) + ")");
  // Wait for the preview (or its fallback) to appear and settle.
  for (let i = 0; i < 100; i++) { const ready = await w.webContents.executeJavaScript("!!document.querySelector('.op-slide-card,.op-page-card,.op-xlsx,#fallback')"); if (ready) break; await new Promise((r) => setTimeout(r, 100)); }
  await new Promise((r) => setTimeout(r, 1200));
  const total = await w.webContents.executeJavaScript("document.documentElement.scrollHeight");
  w.setContentSize(${Number(width)}, Math.min(total + 20, 12000));
  await new Promise((r) => setTimeout(r, 600));
  const rects = await w.webContents.executeJavaScript("[...document.querySelectorAll('.op-slide-card,.op-page-card')].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y+scrollY,r.width,r.height]})");
  const fallback = await w.webContents.executeJavaScript("!!document.getElementById('fallback')");
  if (fallback) console.log("FALLBACK shown");
  const targets = rects.length ? rects : [[0, 0, ${Number(width)}, Math.min(total, 12000)]];
  for (const [i, [x, y, ww, hh]] of targets.entries()) {
    await w.webContents.executeJavaScript("window.scrollTo(0," + Math.max(0, y - 10) + ")");
    await new Promise((r) => setTimeout(r, 120));
    const sy = await w.webContents.executeJavaScript("window.scrollY");
    const image = await w.webContents.capturePage({ x: Math.round(x), y: Math.round(y - sy), width: Math.round(ww), height: Math.min(Math.round(hh), 12000 - Math.round(y - sy)) });
    fs.writeFileSync(${JSON.stringify(resolve(outDir))} + "/" + ${JSON.stringify(basename(file).replace(/\.[^.]+$/, ""))} + "-" + String(i + 1).padStart(2, "0") + ".png", image.toPNG());
  }
  console.log("TEXT:" + JSON.stringify(await w.webContents.executeJavaScript("document.body.innerText.slice(0,6000)")));
  console.log(targets.length + " image(s) written");
  app.exit(fallback ? 3 : 0);
});`);
const electron = createRequire(import.meta.url)("electron");
process.exit(spawnSync(electron, [join(out, "main.cjs")], { stdio: "inherit", timeout: 180000 }).status ?? 1);
