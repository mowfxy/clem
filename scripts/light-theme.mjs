// Mowr's light theme, made from the dark one at build time. Every CSS rule that sets a colour gets a twin under
// :root[data-theme=light] with that colour moved onto paper: dark surfaces become warm whites, light ink becomes
// navy-tinted near-black, accents keep their hue at a readable depth, and shadows soften. New styles are themed the
// moment they are written, so nobody has to keep a second stylesheet in step. Hand-tuned exceptions live in
// src/theme/light.css, which loads last.
//
// Used as a PostCSS plugin from vite.config.ts.

const PREFIX = ":root[data-theme=light]";
// Colours that mean something on their own: a rendered Office document, a diagram on white, the logo.
const SKIP_FILES = [/office-preview/, /[\\/]theme[\\/]light\.css$/];
const SKIP_SELECTORS = [/\.kinetra-diagram/, /\.mowr-mark/, /\.brand-logo/, /\.office-/, /\.yt-thumb i/];
const COLOUR_PROPS = /^(color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-start|-end)?)?(-color)?|outline(-color)?|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|text-decoration(-color)?|column-rule(-color)?|scrollbar-color|filter|--.+)$/;
const SHADOW_PROPS = /^(box-shadow|text-shadow|filter)$/;
const NAMED = { white: "#ffffff", black: "#000000" };
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(white|black)\b/g;

// sRGB <-> OKLab (Björn Ottosson).
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function toLab([r, g, b]) {
  [r, g, b] = [r, g, b].map((v) => lin(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function toRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map((v) => Math.round(Math.min(1, Math.max(0, gam(Math.min(1, Math.max(0, v))))) * 255));
}

// Lightness on the dark theme -> lightness on paper. Near-black surfaces land on warm white, mid greys become
// borders, and the dark theme's ink lands on a readable near-black.
const CURVE = [[0, 1], [0.18, 0.99], [0.2, 0.978], [0.24, 0.958], [0.28, 0.935], [0.32, 0.905], [0.42, 0.84], [0.5, 0.77], [0.6, 0.6], [0.7, 0.5], [0.8, 0.42], [0.9, 0.33], [1, 0.25]];
function curve(L) {
  for (let i = 1; i < CURVE.length; i++) if (L <= CURVE[i][0]) { const [x0, y0] = CURVE[i - 1], [x1, y1] = CURVE[i]; return y0 + ((L - x0) / (x1 - x0)) * (y1 - y0); }
  return CURVE.at(-1)[1];
}
// Greys pick up the brand: warm paper for surfaces, a trace of navy ink for text.
const PAPER = [0.0006, 0.0085], INK = [-0.004, -0.026];
function shift(rgba, shadow) {
  const [r, g, b, alpha] = rgba, [L, A, B] = toLab([r, g, b]), chroma = Math.hypot(A, B);
  let outL = curve(L), outA = A, outB = B, outAlpha = alpha;
  if (shadow || (alpha < 1 && L < 0.35)) return [r, g, b, Math.min(alpha, alpha * 0.45)];
  if (chroma < 0.02) {
    const t = Math.min(1, Math.max(0, (outL - 0.45) / 0.45));
    outA = INK[0] + (PAPER[0] - INK[0]) * t; outB = INK[1] + (PAPER[1] - INK[1]) * t;
  } else outL = Math.min(outL, 0.62); // Accents stay deep enough to read on white.
  return [...toRgb([outL, outA, outB]), outAlpha];
}

function parse(text) {
  const t = text.toLowerCase();
  if (NAMED[t]) return parse(NAMED[t]);
  if (t.startsWith("#")) {
    let h = t.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1);
  }
  const parts = t.replace(/^rgba?\(|\)$/g, "").split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.some((p) => p.startsWith("var"))) return null;
  const n = parts.map((p, i) => (p.endsWith("%") ? (parseFloat(p) / 100) * (i < 3 ? 255 : 1) : parseFloat(p)));
  return n.some(Number.isNaN) ? null : [n[0], n[1], n[2], n[3] ?? 1];
}
const hex = (v) => Math.round(v).toString(16).padStart(2, "0");
const format = ([r, g, b, a]) => "#" + hex(r) + hex(g) + hex(b) + (a < 1 ? hex(a * 255) : "");

export function lightValue(value, prop = "color") {
  if (prop === "color-scheme") return value.replace(/\bdark\b/, "light");
  const shadow = SHADOW_PROPS.test(prop);
  return value.replace(COLOUR, (m) => { const c = parse(m); return c ? format(shift(c, shadow)) : m; });
}

function scope(selector) {
  return selector.split(/,(?![^(]*\))/).map((s) => {
    s = s.trim();
    if (/^:root\b/.test(s)) return s.replace(/^:root/, PREFIX);
    if (/^html\b/.test(s)) return s.replace(/^html/, "html[data-theme=light]");
    return `${PREFIX} ${s}`;
  }).join(",");
}

export default function lightTheme() {
  return {
    postcssPlugin: "mowr-light-theme",
    Once(root) {
      const file = root.source?.input.file || "";
      if (!/\.css$/.test(file) || SKIP_FILES.some((r) => r.test(file))) return;
      root.walkRules((rule) => {
        if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
        if (rule.selector.includes("data-theme") || SKIP_SELECTORS.some((r) => r.test(rule.selector))) return;
        // The twin repeats every colour declaration, changed or not (transparent, inherit, var(...)), so a twin of a
        // broader rule can never override a narrower rule's colour that had nothing to convert.
        const twins = [];
        rule.each((d) => {
          if (d.type !== "decl" || !(d.prop === "color-scheme" || (COLOUR_PROPS.test(d.prop) && !/^--/.test(d.prop)) || (/^--/.test(d.prop) && COLOUR.test(d.value)))) return;
          COLOUR.lastIndex = 0;
          const value = lightValue(d.value, d.prop);
          twins.push(d.clone({ value }));
        });
        if (!twins.length) return;
        const twin = rule.clone({ selector: scope(rule.selector) });
        twin.removeAll(); twin.append(twins);
        rule.after(twin);
      });
    },
  };
}
lightTheme.postcss = true;
