import { arrow, C, fmt, H, niceStep, SvgPen, W, type Ink, type P, type Pen } from './pen';

/** Deterministic, closed-form (or tightly integrated) models. No scene is drawn from guesses. */
export type Values = Record<string, number>;
export type Param = { key: string; label: string; min: number; max: number; step: number; unit: string; value: number; hidden?: boolean; parse?: RegExp };
export type Handle = { id: string; x: number; y: number };
export type SceneDef = {
  id: string; title: string; subject: string; summary: string; keywords: RegExp; params: Param[];
  equation: string; assumption: string;
  /** Loop length in seconds; Infinity plays continuously. */
  period(p: Values): number;
  /** A representative moment for thumbnails and reduced motion. */
  still(p: Values): number;
  draw(pen: Pen, p: Values, t: number): void;
  readouts(p: Values, t: number): [string, string][];
  describe(p: Values): string;
  handles?(p: Values): Handle[];
  drag?(id: string, x: number, y: number, p: Values): Values;
};

const TAU = Math.PI * 2, rad = (d: number) => d * Math.PI / 180, clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const mod = (v: number, m: number) => ((v % m) + m) % m;
const G = { key: 'g', label: 'Gravity', min: 1.6, max: 24.8, step: 0.01, unit: 'm/s²', value: 9.81 };
const memo = <T,>(fn: (p: Values) => T) => { let key = '', value: T; return (p: Values) => { const k = JSON.stringify(p); if (k !== key) { key = k; value = fn(p); } return value!; }; };
const glow = (pen: Pen, x: number, y: number, r: number, color: string) => { pen.circle(x, y, r * 2.3, { fill: color, alpha: 0.13 }); pen.circle(x, y, r, { fill: color }); };
function hatch(pen: Pen, x0: number, x1: number, y: number, vertical = false) {
  if (vertical) { pen.path([[x0, x1], [x0, y]], { stroke: C.axis, width: 2 }); for (let v = x1; v < y; v += 12) pen.path([[x0, v + 10], [x0 - 9, v + 1]], { stroke: C.axis, width: 1 }); return; }
  pen.path([[x0, y], [x1, y]], { stroke: C.axis, width: 2 });
  for (let v = x0; v < x1; v += 12) pen.path([[v, y], [v + 9, y - 9]], { stroke: C.axis, width: 1 });
}

/* ───────────── Projectile motion ───────────── */
const proj = (p: Values) => { const th = rad(p.angle), vx = p.speed * Math.cos(th), vy = p.speed * Math.sin(th), T = 2 * vy / p.g; return { th, vx, vy, T, R: vx * T, H: vy * vy / (2 * p.g) }; };
const projectile: SceneDef = {
  id: 'projectile', title: 'Projectile motion', subject: 'Mechanics', summary: 'Launch a body and follow its path under constant gravity.',
  keywords: /projectile|trajector|launch|throw|thrown|cannon|parabol|kick|ballistic/i,
  params: [
    { key: 'angle', label: 'Launch angle', min: 10, max: 80, step: 1, unit: '°', value: 45, parse: /(\d+(?:\.\d+)?)\s*(?:°|deg)/i },
    { key: 'speed', label: 'Initial speed', min: 5, max: 40, step: 1, unit: 'm/s', value: 18, parse: /(\d+(?:\.\d+)?)\s*m\/s(?![²2])/i },
    G,
  ],
  equation: 'y = x·tan θ − g·x² / (2v₀²·cos²θ)', assumption: 'Ground-level launch, uniform gravity, no air resistance.',
  period: p => proj(p).T + 1.4, still: p => proj(p).T * 0.36,
  draw(pen, p, t) {
    const k = proj(p), b = { x0: 70, y0: 40, x1: 770, y1: 390 };
    const s = Math.min((b.x1 - b.x0) / (k.R * 1.08), (b.y1 - b.y0) / (k.H * 1.4));
    const X = (x: number) => b.x0 + x * s, Y = (y: number) => b.y1 - y * s, step = niceStep((b.x1 - b.x0) / s, 8), d = step < 1 ? 1 : 0;
    for (let x = 0; X(x) <= b.x1 + 0.5; x += step) { pen.path([[X(x), b.y0], [X(x), b.y1]], { stroke: C.grid, width: 1 }); pen.text(X(x), b.y1 + 18, fmt(x, d), { size: 10.5, color: C.faint, align: 'middle' }); }
    for (let y = step; Y(y) >= b.y0 - 0.5; y += step) { pen.path([[b.x0, Y(y)], [b.x1, Y(y)]], { stroke: C.grid, width: 1 }); pen.text(b.x0 - 9, Y(y) + 4, fmt(y, d), { size: 10.5, color: C.faint, align: 'end' }); }
    pen.path([[b.x0, b.y1], [b.x1, b.y1]], { stroke: C.axis, width: 1.5 });
    pen.text(b.x1, b.y1 + 38, 'Horizontal distance (m)', { size: 11, color: C.faint, align: 'end' });
    pen.text(b.x0 - 9, b.y0 - 16, 'Height (m)', { size: 11, color: C.faint });
    const at = (tt: number): P => [X(k.vx * tt), Y(k.vy * tt - 0.5 * p.g * tt * tt)];
    pen.path(Array.from({ length: 121 }, (_, i) => at(k.T * i / 120)), { stroke: C.faint, width: 1.3, dash: [4, 6] });
    const tt = clamp(t, 0, k.T);
    pen.path(Array.from({ length: 101 }, (_, i) => at(tt * i / 100)), { stroke: C.ink, width: 2.4 });
    pen.path(Array.from({ length: 25 }, (_, i) => { const a = k.th * i / 24; return [X(0) + 38 * Math.cos(a), Y(0) - 38 * Math.sin(a)] as P; }), { stroke: C.soft, width: 1.2 });
    pen.text(X(0) + 48 * Math.cos(k.th / 2) + 3, Y(0) - 48 * Math.sin(k.th / 2) + 4, `θ ${p.angle}°`, { size: 11.5, color: C.soft });
    const ax = X(k.R / 2), ay = Y(k.H);
    pen.path([[ax, ay], [ax, b.y1]], { stroke: C.faint, width: 1, dash: [3, 5] });
    pen.circle(ax, ay, 3.5, { fill: C.ink });
    pen.text(ax, ay - 13, `Apex · ${fmt(k.H)} m`, { size: 12, color: C.ink, align: 'middle' });
    pen.circle(X(k.R), b.y1, 3.5, { fill: C.ink });
    pen.text(X(k.R) - 8, b.y1 - 10, `Range ${fmt(k.R)} m`, { size: 12, color: C.ink, align: 'end' });
    const [bx, by] = at(tt), vyNow = k.vy - p.g * tt, vs = 92 / p.speed;
    if (t <= k.T) {
      arrow(pen, bx, by, bx + k.vx * vs, by, { stroke: C.blue, width: 1.4, dash: [4, 4], alpha: 0.55 });
      arrow(pen, bx, by, bx, by - vyNow * vs, { stroke: C.blue, width: 1.4, dash: [4, 4], alpha: 0.55 });
      arrow(pen, bx, by, bx + k.vx * vs, by - vyNow * vs, { stroke: C.blue, width: 2.2 });
      pen.text(bx + k.vx * vs + 8, by - vyNow * vs, 'v', { size: 13, color: C.blue, serif: true });
    }
    glow(pen, bx, by, 6.5, C.coral);
  },
  readouts(p, t) { const k = proj(p), tt = clamp(t, 0, k.T), vy = k.vy - p.g * tt; return [['Time', `${fmt(tt)} s`], ['Height', `${fmt(Math.max(0, k.vy * tt - 0.5 * p.g * tt * tt))} m`], ['Speed', `${fmt(Math.hypot(k.vx, vy))} m/s`], ['Range', `${fmt(k.R)} m`], ['Max height', `${fmt(k.H)} m`], ['Flight time', `${fmt(k.T)} s`]]; },
  describe(p) { const k = proj(p); return `Projectile launched at ${p.angle}° and ${p.speed} m/s with gravity ${p.g} m/s²: range ${fmt(k.R)} m, maximum height ${fmt(k.H)} m, flight time ${fmt(k.T)} s.`; },
};

