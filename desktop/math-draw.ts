/**
 * Two corrections for maths Clem draws in Chromium (PDFs, deck equations, Word fallback pictures).
 *
 * Arrows with something written on them (\xrightarrow{light}, \xleftarrow, \overrightarrow{AB}): Chromium's MathML
 * does not stretch an arrow horizontally, so the label sat on a short arrow and ran into the next term. `drawnArrows`
 * replaces each stretchy arrow with one drawn to the width of what is written on it: a rule on the maths axis, as wide
 * as an invisible copy of the label, ending in the arrowhead glyph. (Word draws its own arrows, so Word's native
 * equations are left alone.)
 *
 * Chemistry: "6CO_2 + 6H_2O \to C_6H_{12}O_6" is set as variables (italic C, O, H). `uprightChemistry` recognises
 * LaTeX that is only element symbols, counts, charges, states and reaction arrows, and sets the elements upright, as
 * chemists write them.
 */

// Measured in Chromium with Cambria Math at 200px (the face Clem's pages and pictures use for maths), in ems: the
// arrowhead's stroke is RULE thick with its top edge AXIS above the baseline; a double arrow's strokes are GAP apart,
// the upper one's top edge DOUBLE above the baseline.
const AXIS = 0.275, RULE = 0.045, GAP = 0.2, DOUBLE = 0.41, OVERLAP = 0.3, MIN = 1.4;
const HEADS: Record<string, { left?: string; right?: string; double?: boolean }> = {
  "→": { right: "→" }, "⟶": { right: "→" }, "↦": { right: "→" }, "←": { left: "←" }, "⟵": { left: "←" }, "↔": { left: "←", right: "→" }, "⟷": { left: "←", right: "→" },
  "⇒": { right: "⇒", double: true }, "⟹": { right: "⇒", double: true }, "⇐": { left: "⇐", double: true }, "⟸": { left: "⇐", double: true }, "⇔": { left: "⇐", right: "⇒", double: true }, "⟺": { left: "⇐", right: "⇒", double: true },
};

/** Index just past the element that opens at `start` (balanced on its own tag name), or -1. */
function elementEnd(xml: string, start: number) {
  const name = /^<([a-zA-Z]+)/.exec(xml.slice(start))?.[1];
  if (!name) return -1;
  const tag = new RegExp(`<(/?)${name}\\b[^>]*?(/?)>`, "g");
  let depth = 0;
  tag.lastIndex = start;
  for (let m; (m = tag.exec(xml)); ) {
    if (m[2]) { if (depth === 0) return tag.lastIndex; continue; }
    depth += m[1] ? -1 : 1;
    if (depth === 0) return tag.lastIndex;
  }
  return -1;
}
/** The child elements of the element that opens at `start`, as strings. */
function children(xml: string, start: number, end: number) {
  const open = xml.indexOf(">", start) + 1, close = xml.lastIndexOf("</", end - 1);
  const out: string[] = [];
  for (let at = open; at < close; ) {
    const next = xml.indexOf("<", at);
    if (next < 0 || next >= close) break;
    const stop = elementEnd(xml, next);
    if (stop < 0) break;
    out.push(xml.slice(next, stop));
    at = stop;
  }
  return out;
}
/**
 * KaTeX pads arrow labels with <mpadded width="+0.6em" lspace="0.3em">; Chromium reads "+0.6em" as a width of 0.6em
 * (MathML Core has no relative widths), so the label would measure as almost nothing. The padding becomes real space.
 */
const unpadded = (label: string) => {
  const m = /^<mpadded width="\+([\d.]+)em" lspace="([\d.]+)em">([\s\S]*)<\/mpadded>$/.exec(label);
  return m ? `<mrow><mspace width="${m[2]}em"/>${m[3]}<mspace width="${(Number(m[1]) - Number(m[2])).toFixed(2)}em"/></mrow>` : label;
};
const arrowOf = (mo: string) => /^<mo\b[^>]*stretchy="true"[^>]*>([^<]+)<\/mo>$/.exec(mo)?.[1].trim();

