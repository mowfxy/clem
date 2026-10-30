import { useEffect, useState } from 'react';
/** One drawing vocabulary for every visual: painted live to a canvas, or written out as SVG for exports and thumbnails. */
export type P = [number, number];
export type Style = { stroke?: string; fill?: string; width?: number; dash?: number[]; alpha?: number };
/** `ui` sets the text in the system's interface face, which stays crisp at the small sizes a graph's labels use. */
export type TextStyle = { size?: number; color?: string; align?: 'start' | 'middle' | 'end'; serif?: boolean; weight?: number; alpha?: number; ui?: boolean };
export interface Pen {
  readonly w: number;
  readonly h: number;
  /** How much larger text must be drawn to show at its intended size when the picture is shown smaller than W. */
  textScale?: number;
  /** True for a copy with no key button (exports): a plot then draws its key into the picture. */
  keyed?: boolean;
  path(points: P[], style: Style, closed?: boolean): void;
  circle(x: number, y: number, r: number, style: Style): void;
  text(x: number, y: number, value: string, style?: TextStyle): void;
}

export const W = 800, H = 440;
export const C = { bg: '#161615', panel: '#1b1b19', grid: '#242422', axis: '#4a4a45', ink: '#f0efeb', soft: '#a3a3a0', faint: '#6f6e68', blue: '#8197e2', coral: '#d87968' };
const SANS = "'Mowafy Sans',system-ui,sans-serif", SERIF = "'Mowafy Serif',serif";
const UI = "'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif";

/** Visuals are drawn in the dark palette; on the light theme each pen moves those colours onto paper (tuned by eye
 *  against the light theme's warm whites and navy ink). Colours outside the palette are kept. */
const PAPER: Record<string, string> = {
  '#161615': '#fbf9f4', '#1b1b19': '#ffffff', '#1d1d1b': '#ffffff', '#242422': '#ece8df', '#262624': '#f1ede4', '#2c2c2a': '#e4e0d6', '#0a0a09': '#bdb6a6', '#141413': '#f4f1ea',
  '#4a4a45': '#c4c0b5', '#f0efeb': '#20253a', '#a3a3a0': '#585d69', '#6f6e68': '#868891', '#8a8a85': '#7b7d85', '#b8b7b2': '#6a6c75',
  '#5b9cf5': '#2d70b3', '#f2735f': '#c74440', '#4fbf73': '#388c46', '#f5a14a': '#d96a0b', '#a98af5': '#6042a6',
  '#8197e2': '#3c55b0', '#d87968': '#b24c39', '#8fbf98': '#3b7a49', '#d9b36c': '#946512', '#b49ddb': '#6b4f9e', '#9fcf8f': '#3f7d33', '#e39a5b': '#b0611f', '#d08a5a': '#a55a26',
};
export type Ink = (color: string) => string;
export const darkInk: Ink = c => c;
export const paperInk: Ink = c => PAPER[c.toLowerCase()] ?? c;
export const isLight = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light';
/** The ink for the theme on screen now. */
export const themeInk = (): Ink => (isLight() ? paperInk : darkInk);

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
  textScale = 1;
  keyed = false;
  /** `fonts` replaces the app's faces, for an exported image (files use standard fonts, see core/print-fonts). */
  constructor(private ctx: CanvasRenderingContext2D, private fonts?: { sans: string; serif: string }, private ink: Ink = darkInk) {}
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
    if (s.fill) { c.fillStyle = this.ink(s.fill); c.fill(); }
    if (s.stroke) { c.strokeStyle = this.ink(s.stroke); c.stroke(); }
    c.globalAlpha = 1;
  }
  circle(x: number, y: number, r: number, s: Style) {
    const c = this.ctx;
    this.apply(s);
    c.beginPath();
    c.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
    if (s.fill) { c.fillStyle = this.ink(s.fill); c.fill(); }
    if (s.stroke) { c.strokeStyle = this.ink(s.stroke); c.stroke(); }
    c.globalAlpha = 1;
  }
  private font(s: TextStyle) { return `${s.weight ?? 400} ${s.size ?? 12}px ${s.serif ? this.fonts?.serif ?? SERIF : s.ui ? this.fonts?.sans ?? UI : this.fonts?.sans ?? SANS}`; }
  text(x: number, y: number, value: string, s: TextStyle = {}) {
    const c = this.ctx;
    c.globalAlpha = s.alpha ?? 1;
    c.font = this.font(s);
    c.textAlign = s.align === 'middle' ? 'center' : s.align === 'end' ? 'right' : 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = this.ink(s.color ?? C.soft);
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
  keyed = false;
  constructor(private ink: Ink = darkInk) {}
  private attrs(s: Style) {
    return `fill="${s.fill ? this.ink(s.fill) : 'none'}"${s.stroke ? ` stroke="${this.ink(s.stroke)}" stroke-width="${s.width ?? 1.5}" stroke-linecap="round" stroke-linejoin="round"` : ''}${s.dash ? ` stroke-dasharray="${s.dash.join(' ')}"` : ''}${s.alpha !== undefined && s.alpha < 1 ? ` opacity="${s.alpha.toFixed(3)}"` : ''}`;
  }
  path(points: P[], s: Style, closed = false) {
    if (points.length < 2) return;
    this.parts.push(`<path d="M${points.map(p => n(p[0]) + ' ' + n(p[1])).join('L')}${closed ? 'Z' : ''}" ${this.attrs(s)}/>`);
  }
  circle(x: number, y: number, r: number, s: Style) {
    this.parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(Math.max(0, r))}" ${this.attrs(s)}/>`);
  }
  text(x: number, y: number, value: string, s: TextStyle = {}) {
    this.parts.push(`<text x="${n(x)}" y="${n(y)}" font-family="${s.serif ? 'Mowafy Serif, serif' : s.ui ? UI.replace(/'/g, '') : 'Mowafy Sans, Arial, sans-serif'}" font-size="${s.size ?? 12}" font-weight="${s.weight ?? 400}" fill="${this.ink(s.color ?? C.soft)}" text-anchor="${s.align ?? 'start'}"${s.alpha !== undefined ? ` opacity="${s.alpha}"` : ''}>${esc(value)}</text>`);
  }
  toString(title = '') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${title ? `<title>${esc(title)}</title>` : ''}<rect width="${W}" height="${H}" fill="${this.ink(C.bg)}"/>${this.parts.join('')}</svg>`;
  }
}

/** The colour theme as React state, so a visual repaints when the person switches it. */
export function useInk(): Ink {
  const [light, setLight] = useState(isLight);
  useEffect(() => { const on = () => setLight(isLight()); window.addEventListener('clem-theme', on); return () => window.removeEventListener('clem-theme', on); }, []);
  return light ? paperInk : darkInk;
}
