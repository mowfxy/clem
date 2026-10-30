/**
 * A chat ```visual as a printed figure: the same compiled drawing the person saw, on white paper in print colours
 * and standard fonts. PDFs (Kinetra clem.visual), answer exports and Word or PowerPoint files all print visuals
 * through here, so a diagram the AI drew in the chat goes into any file unchanged.
 */
import { compileVisual, defaultValues, palette, vivid, W, H, type Pen, type P, type Style, type TextStyle } from './visual-spec.ts';
import { parseModelJson } from './model-json.ts';
import { printSans, printSerif } from './print-fonts.ts';

/** The app's dark visual palette mapped to ink on paper. Colours outside the palette are kept. */
const paper: Record<string, string> = {
  [palette.bg]: '#ffffff', [palette.panel]: '#f4f6f8', [palette.grid]: '#e3e6ea', [palette.axis]: '#8a9098',
  [palette.ink]: '#1b1d21', [palette.soft]: '#4a4f57', [palette.faint]: '#6b7078',
  [palette.blue]: '#1f4e79', [palette.coral]: '#c0504d', [palette.green]: '#3f7a31', [palette.amber]: '#b7801a', [palette.violet]: '#6b4c9a',
  [palette.hot]: '#e8f0f8', [palette.shadow]: '#ffffff',
  [vivid.blue]: '#2d70b3', [vivid.coral]: '#c74440', [vivid.green]: '#388c46', [vivid.amber]: '#d96a0b', [vivid.violet]: '#6042a6',
};
const ink = (color: string | undefined) => (color ? paper[color.toLowerCase()] ?? color : undefined);
const n = (v: number) => (Math.round(v * 10) / 10).toString();
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

class PrintPen implements Pen {
  readonly w = W;
  readonly h = H;
  /** Paper has no key button, so a plot draws its key onto the page. */
  readonly keyed = true;
  parts: string[] = [];
  /** What was drawn, so the printed page can be cropped to it: [left, top, right, bottom]. */
  box = [Infinity, Infinity, -Infinity, -Infinity];
  private grow(x0: number, y0: number, x1: number, y1: number) {
    const b = this.box;
    b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], y0); b[2] = Math.max(b[2], x1); b[3] = Math.max(b[3], y1);
  }
  private attrs(s: Style) {
    const stroke = ink(s.stroke);
    return `fill="${ink(s.fill) ?? 'none'}"${stroke ? ` stroke="${stroke}" stroke-width="${s.width ?? 1.5}" stroke-linecap="round" stroke-linejoin="round"` : ''}${s.dash?.length ? ` stroke-dasharray="${s.dash.join(' ')}"` : ''}${s.alpha !== undefined && s.alpha < 1 ? ` opacity="${s.alpha.toFixed(3)}"` : ''}`;
  }
  path(points: P[], s: Style, closed = false) {
    if (points.length < 2) return;
    // The page-filling background (and a panel behind everything) does not count as content.
    if (!(s.fill && ink(s.fill) === '#ffffff' && !s.stroke)) for (const [x, y] of points) this.grow(x, y, x, y);
    this.parts.push(`<path d="M${points.map(p => n(p[0]) + ' ' + n(p[1])).join('L')}${closed ? 'Z' : ''}" ${this.attrs(s)}/>`);
  }
  circle(x: number, y: number, r: number, s: Style) {
    this.grow(x - r, y - r, x + r, y + r);
    this.parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(Math.max(0, r))}" ${this.attrs(s)}/>`);
  }
  text(x: number, y: number, value: string, s: TextStyle = {}) {
    const size = s.size ?? 12, w = value.length * size * 0.56, left = s.align === 'middle' ? x - w / 2 : s.align === 'end' ? x - w : x;
    this.grow(left, y - size, left + w, y + size * 0.3);
    this.parts.push(`<text x="${n(x)}" y="${n(y)}" font-family="${s.serif ? printSerif : printSans}" font-size="${s.size ?? 12}" font-weight="${s.weight ?? 400}" fill="${ink(s.color) ?? '#4a4f57'}" text-anchor="${s.align ?? 'start'}"${s.alpha !== undefined && s.alpha < 1 ? ` opacity="${s.alpha}"` : ''}>${esc(value)}</text>`);
  }
}

/**
 * Prints a visual spec (the JSON of a ```visual block, any kind) as an SVG on white paper. Sliders sit at their
 * starting values, every step is shown, and a moving picture is printed as it stands once its animation has run
 * (a chart fully grown). Throws the same short reasons as the chat does for a broken visual.
 */
export function printVisualSvg(raw: unknown) {
  const visual = compileVisual(typeof raw === 'string' ? JSON.parse(raw) : raw), spec = visual.spec, values = defaultValues(visual);
  const t = spec.animate?.duration ?? (spec.kind === 'chart' ? 1 : 0);
  if (visual.figure) {
    let h = 5381; for (const ch of JSON.stringify(spec)) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
    return visual.figure.render(values, t, { background: '#ffffff', idPrefix: 'v' + h.toString(36) });
  }
  const pen = new PrintPen();
  visual.draw(pen, values, t);
  // Cropped to what was drawn (a one-row diagram does not print in a mostly empty frame), never past the canvas.
  const pad = 20, b = pen.box, empty = !Number.isFinite(b[0]);
  const x = empty ? 0 : Math.max(0, Math.floor(b[0] - pad)), y = empty ? 0 : Math.max(0, Math.floor(b[1] - pad));
  const w = empty ? W : Math.min(W, Math.ceil(b[2] + pad)) - x, h = empty ? H : Math.min(H, Math.ceil(b[3] + pad)) - y;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"><title>${esc(spec.title)}</title><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>${pen.parts.join('')}</svg>`;
}

/** The caption a printed visual carries: its own caption, else its title. */
export const visualCaption = (raw: { title?: unknown; caption?: unknown }) => String(raw.caption || raw.title || '').trim();

/** The JSON of each ```visual block in Markdown, in order, with where it sits. Unreadable blocks are skipped. */
export function visualBlocks(markdown: string) {
  const out: { start: number; end: number; spec: Record<string, unknown> }[] = [];
  for (const m of markdown.matchAll(/```visual[^\n]*\n([\s\S]*?)(?:```|$)/g)) {
    try {
      const spec = parseModelJson(m[1]);
      if (spec && typeof spec === 'object' && !Array.isArray(spec)) out.push({ start: m.index!, end: m.index! + m[0].length, spec });
    } catch { /* a block that is not JSON is left out of the printed copy */ }
  }
  return out;
}
