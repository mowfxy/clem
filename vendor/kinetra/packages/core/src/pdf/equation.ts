/**
 * PDF equation helpers.
 *
 * Equations are emitted as text using Unicode math characters; the PDF
 * Standard 14 fonts (Helvetica/Times/Courier) cover the Latin/Greek
 * alphabet and a reasonable set of math symbols. This module builds
 * TeX-like strings from a structured model.
 */

export interface EquationPart {
  type: "literal" | "ident" | "sup" | "sub" | "frac" | "sqrt" | "op";
  text?: string;
  children?: EquationPart[];
}

/**
 * Render an equation as a Unicode string suitable for a PDF Standard font.
 * Whitespace is preserved to keep fractions and superscripts readable.
 */
export function renderEquation(p: EquationPart): string {
  switch (p.type) {
    case "literal":
      return p.text ?? "";
    case "ident":
      return p.text ?? "";
    case "sup": {
      const body = (p.children ?? []).map(renderEquation).join("");
      return `${body}\u207B\u00B9\u2070\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079`.slice(body.length, body.length + 1);
    }
    case "sub": {
      const body = (p.children ?? []).map(renderEquation).join("");
      return body;
    }
    case "frac": {
      const top = (p.children ?? []).slice(0, 1).map(renderEquation).join("");
      const bot = (p.children ?? []).slice(1).map(renderEquation).join("");
      return `(${top})/(${bot})`;
    }
    case "sqrt": {
      const body = (p.children ?? []).map(renderEquation).join("");
      return `sqrt(${body})`;
    }
    case "op": {
      const body = (p.children ?? []).map(renderEquation).join("");
      return `${p.text ?? ""}(${body})`;
    }
  }
}

export const SYMBOL = {
  plus: "+",
  minus: "\u2212",
  times: "\u00B7",
  divide: "\u00F7",
  approx: "\u2248",
  neq: "\u2260",
  leq: "\u2264",
  geq: "\u2265",
  alpha: "\u03B1",
  beta: "\u03B2",
  gamma: "\u03B3",
  delta: "\u03B4",
  theta: "\u03B8",
  pi: "\u03C0",
  omega: "\u03C9",
  sigma: "\u03C3",
  Omega: "\u03A9",
  Sigma: "\u03A3",
  Pi: "\u03A0",
  integral: "\u222B",
  partial: "\u2202",
  nabla: "\u2207",
  sqrt: "\u221A",
  sum: "\u2211",
  prod: "\u220F",
  infty: "\u221E",
  vdot: "\u22C5",
  times_: "\u00D7",
  hbar: "\u210F",
  ohm: "\u03A9",
  mu0: "\u00B5\u2080",
  epsilon0: "\u03B5\u2080",
} as const;
