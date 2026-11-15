// The Image download of a visual or figure (the visual's download menu, src/visuals/SpecVisual.tsx and
// src/chat/KinetraFigure.tsx), as one function each, so Telegram's photos (src/telegram/figure-draw.ts), from the
// laptop or from the VPS worker's headless page, are pixel for pixel the image the download gives.
import { standardFonts, exportFonts } from '../../core/print-fonts';
import { CanvasPen, C, H, W, type Ink, type Pen } from './pen';
import { paintSvg } from './record';

const blob = (c: HTMLCanvasElement) => new Promise<Blob>((done, fail) => c.toBlob((b) => (b ? done(b) : fail(Error('No picture.'))), 'image/png'));
/** A figure (SVG): its print fonts, twice its size, painted as the download paints it. */
export async function figurePng(svg: string): Promise<Blob> {
  const out = standardFonts(svg), box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(out), c = document.createElement('canvas');
  c.width = Math.round((box ? +box[1] : 760) * 2); c.height = Math.round((box ? +box[2] : 460) * 2);
  await paintSvg(c, out);
  return blob(c);
}
/** A visual's panel: its background, twice its size, drawn with the export fonts and a key. */
export function panelPng(draw: (pen: Pen) => void, ink: Ink): Promise<Blob> {
  const off = document.createElement('canvas'); off.width = W * 2; off.height = H * 2;
  const ctx = off.getContext('2d')!; ctx.fillStyle = ink(C.bg); ctx.fillRect(0, 0, off.width, off.height); ctx.scale(2, 2);
  const out = new CanvasPen(ctx, exportFonts, ink); out.keyed = true;
  draw(out);
  return blob(off);
}
