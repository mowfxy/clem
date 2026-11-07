import { useEffect, useRef } from 'react';
import horizon from './horizon.webp?inline';

/** The window's backdrop: Earth's limb from orbit, set in type. A small photograph is read one cell at a time and each
 *  cell becomes a character in that cell's colour, over a dimmed copy of the picture that gives the glass above it real
 *  light to bend; the black of space keeps a sparse coloured speckle. It is drawn once
 *  per size, in Mowafy Sans, then only a few cells change: 6 times a second on the home screen, never behind a chat
 *  or page, in quiet mode, or while the window is in the background. The picture is inlined so the canvas can read it. */
const RAMP = ' .··::;;+*#';
const CELL_W = 5, CELL_H = 8.5, MAX_COLS = 430, TWINKLE = 0.012;
const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const quiet = () => document.documentElement.dataset.quiet === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPECKLE = ['#ff5a36', '#3f8cff', '#37d08c', '#e8c547', '#b27bff'];

type Cell = { x: number; y: number; c: number; fill: string; alpha: number };

export function HorizonField({ live }: { live: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null), liveRef = useRef(live);
  liveRef.current = live;
  useEffect(() => {
    const canvas = ref.current!, ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    let gone = false, photo: HTMLImageElement | null = null, daylit: HTMLCanvasElement | null = null, base: HTMLCanvasElement | null = null, pixels: Uint8ClampedArray | null = null, imgW = 0, imgH = 0, cells: Cell[] = [], cw = CELL_W, ch = CELL_H, dpr = 1, timer = 0, resize = 0;
    const paint = (cell: Cell, char: string) => {
      const x = Math.floor(cell.x * dpr), y = Math.floor(cell.y * dpr), width = Math.ceil(cw * dpr) + 1, height = Math.ceil(ch * dpr) + 1;
      ctx.globalAlpha = 1; ctx.clearRect(x, y, width, height);
      if (base) ctx.drawImage(base, x, y, width, height, x, y, width, height);
      if (char === ' ') return;
      ctx.globalAlpha = cell.alpha; ctx.fillStyle = cell.fill;
      ctx.fillText(char, (cell.x + cw / 2) * dpr, (cell.y + ch / 2) * dpr);
    };
    const draw = () => {
      if (!pixels) return;
      const w = window.innerWidth, h = window.innerHeight, light = document.documentElement.dataset.theme === 'light';
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cw = Math.max(CELL_W, w / MAX_COLS); ch = cw * (CELL_H / CELL_W);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.font = `400 ${(cw * 1.7 * dpr).toFixed(1)}px 'Mowafy Sans', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // Cover the window: the picture is scaled to fill it and centred.
      const scale = Math.max(w / imgW, h / imgH), ox = (imgW - w / scale) / 2, oy = (imgH - h / scale) / 2;
      const cols = Math.ceil(w / cw), rows = Math.ceil(h / ch);
      cells = [];
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const x = Math.min(imgW - 1, Math.floor(ox + ((col + 0.5) * cw) / scale)), y = Math.min(imgH - 1, Math.floor(oy + ((row + 0.5) * ch) / scale)), at = (y * imgW + x) * 4;
        const r = pixels[at], g = pixels[at + 1], b = pixels[at + 2], lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255, grain = hash(col, row);
        const cell: Cell = { x: col * cw, y: row * ch, c: 0, fill: '', alpha: 1 };
        if (lum < 0.05) {
          // Space: most cells stay empty, the rest are faint specks of colour, like a sensor in the dark.
          if (grain > 0.62) continue;
          cell.c = grain < 0.2 ? 2 : 1; cell.fill = SPECKLE[Math.floor(hash(row, col) * SPECKLE.length)]; cell.alpha = light ? 0.2 : 0.1 + grain * 0.2;
        } else {
          // Colour is pushed a little past the photograph, and density follows brightness with some grain in it.
          const mean = (r + g + b) / 3, push = 1.4, cr = mean + (r - mean) * push, cg = mean + (g - mean) * push, cb = mean + (b - mean) * push;
          const dim = light ? 0.86 : 0.8;
          cell.fill = `rgb(${Math.min(255, cr * dim) | 0},${Math.min(255, cg * dim) | 0},${Math.min(255, cb * dim) | 0})`;
          cell.c = Math.max(1, Math.min(RAMP.length - 1, Math.round((Math.sqrt(lum) * 0.92 + (grain - 0.5) * 0.2) * (RAMP.length - 1))));
          cell.alpha = light ? Math.min(1, 0.45 + lum * 0.9) : 0.26 + lum * 0.42;
        }
        cells.push(cell);
      }
      // The picture itself, dimmed, under the characters.
      base = document.createElement('canvas'); base.width = canvas.width; base.height = canvas.height;
      const under = base.getContext('2d')!;
      under.globalAlpha = light ? 0.42 : 0.46; under.imageSmoothingQuality = 'high';
      if (light && !daylit) {
        // On the light theme space is simply not there: the picture's black turns see-through instead of grey.
        daylit = document.createElement('canvas'); daylit.width = imgW; daylit.height = imgH;
        const lit = daylit.getContext('2d')!, copy = new ImageData(new Uint8ClampedArray(pixels), imgW, imgH);
        for (let i = 0; i < copy.data.length; i += 4) copy.data[i + 3] = Math.min(255, (0.3 * copy.data[i] + 0.59 * copy.data[i + 1] + 0.11 * copy.data[i + 2]) * 3);
        lit.putImageData(copy, 0, 0);
      }
      under.drawImage(light ? daylit! : photo!, ox, oy, w / scale, h / scale, 0, 0, base.width, base.height);
      ctx.globalAlpha = 1; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(base, 0, 0);
      // Grouped by colour, so a large window costs a few milliseconds rather than a colour change per character.
      for (const cell of [...cells].sort((a, b) => (a.fill < b.fill ? -1 : 1))) {
        ctx.globalAlpha = cell.alpha; ctx.fillStyle = cell.fill;
        ctx.fillText(RAMP[cell.c], (cell.x + cw / 2) * dpr, (cell.y + ch / 2) * dpr);
      }
      ctx.globalAlpha = 1;
    };
    const twinkle = () => {
      if (!cells.length || !liveRef.current || document.hidden || !document.hasFocus() || quiet()) return;
      for (let n = Math.round(cells.length * TWINKLE); n > 0; n--) {
        const cell = cells[Math.floor(Math.random() * cells.length)], shift = Math.random() < 0.5 ? -1 : 1;
        paint(cell, RAMP[Math.max(1, Math.min(RAMP.length - 1, cell.c + shift))]);
      }
      ctx.globalAlpha = 1;
    };
    const image = new Image();
    image.onload = () => {
      if (gone) return;
      photo = image; imgW = image.naturalWidth; imgH = image.naturalHeight;
      const read = document.createElement('canvas'); read.width = imgW; read.height = imgH;
      const c = read.getContext('2d', { willReadFrequently: true })!;
      c.drawImage(image, 0, 0); pixels = c.getImageData(0, 0, imgW, imgH).data;
      void document.fonts.load("400 10px 'Mowafy Sans'").catch(() => {}).then(() => { if (!gone) draw(); });
    };
    image.src = horizon;
    const onResize = () => { clearTimeout(resize); resize = window.setTimeout(draw, 160); };
    window.addEventListener('resize', onResize);
    window.addEventListener('clem-theme', draw);
    timer = window.setInterval(twinkle, 1000 / 6);
    return () => { gone = true; clearInterval(timer); clearTimeout(resize); window.removeEventListener('resize', onResize); window.removeEventListener('clem-theme', draw); };
  }, []);
  return <canvas ref={ref} className="horizon-field" aria-hidden="true" />;
}
