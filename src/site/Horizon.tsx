import { useEffect, useRef } from 'react';
import horizon from '../glass/horizon.webp?inline';

/** The app's backdrop on the page: Earth's limb at sunrise, read cell by cell into Mowafy Sans characters exactly as
 *  src/glass/HorizonField.tsx reads it, in the app's light theme (`day`) or its dark one. Drawn once per size; a few cells
 *  twinkle while it is in view. Reduced motion keeps it still. */
const RAMP = ' .··::;;+*#';
const SPECKLE = ['#ff5a36', '#3f8cff', '#37d08c', '#e8c547', '#b27bff'];
const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
type Cell = { x: number; y: number; c: number; fill: string; alpha: number };

export function Horizon({ day = false }: { day?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!, ctx = canvas.getContext('2d');
    if (!ctx) return;
    let gone = false, seen = true, photo: HTMLImageElement | null = null, pixels: Uint8ClampedArray | null = null, base: HTMLCanvasElement | null = null;
    let imgW = 0, imgH = 0, cw = 6, ch = 10, dpr = 1, cells: Cell[] = [], resize = 0, lastW = 0;
    const paint = (cell: Cell, char: string) => {
      const x = Math.floor(cell.x * dpr), y = Math.floor(cell.y * dpr), w = Math.ceil(cw * dpr) + 1, h = Math.ceil(ch * dpr) + 1;
      ctx.globalAlpha = 1; ctx.clearRect(x, y, w, h);
      if (base) ctx.drawImage(base, x, y, w, h, x, y, w, h);
      ctx.globalAlpha = cell.alpha; ctx.fillStyle = cell.fill;
      ctx.fillText(char, (cell.x + cw / 2) * dpr, (cell.y + ch / 2) * dpr);
    };
    const draw = () => {
      if (!pixels || !photo) return;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      lastW = window.innerWidth;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cw = Math.max(5.2, w / 270); ch = cw * 1.7;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.font = `400 ${(cw * 1.7 * dpr).toFixed(1)}px 'Mowafy Sans', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const scale = Math.max(w / imgW, h / imgH), ox = (imgW - w / scale) / 2, oy = (imgH - h / scale) / 2;
      cells = [];
      for (let row = 0; row < Math.ceil(h / ch); row++) for (let col = 0; col < Math.ceil(w / cw); col++) {
        const x = Math.min(imgW - 1, Math.floor(ox + ((col + 0.5) * cw) / scale)), y = Math.min(imgH - 1, Math.floor(oy + ((row + 0.5) * ch) / scale)), at = (y * imgW + x) * 4;
        const r = pixels[at], g = pixels[at + 1], b = pixels[at + 2], lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255, grain = hash(col, row);
        const cell: Cell = { x: col * cw, y: row * ch, c: 0, fill: '', alpha: 1 };
        if (lum < 0.05) {
          if (grain > 0.6 || day) continue;
          cell.c = grain < 0.2 ? 2 : 1; cell.fill = SPECKLE[Math.floor(hash(row, col) * SPECKLE.length)]; cell.alpha = 0.1 + grain * 0.22;
        } else {
          const mean = (r + g + b) / 3, dim = day ? 0.86 : 0.84, tint = (v: number) => Math.max(0, Math.min(255, (mean + (v - mean) * 1.4) * dim)) | 0;
          cell.fill = `rgb(${tint(r)},${tint(g)},${tint(b)})`;
          cell.c = Math.max(1, Math.min(RAMP.length - 1, Math.round((Math.sqrt(lum) * 0.92 + (grain - 0.5) * 0.2) * (RAMP.length - 1))));
          cell.alpha = day ? Math.min(1, 0.45 + lum * 0.9) : 0.3 + lum * 0.5;
        }
        cells.push(cell);
      }
      base = document.createElement('canvas'); base.width = canvas.width; base.height = canvas.height;
      const under = base.getContext('2d')!;
      let from: CanvasImageSource = photo;
      if (day) {
        // By day, space is simply not there: the picture's black turns see-through instead of grey.
        const lit = document.createElement('canvas'); lit.width = imgW; lit.height = imgH;
        const copy = new ImageData(new Uint8ClampedArray(pixels), imgW, imgH);
        for (let i = 0; i < copy.data.length; i += 4) copy.data[i + 3] = Math.min(255, (0.3 * copy.data[i] + 0.59 * copy.data[i + 1] + 0.11 * copy.data[i + 2]) * 3);
        lit.getContext('2d')!.putImageData(copy, 0, 0);
        from = lit;
      }
      under.globalAlpha = 0.42; under.imageSmoothingQuality = 'high';
      under.drawImage(from, ox, oy, w / scale, h / scale, 0, 0, base.width, base.height);
      ctx.globalAlpha = 1; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(base, 0, 0);
      for (const cell of [...cells].sort((a, b) => (a.fill < b.fill ? -1 : 1))) {
        ctx.globalAlpha = cell.alpha; ctx.fillStyle = cell.fill;
        ctx.fillText(RAMP[cell.c], (cell.x + cw / 2) * dpr, (cell.y + ch / 2) * dpr);
      }
      canvas.dataset.drawn = 'true';
    };
    const twinkle = () => {
      if (!cells.length || !seen || document.hidden || still()) return;
      for (let n = Math.round(cells.length * 0.01); n > 0; n--) {
        const cell = cells[Math.floor(Math.random() * cells.length)];
        paint(cell, RAMP[Math.max(1, Math.min(RAMP.length - 1, cell.c + (Math.random() < 0.5 ? -1 : 1)))]);
      }
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
    // Phones fire resize when the address bar slides; only a real width change redraws.
    const onResize = () => { if (window.innerWidth === lastW) return; clearTimeout(resize); resize = window.setTimeout(draw, 180); };
    window.addEventListener('resize', onResize);
    const watch = 'IntersectionObserver' in window ? new IntersectionObserver((e) => { seen = e[e.length - 1].isIntersecting; }) : null;
    watch?.observe(canvas);
    const timer = window.setInterval(twinkle, 1000 / 6);
    return () => { gone = true; watch?.disconnect(); clearInterval(timer); clearTimeout(resize); window.removeEventListener('resize', onResize); };
  }, [day]);
  return <canvas ref={ref} className="cs-horizon" aria-hidden="true" />;
}
