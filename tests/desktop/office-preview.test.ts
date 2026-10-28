import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync, strFromU8, strToU8 } from "fflate";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { excelWorkbook } from "../../desktop/xlsx-workbook.ts";

/**
 * The in-app Office viewer runs in Chromium, so these tests draw small files in Electron with scripts/verify/office-preview.mjs
 * (the real src/office-preview code) and read back the text the page shows. Files are built by hand here, so they hold no
 * cached values and nothing but their own XML to go on, like a file from another program.
 */
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const rels = (items: string) => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;
const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

const pptx = () => zip({
  "ppt/presentation.xml": `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
  "ppt/_rels/presentation.xml.rels": rels('<Relationship Id="rId1" Type="x/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="x/slide" Target="slides/slide2.xml"/>'),
  "ppt/slides/slide1.xml": `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="102A43"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="8229600" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="F0B429"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="3200" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Hand-built title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  "ppt/slides/_rels/slide1.xml.rels": rels(""),
  "ppt/slides/slide2.xml": `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="B"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="8229600" cy="3000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:pPr marL="342900" indent="-342900"><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="2400"/><a:t>First bullet</a:t></a:r></a:p><a:p><a:pPr marL="342900" indent="-342900"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:rPr sz="2400"/><a:t>Numbered item</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  "ppt/slides/_rels/slide2.xml.rels": rels(""),
});
const docx = () => zip({
  "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>A heading</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Bold start, </w:t></w:r><w:r><w:t>then plain text.</w:t></w:r></w:p>
    <w:p><m:oMathPara><m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath></m:oMathPara></w:p>
    <w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>On the second page</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>`,
  "word/styles.xml": `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:color w:val="1F4E79"/><w:sz w:val="40"/></w:rPr></w:style></w:styles>`,
  "word/_rels/document.xml.rels": rels(""),
});

/** Draws a file in the viewer; returns what the page shows (or that it fell back to the plain text view). A run whose
 *  Electron never got going (a cold first start on a CI machine once hung for the whole two minutes) is tried once more;
 *  a drawing that fails twice fails the test with what Electron printed. */
function draw(name: string, bytes: Uint8Array) {
  const dir = mkdtempSync(join(tmpdir(), "clem-preview-test-"));
  const file = join(dir, name);
  writeFileSync(file, bytes);
  let run = attempt(file, dir);
  if (run.status !== 0 && run.status !== 3) run = attempt(file, dir);
  const text = /TEXT:(".*")/.exec(run.stdout)?.[1];
  const log = `exit ${run.status ?? run.signal}\n${run.stdout ?? ""}\n${run.stderr ?? ""}`.slice(-3000);
  return { status: run.status, fallback: run.status === 3, text: text ? (JSON.parse(text) as string) : log, images: readdirSync(dir).filter((f) => f.endsWith(".png")) };
}
// The script ends its own Electron after 60s, so a hung one never outlives the attempt.
const attempt = (file: string, dir: string) =>
  spawnSync(process.execPath, ["scripts/verify/office-preview.mjs", file, dir, "900"], { encoding: "utf8", timeout: 90_000, env: { ...process.env, CLEM_PREVIEW_TIMEOUT_MS: "60000" } });

test("a presentation is drawn as slides, with text, bullets and numbering", () => {
  const out = draw("deck.pptx", pptx());
  assert.equal(out.status, 0, out.text);
  assert.deepEqual(out.images.length, 2);
  assert.match(out.text, /Hand-built title/);
  assert.match(out.text, /First bullet/);
  assert.match(out.text, /1\.\s*Numbered item/);
});

test("a Word file is drawn as pages, with styles, equations, tables and page breaks", () => {
  const out = draw("note.docx", docx());
  assert.equal(out.status, 0, out.text);
  assert.equal(out.images.length, 2, "the page break starts a second page");
  assert.match(out.text, /A heading/);
  assert.match(out.text, /Bold start, then plain text\./);
  assert.match(out.text, /Cell A[\s\S]*Cell B/);
  assert.match(out.text, /On the second page/);
});

test("a workbook shows calculated values and number formats even when the file holds no results", () => {
  // Strip the results Clem writes, as a tool that never calculates would leave them.
  const made = excelWorkbook({ sheets: [{ name: "Budget", columns: [{ header: "Item" }, { header: "Qty", format: "integer" }, { header: "Price", format: "currency" }, { header: "Total", format: "currency" }, { header: "Share", format: "percent" }], rows: [["Pen", 3, 1.5, "=B{row}*C{row}", "=D{row}/D{last}"], ["Book", 2, 12, "=B{row}*C{row}", "=D{row}/D{last}"]], totals: { columns: { Total: "sum" } } }] });
  const files = unzipSync(made);
  files["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]).replace(/(<\/f>)<v>[^<]*<\/v>/g, "$1"));
  const out = draw("budget.xlsx", zipSync(files));
  assert.equal(out.status, 0, out.text);
  assert.match(out.text, /\$4\.50/);
  assert.match(out.text, /\$24\.00/);
  assert.match(out.text, /\$28\.50/);
  assert.match(out.text, /18\.8%[\s\S]*100\.0%/);
  assert.doesNotMatch(out.text, /=B2\*C2|\bD2\*/);
});

test("a file that cannot be drawn falls back to the text view instead of showing nothing", () => {
  const out = draw("broken.docx", strToU8("this is not a zip file"));
  assert.equal(out.fallback, true);
  assert.match(out.text, /FALLBACK/);
});
