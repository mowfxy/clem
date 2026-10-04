import { attr, find, kid, kids } from "./package";

/** Word's native equations (OMML) as MathML, which Chromium draws. Covers fractions, scripts, roots, n-ary operators, fences, functions, accents, matrices and limits. */
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const ops = /^[-+−×÷=<>≤≥≠≈±∓·∙∑∏∫∬∭∮∂∇∞→←↔⇒⇔∈∉⊂⊃⊆⊇∪∩∧∨¬∀∃,;:!|()[\]{}/\\^_~*%&′″]$/;
function token(text: string, plain: boolean) {
  // Runs are split into numbers, operators and identifiers, the way MathML wants them.
  return (text.match(/\d+(?:\.\d+)?|[A-Za-zͰ-Ͽ∀-⋿]+|\s+|./gu) || []).map((t) => {
    if (/^\s+$/.test(t)) return "";
    if (/^\d/.test(t)) return `<mn>${esc(t)}</mn>`;
    if (ops.test(t) || /[∀-⋿←-⇿]/.test(t)) return `<mo>${esc(t)}</mo>`;
    return `<mi${plain || t.length > 1 ? ' mathvariant="normal"' : ""}>${esc(t)}</mi>`;
  }).join("");
}
const group = (el: Element | undefined): string => `<mrow>${kids(el).map(node).join("")}</mrow>`;
const arg = (el: Element, name: string) => group(kid(el, name));

function node(el: Element): string {
  const pr = kid(el, el.localName + "Pr");
  switch (el.localName) {
    case "r": {
      const sty = attr(find(kid(el, "rPr") || undefined, "sty"), "val");
      return kids(el, "t").map((t) => token(t.textContent || "", sty === "p" || sty === "b" ? true : false)).join("");
    }
    case "f": return attr(find(pr, "type"), "val") === "noBar" ? `<mfrac linethickness="0">${arg(el, "num")}${arg(el, "den")}</mfrac>` : `<mfrac>${arg(el, "num")}${arg(el, "den")}</mfrac>`;
    case "sSub": return `<msub>${arg(el, "e")}${arg(el, "sub")}</msub>`;
    case "sSup": return `<msup>${arg(el, "e")}${arg(el, "sup")}</msup>`;
    case "sSubSup": return `<msubsup>${arg(el, "e")}${arg(el, "sub")}${arg(el, "sup")}</msubsup>`;
    case "sPre": return `<mmultiscripts>${arg(el, "e")}<mprescripts/>${arg(el, "sub")}${arg(el, "sup")}</mmultiscripts>`;
    case "rad": return attr(find(pr, "degHide"), "val") === "1" || !kid(el, "deg")?.children.length ? `<msqrt>${arg(el, "e")}</msqrt>` : `<mroot>${arg(el, "e")}${arg(el, "deg")}</mroot>`;
    case "nary": {
      const c = esc(attr(find(pr, "chr"), "val") ?? "∫"), sub = kid(el, "sub")?.children.length, sup = kid(el, "sup")?.children.length, limits = attr(find(pr, "limLoc"), "val") === "undOvr" || /[∑∏]/.test(c);
      const op = `<mo largeop="true" stretchy="false">${c}</mo>`;
      const head = sub && sup ? (limits ? `<munderover>${op}${arg(el, "sub")}${arg(el, "sup")}</munderover>` : `<msubsup>${op}${arg(el, "sub")}${arg(el, "sup")}</msubsup>`) : sub ? (limits ? `<munder>${op}${arg(el, "sub")}</munder>` : `<msub>${op}${arg(el, "sub")}</msub>`) : sup ? `<mover>${op}${arg(el, "sup")}</mover>` : op;
      return head + arg(el, "e");
    }
    case "d": {
      const open = attr(find(pr, "begChr"), "val") ?? "(", close = attr(find(pr, "endChr"), "val") ?? ")", sep = attr(find(pr, "sepChr"), "val") ?? "|";
      const parts = kids(el, "e").map((e) => group(e));
      return `<mrow>${open ? `<mo fence="true">${esc(open)}</mo>` : ""}${parts.join(`<mo separator="true">${esc(sep)}</mo>`)}${close ? `<mo fence="true">${esc(close)}</mo>` : ""}</mrow>`;
    }
    case "func": return `<mrow>${arg(el, "fName").replace(/<mi>/g, '<mi mathvariant="normal">')}<mo>&#x2061;</mo>${arg(el, "e")}</mrow>`;
    case "acc": { const c = attr(find(pr, "chr"), "val") ?? "̂"; return `<mover accent="true">${arg(el, "e")}<mo>${esc(c === "̂" ? "^" : c === "̃" ? "~" : c === "̇" ? "˙" : c === "⃗" ? "→" : c === "̅" ? "¯" : c)}</mo></mover>`; }
    case "bar": return attr(find(pr, "pos"), "val") === "bot" ? `<munder>${arg(el, "e")}<mo>_</mo></munder>` : `<mover>${arg(el, "e")}<mo>¯</mo></mover>`;
    case "limLow": return `<munder>${arg(el, "e")}${arg(el, "lim")}</munder>`;
    case "limUpp": return `<mover>${arg(el, "e")}${arg(el, "lim")}</mover>`;
    case "groupChr": return `<mover>${arg(el, "e")}<mo>${esc(attr(find(pr, "chr"), "val") ?? "⏞")}</mo></mover>`;
    case "box": case "phant": case "borderBox": return arg(el, "e");
    case "m": return `<mtable>${kids(el, "mr").map((r) => `<mtr>${kids(r, "e").map((e) => `<mtd>${group(e)}</mtd>`).join("")}</mtr>`).join("")}</mtable>`;
    case "eqArr": return `<mtable>${kids(el, "e").map((e) => `<mtr><mtd>${group(e)}</mtd></mtr>`).join("")}</mtable>`;
    case "e": case "num": case "den": case "sub": case "sup": case "deg": case "lim": case "fName": return group(el);
    default: return kids(el).map(node).join("");
  }
}
/** A MathML string for one m:oMath (or each in an m:oMathPara, shown as a display block). */
export function ommlToMathml(el: Element): string {
  const display = el.localName === "oMathPara";
  const maths = display ? kids(el, "oMath") : [el];
  return maths.map((m) => `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ""}><mrow>${kids(m).map(node).join("")}</mrow></math>`).join("");
}
