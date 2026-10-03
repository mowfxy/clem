/** One drawing vocabulary for every visual: painted live to a canvas, or written out as SVG for exports and thumbnails. */
export type P = [number, number];
export type Style = { stroke?: string; fill?: string; width?: number; dash?: number[]; alpha?: number };
export type TextStyle = { size?: number; color?: string; align?: 'start' | 'middle' | 'end'; serif?: boolean; weight?: number; alpha?: number };
export interface Pen {
  readonly w: number;
  readonly h: number;
  path(points: P[], style: Style, closed?: boolean): void;
  circle(x: number, y: number, r: number, style: Style): void;
  text(x: number, y: number, value: string, style?: TextStyle): void;
}

export const W = 800, H = 440;
export const C = { bg: '#161615', panel: '#1b1b19', grid: '#242422', axis: '#4a4a45', ink: '#f0efeb', soft: '#a3a3a0', faint: '#6f6e68', blue: '#8197e2', coral: '#d87968' };
const SANS = "'Mowafy Sans',system-ui,sans-serif", SERIF = "'Mowafy Serif',serif";

export function arrow(pen: Pen, x1: number, y1: number, x2: number, y2: number, style: Style, head = 9) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1) return;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len, size = Math.min(head, len * 0.6);
  pen.path([[x1, y1], [x2 - ux * size * 0.7, y2 - uy * size * 0.7]], { ...style, fill: undefined });
  pen.path([[x2, y2], [x2 - ux * size - uy * size * 0.5, y2 - uy * size + ux * size * 0.5], [x2 - ux * size + uy * size * 0.5, y2 - uy * size - ux * size * 0.5]], { fill: style.stroke, alpha: style.alpha }, true);
}

/** Round axis steps to 1, 2 or 5 × 10ⁿ. */
export function niceStep(span: number, ticks = 6) {
  const raw = span / ticks, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
}
export const fmt = (v: number, digits = 2) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(digits);

export class CanvasPen implements Pen {
  readonly w = W;
  readonly h = H;
  /** `fonts` replaces the app's faces, for an exported image (files use standard fonts, see core/print-fonts). */
  constructor(private ctx: CanvasRenderingContext2D, private fonts?: { sans: string; serif: string }) {}
  private apply(s: Style) {
    const c = this.ctx;
    c.globalAlpha = s.alpha ?? 1;
    c.setLineDash(s.dash || []);
    c.lineWidth = s.width ?? 1.5;
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }
  path(points: P[], s: Style, closed = false) {
    if (points.length < 2) return;
    const c = this.ctx;
    this.apply(s);
    c.beginPath();
    c.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) c.lineTo(points[i][0], points[i][1]);
    if (closed) c.closePath();
    if (s.fill) { c.fillStyle = s.fill; c.fill(); }
    if (s.stroke) { c.strokeStyle = s.stroke; c.stroke(); }
    c.globalAlpha = 1;
  }
  circle(x: number, y: number, r: number, s: Style) {
    const c = this.ctx;
    this.apply(s);
    c.beginPath();
    c.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
    if (s.fill) { c.fillStyle = s.fill; c.fill(); }
    if (s.stroke) { c.strokeStyle = s.stroke; c.stroke(); }
    c.globalAlpha = 1;
  }
  text(x: number, y: number, value: string, s: TextStyle = {}) {
    const c = this.ctx;
    c.globalAlpha = s.alpha ?? 1;
    c.font = `${s.weight ?? 400} ${s.size ?? 12}px ${s.serif ? this.fonts?.serif ?? SERIF : this.fonts?.sans ?? SANS}`;
    c.fillStyle = s.color ?? C.soft;
    c.textAlign = s.align === 'middle' ? 'center' : s.align === 'end' ? 'right' : 'left';
    c.textBaseline = 'alphabetic';
    c.fillText(value, x, y);
    c.globalAlpha = 1;
  }
}

const n = (v: number) => (Math.round(v * 10) / 10).toString();
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export class SvgPen implements Pen {
  readonly w = W;
  readonly h = H;
  private parts: string[] = [];
  private attrs(s: Style) {
    return `fill="${s.fill ?? 'none'}"${s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.width ?? 1.5}" stroke-linecap="round" stroke-linejoin="round"` : ''}${s.dash ? ` stroke-dasharray="${s.dash.join(' ')}"` : ''}${s.alpha !== undefined && s.alpha < 1 ? ` opacity="${s.alpha.toFixed(3)}"` : ''}`;
  }
  path(points: P[], s: Style, closed = false) {
    if (points.length < 2) return;
    this.parts.push(`<path d="M${points.map(p => n(p[0]) + ' ' + n(p[1])).join('L')}${closed ? 'Z' : ''}" ${this.attrs(s)}/>`);
  }
  circle(x: number, y: number, r: number, s: Style) {
    this.parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(Math.max(0, r))}" ${this.attrs(s)}/>`);
  }
  text(x: number, y: number, value: string, s: TextStyle = {}) {
    this.parts.push(`<text x="${n(x)}" y="${n(y)}" font-family="${s.serif ? 'Mowafy Serif, serif' : 'Mowafy Sans, Arial, sans-serif'}" font-size="${s.size ?? 12}" font-weight="${s.weight ?? 400}" fill="${s.color ?? C.soft}" text-anchor="${s.align ?? 'start'}"${s.alpha !== undefined ? ` opacity="${s.alpha}"` : ''}>${esc(value)}</text>`);
  }
  toString(title = '') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${title ? `<title>${esc(title)}</title>` : ''}<rect width="${W}" height="${H}" fill="${C.bg}"/>${this.parts.join('')}</svg>`;
  }
}