/**
 * An arrow at least as wide as `measure` (MathML whose width the arrow takes; never shown). `snug`: exactly as wide as
 * `measure`, for an arrow over a vector's letters.
 */
function drawnArrow(char: string, measure: string, snug = false) {
  const head = HEADS[char];
  const overlap = snug ? 0.75 : OVERLAP, pad = snug ? 0 : OVERLAP;
  const margin = `${head.left ? `margin-left:-${overlap}em;` : ""}${head.right ? `margin-right:-${overlap}em;` : ""}`;
  const sized = `<mphantom><mpadded depth="0">${snug ? measure : `<munder><mrow>${measure}</mrow><mspace width="${MIN}em"/></munder>`}</mpadded></mphantom>`;
  const line = `${RULE}em solid currentColor`;
  // A double arrow is two strokes: the upper under the measured box, the lower GAP below it.
  const body = head.double
    ? `<mrow style="border-bottom:${line};padding:0 0 ${+(GAP - RULE).toFixed(3)}em;${margin}"><mrow style="border-bottom:${line};padding:0 ${pad}em">${sized}</mrow></mrow>`
    : `<mrow style="border-bottom:${line};padding:0 ${pad}em;${margin}">${sized}</mrow>`;
  const shaft = `<mpadded height="0" depth="0" voffset="${head.double ? DOUBLE : AXIS}em">${body}</mpadded>`;
  const glyph = (c: string) => `<mo lspace="0" rspace="0" stretchy="false">${c}</mo>`;
  return `<mrow>${head.left ? glyph(head.left) : ""}${shaft}${head.right ? glyph(head.right) : ""}</mrow>`;
}

/** MathML with every labelled or stretched arrow drawn to its full width (see above). Other MathML is unchanged. */
export function drawnArrows(mathml: string) {
  let out = "", at = 0;
  const scripts = /<(mover|munder|munderover)\b[^>]*>/g;
  for (let m; (m = scripts.exec(mathml)); ) {
    if (m.index < at) continue;
    const end = elementEnd(mathml, m.index);
    if (end < 0) continue;
    const kids = children(mathml, m.index, end);
    const first = arrowOf(kids[0] || ""), last = m[1] === "mover" ? arrowOf(kids[1] || "") : undefined;
    let drawn: string | undefined;
    if (first && HEADS[first] && kids.length >= 2) {
      // \xrightarrow and friends: the arrow is the base, the labels sit above (and below).
      const labels = kids.slice(1).map((k) => drawnArrows(unpadded(k)));
      const measure = labels.length === 1 ? labels[0] : `<munder><mrow>${labels[0]}</mrow><mrow>${labels[1]}</mrow></munder>`;
      drawn = `<mrow><mspace width="0.28em"/><${m[1]}>${drawnArrow(first, measure)}${labels.join("")}</${m[1]}><mspace width="0.28em"/></mrow>`;
    } else if (last && HEADS[last] && kids.length === 2) {
      // \overrightarrow{AB}: the arrow is drawn over its base, as wide as the base.
      const base = drawnArrows(kids[0]);
      drawn = `<mover accent="true">${base}${drawnArrow(last, base, true)}</mover>`;
    }
    if (!drawn) continue;
    out += mathml.slice(at, m.index) + drawn;
    at = end;
    scripts.lastIndex = end;
  }
  return out + mathml.slice(at);
}

