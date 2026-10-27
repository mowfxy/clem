/**
 * Text measurement for Kinetra's label font ("Arial, Helvetica, sans-serif")
 * from hard-coded advance widths (1/1000 em; Arial and Helvetica share
 * metrics). Unknown characters are measured as a full em, so they can only
 * overestimate. Labels accept light markup that becomes Unicode:
 *   F_N -> F + subscript N, x^2 -> x + superscript 2, \theta -> θ,
 *   v_{max} -> v + subscript max.
 */
import { fail } from "./errors.js";

const ASCII: Record<string, number> = {
  " ": 278, "!": 278, "\"": 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, "_": 556, "`": 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "{": 334, "|": 260, "}": 334, "~": 584,
};
const EXTRA: Record<string, number> = {
  "α": 578, "β": 575, "γ": 500, "δ": 556, "ε": 446, "ζ": 441, "η": 556, "θ": 556, "ι": 222, "κ": 500, "λ": 500, "μ": 576, "ν": 500, "ξ": 446, "ο": 556, "π": 690, "ρ": 571, "σ": 618, "ς": 500, "τ": 395, "υ": 546, "φ": 648, "χ": 524, "ψ": 713, "ω": 781,
  "Γ": 551, "Δ": 668, "Θ": 778, "Λ": 667, "Ξ": 649, "Π": 722, "Σ": 618, "Υ": 667, "Φ": 798, "Ψ": 835, "Ω": 747,
  "°": 400, "·": 278, "×": 584, "÷": 584, "−": 584, "±": 584, "≈": 584, "≠": 584, "≤": 584, "≥": 584, "→": 1000, "←": 1000, "∞": 713, "√": 549, "∑": 713, "∫": 274, "∂": 494, "′": 191, "″": 355, "…": 1000, "µ": 556, "Å": 667,
};
const SUB = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₔₕₖₗₘₙₚₛₜᵢⱼᵣᵤᵥᵦᵧᵨᵩᵪ";
const SUB_SRC = "0123456789+-=()aeoxəhklmnpstijruvβγρφχ";
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱᵃᵇᶜᵈᵉᶠᵍʰʲᵏˡᵐᵒᵖʳˢᵗᵘᵛʷˣʸᶻᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ";
const SUP_SRC = "0123456789+-=()niabcdefghjklmoprstuvwxyzABDEGHIJKLMNOPRTUVW";
/** Sub/superscript glyphs come from fallback fonts; measured at 0.65 em, an upper bound. */
const SCRIPT_WIDTH = 650;

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω", deg: "°", cdot: "·", times: "×", pm: "±", approx: "≈", leq: "≤", geq: "≥", to: "→", infty: "∞", sqrt: "√",
};

const subMap = new Map([...SUB_SRC].map((c, i) => [c, [...SUB][i]!]));
const supMap = new Map([...SUP_SRC].map((c, i) => [c, [...SUP][i]!]));

/** Convert label markup to the Unicode string that is rendered. */
export function formatLabelText(src: string, owner: string[] = []): string {
  let s = src.replace(/\\([A-Za-z]+)/g, (m, name: string) => GREEK[name] ?? m);
  if (/\\[A-Za-z]/.test(s)) {
    const bad = s.match(/\\[A-Za-z]+/)![0];
    fail("E_TEXT_UNSUPPORTED", owner, `Unknown symbol ${bad} in label "${src}"`, { suggestion: `Use one of ${Object.keys(GREEK).slice(0, 12).map(k => "\\" + k).join(", ")}, ... or type the Unicode character.` });
  }
  s = s.replace(/([_^])(\{([^}]*)\}|(.))/gu, (m, kind: string, _g, group: string | undefined, single: string | undefined) => {
    const body = group ?? single ?? "";
    const map = kind === "_" ? subMap : supMap;
    const out = [...body].map(c => map.get(c));
    if (out.some(c => c === undefined)) {
      const missing = [...body].filter(c => !map.has(c)).join("");
      fail("E_TEXT_UNSUPPORTED", owner, `"${missing}" has no Unicode ${kind === "_" ? "subscript" : "superscript"} form in label "${src}"`, { suggestion: `${kind === "_" ? "Subscripts" : "Superscripts"} support ${[...(kind === "_" ? SUB_SRC : SUP_SRC)].join("")}; otherwise write the text inline, e.g. "F (normal)".` });
    }
    return out.join("");
  });
  return s;
}

export function charWidth(ch: string): number {
  const script = scriptOf(ch);
  if (script) return charWidth(script.ch) * SCRIPT_MEASURE;
  const w = ASCII[ch] ?? EXTRA[ch];
  if (w !== undefined) return w;
  if (SUB.includes(ch) || SUP.includes(ch)) return SCRIPT_WIDTH;
  return 1000;
}

/** Advance width in px of rendered (already formatted) text at a font size. */
export function measureLabelWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch);
  return w * size / 1000;
}

// --- real sub- and superscripts (Agent 3) ------------------------------------------------
//
// formatLabelMarkup() keeps `_x` / `^x` runs as real SVG scripts instead of
// Unicode glyphs, so capital and multi-letter scripts work (F_N, V_{CC}, R_L).
// Until rendering, a script character is carried as one private-use code
// point (sub: U+E000 + c, sup: U+E400 + c, for c < U+0400), so the string keeps
// one code unit per visible glyph: Scene2D's backdrop (length based) and the
// toolkit's measurement both see the right count. renderScriptTspans() turns
// the runs into <tspan font-size dy> after renderScene2D.