/* ───────────── Pendulum ───────────── */
function agm(a: number, b: number) { for (let i = 0; i < 24; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)]; return a; }
const pend = memo(p => {
  const th0 = rad(p.amp), w0 = Math.sqrt(p.g / p.L), k = Math.sin(th0 / 2);
  const T = 4 * (Math.PI / (2 * agm(1, Math.sqrt(1 - k * k)))) / w0, N = 600, dt = T / N, table = new Float64Array(N + 1);
  let th = th0, om = 0; table[0] = th;
  const f = (a: number) => -w0 * w0 * Math.sin(a);
  for (let i = 0; i < N; i++) {
    const k1 = om, l1 = f(th), k2 = om + l1 * dt / 2, l2 = f(th + k1 * dt / 2), k3 = om + l2 * dt / 2, l3 = f(th + k2 * dt / 2), k4 = om + l3 * dt, l4 = f(th + k3 * dt);
    th += dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4); om += dt / 6 * (l1 + 2 * l2 + 2 * l3 + l4); table[i + 1] = th;
  }
  const angle = (t: number) => { const u = mod(t, T) / T * N, i = Math.floor(u); return table[i] + (table[Math.min(N, i + 1)] - table[i]) * (u - i); };
  return { th0, w0, T, T0: TAU / w0, angle };
});
const pendulum: SceneDef = {
  id: 'pendulum', title: 'Simple pendulum', subject: 'Oscillations', summary: 'Compare the exact swing with the small-angle approximation.',
  keywords: /pendul|swing|bob\b/i,
  params: [
    { key: 'L', label: 'Length', min: 0.2, max: 3, step: 0.05, unit: 'm', value: 1, parse: /(\d+(?:\.\d+)?)\s*m\b(?!\/)/i },
    { key: 'amp', label: 'Release angle', min: 5, max: 85, step: 1, unit: '°', value: 50, parse: /(\d+(?:\.\d+)?)\s*(?:°|deg)/i },
    G,
  ],
  equation: 'T = 4√(L/g)·K(sin θ₀/2)  vs  T ≈ 2π√(L/g)', assumption: 'Rigid massless rod, point mass, no friction. Exact period by elliptic integral; motion by RK4.',
  period: p => pend(p).T * 2, still: p => pend(p).T * 0.12,
  draw(pen, p, t) {
    const m = pend(p), px = 196, py = 62, Lpx = 70 + p.L / 3 * 260, th = m.angle(t);
    hatch(pen, px - 70, px + 70, py);
    pen.path([[px, py], [px, py + Lpx + 26]], { stroke: C.faint, width: 1, dash: [3, 5] });
    pen.path(Array.from({ length: 41 }, (_, i) => { const a = -m.th0 + 2 * m.th0 * i / 40; return [px + Lpx * Math.sin(a), py + Lpx * Math.cos(a)] as P; }), { stroke: C.faint, width: 1, dash: [3, 5] });
    for (const a of [-m.th0, m.th0]) pen.circle(px + Lpx * Math.sin(a), py + Lpx * Math.cos(a), 12, { stroke: C.faint, width: 1, alpha: 0.6 });
    const bx = px + Lpx * Math.sin(th), by = py + Lpx * Math.cos(th);
    pen.path(Array.from({ length: 13 }, (_, i) => { const a = th * i / 12; return [px + 44 * Math.sin(a), py + 44 * Math.cos(a)] as P; }), { stroke: C.soft, width: 1.2 });
    pen.text(px + (th < 0 ? -12 : 12), py + 64, `${fmt(th * 180 / Math.PI, 0)}°`, { size: 11.5, color: C.soft, align: th < 0 ? 'end' : 'start' });
    pen.path([[px, py], [bx, by]], { stroke: C.ink, width: 2.2 });
    pen.circle(px, py, 4, { fill: C.ink });
    glow(pen, bx, by, 13, C.coral);
    const b = { x0: 420, x1: 776, y0: 80, y1: 360 }, span = m.T * 2, amp = p.amp * 1.2;
    const X = (tt: number) => b.x0 + tt / span * (b.x1 - b.x0), Y = (deg: number) => (b.y0 + b.y1) / 2 - deg / amp * (b.y1 - b.y0) / 2;
    pen.path([[b.x0, Y(0)], [b.x1, Y(0)]], { stroke: C.axis, width: 1 });
    pen.path([[b.x0, b.y0], [b.x0, b.y1]], { stroke: C.axis, width: 1 });
    for (const d of [p.amp, -p.amp]) { pen.path([[b.x0, Y(d)], [b.x1, Y(d)]], { stroke: C.grid, width: 1 }); pen.text(b.x0 - 8, Y(d) + 4, `${d > 0 ? '+' : '−'}${p.amp}°`, { size: 10.5, color: C.faint, align: 'end' }); }
    for (const [v, l] of [[m.T, 'T'], [m.T * 2, '2T']] as const) { pen.path([[X(v), Y(0) - 4], [X(v), Y(0) + 4]], { stroke: C.axis, width: 1 }); pen.text(X(v), b.y1 + 18, l, { size: 11, color: C.faint, align: 'middle' }); }
    pen.path(Array.from({ length: 241 }, (_, i) => { const tt = span * i / 240; return [X(tt), Y(p.amp * Math.cos(m.w0 * tt))] as P; }), { stroke: C.blue, width: 1.5, dash: [5, 5], alpha: 0.85 });
    pen.path(Array.from({ length: 241 }, (_, i) => { const tt = span * i / 240; return [X(tt), Y(m.angle(tt) * 180 / Math.PI)] as P; }), { stroke: C.ink, width: 2 });
    const now = mod(t, span);
    pen.path([[X(now), b.y0], [X(now), b.y1]], { stroke: C.faint, width: 1, alpha: 0.6 });
    glow(pen, X(now), Y(th * 180 / Math.PI), 4.5, C.coral);
    pen.text(b.x0, b.y0 - 34, '— exact (numerical)', { size: 11, color: C.ink });
    pen.text(b.x0 + 140, b.y0 - 34, '- - small-angle approximation', { size: 11, color: C.blue });
    pen.text(b.x0, b.y0 - 14, 'Angle over time', { size: 11, color: C.faint });
  },
  readouts(p, t) { const m = pend(p), th = m.angle(t), h = 1e-4, w = (m.angle(t + h) - m.angle(t - h)) / (2 * h); return [['Period (exact)', `${fmt(m.T, 3)} s`], ['Small-angle estimate', `${fmt(m.T0, 3)} s`], ['Difference', `${fmt((m.T / m.T0 - 1) * 100, 1)} %`], ['Angle', `${fmt(th * 180 / Math.PI, 1)}°`], ['Bob speed', `${fmt(Math.abs(w) * p.L)} m/s`]]; },
  describe(p) { const m = pend(p); return `Pendulum ${p.L} m long released at ${p.amp}°: exact period ${fmt(m.T, 3)} s against the small-angle estimate ${fmt(m.T0, 3)} s.`; },
};

