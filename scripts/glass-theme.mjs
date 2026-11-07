// Clem's glass, made from the older stylesheets at build time. Their grey surfaces are hard-coded across dozens of
// files, so instead of chasing them one by one this pass turns neutral greys into what the new design needs: dark
// surfaces become sheets of light over the horizon, grey lines become thin light, and grey ink gets a trace of the blue
// of the sky. Colours that mean something (accents, status) are left alone. In the light theme the paper twins that
// scripts/light-theme.mjs writes become white glass in the same way. src/glass/glass.css sets the materials themselves.
//
// Used as a PostCSS plugin from vite.config.ts, after the light theme.

const SKIP_FILES = [/office-preview/, /[\\/]glass[\\/]/, /[\\/]theme[\\/]light\.css$/, /[\\/]site[\\/]/, /[\\/]admin[\\/]/, /katex/];
const SKIP_SELECTORS = [/\.kinetra/, /\.clem-mark/, /\.brand-logo/, /\.office-/, /\.yt-thumb/, /\.fp-page/, /\.pdf/, /\.ascii-field/];
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:white|black)\b/g;
const INK_PROPS = /^(color|fill|stroke|caret-color|accent-color|outline(-color)?|text-decoration-color|-webkit-text-fill-color)$/;
const PAINT_PROPS = /^(background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-start|-end)?)?(-color)?|box-shadow)$/;
const LIGHT_TWIN = "data-theme=light";

const hex = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
function parse(text) {
  const t = text.toLowerCase();
  if (t === "white") return [255, 255, 255, 1];
  if (t === "black") return [0, 0, 0, 1];
  let h = t.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1);
}
const grey = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) <= 12;
const level = ([r, g, b]) => (r + g + b) / 3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sheet = (alpha) => `#ffffff${hex(alpha * 255)}`;
const well = (alpha) => `#04070e${hex(alpha * 255)}`;

/** A grey painted as a surface or a line, on the dark theme. */
function darkPaint(c, prop) {
  const v = level(c), alpha = c[3];
  if (alpha < 1) return null; // Already see-through: shadows and washes keep their own values.
  if (v <= 22) return prop === "box-shadow" ? null : well(0.34);
  if (v <= 96) return sheet(clamp((v - 20) / 400, 0.03, 0.2));
  return null;
}
/** A grey as ink: the same lightness with a little of the sky in it; a dark ink on a pale button is deep navy. */
function darkInk(c) {
  const [r, g, b] = c, v = level(c);
  if (v < 70) return `#0a1020${c[3] < 1 ? hex(c[3] * 255) : ""}`;
  return `#${hex(r - 9)}${hex(g - 3)}${hex(b + 11)}${c[3] < 1 ? hex(c[3] * 255) : ""}`;
}
/** A paper tone on the light theme. */
function lightPaint(c) {
  const v = level(c);
  if (c[3] < 1 || v < 200) return null;
  if (v >= 222) return sheet(v >= 247 ? 0.42 : 0.56);
  return `#20304a${hex(clamp((250 - v) / 300, 0.05, 0.16) * 255)}`;
}

function convert(value, prop, custom, lightTwin) {
  return value.replace(COLOUR, (m) => {
    const c = parse(m);
    if (!c || !grey(c)) return m;
    if (lightTwin) return (PAINT_PROPS.test(prop) || custom ? lightPaint(c) : null) ?? m;
    if (INK_PROPS.test(prop)) return darkInk(c);
    if (PAINT_PROPS.test(prop)) return darkPaint(c, prop) ?? m;
    if (custom) return level(c) <= 96 ? darkPaint(c, prop) ?? m : darkInk(c);
    return m;
  });
}

export default function glassTheme() {
  return {
    postcssPlugin: "clem-glass-theme",
    OnceExit(root) {
      const file = root.source?.input.file || "";
      if (!/\.css$/.test(file) || SKIP_FILES.some((r) => r.test(file))) return;
      root.walkDecls((d) => {
        const rule = d.parent;
        if (rule.type !== "rule" || (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name))) return;
        if (SKIP_SELECTORS.some((r) => r.test(rule.selector))) return;
        const custom = d.prop.startsWith("--");
        if (!custom && !INK_PROPS.test(d.prop) && !PAINT_PROPS.test(d.prop)) return;
        d.value = convert(d.value, d.prop, custom, rule.selector.includes(LIGHT_TWIN));
      });
    },
  };
}
glassTheme.postcss = true;
