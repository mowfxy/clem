// Real documents for fixtures: Mowr's own document template (desktop/pdf-document.ts) printed by
// Chromium, which is how the desktop app prints them, plus a plain "teacher's handout" PDF.
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

let template;
async function documentHtml() {
  if (template) return template;
  const out = resolve(".work/fixture/document-html.mjs");
  await mkdir(resolve(".work/fixture"), { recursive: true });
  await build({ stdin: { contents: "export {documentHtml} from './desktop/pdf-document.ts';", resolveDir: process.cwd(), loader: "ts" }, outfile: out, bundle: true, platform: "node", format: "esm", external: ["electron"], logLevel: "error", banner: { js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" } });
  template = (await import(pathToFileURL(out).href + "?v=" + Date.now())).documentHtml;
  return template;
}

/** Returns spec → PDF bytes, printed the way Mowr prints generated documents. */
export async function specPrinter(browser) {
  const html = await documentHtml();
  const page = await browser.newPage();
  return async (spec) => {
    await page.setContent(html(spec, []), { waitUntil: "load" });
    return new Uint8Array(await page.pdf({ printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: '<div style="width:100%;margin:0 21mm;padding-top:5px;border-top:0.5px solid #c4c8cd;font:7.5px Segoe UI,Arial,sans-serif;color:#80868e;display:flex;justify-content:space-between"><span class="title"></span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>' }));
  };
}

export const worksheetSpec = {
  title: "Cell biology worksheet",
  subtitle: "Biology 101 · Week 3",
  kind: "worksheet",
  date: "2026-09-24",
  sections: [
    { heading: "Organelles", text: "1. Name the organelle that makes most of a cell's ATP.\n\n2. Ribosomes build proteins. Where in the cell are they found?\n\n3. Describe what the Golgi apparatus does with new proteins." },
    { heading: "Membranes", text: "4. Explain what *selectively permeable* means, with one example of a molecule that crosses easily.\n\n5. A plant cell is placed in pure water. Predict what happens and explain why." },
    { heading: "Challenge", text: "6. Muscle cells contain far more mitochondria than skin cells. Suggest why." },
  ],
};

/** A handout someone else made: ordinary fonts, a table, no Mowr source behind it. */
export async function handoutPdf(browser) {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><style>body{font-family:Arial,Helvetica,sans-serif;margin:56px 64px;color:#1a1a1a}h1{font-size:22px;margin:0 0 4px}p{font-size:13px;line-height:1.6;margin:6px 0}.meta{color:#666;font-size:12px}table{border-collapse:collapse;margin:14px 0}td,th{border:1px solid #bbb;padding:6px 14px;font-size:12.5px}th{background:#f1f1f1}</style>
<h1>Osmosis lab — potato cylinders</h1><p class="meta">Mr Hale · Due Friday 26 September</p>
<p>Cut five potato cylinders of equal length. Weigh each one, then leave them in sucrose solutions for 30 minutes.</p>
<table><tr><th>Sucrose (M)</th><th>Mass change (%)</th></tr><tr><td>0.0</td><td>+18</td></tr><tr><td>0.2</td><td>+6</td></tr><tr><td>0.4</td><td>-4</td></tr><tr><td>0.6</td><td>-13</td></tr></table>
<p>1. Plot mass change against sucrose concentration.</p>
<p>2. Estimate the concentration at which the mass does not change.</p>
<p>3. Explain the result for 0.0 M using the word osmosis.</p>`);
  const bytes = new Uint8Array(await page.pdf({ format: "A4", printBackground: true }));
  await page.close();
  return bytes;
}