const ELEMENTS = new Set("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(" "));
/** Whether a run of letters is a sequence of element symbols ("CO", "NaCl", "HCl"). */
function elementRun(run: string): boolean {
  if (!run) return true;
  return [2, 1].some((n) => run.length >= n && ELEMENTS.has(run.slice(0, n)) && elementRun(run.slice(n)));
}
const ARROWS = new Set(["to", "rightarrow", "longrightarrow", "leftarrow", "longleftarrow", "leftrightarrow", "longleftrightarrow", "rightleftharpoons", "leftrightharpoons", "rightleftarrows", "Rightarrow", "xrightarrow", "xleftarrow", "xrightleftharpoons", "xleftrightharpoons"]);
const SPACING = new Set([",", ";", ":", "!", " ", "cdot", "uparrow", "downarrow"]);
/** Commands whose braced argument is text: copied as written. */
const TEXT = new Set(["text", "mathrm", "textrm", "operatorname"]);

type Token = { kind: "letters" | "command" | "group" | "other"; text: string; name?: string };
/** LaTeX as letter runs, commands (with their text and label arguments) and single characters. */
function tokens(latex: string): Token[] | null {
  const out: Token[] = [];
  const group = (at: number, open: string, close: string) => {
    let depth = 0;
    for (let i = at; i < latex.length; i++) {
      if (latex[i] === "\\") { i++; continue; }
      if (latex[i] === open) depth++;
      else if (latex[i] === close && --depth === 0) return i + 1;
    }
    return -1;
  };
  for (let i = 0; i < latex.length; ) {
    const c = latex[i];
    if (c === "\\") {
      const name = /^\\([a-zA-Z]+|.)/.exec(latex.slice(i))![1];
      let end = i + 1 + name.length;
      if (TEXT.has(name) || /^x(right|left)/.test(name)) {
        // Labels and text keep their own letters: \xrightarrow[below]{above}, \text{(aq)}.
        while (/^\s*[[{]/.test(latex.slice(end))) {
          const open = latex.slice(end).match(/^\s*([[{])/)!;
          const close = group(end + open[0].length - 1, open[1], open[1] === "[" ? "]" : "}");
          if (close < 0) return null;
          end = close;
        }
      }
      out.push({ kind: "command", name, text: latex.slice(i, end) });
      i = end;
    } else if (/[A-Za-z]/.test(c)) {
      const run = /^[A-Za-z]+/.exec(latex.slice(i))![0];
      out.push({ kind: "letters", text: run });
      i += run.length;
    } else {
      out.push({ kind: "other", text: c });
      i++;
    }
  }
  return out;
}

/** LaTeX with chemical formulas set upright, when the whole expression is chemistry; anything else is returned as it was. */
export function uprightChemistry(latex: string) {
  if (/\\ce\b|\\pu\b/.test(latex)) return latex;
  const list = tokens(latex);
  if (!list) return latex;
  let arrow = false, symbols = 0, runs = 0;
  for (const [i, t] of list.entries()) {
    if (t.kind === "command") {
      if (ARROWS.has(t.name!)) arrow = true;
      else if (!SPACING.has(t.name!) && !TEXT.has(t.name!)) return latex;
    } else if (t.kind === "letters") {
      // States of matter: (s), (l), (g), (aq).
      if (/^(s|l|g|aq)$/.test(t.text) && list[i - 1]?.text === "(" && list[i + 1]?.text === ")") continue;
      if (!elementRun(t.text)) return latex;
      runs++;
      symbols += t.text.replace(/[a-z]/g, "").length;
    } else if (!/[\d\s_^{}()[\]+\-=.,']/.test(t.text)) return latex;
  }
  // Chemists never write a subscript 0 or 1; physics does (P_1V_1, N_0), so those stay as variables.
  if (!symbols || /_\s*\{?\s*[01]\s*\}?(?!\d)/.test(latex)) return latex;
  if (!arrow && !(runs >= 2 || list.some((t) => t.kind === "letters" && t.text.replace(/[a-z]/g, "").length >= 2))) return latex;
  if (!arrow && !/_\s*\{?\s*\d/.test(latex)) return latex;
  return list.map((t) => (t.kind === "letters" ? `\\mathrm{${t.text}}` : t.text)).join("");
}
