import { figureBlocks } from '../../core/telegram/render';
import { defaultValues, parseVisual } from '../../core/visual-spec';
import { exportFonts, standardFonts } from '../../core/print-fonts';
import { readKinetraBlock, type KinetraBlock } from '../../core/kinetra-block';
import { CanvasPen, C, H, W, darkInk } from '../visuals/pen';

/** A ```kinetra figure's SVG: the desktop's Kinetra worker draws it (src/telegram/figures.ts), the VPS worker's own on the
 *  server (desktop/engine/vps/page-tasks.ts). */
export type KinetraSvg = (block: KinetraBlock, n: number) => Promise<string>;

/**
 * An answer's visuals and textbook figures as PNGs, for Telegram (they go as photos; core/telegram/render.ts leaves their
 * JSON out of the text). Each is drawn as its own PNG download draws it: a ```visual on its dark panel at its first
 * finished frame, a figure (a visual's textbook figure or a ```kinetra block) on white paper. One that cannot be drawn is
 * skipped; the answer's words still go.
 */
export const MAX_PHOTOS = 6;
export type Photo = { name: string; data: string };

const fileName = (title: string, n: number) => (title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || `Visual ${n}`) + '.png';

function toBase64(blob: Blob) {
  return blob.arrayBuffer().then((buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); });
}
function png(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(Error('No picture.'))), 'image/png'));
}
/** An SVG on white paper, at twice its size. Fails (rather than sending a blank picture) when the SVG can't be drawn. */
function paper(svg: string) {
  const out = standardFonts(svg), box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(out);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((box ? +box[1] : 760) * 2); canvas.height = Math.round((box ? +box[2] : 460) * 2);
  const url = URL.createObjectURL(new Blob([out], { type: 'image/svg+xml' })), image = new Image();
  return new Promise<HTMLCanvasElement>((done, fail) => {
    image.onload = () => { const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(url); done(canvas); };
    image.onerror = () => { URL.revokeObjectURL(url); fail(Error('The figure could not be drawn.')); };
    image.src = url;
  });
}

async function draw(block: { lang: 'visual' | 'kinetra'; body: string }, n: number, kinetra: KinetraSvg): Promise<Photo> {
  if (block.lang === 'kinetra') {
    const parsed = readKinetraBlock(block.body);
    if (!parsed) throw Error('No figure.');
    const svg = await kinetra(parsed, n);
    return { name: fileName(parsed.title, n), data: await toBase64(await png(await paper(svg))) };
  }
  const visual = parseVisual(block.body), values = defaultValues(visual), title = String(visual.spec.title || '');
  if (visual.figure) return { name: fileName(title, n), data: await toBase64(await png(await paper(visual.figure.render(values, 0, { idPrefix: 'tg' + n })))) };
  // The panel as the chat shows it, after its entrance (a moving visual at its start).
  const canvas = document.createElement('canvas');
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = darkInk(C.bg); ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.scale(2, 2);
  const pen = new CanvasPen(ctx, exportFonts, darkInk); pen.keyed = true;
  visual.draw(pen, values, visual.moving ? 0 : 1, undefined);
  return { name: fileName(title, n), data: await toBase64(await png(canvas)) };
}

/** Up to MAX_PHOTOS pictures of the answer's visuals, in order. */
export async function drawFigures(content: string, kinetra: KinetraSvg): Promise<Photo[]> {
  const blocks = figureBlocks(content).slice(0, MAX_PHOTOS), out: Photo[] = [];
  for (const [i, block] of blocks.entries()) {
    try { out.push(await draw(block, i + 1, kinetra)); } catch (e) { console.warn('[telegram] a visual could not be drawn:', (e as Error).message); }
  }
  return out;
}
