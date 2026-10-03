import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { runKinetraTurn, toolRequests } from "../../desktop/kinetra-turn.ts";
import { kinetraInstructionsFor, kinetraTool } from "../../desktop/kinetra-runtime.ts";
import { fileGuidesFor, fileIntent, FILE_ACTIONS } from "../../desktop/file-guides.ts";
import { excelWorkbook, resolveFormula, workbookProblems } from "../../desktop/xlsx-workbook.ts";
import { wordMath, plainMath, wordUpright, UPRIGHT } from "../../desktop/docx-math.ts";
import { namedPages } from "../../core/file-tools.ts";

test("every file action is a tool request the loop dispatches", () => {
  for (const action of FILE_ACTIONS) assert.deepEqual(toolRequests(`{"kinetra":{"action":"${action}","title":"T"}}`), [{ action, title: "T" }]);
  assert.deepEqual(toolRequests('{"kinetra":{"action":"look","file":"a.pdf","pages":[2]}}'), [{ action: "look", file: "a.pdf", pages: [2] }]);
});

test("file actions reach the maker, and say so plainly when files cannot be made", async () => {
  const seen: any[] = [];
  for (const action of FILE_ACTIONS) await kinetraTool({ action, title: "x" }, async (spec) => { seen.push(spec.action); return { created: true }; });
  assert.deepEqual(seen, [...FILE_ACTIONS]);
  await assert.rejects(kinetraTool({ action: "pptx", slides: [] }), /not available/);
  assert.match(await kinetraTool({ action: "skill", name: "slides" }), /SLIDES SKILL/);
  assert.match(await kinetraTool({ action: "skill", name: "spreadsheets" }), /\{row\}/);
});

test("requests for Office and other files get the tool guide with the matching design skill", () => {
  for (const ask of ["make me a powerpoint on photosynthesis", "turn this into an excel budget", "write my CV as a word document", "export the schedule as a .ics calendar file"]) {
    assert.ok(fileIntent.test(ask), ask);
    assert.match(kinetraInstructionsFor(ask), /FILES: Mowr makes real files/);
  }
  assert.match(fileGuidesFor("a slide deck for my thesis defence"), /SLIDES SKILL/);
  assert.doesNotMatch(fileGuidesFor("a slide deck for my thesis defence"), /SPREADSHEETS SKILL/);
  assert.match(fileGuidesFor("an excel tracker"), /SPREADSHEETS SKILL/);
  assert.doesNotMatch(kinetraInstructionsFor("how are you today?"), /FILES:/);
});

test("a page the model looks at goes with its next message, once with a thread and every time without one", async () => {
  for (const stateful of [true, false]) {
    const sent: unknown[][] = [];
    let step = 0;
    await runKinetraTurn<string>("q", "i", async (_input, _followUp, pictures) => {
      sent.push(pictures);
      step++;
      return step === 1 ? '{"kinetra":{"action":"look","file":"a.pdf","pages":[3]}}' : step === 2 ? '{"kinetra":{"action":"files"}}' : "The circuit has two resistors.";
    }, async (request) => (request.action === "look" ? { pictures: ["a.pdf — page 3"], attachPictures: ["page3.jpg"] } : { files: [] }), () => false, { stateful });
    assert.deepEqual(sent, stateful ? [[], ["page3.jpg"], []] : [[], ["page3.jpg"], ["page3.jpg"]]);
  }
});

test("pages named in a message are found", () => {
  assert.deepEqual(namedPages("explain the circuit on page 4 and pp. 7-9, also slide 12"), [4, 7, 8, 9, 12]);
  assert.deepEqual(namedPages("no pages here"), []);
});

test("workbook formulas use row placeholders and column names", () => {
  assert.equal(resolveFormula("[Price]{row}*[Qty]{row}", 5, 2, 9, ["Item", "Price", "Qty"]), "B5*C5");
  assert.equal(resolveFormula("SUM(D{first}:D{last})", 5, 2, 9, []), "SUM(D2:D9)");
  assert.match(workbookProblems({ sheets: [{ name: "a/b", columns: [], rows: [] }] }).join(" "), /name/);
  assert.match(workbookProblems({ sheets: [{ name: "S", columns: [{ header: "x" }], rows: [[1]], charts: [{ type: "pie", categories: "nope", series: ["x"] }] }] }).join(" "), /categories/);
});

test("a workbook is valid Office XML with live formulas, real dates, styles and charts", () => {
  const bytes = excelWorkbook({
    sheets: [{ name: "Budget", title: "Budget 2026", columns: [{ header: "Month" }, { header: "In", format: "currency" }, { header: "Out", format: "currency" }, { header: "Saved", format: "currency" }, { header: "Paid", format: "date" }], rows: [["Jan", 10, 4, "=[In]{row}-[Out]{row}", "2026-01-31"], ["Feb", 12, 5, "=B{row}-C{row}", "2026-02-28"]], totals: { columns: { In: "sum" } }, charts: [{ type: "column", categories: "Month", series: ["In", "Out"] }] }],
  });
  const files = unzipSync(bytes);
  for (const part of ["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/charts/chart1.xml", "xl/drawings/drawing1.xml"]) assert.ok(files[part], part);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /<f>B4-C4<\/f>/);
  assert.match(sheet, /<f>SUM\(B4:B5\)<\/f>/);
  assert.match(sheet, /<c r="E4" s="\d+"><v>46053<\/v><\/c>/);
  assert.match(sheet, /state="frozen"/);
  assert.match(strFromU8(files["xl/workbook.xml"]), /fullCalcOnLoad="1"/);
  assert.match(strFromU8(files["xl/charts/chart1.xml"]), /'Budget'!\$B\$4:\$B\$5/);
});

test("LaTeX becomes native Word equations, upright where it should be", () => {
  for (const latex of [String.raw`\frac{a}{b}`, String.raw`\sum_{i=1}^{n} x_i`, String.raw`\int_0^1 f(x)\,dx`, String.raw`\sqrt[3]{x}`, String.raw`\lim_{x\to 0}\frac{\sin x}{x}`, String.raw`\vec{v}`]) assert.ok(wordMath(latex, true), latex);
  // A matrix has no Word counterpart here: the caller prints it as a picture.
  assert.equal(wordMath(String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`, true), null);
  assert.equal(plainMath(String.raw`x^2 + \frac{1}{2}`), "x²+1/2");
  assert.equal(wordUpright(`<m:r><m:t>${UPRIGHT}mA</m:t></m:r>`), '<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>mA</m:t></m:r>');
});
