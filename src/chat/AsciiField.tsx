import { useEffect, useRef } from 'react';
import './ascii-field.css';

/** The new-chat screen's backdrop: an ASCII mountain range under a sky that keeps the same hours as the greeting.
 *  A coral sun rises on the left in the morning, stands high in the afternoon and sets behind the peaks in the
 *  evening, its rays slowly turning; late at night a moon crosses the stars and a shooting star falls now and then.
 *  Clouds glide past, mist rolls through the valleys, a flock beats across by day, and light sweeps the slopes.
 *  Kept light on purpose: a coarse grid, glyphs stamped from a small pre-drawn atlas instead of laid out as text,
 *  15 frames a second (6 with the window in the background) and nothing at all while it is off screen, hidden or in
 *  quiet mode, where it is drawn once and left still. */
const CHARS = " .,:'`-~=+*^/\\_o@v()";
const CELL_W = 11, CELL_H = 18;
// The range's skyline, drawn by hand as a real one rises and falls: x across the width, y as a fraction of the
// height. A tall peak right of centre, a shoulder to its left, foothills at the edges; the tops stay below the composer.
const RIDGE: [number, number][] = [[0, 0.9], [0.05, 0.86], [0.09, 0.88], [0.16, 0.78], [0.2, 0.8], [0.25, 0.72], [0.3, 0.79], [0.34, 0.77], [0.4, 0.86], [0.46, 0.83], [0.52, 0.88], [0.58, 0.79], [0.62, 0.81], [0.68, 0.7], [0.73, 0.77], [0.77, 0.75], [0.83, 0.84], [0.9, 0.8], [0.95, 0.85], [1, 0.83]];
const quiet = () => document.documentElement.dataset.quiet === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), u = smooth(0, 1, x - xi), v = smooth(0, 1, y - yi);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** The front ridge's height and slope at x (0–1); slope < 0 climbs to the right. */
function ridge(x: number) {
  let k = 1;
  while (k < RIDGE.length - 1 && RIDGE[k][0] < x) k++;
  const [x0, y0] = RIDGE[k - 1], [x1, y1] = RIDGE[k], slope = (y1 - y0) / (x1 - x0);
  return { y: y0 + slope * (x - x0), slope };
}
/** Where the sun (by day) or the moon (by night) is: x and height as fractions of the screen, and how much daylight. */
export function skyAt(date: Date) {
  const h = date.getHours() + date.getMinutes() / 60;
  const day = h >= 6 && h < 20, p = day ? (h - 6) / 14 : ((h + 24 - 20) % 24) / 10;
  const arc = Math.sin(Math.PI * Math.max(0, Math.min(1, p)));
  const light = day ? smooth(0, 0.25, arc) : 0;
  return { day, x: 0.04 + 0.92 * p, y: 0.7 - 0.52 * arc, light, low: day && arc < 0.45 };
}

type Cloud = { x: number; y: number; speed: number; width: number; cells: [number, number, string, number][] };
/** A cloud as a puff of characters: denser and brighter in the middle, ragged at the edges. */
function makeCloud(n: number, w: number): Cloud {
  const width = 9 + Math.floor(hash(n, 7) * 16), height = 2 + Math.floor(hash(n, 8) * 3), y = 0.06 + hash(n, 9) * 0.42;
  const cells: Cloud['cells'] = [];
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
    const ex = (dx - (width - 1) / 2) / (width / 2), ey = (dy - (height - 1) / 2) / (height / 2 + 0.4), r = ex * ex + ey * ey;
    const fill = (1 - r) + (noise(dx * 0.45 + n * 10, dy * 0.8) - 0.5) * 0.7;
    if (fill > 0.15) cells.push([dx, dy, fill > 0.6 ? '~' : fill > 0.35 ? '-' : '.', 0.08 + 0.2 * Math.min(1, fill)]);
  }
  return { x: hash(n, 6) * w, y, speed: 42 - y * 40 + hash(n, 5) * 10, width, cells };
}

