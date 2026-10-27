import { test } from "node:test";
import assert from "node:assert/strict";
import { drawnArrows, uprightChemistry } from "../../desktop/math-draw.ts";
import { latexMathml, wordMath } from "../../desktop/docx-math.ts";
import { markdownHtml } from "../../desktop/pdf-markdown.ts";

test("chemical equations and formulas are set upright; physics and algebra are left alone", () => {
  assert.equal(uprightChemistry(String.raw`6\,CO_2 + 6\,H_2O \xrightarrow{\text{light}} C_6H_{12}O_6 + 6\,O_2`), String.raw`6\,\mathrm{CO}_2 + 6\,\mathrm{H}_2\mathrm{O} \xrightarrow{\text{light}} \mathrm{C}_6\mathrm{H}_{12}\mathrm{O}_6 + 6\,\mathrm{O}_2`);
  assert.equal(uprightChemistry("H_2O"), String.raw`\mathrm{H}_2\mathrm{O}`);
  assert.equal(uprightChemistry(String.raw`NaCl(aq) \rightarrow Na^+(aq) + Cl^-(aq)`), String.raw`\mathrm{NaCl}(\mathrm{aq}) \rightarrow \mathrm{Na}^+(\mathrm{aq}) + \mathrm{Cl}^-(\mathrm{aq})`);
  assert.equal(uprightChemistry(String.raw`N_2 + 3H_2 \rightleftharpoons 2NH_3`), String.raw`\mathrm{N}_2 + 3\mathrm{H}_2 \rightleftharpoons 2\mathrm{NH}_3`);
  for (const stays of [String.raw`P_1V_1 = P_2V_2`, "N_0 e^{-\\lambda t}", "V = IR", "F = ma", String.raw`x \to \infty`, "A \\to B", "H_2", "BC", String.raw`\ce{H2O}`, String.raw`\frac{C}{V}`, "E = mc^2"])
    assert.equal(uprightChemistry(stays), stays, stays);
});

test("Word equations get upright elements too", () => {
  assert.match(latexMathml("C_6H_{12}O_6", false), /mathvariant="normal"/);
  assert.ok(wordMath("CO_2 \\to C + O_2"));
  // Word would draw a labelled arrow short with its label as a limit, so it becomes a picture (drawn correctly) instead.
  assert.equal(wordMath(String.raw`A \xrightarrow{\text{light}} B`), null);
  assert.equal(wordMath(String.raw`\ce{A ->[light] B}`), null);
  assert.ok(wordMath(String.raw`\overrightarrow{AB}`), "vector arrows stay native Word accents");
});

test("an arrow with a label is drawn as wide as its label, above and below; other maths is unchanged", () => {
  const one = drawnArrows(latexMathml(String.raw`A \xrightarrow{\text{light}} B`, true));
  assert.doesNotMatch(one, /stretchy="true"/);
  assert.match(one, /border-bottom:0\.045em solid currentColor/);
  assert.doesNotMatch(one.slice(one.indexOf("<mphantom>"), one.indexOf("</mphantom>")), /width="\+/, "KaTeX's relative padding is not used to measure the label");
  assert.match(one, /<mphantom>[\s\S]*light[\s\S]*<\/mphantom>/, "the shaft is measured on the label");
  assert.match(one, /<mtext>light<\/mtext>[\s\S]*<\/mover>/, "the label is still shown");
  const both = drawnArrows(latexMathml(String.raw`A \xleftarrow[x]{y} B`, true));
  assert.match(both, /<mo lspace="0" rspace="0" stretchy="false">←<\/mo>/);
  assert.match(both, /<munder><mrow>[\s\S]*<mi>x<\/mi>[\s\S]*<mi>y<\/mi>/, "measured on the wider of the two labels");
  assert.match(drawnArrows(latexMathml(String.raw`A \xRightarrow{f} B`, true)), /padding:0 0 0\.155em[\s\S]*border-bottom[\s\S]*⇒/, "a double arrow is two strokes");
  // mhchem's labelled arrows (\ce{… ->[light] …}) are drawn the same way.
  const ce = drawnArrows(latexMathml(String.raw`\ce{6CO2 + 6H2O ->[light] C6H12O6 + 6O2}`, true));
  assert.match(ce, /<mphantom>[\s\S]*>l<\/mi><mi[^>]*>i<\/mi>[\s\S]*<\/mphantom>/, "measured on mhchem's letter-by-letter label");
  assert.doesNotMatch(ce, /stretchy="true"/);
  const vector = drawnArrows(latexMathml(String.raw`\overrightarrow{AB}`, true));
  assert.match(vector, /<mover accent="true">[\s\S]*<mphantom>[\s\S]*<mi>A<\/mi>/);
  for (const plain of [String.raw`\frac{a}{b}`, String.raw`\sum_{i=1}^n i`, String.raw`\hat{x}`, String.raw`a \to b`]) {
    const mathml = latexMathml(plain, true);
    assert.equal(drawnArrows(mathml), mathml, plain);
  }
});

test("PDFs draw labelled arrows and upright chemistry as well", () => {
  const html = markdownHtml("Photosynthesis:\n\n$$6CO_2 + 6H_2O \\xrightarrow{\\text{light}} C_6H_{12}O_6 + 6O_2$$\n\nInline $H_2O$ and physics $P_1V_1 = P_2V_2$.");
  // PDFs use KaTeX's HTML layout, which draws the arrow to its label's width itself (an SVG under the label).
  assert.match(html, /class="mrel x-arrow"[\s\S]*?light[\s\S]*?<svg/);
  assert.match(html, /<span class="mord mathrm">C<\/span>/);
  assert.match(html, /<span class="mord mathnormal"[^>]*>P<\/span>/, "physics stays italic");
});

test("PDF maths is fenced, so cross-reference links never reach inside a formula", () => {
  const html = markdownHtml("See $\\text{Figure 2}$ and\n\n$$\\begin{aligned} a &= 1 \\\\ b &= 2 \\end{aligned}$$");
  assert.equal((html.match(/<x-math>/g) || []).length, 2);
  assert.match(html, /<x-math><span class="katex-display">/);
  assert.doesNotMatch(html, /<math/);
});