/* ───────────── Superposition of waves ───────────── */
const waves: SceneDef = {
  id: 'waves', title: 'Wave superposition', subject: 'Waves', summary: 'Add two travelling waves and watch interference and beats appear.',
  keywords: /wave|interfer|superpos|beats?\b|frequenc|sound|standing/i,
  params: [
    { key: 'f1', label: 'Frequency A', min: 0.5, max: 3, step: 0.05, unit: 'Hz', value: 1 },
    { key: 'f2', label: 'Frequency B', min: 0.5, max: 3, step: 0.05, unit: 'Hz', value: 1.2 },
    { key: 'a2', label: 'Amplitude B', min: 0, max: 1, step: 0.05, unit: '× A', value: 1 },
    { key: 'phase', label: 'Phase offset', min: 0, max: 360, step: 5, unit: '°', value: 0 },
  ],
  equation: 'y = sin 2πf₁(x/v − t) + A₂·sin(2πf₂(x/v − t) + φ)', assumption: 'Linear medium, wave speed 1 m/s, both waves travel to the right.',
  period: () => Infinity, still: () => 0.8,
  draw(pen, p, t) {
    const x0 = 120, x1 = 780, span = 4, phi = rad(p.phase), N = 360;
    const rows: [string, string, number, number, (x: number) => number][] = [
      ['Wave A', C.blue, 82, 34, x => Math.sin(TAU * p.f1 * (x - t))],
      ['Wave B', C.coral, 188, 34, x => p.a2 * Math.sin(TAU * p.f2 * (x - t) + phi)],
      ['A + B', C.ink, 330, 34, x => Math.sin(TAU * p.f1 * (x - t)) + p.a2 * Math.sin(TAU * p.f2 * (x - t) + phi)],
    ];
    const X = (x: number) => x0 + x / span * (x1 - x0);
    for (const [label, color, cy, amp, f] of rows) {
      pen.path([[x0, cy], [x1, cy]], { stroke: C.axis, width: 1 });
      pen.text(24, cy - 4, label, { size: 13, color, serif: true });
      if (label === 'A + B') {
        const env = (x: number) => Math.sqrt(1 + p.a2 * p.a2 + 2 * p.a2 * Math.cos(TAU * (p.f2 - p.f1) * (x - t) + phi));
        for (const sgn of [1, -1]) pen.path(Array.from({ length: N + 1 }, (_, i) => { const x = span * i / N; return [X(x), cy - sgn * env(x) * amp] as P; }), { stroke: C.faint, width: 1.1, dash: [4, 5] });
        pen.text(24, cy + 14, 'envelope dashed', { size: 10.5, color: C.faint });
      }
      pen.path(Array.from({ length: N + 1 }, (_, i) => { const x = span * i / N; return [X(x), cy - f(x) * amp] as P; }), { stroke: color, width: 2 });
    }
    for (let x = 0; x <= span; x++) pen.text(X(x), 424, `${x} m`, { size: 10.5, color: C.faint, align: 'middle' });
  },
  readouts(p) { return [['Beat frequency', `${fmt(Math.abs(p.f1 - p.f2))} Hz`], ['Wavelength A', `${fmt(1 / p.f1)} m`], ['Wavelength B', `${fmt(1 / p.f2)} m`], ['Peak amplitude', `${fmt(1 + p.a2)} × A`], ['Phase offset', `${p.phase}°`]]; },
  describe(p) { return `Two waves at ${p.f1} Hz and ${p.f2} Hz with phase offset ${p.phase}° add to a wave whose beat frequency is ${fmt(Math.abs(p.f1 - p.f2))} Hz.`; },
};