export function AsciiField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!, ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0, h = 0, cols = 0, rows = 0, dpr = 1, front = new Float32Array(0), slope = new Float32Array(0), back = new Float32Array(0), seed = new Float32Array(0);
    let atlas: HTMLCanvasElement | null = null, glyphW = 0, glyphH = 0;
    let raf = 0, last = 0, visible = true, focused = document.hasFocus(), clouds: Cloud[] = [];
    const start = performance.now();

    // Every character drawn once in the theme's ink (row 0) and in Mowr's coral (row 1); frames only copy them.
    const buildAtlas = () => {
      const style = getComputedStyle(canvas), coral = document.documentElement.dataset.theme === 'light' ? '#c8432f' : '#ef5340';
      glyphW = Math.ceil(CELL_W * dpr); glyphH = Math.ceil(CELL_H * dpr);
      atlas = document.createElement('canvas'); atlas.width = glyphW * CHARS.length; atlas.height = glyphH * 2;
      const a = atlas.getContext('2d')!;
      a.font = `${Math.round(13 * dpr)}px ui-monospace, 'Cascadia Mono', Consolas, monospace`; a.textAlign = 'center'; a.textBaseline = 'middle';
      [style.color, coral].forEach((fill, row) => { a.fillStyle = fill; for (let k = 1; k < CHARS.length; k++) a.fillText(CHARS[k], glyphW * (k + 0.5), glyphH * (row + 0.5)); });
    };
    const stamp = (c: string, x: number, y: number, alpha: number, accent = false) => {
      if (alpha < 0.02) return;
      ctx.globalAlpha = Math.min(0.85, alpha);
      ctx.drawImage(atlas!, CHARS.indexOf(c) * glyphW, accent ? glyphH : 0, glyphW, glyphH, Math.round(x * dpr), Math.round(y * dpr), glyphW, glyphH);
    };

    const draw = (now: number) => {
      if (!atlas || !cols) return;
      const t = (now - start) / 1000, sky = skyAt(new Date());
      const sunX = sky.x * w, sunY = sky.y * h, R = Math.max(34, Math.min(58, w * 0.035));
      const dark = 1 - sky.light, stars = sky.day ? (sky.low ? 0.006 : 0) : 0.03;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let j = 0; j < rows; j++) {
        const fy = (j + 0.5) / rows, y = j * CELL_H;
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i, fx = (i + 0.5) / cols, x = i * CELL_W, top = front[i];
          if (fy >= top) {
            // The front range. Its outline: / climbing, \ falling, ^ on the tops.
            const depth = (fy - top) * rows, s = slope[i];
            if (depth < 2) {
              const peak = i > 0 && i < cols - 1 && front[i - 1] > top && front[i + 1] > top;
              stamp(peak && depth < 1 ? '^' : s < 0 ? '/' : '\\', x, y, (depth < 1 ? 0.6 : 0.28) * (0.75 + 0.25 * sky.light));
              continue;
            }
            // The slope that faces the sun (or moon) is lit: denser, brighter stippling that fades with depth.
            const faces = s < 0 ? sky.x < fx : sky.x > fx, lit = faces ? 1 : 0.4, fade = 1 - smooth(0, 9, depth) * 0.75;
            const hatch = (s < 0 ? i + j : i - j + 999) % (faces ? 3 : 6) === 0;
            if (!hatch && seed[k] > 0.12) continue;
            // A sheen of light sweeps slowly across the slopes.
            const shimmer = 0.75 + 0.5 * smooth(0.7, 1, Math.sin(x * 0.006 - t * 0.35 + j * 0.02));
            stamp(hatch && faces ? ':' : '.', x, y, (0.05 + 0.11 * lit * (0.45 + 0.55 * sky.light)) * fade * shimmer);
            continue;
          }
          if (fy >= back[i]) {
            // A farther range behind, faint, for depth.
            if ((fy - back[i]) * rows < 1) stamp('.', x, y, 0.14);
            else if (seed[k] < 0.08) stamp('.', x, y, 0.05);
            continue;
          }
          // The sky. The sun or moon sits behind everything else here and sets behind the ranges.
          const d = Math.hypot(x + CELL_W / 2 - sunX, y + CELL_H / 2 - sunY);
          if (d < R) {
            if (sky.day) stamp(d < R * 0.55 ? '@' : 'o', x, y, 0.6, true);
            // A crescent: the disc less a second disc offset towards the top right.
            else if (Math.hypot(x + CELL_W / 2 - sunX - R * 0.45, y + CELL_H / 2 - sunY + R * 0.25) > R * 0.82) stamp(d < R * 0.6 ? 'o' : '(', x, y, 0.5);
            continue;
          }
          if (d < R * 1.6) {
            const glow = (1 - (d - R) / (R * 0.6)) * (0.85 + 0.15 * Math.sin(t * 0.9 - d * 0.05));
            if (seed[k] < 0.25 + glow * 0.6) { stamp(glow > 0.55 ? ':' : '.', x, y, (sky.day ? 0.32 : 0.16) * glow, sky.day); continue; }
          }
          // Mist rolls along the valleys, in bands that keep moving.
          const above = (top - fy) * rows;
          if (above < 3.5 && top > 0.79) {
            const band = Math.sin(x * 0.02 - t * 1.8 + j * 1.3) + 0.5 * Math.sin(x * 0.047 + t * 1.1);
            if (band > 0.7) { stamp(band > 1.15 ? '~' : '-', x, y, (0.1 + 0.12 * (band - 0.7)) * (1 - above / 3.5)); continue; }
          }
          if (stars && seed[k] < stars) {
            const twinkle = 0.5 + 0.5 * Math.sin(t * (0.8 + seed[k] * 60) + seed[k] * 900);
            stamp(seed[k] < stars * 0.15 ? '*' : seed[k] < stars * 0.4 ? '+' : '.', x, y, (0.12 + 0.3 * twinkle) * dark);
          }
        }
      }
      // Everything below moves smoothly, pixel by pixel rather than cell by cell.
      // Rays turn slowly round the sun; the moon only glows.
      if (sky.day) for (let n = 0; n < 14; n++) {
        const a = n * Math.PI * 2 / 14 + t * 0.22;
        for (const [f, c, al] of [[1.3, ':', 0.6], [1.7, ':', 0.42], [2.1, '.', 0.3], [2.5, '.', 0.16]] as const) {
          const rx = sunX + Math.cos(a) * R * f, ry = sunY + Math.sin(a) * R * f, col = Math.floor(rx / CELL_W);
          if (col >= 0 && col < cols && ry / h < front[col] - 0.01) stamp(c, rx - CELL_W / 2, ry - CELL_H / 2, al * (0.75 + 0.25 * Math.sin(t * 2 + n)), true);
        }
      }
      // Clouds glide across at their own speeds, slower the higher they are; thinner at night.
      for (const c of clouds) {
        const span = w + c.width * CELL_W, cx = ((c.x + t * c.speed) % span + span) % span - c.width * CELL_W, cy = c.y * h;
        for (const [dx, dy, ch, al] of c.cells) stamp(ch, cx + dx * CELL_W, cy + dy * CELL_H, al * (sky.day ? 1 : 0.55));
      }
      // By day a small flock crosses every so often, wings beating.
      if (sky.day) {
        const run = (t * 0.045) % 1.8 - 0.4, by = h * (0.2 + 0.04 * Math.sin(t * 0.3));
        [[0, 0], [-0.022, 0.016], [-0.022, -0.016], [-0.044, 0.03], [-0.044, -0.028]].forEach(([dx, dy], n) => {
          const flap = Math.sin(t * 9 + n * 1.7) > 0;
          stamp(flap ? 'v' : '-', (run + dx) * w, by + dy * h + Math.sin(t * 1.4 + n) * 3, 0.38);
        });
      }
      // At night a shooting star now and then.
      if (!sky.day) {
        const cycle = Math.floor(t / 6.5), age = t - cycle * 6.5;
        if (age < 1.1) {
          const sx = (0.15 + hash(cycle, 1) * 0.75) * w, sy = (0.05 + hash(cycle, 2) * 0.3) * h, vx = -520, vy = 230;
          for (let k = 0; k < 8; k++) {
            const back = k * 0.018, a = (1 - k / 8) * (1 - age / 1.1);
            stamp(k ? '-' : '*', sx + vx * (age - back), sy + vy * (age - back), 0.65 * a);
          }
        }
      }
      ctx.globalAlpha = 1;
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      if (!w || !h) return;
      dpr = Math.min(devicePixelRatio || 1, 1.25);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      cols = Math.ceil(w / CELL_W); rows = Math.ceil(h / CELL_H);
      front = new Float32Array(cols); slope = new Float32Array(cols); back = new Float32Array(cols); seed = new Float32Array(cols * rows);
      clouds = Array.from({ length: Math.max(4, Math.round(w / 260)) }, (_, n) => makeCloud(n, w));
      for (let i = 0; i < cols; i++) {
        const fx = (i + 0.5) / cols, r = ridge(fx);
        front[i] = r.y; slope[i] = r.slope;
        back[i] = Math.min(r.y, 0.76 + 0.045 * Math.sin(fx * 9 + 1) + 0.025 * Math.sin(fx * 23 + 2));
      }
      for (let k = 0; k < seed.length; k++) seed[k] = hash(k % cols, Math.floor(k / cols));
      buildAtlas(); draw(performance.now());
    };

    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      if (now - last >= 1000 / (focused ? 15 : 6) - 2) { last = now; draw(now); }
      raf = requestAnimationFrame(frame);
    };
    const wake = () => { if (!raf && visible && !document.hidden && !quiet()) raf = requestAnimationFrame(frame); };
    const focus = () => { focused = document.hasFocus(); wake(); };
    const retheme = () => { buildAtlas(); draw(performance.now()); };

    const observer = new ResizeObserver(resize); observer.observe(canvas);
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; wake(); }); io.observe(canvas);
    window.addEventListener('focus', focus); window.addEventListener('blur', focus);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('mowr-theme', retheme);
    wake();
    return () => {
      cancelAnimationFrame(raf); observer.disconnect(); io.disconnect();
      window.removeEventListener('focus', focus); window.removeEventListener('blur', focus);
      document.removeEventListener('visibilitychange', wake); window.removeEventListener('mowr-theme', retheme);
    };
  }, []);
  return <canvas ref={ref} className="ascii-field" aria-hidden="true" />;
}
