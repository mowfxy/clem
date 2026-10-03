import katex from "katex";
import "katex/contrib/mhchem";
import {
  MathRun, MathFraction, MathSuperScript, MathSubScript, MathSubSuperScript, MathRadical, MathSum, MathIntegral,
  MathLimitLower, MathLimitUpper, MathRoundBrackets, MathSquareBrackets, MathCurlyBrackets, MathAngledBrackets,
} from "docx";
import { mathMacros } from "../core/math-markdown.ts";

/**
 * LaTeX as native Word equations (OMML), so maths in a Word file stays editable in Word's equation editor.
 * KaTeX parses the LaTeX (with the same macros the chat and PDFs use) into MathML, and the MathML maps onto
 * docx's equation parts. Anything without a Word counterpart (matrices, aligned rows) makes `wordMath` return
 * null, and the caller prints that equation as a picture instead.
 */
type Node = { tag: string; attrs: Record<string, string>; children: Node[]; text: string };

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : entities[e] ?? whole);

/** KaTeX's MathML is small and well formed: a tag reader is enough. */
export function parseMathml(xml: string): Node {
  const root: Node = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const token = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(token)) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { if (m[5].trim() || top.tag === "mtext" || top.tag === "mi" || top.tag === "mo") top.text += decode(m[5]); continue; }
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
    const node: Node = { tag: m[2], attrs, children: [], text: "" };
    top.children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}

class Unsupported extends Error {}
/** A private-use mark on maths runs that must be upright; `wordUpright` turns it into Word's plain style. */
export const UPRIGHT = "\ue000";
/** Word part XML with marked maths runs set upright (OMML m:sty "p"). */
export function wordUpright(xml: string) {
  return xml.replace(/<m:r>(<m:t(?: xml:space="preserve")?>)\ue000/g, '<m:r><m:rPr><m:sty m:val="p"/></m:rPr>$1').replace(/\ue000/g, "");
}
const nary = new Set(["∑", "∏", "∐", "⋃", "⋂", "⨁", "⨂", "⨀", "⋁", "⋀"]);
const integrals = new Set(["∫", "∬", "∭", "∮", "∯", "∰"]);
const accents: Record<string, string> = { "^": "\u0302", "ˆ": "\u0302", "¯": "\u0304", "ˉ": "\u0304", "‾": "\u0305", "→": "\u20d7", "\u20d7": "\u20d7", "˙": "\u0307", "¨": "\u0308", "~": "\u0303", "˜": "\u0303", "ˇ": "\u030c", "´": "\u0301", "`": "\u0300", "˘": "\u0306" };
const textOf = (n: Node): string => n.text + n.children.map(textOf).join("");
const elements = (n: Node) => n.children.filter((c) => c.tag !== "annotation" && c.tag !== "annotation-xml");

function convert(n: Node): any[] {
  switch (n.tag) {
    case "#root": case "math": case "semantics": case "mrow": case "mstyle": case "mpadded": case "menclose": case "mtd":
      return row(elements(n));
    case "annotation": case "annotation-xml": case "mphantom": case "none":
      return [];
    case "mi": case "mn": case "mo": case "mtext": case "ms": {
      const text = textOf(n).replace(/\u2061|\u2062|\u2063/g, "");
      if (!text) return [];
      // Upright identifiers (\mathrm{V}, sin, lim, \text{…}) are marked for wordUpright; Word sets the rest in maths italic.
      const upright = n.tag === "mtext" || (n.tag === "mi" && (n.attrs.mathvariant === "normal" || [...text].length > 1));
      return [new MathRun((upright ? UPRIGHT : "") + (n.tag === "mtext" ? text.replace(/ /g, "\u00a0") : text))];
    }
    case "mspace": return [new MathRun("\u2009")];
    case "msup": { const [b, s] = elements(n); return [new MathSuperScript({ children: convert(b), superScript: convert(s) })]; }
    case "msub": { const [b, s] = elements(n); return [new MathSubScript({ children: convert(b), subScript: convert(s) })]; }
    case "msubsup": { const [b, sub, sup] = elements(n); return [new MathSubSuperScript({ children: convert(b), subScript: convert(sub), superScript: convert(sup) })]; }
    case "mfrac": { const [a, b] = elements(n); return [new MathFraction({ numerator: convert(a), denominator: convert(b) })]; }
    case "msqrt": return [new MathRadical({ children: row(elements(n)) })];
    case "mroot": { const [b, i] = elements(n); return [new MathRadical({ children: convert(b), degree: convert(i) })]; }
    case "munder": case "mover": case "munderover": return limits(n, []);
    default: throw new Unsupported(n.tag);
  }
}

