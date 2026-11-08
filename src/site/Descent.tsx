import { useEffect, useRef, type ReactNode } from 'react';
import horizon from '../glass/horizon.webp?inline';

/** The site's one spectacle: the app's backdrop (Earth's limb at sunrise, set in Mowafy Sans characters, the same reading
 *  as src/glass/HorizonField.tsx) fills the first screen. Scrolling falls toward the limb, the night closes in, and the
 *  real app window rises into place. After it, the page is the app's quiet night. The characters are drawn once per size;
 *  the descent only moves and scales that one canvas, so it costs a compositor transform per frame. */
const RAMP = ' .··::;;+*#';
const SPECKLE = ['#ff5a36', '#3f8cff', '#37d08c', '#e8c547', '#b27bff'];
const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => 1 - (1 - t) ** 3;
const span = (p: number, a: number, b: number) => clamp((p - a) / (b - a));

type Cell = { x: number; y: number; c: number; fill: string; alpha: number };

function useSky(canvasRef: React.RefObject<HTMLCanvasElement | null>, liveRef: React.RefObject<boolean>) {
  useEffect(() => {
    const canvas = canvasRef.current!, ctx = canvas.getContext('2d');
    if (!ctx) return;
    let gone = false, photo: HTMLImageElement | null = null, pixels: Uint8ClampedArray | null = null, base: HTMLCanvasElement | null = null;
    let imgW = 0, imgH = 0, cw = 6, ch = 10, dpr = 1, cells: Cell[] = [], timer = 0, resize = 0, lastW = 0;
    const paint = (cell: Cell, char: string) => {
      const x = Math.floor(cell.x * dpr), y = Math.floor(cell.y * dpr), w = Math.ceil(cw * dpr) + 1, h = Math.ceil(ch * dpr) + 1;
      ctx.globalAlpha = 1; ctx.clearRect(x, y, w, h);
      if (base) ctx.drawImage(base, x, y, w, h, x, y, w, h);
      if (char === ' ') return;
      ctx.globalAlpha = cell.alpha; ctx.fillStyle = cell.fill;
      ctx.fillText(char, (cell.x + cw / 2) * dpr, (cell.y + ch / 2) * dpr);
    };
    const draw = () => {
      if (!pixels || !photo) return;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      lastW = window.innerWidth;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      // Larger cells than the app's: on a page the type has to read as type from across the room, and it grows as you fall.
      cw = Math.max(5.5, w / 240); ch = cw * 1.7;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.font = `400 ${(cw * 1.7 * dpr).toFixed(1)}px 'Mowafy Sans', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const scale = Math.max(w / imgW, h / imgH), ox = (imgW - w / scale) / 2, oy = (imgH - h / scale) / 2;
      const cols = Math.ceil(w / cw), rows = Math.ceil(h / ch);
      cells = [];
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const x = Math.min(imgW - 1, Math.floor(ox + ((col + 0.5) * cw) / scale)), y = Math.min(imgH - 1, Math.floor(oy + ((row + 0.5) * ch) / scale)), at = (y * imgW + x) * 4;
        const r = pixels[at], g = pixels[at + 1], b = pixels[at + 2], lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255, grain = hash(col, row);
        const cell: Cell = { x: col * cw, y: row * ch, c: 0, fill: '', alpha: 1 };
        if (lum < 0.05) {
          if (grain > 0.6) continue;
          cell.c = grain < 0.2 ? 2 : 1; cell.fill = SPECKLE[Math.floor(hash(row, col) * SPECKLE.length)]; cell.alpha = 0.1 + grain * 0.22;
        } else {
          const mean = (r + g + b) / 3, push = 1.4;
          const cr = mean + (r - mean) * push, cg = mean + (g - mean) * push, cb = mean + (b - mean) * push;
          cell.fill = `rgb(${Math.min(255, cr * 0.84) | 0},${Math.min(255, cg * 0.84) | 0},${Math.min(255, cb * 0.84) | 0})`;
          cell.c = Math.max(1, Math.min(RAMP.length - 1, Math.round((Math.sqrt(lum) * 0.92 + (grain - 0.5) * 0.2) * (RAMP.length - 1))));
          cell.alpha = 0.3 + lum * 0.5;
        }
        cells.push(cell);
      }
      base = document.createElement('canvas'); base.width = canvas.width; base.height = canvas.height;
      const under = base.getContext('2d')!;
      under.globalAlpha = 0.42; under.imageSmoothingQuality = 'high';
      under.drawImage(photo, ox, oy, w / scale, h / scale, 0, 0, base.width, base.height);
      ctx.globalAlpha = 1; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(base, 0, 0);
      for (const cell of [...cells].sort((a, b) => (a.fill < b.fill ? -1 : 1))) {
        ctx.globalAlpha = cell.alpha; ctx.fillStyle = cell.fill;
        ctx.fillText(RAMP[cell.c], (cell.x + cw / 2) * dpr, (cell.y + ch / 2) * dpr);
      }
      ctx.globalAlpha = 1;
      canvas.dataset.drawn = 'true';
    };
    // The same slow twinkle as the app's home screen, only while the sky is in view and the visitor is at the top.
    const twinkle = () => {
      if (!cells.length || !liveRef.current || document.hidden || still()) return;
      for (let n = Math.round(cells.length * 0.01); n > 0; n--) {
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
    // Phones fire resize when the address bar slides; only a real width change redraws.
    const onResize = () => { if (window.innerWidth === lastW) return; clearTimeout(resize); resize = window.setTimeout(draw, 180); };
    window.addEventListener('resize', onResize);
    timer = window.setInterval(twinkle, 1000 / 6);
    return () => { gone = true; clearInterval(timer); clearTimeout(resize); window.removeEventListener('resize', onResize); };
  }, [canvasRef, liveRef]);
}

export function Descent({ copy, arrival }: { copy: ReactNode; arrival: ReactNode }) {
  const section = useRef<HTMLElement>(null), canvas = useRef<HTMLCanvasElement>(null), live = useRef(true);
  useSky(canvas, live);
  useEffect(() => {
    const el = section.current!;
    if (still()) { el.dataset.still = 'true'; return; }
    let frame = 0;
    const set = () => {
      frame = 0;
      const rect = el.getBoundingClientRect(), travel = Math.max(1, rect.height - window.innerHeight), p = clamp(-rect.top / travel);
      live.current = p < 0.04 && rect.bottom > 0;
      const s = el.style;
      s.setProperty('--zoom', (1 + 1.5 * ease(span(p, 0, 0.9))).toFixed(4));
      s.setProperty('--dusk', ease(span(p, 0.3, 0.86)).toFixed(4));
      const out = ease(span(p, 0.02, 0.3));
      s.setProperty('--copy', (1 - out).toFixed(4));
      s.setProperty('--lift', (out * -14).toFixed(3) + 'vh');
      el.dataset.gone = String(out > 0.92);
      const up = ease(span(p, 0.1, 0.8));
      s.setProperty('--rise', ((1 - up) * 78).toFixed(3) + 'vh');
      s.setProperty('--grow', (0.58 + 0.42 * up).toFixed(4));
      s.setProperty('--seen', span(p, 0.78, 0.94).toFixed(4));
    };
    const on = () => { if (!frame) frame = requestAnimationFrame(set); };
    set();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', on); window.removeEventListener('resize', on); };
  }, []);
  return (
    <section className="cs-descent" ref={section} aria-label="Clem">
      <div className="cs-stage">
        <canvas ref={canvas} className="cs-sky" aria-hidden="true" />
        <div className="cs-dusk" aria-hidden="true" />
        <div className="cs-hero">{copy}</div>
        <div className="cs-arrival">{arrival}</div>
      </div>
    </section>
  );
}
