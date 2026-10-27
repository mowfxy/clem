/**
 * Maths in answers. Models write LaTeX in several dialects (\( \), \[ \], $…$, $$…$$, bare \begin{align}),
 * and borrow macros from LaTeX packages KaTeX does not ship (physics, siunitx, braket). This turns all of
 * them into the $$…$$ that remark-math reads, and supplies the missing macros, so symbols render instead
 * of leaking dollar signs. Chemistry (\ce, \pu) comes from KaTeX's mhchem extension, loaded by the renderer.
 */

/** Package macros KaTeX lacks, mapped to plain KaTeX. Single-argument forms only: KaTeX macros cannot take optional arguments. */
export const mathMacros: Record<string, string> = {
  // physics package
  '\\abs': '\\left\\lvert #1\\right\\rvert',
  '\\norm': '\\left\\lVert #1\\right\\rVert',
  '\\ev': '\\left\\langle #1\\right\\rangle',
  '\\order': '\\mathcal{O}\\left(#1\\right)',
  '\\dv': '\\frac{\\mathrm{d}#1}{\\mathrm{d}#2}',
  '\\pdv': '\\frac{\\partial #1}{\\partial #2}',
  '\\fdv': '\\frac{\\delta #1}{\\delta #2}',
  '\\dd': '\\mathop{}\\!\\mathrm{d}',
  '\\vb': '\\mathbf{#1}',
  '\\va': '\\vec{#1}',
  '\\vu': '\\hat{\\mathbf{#1}}',
  '\\grad': '\\nabla',
  '\\curl': '\\nabla\\times',
  '\\divergence': '\\nabla\\cdot',
  '\\laplacian': '\\nabla^2',
  '\\cross': '\\times',
  '\\vdot': '\\cdot',
  '\\comm': '\\left[#1,#2\\right]',
  '\\tr': '\\operatorname{tr}',
  '\\Tr': '\\operatorname{Tr}',
  '\\rank': '\\operatorname{rank}',
  '\\erf': '\\operatorname{erf}',
  '\\sgn': '\\operatorname{sgn}',
  '\\Res': '\\operatorname{Res}',
  // siunitx
  '\\si': '\\mathrm{#1}',
  '\\unit': '\\,\\mathrm{#1}',
  '\\SI': '#1\\,\\mathrm{#2}',
  '\\num': '#1',
  '\\ang': '#1^\\circ',
  '\\degree': '^\\circ',
  '\\celsius': '{}^\\circ\\mathrm{C}',
  '\\degreeCelsius': '{}^\\circ\\mathrm{C}',
  '\\ohm': '\\Omega',
  '\\micro': '\\mu',
  '\\angstrom': '\\text{Å}',
  '\\per': '/',
  // common shorthands
  '\\bm': '\\boldsymbol{#1}',
  '\\RR': '\\mathbb{R}', '\\NN': '\\mathbb{N}', '\\ZZ': '\\mathbb{Z}', '\\QQ': '\\mathbb{Q}', '\\CC': '\\mathbb{C}',
  '\\E': '\\mathbb{E}',
  '\\Var': '\\operatorname{Var}',
  '\\Cov': '\\operatorname{Cov}',
  '\\argmax': '\\operatorname*{arg\\,max}',
  '\\argmin': '\\operatorname*{arg\\,min}',
  '\\eqref': '(\\text{#1})',
  '\\label': '',
  '\\nonumber': '',
  '\\notag': '',
};

const ENVIRONMENTS = 'equation|align|aligned|gather|gathered|multline|alignat|eqnarray|cases|matrix|pmatrix|bmatrix|vmatrix|Bmatrix|Vmatrix|array|split|CD';
const bareEnvironment = new RegExp(`(^|\\n)[ \\t]*(\\\\begin\\{(${ENVIRONMENTS})\\*?\\}[\\s\\S]*?\\\\end\\{\\3\\*?\\})`, 'g');
const display = (m: string) => `\n$$\n${m.trim()}\n$$\n`;

/** Normalises the maths in one stretch of prose (no code inside). */
function prose(text: string, first: boolean, last: boolean) {
  // Line starts and ends count only at real line breaks, not where a code span interrupted the line.
  text = (first ? '\n' : '\u0000') + text + (last ? '\n' : '\u0000');
  // Bracket delimiters and bare environments become $$…$$ first, so the dollar pass sees one dialect.
  text = text
    // \[…\] in a table row stays on its line: a line break there would end the table.
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string, at: number, all: string) => !m.includes('\n') && /^[ \t]*\|/.test(all.slice(all.lastIndexOf('\n', at) + 1)) ? `$$${m.trim()}$$` : display(m))
    .replace(/\\\((.+?)\\\)/g, (_, m) => `$$${m}$$`);
  // Existing $$…$$ is kept as is (display when it spans lines or stands alone on its line); only the text between is scanned.
  return text.split(/(\$\$[\s\S]+?\$\$)/g).map((part, i) => {
    if (i % 2) {
      const inner = part.slice(2, -2);
      return inner.includes('\n') ? display(inner) : part;
    }
    return part
      .replace(bareEnvironment, (_, pre, env) => pre + display(env))
      // A superscript or subscript attached to a word (NAD$^+$, H$_2$O, cm$^3$) is maths too; without this its closing
      // dollar would open a span that runs into the next sentence's maths.
      .replace(/(\w)\$([\^_][^$\n]{0,60}?[^\s\\$])\$(?!\d)/g, (_, pre, m) => `${pre}$$${m}$$`)
      // Pandoc-style inline math: $x$ when the dollars hug non-space text and no digit follows the closing one,
      // so prices like “$2 and $5” stay prose. One character is enough ($x$).
      .replace(/(^|[^\\$\w])\$(?![\s$])([^$\n]{0,400}?[^\s\\$])\$(?![\d$])/g, (_, pre, m) => `${pre}$$${m}$$`);
  }).join('')
    // A line that is only $$…$$ is display maths.
    .replace(/(\n)[ \t]*\$\$([^\n$]+?)\$\$[ \t]*(?=\n)/g, (_, pre, m) => pre + display(m))
    .slice(1, -1);
}

/** Rewrites every maths dialect into remark-math's $$…$$, leaving code spans and fenced blocks untouched. */
export function normalizeMath(text: string) {
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return tableMath(parts.map((part, i) => (i % 2 ? part : prose(part, i === 0, i === parts.length - 1))).join(''));
}

const DELIMITER_ROW = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/;
/**
 * Maths inside a Markdown table. A table splits its rows at every "|", including the bars of |x|, \left|…\right| and
 * \|v\|, which cut a formula in two and left "$$dQ = \sum \left" printed as text. In table rows those bars become
 * \vert and \Vert, which draw the same. Display maths has no place in a cell, so a cell's $$…$$ stays inline.
 */
function tableMath(text: string) {
  const lines = text.split('\n');
  let fenced = false, inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[ \t]*```/.test(line)) { fenced = !fenced; inTable = false; continue; }
    if (fenced) continue;
    if (DELIMITER_ROW.test(line) && i > 0 && lines[i - 1].includes('|')) { inTable = true; lines[i - 1] = barsInMath(lines[i - 1]); continue; }
    if (!inTable) continue;
    if (!line.trim() || !line.includes('|')) { inTable = false; continue; }
    lines[i] = barsInMath(line);
  }
  return lines.join('\n');
}
const barsInMath = (row: string) => row.replace(/\$\$([^\n]+?)\$\$/g, (_, m: string) => '$$' + m.replace(/\\\|/g, '\\Vert ').replace(/(?<!\\)\|/g, '\\vert ') + '$$');
