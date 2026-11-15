import { figureBlocks } from '../../core/telegram/render';
import { defaultValues, parseVisual } from '../../core/visual-spec';
import { readKinetraBlock, type KinetraBlock } from '../../core/kinetra-block';
import { darkInk } from '../visuals/pen';
import { figurePng, panelPng } from '../visuals/png-export';

/** A ```kinetra figure's SVG: the desktop's Kinetra worker draws it (src/telegram/figures.ts), the VPS worker's own on the
 *  server (desktop/engine/vps/page-tasks.ts). */
export type KinetraSvg = (block: KinetraBlock, n: number) => Promise<string>;

/**
 * An answer's visuals and textbook figures as PNGs, for Telegram (they go as photos; core/telegram/render.ts leaves their
 * JSON out of the text). Each is exactly its own Image download (src/visuals/png-export.ts): a ```visual on its dark panel
 * at its first finished frame, a figure (a visual's textbook figure or a ```kinetra block) as the figure's PNG. One that cannot be drawn is
 * skipped; the answer's words still go.
 */
export const MAX_PHOTOS = 6;
export type Photo = { name: string; data: string };

const fileName = (title: string, n: number) => (title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || `Visual ${n}`) + '.png';

function toBase64(blob: Blob) {
  return blob.arrayBuffer().then((buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); });
}

/** Each picture is the visual's own Image download (src/visuals/png-export.ts), drawn in the app's dark ink: the same
 *  pixels from the laptop's window and from the VPS worker's headless page. */
async function draw(block: { lang: 'visual' | 'kinetra'; body: string }, n: number, kinetra: KinetraSvg): Promise<Photo> {
  if (block.lang === 'kinetra') {
    const parsed = readKinetraBlock(block.body);
    if (!parsed) throw Error('No figure.');
    return { name: fileName(parsed.title, n), data: await toBase64(await figurePng(await kinetra(parsed, n))) };
  }
  const visual = parseVisual(block.body), values = defaultValues(visual), title = String(visual.spec.title || '');
  if (visual.figure) return { name: fileName(title, n), data: await toBase64(await figurePng(visual.figure.render(values, 0, { idPrefix: 'tg' + n }))) };
  // The panel as the chat shows it, after its entrance (a moving visual at its start).
  return { name: fileName(title, n), data: await toBase64(await panelPng((pen) => visual.draw(pen, values, visual.moving ? 0 : 1, undefined), darkInk)) };
}

/** Up to MAX_PHOTOS pictures of the answer's visuals, in order. */
export async function drawFigures(content: string, kinetra: KinetraSvg): Promise<Photo[]> {
  const blocks = figureBlocks(content).slice(0, MAX_PHOTOS), out: Photo[] = [];
  for (const [i, block] of blocks.entries()) {
    try { out.push(await draw(block, i + 1, kinetra)); } catch (e) { console.warn('[telegram] a visual could not be drawn:', (e as Error).message); }
  }
  return out;
}