/* ───────────── Thin lens ───────────── */
const LX = 430, AY = 250, S = 6;
const lensImage = (p: Values) => { const v = Math.abs(p.u - p.f) < 0.05 ? Infinity : p.u * p.f / (p.u - p.f); return { v, m: Number.isFinite(v) ? -v / p.u : Infinity }; };
const lens: SceneDef = {
  id: 'lens', title: 'Converging lens', subject: 'Optics', summary: 'Trace principal rays and find where the image forms. Drag the object.',
  keywords: /lens|optic|refract|ray diagram|focal|magnif|convex|camera|eye\b/i,
  params: [
    { key: 'f', label: 'Focal length', min: 5, max: 25, step: 0.5, unit: 'cm', value: 12, parse: /f\s*=\s*(\d+(?:\.\d+)?)/i },
    { key: 'u', label: 'Object distance', min: 4, max: 62, step: 0.5, unit: 'cm', value: 30, parse: /u\s*=\s*(\d+(?:\.\d+)?)/i },
    { key: 'h', label: 'Object height', min: 1, max: 7, step: 0.5, unit: 'cm', value: 4 },
  ],
  equation: '1/f = 1/u + 1/v   ·   m = −v/u', assumption: 'Thin lens, paraxial rays, real-is-positive sign convention.',
  period: () => 2.6, still: () => 1.1,
  handles: p => [{ id: 'object', x: LX - p.u * S, y: AY - p.h * S }],
  drag: (_id, x, y) => ({ u: Math.round(clamp((LX - x) / S, 4, 62) * 2) / 2, h: Math.round(clamp((AY - y) / S, 1, 7) * 2) / 2 }),
  draw(pen, p, t) {
    const { v, m } = lensImage(p), fs = p.f * S, xo = LX - p.u * S, yo = AY - p.h * S;
    pen.path([[0, AY], [W, AY]], { stroke: C.axis, width: 1 });
    const half = 150, bulge = 13, left: P[] = [], right: P[] = [];
    for (let i = 0; i <= 30; i++) { const y = -half + 2 * half * i / 30, dx = bulge * (1 - (y / half) ** 2); left.push([LX - dx, AY + y]); right.push([LX + dx, AY + y]); }
    pen.path([...left, ...right.reverse()], { fill: C.blue, alpha: 0.13 }, true);
    pen.path([...left], { stroke: C.blue, width: 1.4, alpha: 0.8 }); pen.path(right, { stroke: C.blue, width: 1.4, alpha: 0.8 });
    for (const [x, l] of [[LX - fs, 'F'], [LX + fs, 'F′'], [LX - 2 * fs, '2F'], [LX + 2 * fs, '2F′']] as const) if (x > 10 && x < W - 10) { pen.circle(x, AY, 3, { fill: C.soft }); pen.text(x, AY + 20, l, { size: 12, color: C.soft, align: 'middle', serif: true }); }
    const rays: { color: string; pts: P[]; back?: P }[] = [];
    const extend = (a: P, dx: number, dy: number): P => { const k = (W + 40 - a[0]) / (dx || 1e-9); return dx <= 0 ? a : [a[0] + dx * k, a[1] + dy * k]; };
    rays.push({ color: C.ink, pts: [[xo, yo], [LX, yo], extend([LX, yo], fs, AY - yo)], back: [LX, yo] });
    rays.push({ color: C.blue, pts: [[xo, yo], [LX, AY], extend([LX, AY], LX - xo, AY - yo)], back: [LX, AY] });
    const xF = LX - fs;
    if (Math.abs(xo - xF) > 1) { const yl = AY + (yo - AY) * (LX - xF) / (xo - xF); if (Math.abs(yl - AY) < half - 4) rays.push({ color: C.soft, pts: [[xo, yo], [LX, yl], [W + 40, yl]], back: [LX, yl] }); }
    const xi = LX + v * S, yi = AY - m * p.h * S, finite = Number.isFinite(v) && Math.abs(xi) < 4000;
    rays.forEach((r, i) => {
      pen.path(r.pts, { stroke: r.color, width: 1.5, alpha: 0.85 });
      if (finite && v < 0 && r.back) pen.path([r.back, [xi, yi]], { stroke: r.color, width: 1.1, dash: [4, 5], alpha: 0.55 });
      const lens = r.pts.map((q, j) => j ? Math.hypot(q[0] - r.pts[j - 1][0], q[1] - r.pts[j - 1][1]) : 0), total = Math.min(lens.reduce((a, b) => a + b), 900);
      for (let k = 0; k < 2; k++) {
        let d = mod(t / 2.6 + i * 0.17 + k * 0.5, 1) * total, j = 1;
        while (j < r.pts.length - 1 && d > lens[j]) d -= lens[j++];
        const a = r.pts[j - 1], b = r.pts[j], u = Math.min(1, d / (lens[j] || 1));
        glow(pen, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, 2.6, r.color);
      }
    });
    arrow(pen, xo, AY, xo, yo, { stroke: C.ink, width: 2.6 }, 11);
    pen.circle(xo, yo, 9, { stroke: C.ink, width: 1, alpha: 0.4 });
    pen.text(xo, AY + 38, 'Object', { size: 11.5, color: C.ink, align: 'middle' });
    if (finite) {
      arrow(pen, xi, AY, xi, yi, { stroke: C.coral, width: 2.6, dash: v < 0 ? [5, 4] : undefined }, 11);
      pen.text(xi, m * p.h > 0 ? yi - 12 : yi + 22, v < 0 ? 'Virtual image' : 'Image', { size: 11.5, color: C.coral, align: 'middle' });
    } else pen.text(W - 20, 40, 'Rays emerge parallel: image at infinity', { size: 12, color: C.coral, align: 'end' });
  },
  readouts(p) {
    const { v, m } = lensImage(p);
    if (!Number.isFinite(v)) return [['Image distance', '∞'], ['Magnification', '∞'], ['Image', 'At infinity'], ['Focal length', `${p.f} cm`]];
    const size = Math.abs(m) > 1.02 ? 'enlarged' : Math.abs(m) < 0.98 ? 'diminished' : 'same size';
    return [['Image distance', `${fmt(v, 1)} cm`], ['Magnification', `${fmt(m)}×`], ['Image', `${v > 0 ? 'Real · inverted' : 'Virtual · upright'} · ${size}`], ['Object distance', `${p.u} cm`], ['Focal length', `${p.f} cm`]];
  },
  describe(p) { const { v, m } = lensImage(p); return Number.isFinite(v) ? `Object ${p.u} cm from a converging lens of focal length ${p.f} cm forms a ${v > 0 ? 'real, inverted' : 'virtual, upright'} image at ${fmt(v, 1)} cm with magnification ${fmt(m)}.` : `Object at the focal point of a ${p.f} cm lens: the image forms at infinity.`; },
};