/** n-ary operators take the next part of the row as their body, as Word expects; fenced groups become brackets. */
function row(items: Node[]): any[] {
  const out: any[] = [];
  const first = items[0], last = items[items.length - 1];
  if (items.length >= 2 && first.tag === "mo" && last.tag === "mo" && first.attrs.fence === "true" && last.attrs.fence === "true") {
    const open = textOf(first), close = textOf(last), inner = row(items.slice(1, -1));
    const kind = open === "(" && close === ")" ? MathRoundBrackets : open === "[" && close === "]" ? MathSquareBrackets : open === "{" && close === "}" ? MathCurlyBrackets : (open === "⟨" || open === "〈") && (close === "⟩" || close === "〉") ? MathAngledBrackets : null;
    if (kind) return [new kind({ children: inner })];
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const base = item.tag === "munder" || item.tag === "mover" || item.tag === "munderover" || item.tag === "msub" || item.tag === "msup" || item.tag === "msubsup" ? elements(item)[0] : item;
    const symbol = base && base.tag === "mo" ? textOf(base) : "";
    if (nary.has(symbol) || integrals.has(symbol)) {
      // The body is the next element (\sum_i x_i), or nothing when the operator ends the row.
      const body = items[i + 1] && !(items[i + 1].tag === "mo" && /^[=+\-−<>≤≥≈≠,;]$/.test(textOf(items[i + 1]))) ? convert(items[++i]) : [];
      out.push(...limits(item, body));
    } else out.push(...convert(item));
  }
  return out;
}

function limits(n: Node, body: any[]): any[] {
  const parts = elements(n);
  const [base] = parts;
  const under = n.tag === "munder" || n.tag === "msub" ? parts[1] : n.tag === "munderover" || n.tag === "msubsup" ? parts[1] : undefined;
  const over = n.tag === "mover" || n.tag === "msup" ? parts[1] : n.tag === "munderover" || n.tag === "msubsup" ? parts[2] : undefined;
  const symbol = base?.tag === "mo" ? textOf(base) : "";
  const sub = under ? convert(under) : undefined, sup = over ? convert(over) : undefined;
  if (nary.has(symbol)) return [new MathSum({ children: body, subScript: sub, superScript: sup })];
  if (integrals.has(symbol)) return [new MathIntegral({ children: body, subScript: sub, superScript: sup })];
  if (n.tag === "msub" || n.tag === "msup" || n.tag === "msubsup") return [...convert(n), ...body];
  // An accent over a single letter is that letter with a combining mark (x̂, v⃗); a longer base keeps it above.
  if (n.tag === "mover" && n.attrs.accent === "true" && over) {
    const mark = accents[textOf(over).trim()];
    const letters = textOf(base);
    if (mark && [...letters].length === 1) return [new MathRun(letters + mark), ...body];
  }
  let result: any[] = convert(base);
  if (under) result = [new MathLimitLower({ children: result, limit: sub! })];
  if (over) result = [new MathLimitUpper({ children: result, limit: sup! })];
  return [...result, ...body];
}

/** KaTeX MathML for LaTeX (the MathML the PDFs print); `display` for an equation on its own line. */
export function latexMathml(latex: string, display: boolean) {
  const html = katex.renderToString(latex, { output: "mathml", displayMode: display, throwOnError: true, strict: "ignore", macros: { ...mathMacros } });
  return html.replace(/^<span class="katex(?:-display)?">|<\/span>$/g, "").replace(/^<span class="katex">|<\/span>$/g, "");
}

/** Word equation parts for LaTeX, or null when the LaTeX is invalid or uses a structure Word equations cannot hold. */
export function wordMath(latex: string, display = false): any[] | null {
  try {
    const parts = convert(parseMathml(latexMathml(latex, display)));
    return parts.length ? parts : null;
  } catch {
    return null;
  }
}

const supers: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ" };
const subs: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", i: "ᵢ", j: "ⱼ", n: "ₙ", m: "ₘ", k: "ₖ", t: "ₜ", p: "ₚ", s: "ₛ" };
const script = (text: string, map: Record<string, string>, mark: string) => [...text].every((c) => map[c]) ? [...text].map((c) => map[c]).join("") : mark + (text.length > 1 ? "(" + text + ")" : text);
function plain(n: Node): string {
  const kids = elements(n);
  switch (n.tag) {
    case "annotation": case "annotation-xml": case "mphantom": return "";
    case "mover": { const mark = n.attrs.accent === "true" ? accents[plain(kids[1]).trim()] : undefined; return mark ? plain(kids[0]) + mark : plain(kids[0]) + plain(kids[1]); }
    case "msup": return plain(kids[0]) + script(plain(kids[1]), supers, "^");
    case "msub": return plain(kids[0]) + script(plain(kids[1]), subs, "_");
    case "msubsup": return plain(kids[0]) + script(plain(kids[1]), subs, "_") + script(plain(kids[2]), supers, "^");
    case "mfrac": { const a = plain(kids[0]), b = plain(kids[1]); return (a.length > 1 ? "(" + a + ")" : a) + "/" + (b.length > 1 ? "(" + b + ")" : b); }
    case "msqrt": return "√(" + kids.map(plain).join("") + ")";
    case "mroot": return script(plain(kids[1]), supers, "") + "√(" + plain(kids[0]) + ")";
    case "mspace": return " ";
    default: return n.text + kids.map(plain).join("");
  }
}
/** LaTeX in plain text, for places that cannot hold an equation (slide notes, a cell): Greek, operators and scripts as Unicode. */
export function plainMath(latex: string) {
  try {
    return plain(parseMathml(latexMathml(latex, false))).replace(/[\u2061-\u2063]/g, "").replace(/\s+/g, " ").trim() || latex;
  } catch {
    return latex;
  }
}
