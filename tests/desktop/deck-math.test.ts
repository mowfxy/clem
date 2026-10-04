import { test } from "node:test";
import assert from "node:assert/strict";
import PptxGenJS from "pptxgenjs";
import { unzipSync, strFromU8 } from "fflate";
import { plainMath } from "../../desktop/docx-math.ts";
import { latexOmml } from "../../desktop/omml.ts";
import { embedMath, unmark } from "../../desktop/deck-math.ts";
import { runs } from "../../desktop/deck-text.ts";

test("plain-text maths reads well: vectors, labelled arrows, fractions, roots, sums", () => {
  assert.equal(plainMath(String.raw`\overrightarrow{AB}`), "A⃗B⃗");
  assert.equal(plainMath(String.raw`\vec{v}`), "v⃗");
  assert.equal(plainMath(String.raw`A \xleftarrow{f} B`), "A ←f– B");
  assert.equal(plainMath(String.raw`A \xrightarrow{f} B`), "A –f→ B");
  assert.equal(plainMath(String.raw`A \xRightarrow{f} B`), "A =f⇒ B");
  assert.equal(plainMath(String.raw`\frac{dy}{dx}`), "dy/dx");
  assert.equal(plainMath(String.raw`\frac{a+b}{c}`), "(a+b)/c");
  assert.equal(plainMath(String.raw`\frac{1}{2}`), "1/2");
  assert.equal(plainMath(String.raw`\sqrt{x}`), "√x");
  assert.equal(plainMath(String.raw`\sqrt{a+b}`), "√(a+b)");
  assert.equal(plainMath(String.raw`\sqrt[3]{x}`), "³√x");
  assert.equal(plainMath(String.raw`\sum_{i=1}^{n} x_i`), "∑ᵢ₌₁ⁿxᵢ");
  assert.equal(plainMath(String.raw`\int_0^1 f`), "∫₀¹f");
  assert.equal(plainMath(String.raw`\sum_{k=A}^{B} k`), "∑_(k=A)^Bk");
  // What was already fine is unchanged.
  assert.equal(plainMath(String.raw`x^2 + \frac{1}{2}`), "x²+1/2");
  assert.equal(plainMath(String.raw`F = ma`), "F=ma");
  assert.equal(plainMath(String.raw`E = mc^2`), "E=mc²");
  assert.equal(plainMath(String.raw`\alpha + \beta`), "α+β");
  assert.equal(plainMath(String.raw`\hat{x}`), "x̂");
});

test("inline maths becomes OMML: fractions, scripts, vectors, chemistry; labelled arrows have none", () => {
  const xml = (latex: string) => latexOmml(latex)!;
  for (const latex of [String.raw`\frac{a}{b}`, "x_i", "x^2", String.raw`\overrightarrow{AB}`, String.raw`\sqrt{x}`, String.raw`\sum_{i=1}^{n} x_i`, "(a+b)^2", "H_2O", String.raw`6CO_2 + 6H_2O \to C_6H_{12}O_6`]) {
    const out = xml(latex);
    assert.match(out, /^<m:oMath>[\s\S]*<\/m:oMath>$/, latex);
    // Well formed: every tag closes in order.
    const stack: string[] = [];
    for (const m of out.matchAll(/<(\/?)([\w:]+)([^>]*?)(\/?)>/g)) { if (m[4]) continue; if (m[1]) assert.equal(stack.pop(), m[2], latex); else stack.push(m[2]); }
    assert.deepEqual(stack, [], latex);
  }
  assert.match(xml(String.raw`\frac{a}{b}`), /<m:f><m:num><m:r>.*<m:t[^>]*>a<\/m:t><\/m:r><\/m:num><m:den><m:r>.*<m:t[^>]*>b<\/m:t><\/m:r><\/m:den><\/m:f>/);
  assert.match(xml("x_i"), /<m:sSub><m:e>.*<\/m:e><m:sub>.*<\/m:sub><\/m:sSub>/);
  assert.match(xml(String.raw`\overrightarrow{AB}`), /<m:acc><m:accPr><m:chr m:val="⃗"\/><\/m:accPr><m:e>.*A.*B.*<\/m:e><\/m:acc>/);
  assert.match(xml(String.raw`\sum_{i=1}^{n} x_i`), /<m:nary><m:naryPr><m:chr m:val="∑"\/>/);
  assert.match(xml("(a+b)^2"), /<m:sSup>/);
  assert.match(xml("H_2O"), /<m:sty m:val="p"\/>/, "chemistry stays upright");
  assert.equal(latexOmml(String.raw`A \xrightarrow{f} B`), null);
  assert.equal(latexOmml(String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`), null);
  assert.equal(latexOmml(String.raw`\frac{`), null, "invalid LaTeX has none");
  // The caller's run properties go inside every run.
  assert.match(latexOmml("x", () => '<a:rPr sz="2000"/>')!, /<m:r><a:rPr sz="2000"\/><m:t/);
});

test("a pptx text run with inline maths becomes an equation with its plain fallback", async () => {
  const pptx = new PptxGenJS();
  pptx.addSlide().addText(runs(String.raw`Vector $\overrightarrow{AB}$ and $\frac{a}{b}$ then $A \xleftarrow{f} B$, all **bold** and $5 and $6.`, { fontSize: 20, color: "112233" }) as any, { x: 1, y: 1, w: 6, h: 1 });
  const files = unzipSync(embedMath(new Uint8Array((await pptx.write({ outputType: "nodebuffer" })) as Buffer)));
  const xml = strFromU8(files["ppt/slides/slide1.xml"]);
  assert.equal((xml.match(/<a14:m>/g) || []).length, 2, "two equations; the labelled arrow stays plain text");
  assert.match(xml, /<mc:AlternateContent><mc:Choice Requires="a14"><a14:m><m:oMath>/);
  assert.match(xml, /<mc:Fallback><a:r><a:rPr[\s\S]*?<a:t>A⃗B⃗<\/a:t><\/a:r><\/mc:Fallback>/);
  assert.match(xml, /<a:t>A ←f– B<\/a:t>/);
  assert.match(xml, /<p:sld[^>]*xmlns:a14="[^"]+"/);
  assert.match(xml, /<p:sld[^>]*xmlns:m="[^"]+"/);
  assert.match(xml, /sz="2000"[^>]*>[\s\S]*?Cambria Math/, "equations keep the text's size");
  assert.match(xml, /5 and \$6/, "money is left alone");
  assert.doesNotMatch(xml, /[-]/, "no markers left in the file");
  assert.equal(unmark(runs("$x^2$")[0].text), "x²");
  // Without maths the bytes are untouched.
  const plain = new PptxGenJS();
  plain.addSlide().addText("hello", { x: 1, y: 1, w: 3, h: 1 });
  const raw = new Uint8Array((await plain.write({ outputType: "nodebuffer" })) as Buffer);
  assert.equal(embedMath(raw), raw);
});