/* ───────────── Electric field of two charges ───────────── */
const PX_M = 0.0005, K_E = 8.9875e9;
const fieldLines = memo(p => {
  const q = [{ x: p.x1, y: p.y1, q: p.q1 }, { x: p.x2, y: p.y2, q: p.q2 }].filter(c => c.q !== 0);
  const E = (x: number, y: number): P => { let ex = 0, ey = 0; for (const c of q) { const dx = x - c.x, dy = y - c.y, r2 = dx * dx + dy * dy + 1e-6, r3 = r2 * Math.sqrt(r2); ex += c.q * dx / r3; ey += c.q * dy / r3; } return [ex, ey]; };
  const positive = q.some(c => c.q > 0), dir = positive ? 1 : -1, lines: P[][] = [];
  for (const src of q.filter(c => (c.q > 0) === positive)) {
    const n = Math.min(24, 4 * Math.abs(src.q));
    for (let j = 0; j < n; j++) {
      const a = TAU * j / n + 0.13; let x = src.x + 16 * Math.cos(a), y = src.y + 16 * Math.sin(a); const line: P[] = [[x, y]];
      for (let s = 0; s < 800; s++) {
        let [ex, ey] = E(x, y); let len = Math.hypot(ex, ey) || 1; const mx = x + dir * ex / len * 2, my = y + dir * ey / len * 2;
        [ex, ey] = E(mx, my); len = Math.hypot(ex, ey) || 1; x += dir * ex / len * 4; y += dir * ey / len * 4;
        line.push([x, y]);
        if (x < -30 || x > W + 30 || y < -30 || y > H + 30 || q.some(c => c !== src && Math.hypot(x - c.x, y - c.y) < 14)) break;
      }
      lines.push(dir > 0 ? line : line.reverse());
    }
  }
  return { lines, E };
});
const field: SceneDef = {
  id: 'field', title: 'Electric field', subject: 'Electromagnetism', summary: 'Two point charges, their field lines and the force between them. Drag either charge.',
  keywords: /electric|charge|coulomb|field line|electrostat|dipole|static/i,
  params: [
    { key: 'q1', label: 'Charge A', min: -5, max: 5, step: 1, unit: 'μC', value: 3 },
    { key: 'q2', label: 'Charge B', min: -5, max: 5, step: 1, unit: 'μC', value: -3 },
    { key: 'x1', label: '', min: 40, max: 760, step: 1, unit: '', value: 270, hidden: true },
    { key: 'y1', label: '', min: 40, max: 400, step: 1, unit: '', value: 220, hidden: true },
    { key: 'x2', label: '', min: 40, max: 760, step: 1, unit: '', value: 530, hidden: true },
    { key: 'y2', label: '', min: 40, max: 400, step: 1, unit: '', value: 220, hidden: true },
  ],
  equation: 'F = k·q₁q₂ / r²   ·   E = Σ k·qᵢ / rᵢ²', assumption: 'Point charges in vacuum; the canvas spans 40 cm.',
  period: () => Infinity, still: () => 0.4,
  handles: p => [{ id: '1', x: p.x1, y: p.y1 }, { id: '2', x: p.x2, y: p.y2 }],
  drag: (id, x, y, p): Values => { const nx = Math.round(clamp(x, 40, 760)), ny = Math.round(clamp(y, 40, 400)), o = id === '1' ? [p.x2, p.y2] : [p.x1, p.y1]; if (Math.hypot(nx - o[0], ny - o[1]) < 44) return {}; return id === '1' ? { x1: nx, y1: ny } : { x2: nx, y2: ny }; },
  draw(pen, p, t) {
    const { lines } = fieldLines(p);
    for (const line of lines) pen.path(line, { stroke: C.ink, width: 1.1, alpha: 0.42 });
    for (const [i, line] of lines.entries()) for (let k = (Math.floor(t * 55) + i * 9) % 46; k < line.length; k += 46) pen.circle(line[k][0], line[k][1], 1.9, { fill: C.ink, alpha: 0.9 });
    const charges = [{ x: p.x1, y: p.y1, q: p.q1, o: [p.x2, p.y2], other: p.q2 }, { x: p.x2, y: p.y2, q: p.q2, o: [p.x1, p.y1], other: p.q1 }];
    for (const c of charges) {
      const color = c.q > 0 ? C.coral : c.q < 0 ? C.blue : C.faint;
      if (c.q && c.other) { const dx = c.x - c.o[0], dy = c.y - c.o[1], d = Math.hypot(dx, dy), s = Math.sign(c.q * c.other); arrow(pen, c.x + s * dx / d * 22, c.y + s * dy / d * 22, c.x + s * dx / d * 70, c.y + s * dy / d * 70, { stroke: C.ink, width: 2.2 }); }
      pen.circle(c.x, c.y, 34, { fill: color, alpha: 0.12 });
      pen.circle(c.x, c.y, 16, { fill: color });
      pen.text(c.x, c.y + 6, c.q > 0 ? '+' : c.q < 0 ? '−' : '0', { size: 19, color: '#141413', align: 'middle', weight: 600 });
      pen.text(c.x, c.y + 44, `${c.q > 0 ? '+' : ''}${c.q} μC`, { size: 11.5, color: C.soft, align: 'middle' });
    }
    pen.text(20, 424, 'Field lines run from + to −. Arrows show the force on each charge.', { size: 10.5, color: C.faint });
  },
  readouts(p) {
    const r = Math.hypot(p.x1 - p.x2, p.y1 - p.y2) * PX_M, F = K_E * Math.abs(p.q1 * p.q2) * 1e-12 / (r * r), { E } = fieldLines(p), [ex, ey] = E((p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2);
    return [['Separation', `${fmt(r * 100, 1)} cm`], ['Force on each', `${fmt(F)} N`], ['Interaction', p.q1 * p.q2 > 0 ? 'Repulsive' : p.q1 * p.q2 < 0 ? 'Attractive' : 'None'], ['Field at midpoint', `${(K_E * 1e-6 * Math.hypot(ex, ey) / (PX_M * PX_M)).toExponential(2)} N/C`]];
  },
  describe(p) { return `Charges of ${p.q1} μC and ${p.q2} μC ${fmt(Math.hypot(p.x1 - p.x2, p.y1 - p.y2) * PX_M * 100, 1)} cm apart, with their field lines.`; },
};

/* ───────────── Orbits and Kepler’s laws ───────────── */
const orbitOf = (p: Values) => {
  const v = p.v, e = Math.abs(v * v - 1), a = 1 / (2 - v * v), b = a * Math.sqrt(1 - e * e), T = TAU * a ** 1.5, flip = v < 1;
  const at = (tau: number): P => { const M = mod(tau, T) / T * TAU; let E = M; for (let i = 0; i < 12; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); const x = a * (Math.cos(E) - e), y = b * Math.sin(E); return flip ? [-x, -y] : [x, y]; };
  return { e, a, b, T, rp: a * (1 - e), ra: a * (1 + e), start: flip ? T / 2 : 0, anim: 6 * a ** 0.75, at };
};
const orbit: SceneDef = {
  id: 'orbit', title: 'Orbits and Kepler’s laws', subject: 'Gravitation', summary: 'Change the launch speed and see circles become ellipses, with equal areas in equal times.',
  keywords: /orbit|kepler|planet|satellite|ellip|solar|moon|gravitation/i,
  params: [
    { key: 'v', label: 'Launch speed', min: 0.5, max: 1.35, step: 0.01, unit: '× circular', value: 1.18 },
    { key: 'M', label: 'Star mass', min: 0.3, max: 3, step: 0.1, unit: 'M☉', value: 1 },
  ],
  equation: 'T² = a³ / M   (years, AU, solar masses)', assumption: 'Two-body Newtonian gravity, launched 1 AU from the star. Animation time is compressed.',
  period: p => orbitOf(p).anim, still: p => orbitOf(p).anim * 0.3,
  draw(pen, p, t) {
    const o = orbitOf(p), flip = p.v < 1, xl = flip ? o.rp : o.ra, xr = flip ? o.ra : o.rp, s = Math.min(700 / (xl + xr), 350 / (2 * o.b));
    const cx = 50 + xl * s + (700 - (xl + xr) * s) / 2, cy = 214, X = (q: P): P => [cx + q[0] * s, cy - q[1] * s];
    pen.path(Array.from({ length: 181 }, (_, i) => X(o.at(o.T * i / 180))), { stroke: C.faint, width: 1.2, dash: [4, 6] });
    const tau = o.start + t / o.anim * o.T, slice = o.T / 12;
    const wedge = (from: number): P[] => [[cx, cy], ...Array.from({ length: 24 }, (_, i) => X(o.at(from + slice * i / 23)))];
    pen.path(wedge(-slice / 2), { fill: C.coral, alpha: 0.13 }, true);
    pen.path(wedge(tau - slice), { fill: C.blue, alpha: 0.22 }, true);
    glow(pen, cx, cy, 11, C.coral);
    pen.text(cx, cy + 32, 'Star', { size: 11, color: C.soft, align: 'middle' });
    const q = o.at(tau), [x, y] = X(q), [x2, y2] = X(o.at(tau + o.T / 2000)), d = Math.hypot(x2 - x, y2 - y) || 1, len = 46 * Math.sqrt(Math.max(0, 2 / Math.hypot(q[0], q[1]) - 1 / o.a));
    arrow(pen, x, y, x + (x2 - x) / d * len, y + (y2 - y) / d * len, { stroke: C.ink, width: 2 });
    glow(pen, x, y, 7, C.blue);
    pen.text(24, 32, 'Equal areas in equal times', { size: 13, color: C.ink, serif: true });
    pen.text(24, 50, 'Both shaded slices take one twelfth of an orbit.', { size: 10.5, color: C.faint });
  },
  readouts(p, t) {
    const o = orbitOf(p), tau = o.start + t / o.anim * o.T, [x, y] = o.at(tau), r = Math.hypot(x, y), speed = Math.sqrt(Math.max(0, 2 / r - 1 / o.a)) * 29.78 * Math.sqrt(p.M);
    return [['Eccentricity', fmt(o.e, 3)], ['Period', `${fmt(o.a ** 1.5 / Math.sqrt(p.M))} years`], ['Closest', `${fmt(o.rp)} AU`], ['Farthest', `${fmt(o.ra)} AU`], ['Speed now', `${fmt(speed, 1)} km/s`]];
  },
  describe(p) { const o = orbitOf(p); return `An orbit launched at ${p.v}× circular speed has eccentricity ${fmt(o.e, 3)} and a period of ${fmt(o.a ** 1.5 / Math.sqrt(p.M))} years.`; },
};

/* ───────────── Unit circle ───────────── */
const circle: SceneDef = {
  id: 'circle', title: 'The unit circle', subject: 'Trigonometry', summary: 'See sine and cosine unroll from a point turning around a circle.',
  keywords: /unit circle|sine|cosine|trig|\bsin\b|\bcos\b|\btan\b|radian/i,
  params: [{ key: 'speed', label: 'Turning speed', min: 0.04, max: 0.5, step: 0.01, unit: 'rev/s', value: 0.12 }],
  equation: '(x, y) = (cos θ, sin θ)   ·   tan θ = sin θ / cos θ', assumption: 'Radius 1; angles measured anticlockwise from the positive x-axis.',
  period: p => 1 / p.speed, still: p => 0.14 / p.speed,
  draw(pen, p, t) {
    const R = 118, cx = 180, cy = 218, th = mod(TAU * p.speed * t, TAU), px = cx + R * Math.cos(th), py = cy - R * Math.sin(th);
    const g0 = 350, g1 = 776, GX = (a: number) => g0 + a / TAU * (g1 - g0);
    for (const [a, b, c, d] of [[cx - R - 20, cy, cx + R + 20, cy], [cx, cy - R - 20, cx, cy + R + 20], [g0, cy, g1, cy]]) pen.path([[a, b], [c, d]], { stroke: C.axis, width: 1 });
    pen.path(Array.from({ length: 121 }, (_, i) => [cx + R * Math.cos(TAU * i / 120), cy - R * Math.sin(TAU * i / 120)] as P), { stroke: C.soft, width: 1.4 });
    for (const [a, l] of [[Math.PI / 2, 'π/2'], [Math.PI, 'π'], [1.5 * Math.PI, '3π/2'], [TAU, '2π']] as const) { pen.path([[GX(a), cy - 4], [GX(a), cy + 4]], { stroke: C.axis, width: 1 }); pen.text(GX(a), cy + 20, l, { size: 11, color: C.faint, align: 'middle', serif: true }); }
    for (const v of [1, -1]) { pen.path([[g0, cy - v * R], [g1, cy - v * R]], { stroke: C.grid, width: 1 }); pen.text(g0 - 8, cy - v * R + 4, v > 0 ? '1' : '−1', { size: 10.5, color: C.faint, align: 'end' }); }
    const curve = (f: (a: number) => number, to: number) => Array.from({ length: 121 }, (_, i) => { const a = to * i / 120; return [GX(a), cy - f(a) * R] as P; });
    pen.path(curve(Math.sin, TAU), { stroke: C.blue, width: 1.2, dash: [3, 5], alpha: 0.5 });
    pen.path(curve(Math.cos, TAU), { stroke: C.coral, width: 1.2, dash: [3, 5], alpha: 0.5 });
    pen.path(curve(Math.cos, th), { stroke: C.coral, width: 2 });
    pen.path(curve(Math.sin, th), { stroke: C.blue, width: 2.2 });
    pen.path(Array.from({ length: 25 }, (_, i) => [cx + 28 * Math.cos(th * i / 24), cy - 28 * Math.sin(th * i / 24)] as P), { stroke: C.soft, width: 1.2 });
    pen.path([[px, py], [GX(th), py]], { stroke: C.faint, width: 1, dash: [3, 5] });
    pen.path([[px, cy], [px, py]], { stroke: C.blue, width: 2.4 });
    pen.path([[cx, cy], [px, cy]], { stroke: C.coral, width: 2.4 });
    pen.path([[cx, cy], [px, py]], { stroke: C.ink, width: 2 });
    glow(pen, px, py, 6, C.ink);
    glow(pen, GX(th), py, 4.5, C.blue);
    pen.text(g0, 44, 'sin θ', { size: 14, color: C.blue, serif: true });
    pen.text(g0 + 60, 44, 'cos θ', { size: 14, color: C.coral, serif: true });
  },
  readouts(p, t) { const th = mod(TAU * p.speed * t, TAU), c = Math.cos(th); return [['Angle', `${fmt(th * 180 / Math.PI, 0)}°`], ['Radians', `${fmt(th)} rad`], ['sin θ', fmt(Math.sin(th), 3)], ['cos θ', fmt(c, 3)], ['tan θ', Math.abs(c) < 0.01 ? 'undefined' : fmt(Math.tan(th), 3)]]; },
  describe() { return 'A point turns around the unit circle while its vertical and horizontal positions trace sine and cosine.'; },
};

/* ───────────── Damped spring ───────────── */
const springOf = (p: Values) => {
  const w0 = Math.sqrt(p.k / p.m), g = p.b / (2 * p.m), wd = Math.sqrt(Math.max(0, w0 * w0 - g * g));
  const x = (t: number) => {
    if (w0 - g > 1e-6) return p.x0 * Math.exp(-g * t) * (Math.cos(wd * t) + g / wd * Math.sin(wd * t));
    if (Math.abs(g - w0) <= 1e-6) return p.x0 * (1 + w0 * t) * Math.exp(-w0 * t);
    const s = Math.sqrt(g * g - w0 * w0), r1 = -g + s, r2 = -g - s; return p.x0 * (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
  };
  const zeta = g / w0; return { w0, g, wd, x, zeta, end: clamp(Math.log(40) / Math.max(g, 0.05), 4, 14) };
};
const spring: SceneDef = {
  id: 'spring', title: 'Damped oscillator', subject: 'Oscillations', summary: 'A mass on a spring, from free oscillation to critical damping.',
  keywords: /spring|hooke|oscillat|damp|harmonic|\bshm\b|vibrat|resonan/i,
  params: [
    { key: 'm', label: 'Mass', min: 0.2, max: 5, step: 0.1, unit: 'kg', value: 1, parse: /(\d+(?:\.\d+)?)\s*kg/i },
    { key: 'k', label: 'Spring constant', min: 5, max: 100, step: 1, unit: 'N/m', value: 25, parse: /(\d+(?:\.\d+)?)\s*N\/m/i },
    { key: 'b', label: 'Damping', min: 0, max: 12, step: 0.1, unit: 'kg/s', value: 0.8 },
    { key: 'x0', label: 'Start displacement', min: 0.05, max: 0.3, step: 0.01, unit: 'm', value: 0.2 },
  ],
  equation: 'm·ẍ + b·ẋ + k·x = 0', assumption: 'Linear spring and viscous damping, released from rest.',
  period: p => springOf(p).end + 0.8, still: p => Math.PI / springOf(p).w0 * 0.5,
  draw(pen, p, t) {
    const s = springOf(p), tt = Math.min(t, s.end), x = s.x(tt), eq = 390, px = 600, bx = eq + x * px, wall = 70, y = 106;
    hatch(pen, wall, 44, 168, true);
    pen.path([[wall, 168], [760, 168]], { stroke: C.axis, width: 1.5 });
    pen.path([[eq, 50], [eq, 176]], { stroke: C.faint, width: 1, dash: [3, 5] });
    pen.text(eq, 192, 'equilibrium', { size: 10.5, color: C.faint, align: 'middle' });
    const coils = 14, start = wall + 16, end = bx - 30, pts: P[] = [[wall, y], [start, y]];
    for (let i = 1; i < coils * 2; i++) pts.push([start + (end - start) * i / (coils * 2), y + (i % 2 ? -13 : 13)]);
    pts.push([end, y], [bx - 28, y]);
    pen.path(pts, { stroke: C.soft, width: 1.8 });
    pen.path([[bx - 28, y - 28], [bx + 28, y - 28], [bx + 28, y + 28], [bx - 28, y + 28]], { fill: C.coral }, true);
    pen.text(bx, y + 6, `${p.m} kg`, { size: 12, color: '#141413', align: 'middle', weight: 600 });
    const g = { x0: 70, x1: 776, y0: 232, y1: 404 }, X = (v: number) => g.x0 + v / s.end * (g.x1 - g.x0), Y = (v: number) => (g.y0 + g.y1) / 2 - v / (p.x0 * 1.15) * (g.y1 - g.y0) / 2;
    pen.path([[g.x0, Y(0)], [g.x1, Y(0)]], { stroke: C.axis, width: 1 });
    pen.text(g.x0 - 8, Y(p.x0) + 4, `${fmt(p.x0 * 100, 0)} cm`, { size: 10.5, color: C.faint, align: 'end' });
    if (s.zeta < 1) for (const sg of [1, -1]) pen.path(Array.from({ length: 121 }, (_, i) => { const v = s.end * i / 120; return [X(v), Y(sg * p.x0 * Math.exp(-s.g * v))] as P; }), { stroke: C.blue, width: 1.1, dash: [4, 5], alpha: 0.7 });
    pen.path(Array.from({ length: 301 }, (_, i) => { const v = s.end * i / 300; return [X(v), Y(s.x(v))] as P; }), { stroke: C.faint, width: 1.1, alpha: 0.6 });
    pen.path(Array.from({ length: 301 }, (_, i) => { const v = tt * i / 300; return [X(v), Y(s.x(v))] as P; }), { stroke: C.ink, width: 2 });
    glow(pen, X(tt), Y(x), 4.5, C.coral);
    pen.text(g.x1, g.y1 + 18, `${fmt(s.end, 1)} s`, { size: 10.5, color: C.faint, align: 'end' });
    pen.text(g.x0, g.y0 - 8, 'Displacement over time', { size: 11, color: C.faint });
  },
  readouts(p, t) { const s = springOf(p); return [['Natural frequency', `${fmt(s.w0)} rad/s`], ['Damped period', s.zeta < 1 ? `${fmt(TAU / s.wd)} s` : '—'], ['Damping ratio ζ', fmt(s.zeta)], ['Regime', s.zeta === 0 ? 'Undamped' : s.zeta < 0.999 ? 'Underdamped' : s.zeta <= 1.001 ? 'Critically damped' : 'Overdamped'], ['Displacement', `${fmt(s.x(Math.min(t, s.end)) * 100, 1)} cm`]]; },
  describe(p) { const s = springOf(p); return `A ${p.m} kg mass on a ${p.k} N/m spring with damping ${p.b} kg/s: damping ratio ${fmt(s.zeta)}.`; },
};

export const scenes: SceneDef[] = [projectile, pendulum, waves, lens, field, orbit, circle, spring];
export const sceneById = (id?: string | boolean) => scenes.find(s => s.id === id) || (id === true ? projectile : undefined);
export const defaults = (scene: SceneDef): Values => Object.fromEntries(scene.params.map(p => [p.key, p.value]));

export function sceneSvg(scene: SceneDef, params = defaults(scene), t = scene.still(params), ink?: Ink) {
  const pen = new SvgPen(ink);
  scene.draw(pen, params, t);
  return pen.toString(scene.title);
}

export function projectileLatex(p: Values) {
  const k = proj(p), coords = Array.from({ length: 81 }, (_, i) => { const t = k.T * i / 80; return `(${(k.vx * t).toFixed(4)},${(k.vy * t - 0.5 * p.g * t * t).toFixed(4)})`; }).join(' ');
  return String.raw`\documentclass{article}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usepackage[margin=25mm]{geometry}
\begin{document}
\section*{Projectile motion}
Initial speed ${p.speed} m/s, launch angle ${p.angle}$^\circ$, gravity ${p.g} m/s$^2$. Ground-level launch, no air resistance.
\begin{center}\begin{tikzpicture}
\begin{axis}[width=14cm,axis equal image,axis lines=left,xlabel={$x$ (m)},ylabel={$y$ (m)},clip=false]
\addplot[thick] coordinates {${coords}};
\node[above] at (axis cs:${(k.R / 2).toFixed(4)},${k.H.toFixed(4)}) {Apex: ${k.H.toFixed(2)} m};
\end{axis}\end{tikzpicture}\end{center}
Flight time ${k.T.toFixed(3)} s. Range ${k.R.toFixed(3)} m. Maximum height ${k.H.toFixed(3)} m.
\end{document}`;
}
export { W, H };
