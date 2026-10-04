import { parseMathml, latexMathml, nary, integrals, accents, textOf, elements, type Node } from "./docx-math.ts";

/**
 * LaTeX as OMML (Office Math) XML, for equations inside PowerPoint text. It walks the same KaTeX MathML as `wordMath`
 * (desktop/docx-math.ts) and covers the same subset: scripts, fractions, roots, n-ary sums and integrals, limits, accents
 * and brackets. Anything without an OMML counterpart (matrices, aligned rows, labelled arrows) returns null and the
 * caller writes the improved plain text instead.
 */
class Unsupported extends Error {}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tag = (name: string, inner = "") => (inner ? `<m:${name}>${inner}</m:${name}>` : `<m:${name}/>`);
const prop = (name: string, value: string) => `<m:${name} m:val="${esc(value)}"/>`;
/** Properties for the run text inside an equation: PowerPoint wants the DrawingML run properties (size, colour, Cambria Math) there. */
type Rpr = (upright: boolean) => string;

function run(text: string, upright: boolean, rpr: Rpr) {
  return `<m:r>${upright ? tag("rPr", prop("sty", "p")) : ""}${rpr(upright)}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
}

function convert(n: Node, rpr: Rpr): string {
  switch (n.tag) {
    case "#root": case "math": case "semantics": case "mrow": case "mstyle": case "mpadded": case "menclose": case "mtd":
      return row(elements(n), rpr);
    case "annotation": case "annotation-xml": case "mphantom": case "none":
      return "";
    case "mi": case "mn": case "mo": case "mtext": case "ms": {
      const text = textOf(n).replace(/[⁡-⁣]/g, "");
      if (!text) return "";
      const upright = n.tag === "mtext" || (n.tag === "mi" && (n.attrs.mathvariant === "normal" || [...text].length > 1));
      return run(n.tag === "mtext" ? text.replace(/ /g, " ") : text, upright, rpr);
    }
    case "mspace": return run(" ", false, rpr);
    case "msup": { const [b, s] = elements(n); return tag("sSup", tag("e", convert(b, rpr)) + tag("sup", convert(s, rpr))); }
    case "msub": { const [b, s] = elements(n); return tag("sSub", tag("e", convert(b, rpr)) + tag("sub", convert(s, rpr))); }
    case "msubsup": { const [b, sub, sup] = elements(n); return tag("sSubSup", tag("e", convert(b, rpr)) + tag("sub", convert(sub, rpr)) + tag("sup", convert(sup, rpr))); }
    case "mfrac": { const [a, b] = elements(n); return tag("f", tag("num", convert(a, rpr)) + tag("den", convert(b, rpr))); }
    case "msqrt": return tag("rad", tag("radPr", prop("degHide", "1")) + tag("deg") + tag("e", row(elements(n), rpr)));
    case "mroot": { const [b, i] = elements(n); return tag("rad", tag("radPr") + tag("deg", convert(i, rpr)) + tag("e", convert(b, rpr))); }
    case "munder": case "mover": case "munderover": return limits(n, "", rpr);
    default: throw new Unsupported(n.tag);
  }
}

/** n-ary operators take the next part of the row as their body; fenced groups become brackets. */
function row(items: Node[], rpr: Rpr): string {
  const first = items[0], last = items[items.length - 1];
  if (items.length >= 2 && first.tag === "mo" && last.tag === "mo" && first.attrs.fence === "true" && last.attrs.fence === "true") {
    const open = textOf(first), close = textOf(last);
    if ((open === "(" && close === ")") || (open === "[" && close === "]") || (open === "{" && close === "}") || ((open === "⟨" || open === "〈") && (close === "⟩" || close === "〉")))
      return tag("d", tag("dPr", prop("begChr", open) + prop("endChr", close)) + tag("e", row(items.slice(1, -1), rpr)));
  }
  let out = "";
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const base = ["munder", "mover", "munderover", "msub", "msup", "msubsup"].includes(item.tag) ? elements(item)[0] : item;
    const symbol = base && base.tag === "mo" ? textOf(base) : "";
    if (nary.has(symbol) || integrals.has(symbol)) {
      const body = items[i + 1] && !(items[i + 1].tag === "mo" && /^[=+\-−<>≤≥≈≠,;]$/.test(textOf(items[i + 1]))) ? convert(items[++i], rpr) : "";
      out += limits(item, body, rpr);
    } else out += convert(item, rpr);
  }
  return out;
}

function limits(n: Node, body: string, rpr: Rpr): string {
  const parts = elements(n), [base] = parts;
  const under = n.tag === "munder" || n.tag === "msub" || n.tag === "munderover" || n.tag === "msubsup" ? parts[1] : undefined;
  const over = n.tag === "mover" || n.tag === "msup" ? parts[1] : n.tag === "munderover" || n.tag === "msubsup" ? parts[2] : undefined;
  const symbol = base?.tag === "mo" ? textOf(base) : "";
  if (base?.tag === "mo" && base.attrs.stretchy === "true" && /[←→↔⇐⇒⇔⟵⟶⟷⟸⟹⟺↦⇌⇋]/.test(symbol)) throw new Unsupported("labelled arrow");
  const sub = under ? convert(under, rpr) : "", sup = over ? convert(over, rpr) : "";
  if (nary.has(symbol) || integrals.has(symbol)) {
    const props = prop("chr", symbol) + prop("limLoc", integrals.has(symbol) ? "subSup" : "undOvr") + (sub ? "" : prop("subHide", "1")) + (sup ? "" : prop("supHide", "1"));
    return tag("nary", tag("naryPr", props) + tag("sub", sub) + tag("sup", sup) + tag("e", body));
  }
  if (n.tag === "msub" || n.tag === "msup" || n.tag === "msubsup") return convert(n, rpr) + body;
  // An accent (vector arrow, hat, bar) is an accent over its base.
  if (n.tag === "mover" && n.attrs.accent === "true" && over) {
    const mark = accents[textOf(over).trim()];
    if (mark) return tag("acc", tag("accPr", prop("chr", mark)) + tag("e", convert(base, rpr))) + body;
  }
  let result = convert(base, rpr);
  if (under) result = tag("limLow", tag("e", result) + tag("lim", sub));
  if (over) result = tag("limUpp", tag("e", result) + tag("lim", sup));
  return result + body;
}

/** `<m:oMath>` for inline LaTeX, or null when the LaTeX is invalid or has no OMML form. `rpr` supplies each run's DrawingML properties. */
export function latexOmml(latex: string, rpr: Rpr = () => ""): string | null {
  try {
    const xml = convert(parseMathml(latexMathml(latex, false)), rpr);
    return xml ? tag("oMath", xml) : null;
  } catch {
    return null;
  }
}
