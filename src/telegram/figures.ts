import { desktop } from '../desktop/bridge';
import { drawFigures, type Photo } from './figure-draw';
export { MAX_PHOTOS } from './figure-draw';

/** Up to MAX_PHOTOS pictures of the answer's visuals, in order (src/telegram/figure-draw.ts draws them; the VPS worker
 *  runs the same drawing in its headless page). A ```kinetra figure is drawn by the desktop's Kinetra worker. */
export function figurePhotos(content: string): Promise<Photo[]> {
  return drawFigures(content, async (block) => {
    if (!desktop) throw Error('No figure.');
    const { svg } = await desktop.invoke({ action: 'kinetraFigure', figure: JSON.stringify({ module: block.module, fn: block.fn, args: block.args }) }) as { svg: string };
    return svg;
  });
}