const SUB_BASE = 0xe000, SUP_BASE = 0xe400, SCRIPT_RANGE = 0x400;
/** Script glyphs are set at 0.75 em (rounded to whole px) and shifted from the baseline. */
export const SCRIPT_SCALE = 0.75;
export const scriptFontSize = (size: number) => Math.round(size * SCRIPT_SCALE);
/** Width factor for measuring script glyphs: an upper bound of scriptFontSize(size) / size for sizes 11-13. */
const SCRIPT_MEASURE = 0.77;
/** Baseline shift (px, SVG y down): subscripts +0.3 em, superscripts -0.4 em, one decimal. */
export const scriptShift = (size: number, kind: "sub" | "sup") => Math.round(size * (kind === "sub" ? 3 : -4)) / 10;

export function scriptOf(ch: string): { kind: "sub" | "sup"; ch: string } | undefined {
  const c = ch.codePointAt(0)!;
  if (c >= SUB_BASE && c < SUB_BASE + SCRIPT_RANGE) return { kind: "sub", ch: String.fromCodePoint(c - SUB_BASE) };
  if (c >= SUP_BASE && c < SUP_BASE + SCRIPT_RANGE) return { kind: "sup", ch: String.fromCodePoint(c - SUP_BASE) };
  return undefined;
}

/**
 * Convert label markup for rendering with real SVG scripts. Like
 * formatLabelText, but any character below U+0400 (Latin, digits, Greek,
 * punctuation) may be a sub- or superscript, capitals included.
 */
export function formatLabelMarkup(src: string, owner: string[] = []): string {
  const s = src.replace(/\\([A-Za-z]+)/g, (m, name: string) => GREEK[name] ?? m);
  if (/\\[A-Za-z]/.test(s)) {
    const bad = s.match(/\\[A-Za-z]+/)![0];
    fail("E_TEXT_UNSUPPORTED", owner, `Unknown symbol ${bad} in label "${src}"`, { suggestion: `Use one of ${Object.keys(GREEK).slice(0, 12).map(k => "\\" + k).join(", ")}, ... or type the Unicode character.` });
  }
  return s.replace(/([_^])(\{([^}]*)\}|(.))/gu, (_m, kind: string, _g, group: string | undefined, single: string | undefined) => {
    const body = group ?? single ?? "";
    const bad = [...body].filter(c => c.codePointAt(0)! >= SCRIPT_RANGE || scriptOf(c));
    if (bad.length || body === "") fail("E_TEXT_UNSUPPORTED", owner, body === "" ? `Empty ${kind === "_" ? "subscript" : "superscript"} in label "${src}"` : `"${bad.join("")}" cannot be a ${kind === "_" ? "subscript" : "superscript"} in label "${src}"`, { suggestion: "Scripts take Latin letters, digits, Greek and punctuation; write other symbols inline." });
    const base = kind === "_" ? SUB_BASE : SUP_BASE;
    return [...body].map(c => String.fromCodePoint(base + c.codePointAt(0)!)).join("");
  });
}

/** Visible text of a formatted label (scripts as their plain characters). */
export function plainLabelText(text: string): string {
  return [...text].map(c => scriptOf(c)?.ch ?? c).join("");
}

/** Vertical extent around the baseline (px) of formatted text, scripts included. */
export function labelVerticalExtentFor(text: string, size: number): { above: number; below: number } {
  const e = labelVerticalExtent(size), ss = scriptFontSize(size);
  let { above, below } = e;
  for (const ch of text) {
    const k = scriptOf(ch)?.kind;
    if (k === "sub") below = Math.max(below, scriptShift(size, "sub") + ss * 0.22);
    if (k === "sup") above = Math.max(above, -scriptShift(size, "sup") + ss * 0.92);
  }
  return { above, below };
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Rewrite every <text> whose content carries script code points into tspans:
 * `F<tspan font-size="9" dy="3.6">N</tspan>`, with a reset `dy` on the base
 * text that follows. Text without scripts is returned byte-for-byte.
 */
export function renderScriptTspans(svg: string): string {
  return svg.replace(/<text ([^>]*)>([^<]*)<\/text>/g, (whole, attrs: string, content: string) => {
    if (![...content].some(c => scriptOf(c))) return whole;
    const size = Number(/font-size="([^"]*)"/.exec(attrs)?.[1] ?? 12);
    let out = "", shift = 0, run = "", mode: "base" | "sub" | "sup" = "base";
    const flush = () => {
      if (!run) return;
      const target = mode === "base" ? 0 : scriptShift(size, mode);
      const dy = Math.round((target - shift) * 10) / 10;
      if (mode === "base" && dy === 0) out += escapeXml(run);
      else out += `<tspan${mode === "base" ? "" : ` font-size="${scriptFontSize(size)}"`}${dy !== 0 ? ` dy="${dy}"` : ""}>${escapeXml(run)}</tspan>`;
      shift = target; run = "";
    };
    // Content is already escaped by Scene2D; decode entities before re-escaping runs.
    // Keep Scene2D's surrounding whitespace outside the tspans.
    const [, lead, body, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(content)!;
    const raw = body!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
    for (const ch of raw) {
      const sc = scriptOf(ch);
      const m = sc ? sc.kind : "base";
      if (m !== mode) { flush(); mode = m; }
      run += sc ? sc.ch : ch;
    }
    flush();
    return `<text ${attrs}>${lead}${out}${trail}</text>`;
  });
}

/** Vertical extent around the baseline (px): Arial ascent incl. accents, descent. */
export function labelVerticalExtent(size: number): { above: number; below: number } {
  return { above: size * 0.92, below: size * 0.22 };
}

/** Title metrics: Inter 600 is wider than Arial; a 1.15 factor bounds it. */
export function measureTitleWidth(text: string, size: number): number {
  return measureLabelWidth(text, size) * 1.15;
}
