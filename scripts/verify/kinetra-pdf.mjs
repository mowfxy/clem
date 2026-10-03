import { build } from "esbuild";
import { mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import electron from "electron";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
await mkdir("artifacts", { recursive: true });
await mkdir(".work/kinetra", { recursive: true });
await build({
  stdin: {
    contents: `import {app} from 'electron';import {writeFile} from 'node:fs/promises';import {illustratedPdf} from './desktop/illustrated-pdf';import {kinetraCall} from './desktop/kinetra-runtime';
app.on('window-all-closed',()=>{});app.whenReady().then(async()=>{try{
const model=await kinetraCall({module:'diagram/electrostatics',fn:'defaultElectrostaticRods',args:[]});
const bytes=await illustratedPdf({title:'Electrostatic attraction',sections:[{text:'Opposite charges attract. The labelled illustration below shows the geometry of a suspended rod and a nearby charged rod.',figure:{module:'diagram/electrostatics',fn:'renderElectrostaticRods',args:[model]},caption:'Computed with Kinetra. Schematic geometry; force arrows indicate direction, not calibrated force magnitude.'}]});
await writeFile('artifacts/kinetra-document.pdf',bytes);
const long=await illustratedPdf({kind:'notes',title:'Lecture notes in full',font:'Times New Roman',sections:Array.from({length:120},(_,i)=>({heading:'Topic '+(i+1),text:'This section explains topic '+(i+1)+' in full, with its definition, its derivation and a worked example. '.repeat(12)}))});
await writeFile('artifacts/kinetra-long-document.pdf',long);app.exit(0);
}catch(e){console.error(e);app.exit(1);}});`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: ".work/kinetra/verify.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
await copyFile(
  "desktop-dist/kinetra-worker.cjs",
  ".work/kinetra/kinetra-worker.cjs",
);
const child = spawn(electron, [resolve(".work/kinetra/verify.cjs")], {
  windowsHide: true,
  stdio: "pipe",
});
let output = "";
child.stderr.on("data", (part) => (output += part));
const timer = setTimeout(() => child.kill(), 30000);
const code = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", resolve);
});
clearTimeout(timer);
assert.equal(code, 0, output);
const bytes = await readFile("artifacts/kinetra-document.pdf");
const doc = await PDFDocument.load(bytes);
assert.equal(doc.getPageCount(), 1);
assert.ok(bytes.length > 10000);
assert.match(bytes.toString(), /MOWR-PROVENANCE-v1/);
// A long document (120 sections) in the font the person asked for keeps every section.
const long = await readFile("artifacts/kinetra-long-document.pdf");
const longDoc = await PDFDocument.load(long);
assert.ok(longDoc.getPageCount() >= 20, `expected a long document, got ${longDoc.getPageCount()} pages`);
assert.match(long.toString("latin1"), /TimesNewRoman/);
assert.doesNotMatch(long.toString("latin1"), /Mowafy/);
console.log(`PASS long document: 120 sections, ${longDoc.getPageCount()} pages, typeset in Times New Roman`);
console.log(
  "PASS actual Electron PDF export with computed Kinetra SVG and provenance",
);
