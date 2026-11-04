import { inks, pen, penFrame } from "./vectorFilm";

/**
 * The profile pictures: eight living things, each a small film of its own, drawn with the illustrations' pen on the same
 * 480×390 stage and to the same rules as src/vectorFilm.ts. Bare line in a lot of empty space, colour on one small element,
 * and a loop that holds, snaps to its next pose with a small overshoot, and holds again. They are drawn from life, a small
 * ink eye and no cartoon face, and they move the way the creature does. Each loop starts on its finished pose, so frame 0
 * is the complete drawing.
 */
type P = [number, number];
export type AvatarFilm = { id: string; name: string; seconds: number; crop: [number, number, number]; draw: (u: number) => string };

const { line, curve, shape, blob, arc, ellipse, leaf, X, ring, wavy, stripes, pose, pop, clamp, lerp } = pen;
const { INK, BLUE, GREEN, LILAC, PINK, SAND, CLAY, FINE, THIN } = inks;
const eye = (x: number, y: number, r = 4) => shape(ellipse(x, y, r), { fill: INK, w: 0 });

function finch(u: number) {
  // A finch on a twig. It holds still, pecks twice at something, hops a little and settles.
  const ks = [1.5, 1.72, 2.1, 2.32, 3.3, 3.62], peck = pose(u, ks, [0, 0.3, 0, 0.3, 0, 0, 0], 0.14), hop = pose(u, [3.3, 3.62], [0, -18, 0], 0.2);
  const b = (pts: P[]) => X(pts, { r: peck, ox: 232, oy: 236, y: hop });
  const body: P[] = [[166, 214], [184, 176], [222, 150], [258, 134], [292, 146], [300, 172], [286, 206], [250, 232], [206, 240]];
  const breast = b([[266, 176], [298, 174], [284, 206], [250, 230], [232, 212]]);
  const [e] = b([[276, 158]]);
  let s = curve([[116, 280], [236, 274], [364, 262]]) + line([[300, 268], [326, 244]], { w: FINE }) + shape(leaf([326, 244], [352, 220], 8), { w: THIN });
  s += line([[224, 238], [222, 274 - hop]], { w: FINE }) + line([[244, 234], [246, 272 - hop]], { w: FINE });
  s += shape(b([[174, 218], [112, 244], [124, 260], [194, 238]]), { w: FINE });
  s += blob(breast, { fill: PINK, w: 0 }) + stripes(breast, 0.5, 13) + blob(b(body));
  s += curve(b([[204, 174], [242, 188], [228, 214], [186, 226]]), { w: FINE });
  return s + shape(b([[297, 150], [324, 162], [298, 174]]), { w: FINE }) + eye(e[0], e[1]);
}

function moth(u: number) {
  // A moth at rest, wings flat. They shiver shut and open twice, and the whole moth lifts a touch and settles.
  const open = pose(u, [1.9, 2.12, 2.34, 2.56], [1, 0.42, 1, 0.42, 1], 0.14), lift = pose(u, [1.9, 3], [0, -12, 0], 0.36);
  const w = (pts: P[], side: number) => X(side > 0 ? pts : pts.map(([x, y]) => [480 - x, y] as P), { sx: open, ox: 240, oy: 196, y: lift });
  const fore: P[] = [[236, 174], [204, 124], [146, 108], [116, 124], [136, 170], [176, 192], [232, 200]];
  const hind: P[] = [[232, 200], [176, 196], [152, 226], [168, 268], [204, 276], [228, 248], [236, 222]];
  let s = "";
  for (const side of [1, -1]) {
    const h = w(hind, side);
    s += blob(h, { fill: LILAC }) + stripes(h, 0.9 * side, 13) + blob(w(fore, side));
    s += curve(w([[230, 182], [190, 150], [136, 124]], side), { w: THIN }) + curve(w([[230, 190], [186, 176], [140, 150]], side), { w: THIN });
  }
  s += shape(X(ellipse(240, 204, 11, 42), { y: lift }));
  return s + curve(X([[234, 164], [216, 132], [192, 122]], { y: lift }), { w: FINE }) + curve(X([[246, 164], [264, 132], [288, 122]], { y: lift }), { w: FINE });
}

function snail(u: number) {
  // A snail stretches forward along the ground, its shell following a moment later; its horns dip as it gathers itself.
  const reach = pose(u, [1.6, 3.5], [0, 22, 0], 0.5), follow = pose(u, [1.95, 3.8], [0, 14, 0], 0.5), dip = pose(u, [1.45, 2.3, 3.4, 4.2], [0, 1, 0, 1, 0], 0.26);
  const foot: P[] = [[112, 268], [176, 250], [252, 254], [306 + reach, 244], [340 + reach, 214], [364 + reach, 210], [372 + reach, 240], [340 + reach, 268]];
  const head = (x: number, y: number) => [x + reach, y] as P, cx = 216 + follow, cy = 188, spiral = Array.from({ length: 34 }, (_, i) => { const t = i / 33, a = 0.3 + t * Math.PI * 4.6, r = 58 * (1 - t * 0.9); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as P; });
  const disc = ellipse(cx, cy, 62);
  let s = line([[86, 272], [410, 272]], { w: FINE }) + blob(foot);
  s += shape(disc, { fill: SAND, w: 0 }) + stripes(disc, 0.7, 16) + shape(disc) + curve(spiral, { w: FINE });
  const tip1 = head(372 - dip * 6, 172 + dip * 22), tip2 = head(398 - dip * 12, 182 + dip * 20);
  s += line([head(352, 212), tip1], { w: FINE }) + line([head(364, 214), tip2], { w: FINE });
  return s + eye(tip1[0], tip1[1], 5) + eye(tip2[0], tip2[1], 5);
}

function koi(u: number) {
  // A koi hangs in the water. A flick of the tail drives it forward, it glides back to rest, and a bubble rises from it.
  const flick = pose(u, [1.6, 1.84, 2.08, 2.32], [0, 0.5, -0.42, 0.26, 0], 0.14), dart = pose(u, [1.7, 3.6], [0, 26, 0], 0.5), tilt = pose(u, [1.7, 3.6], [0, -0.07, 0], 0.5);
  const f = (pts: P[]) => X(pts, { r: tilt, ox: 240, oy: 196, x: dart });
  const patch = f([[222, 156], [272, 156], [292, 184], [258, 204], [214, 192]]);
  const [tail] = f([[156, 198]]), t = (pts: P[]) => X(pts, { r: flick, ox: tail[0], oy: tail[1] });
  const [e] = f([[304, 186]]), [mouth] = f([[346, 200]]);
  let s = blob(patch, { fill: CLAY, w: 0 }) + stripes(patch, 0.6, 12);
  s += shape(t([[tail[0], tail[1]], [tail[0] - 54, tail[1] - 42], [tail[0] - 38, tail[1]], [tail[0] - 54, tail[1] + 42]]), { w: FINE });
  s += blob(f([[150, 198], [196, 158], [262, 146], [326, 170], [346, 200], [322, 222], [262, 244], [196, 236]]));
  s += curve(f([[204, 152], [232, 124], [278, 142]]), { w: FINE }) + curve(f([[234, 240], [226, 272], [262, 248]]), { w: FINE }) + curve(f([[300, 162], [288, 196], [300, 230]]), { w: FINE });
  s += eye(e[0], e[1]);
  if (u >= 2.4) { const q = clamp((u - 2.4) / 2.2); s += ring(mouth[0] + 12 + Math.sin(q * 7) * 4, mouth[1] - q * 110, 6 + q * 4, { w: FINE, opacity: 1 - q * 0.7 }); }
  return s;
}

function jellyfish(u: number) {
  // A jellyfish beats once: the bell draws in and pushes it upward, then opens and drifts down, its arms trailing behind.
  const squeeze = pose(u, [1.5, 2.1, 3.4, 4], [0, 1, 0, 1, 0], 0.26), rise = pose(u, [1.6, 3.5], [0, -32, 0], 0.7), lag = pose(u, [1.8, 3.7], [0, 1, 0], 0.6);
  const rx = 84 - squeeze * 16, ry = 62 + squeeze * 12, cy = 170 + rise, y = cy, n = 5;
  const skirt = Array.from({ length: 13 }, (_, i) => { const t = i / 12; return [240 + rx - t * rx * 2, y + (i % 2 ? 11 : 2) - squeeze * 4] as P; });
  const heart = ellipse(240, y - ry * 0.42, rx * 0.42, ry * 0.32);
  let s = "";
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), x = 240 - rx * 0.72 + t * rx * 1.44, sway = (t - 0.5) * 20 * (1 - squeeze), trail = lag * 18;
    s += curve([[x, y + 6], [x + sway + 10, y + 52], [x + sway - 10, y + 94 - trail * 0.3], [x + sway * 1.6 + 6, y + 132 + trail]], { w: i % 2 ? FINE : THIN });
  }
  s += shape(heart, { fill: BLUE, w: 0 }) + stripes(heart, 0.5, 11);
  return s + shape([...arc(240, y, rx, ry, Math.PI, Math.PI * 2, 24), ...skirt]);
}

function bee(u: number) {
  // A bee circles in, lands on the flower, and the flower's heart takes the colour; then it lifts away again.
  const a: P = [356, 106], b: P = [226, 112], go = pose(u, [1.2], [0, 1], 0.7), away = pose(u, [3.5], [0, 1], 0.6), q = go - away, buzz = q > 0.98 ? 0 : Math.sin(u * 40) * 3;
  const x = lerp(a[0], b[0], q) + Math.sin(q * Math.PI) * 34, y = lerp(a[1], b[1], q) - Math.sin(q * Math.PI) * 22 + buzz, lit = u >= 2 && u < 4.2;
  const c: P = [226, 196], heart = ellipse(c[0], c[1], 21);
  let s = curve([[226, 222], [234, 262], [226, 312]]) + shape(leaf([230, 276], [274, 250], 11), { w: FINE });
  for (let i = 0; i < 7; i++) { const t = (i / 7) * Math.PI * 2, d = 21; s += shape(X(leaf([c[0], c[1] + d], [c[0], c[1] + d + 42], 15), { r: t, ox: c[0], oy: c[1] }), { w: FINE }); }
  s += lit ? shape(heart, { fill: SAND, w: 0 }) + stripes(heart, 0.7, 9) + shape(heart, { w: FINE }) : shape(heart, { w: FINE });
  const flap = Math.floor(u * 12) % 2 ? -0.5 : -0.2, body = ellipse(x, y, 22, 14);
  s += shape(X(ellipse(x - 2, y - 22, 9, 17), { r: flap, ox: x, oy: y - 8 }), { w: THIN }) + shape(X(ellipse(x + 11, y - 21, 8, 15), { r: flap + 0.5, ox: x, oy: y - 8 }), { w: THIN });
  s += shape(body, { w: FINE }) + line([[x - 6, y - 13], [x - 6, y + 13]], { w: THIN }) + line([[x + 4, y - 13], [x + 4, y + 13]], { w: THIN });
  return s + eye(x + 15, y - 3, 2.8);
}

function whale(u: number) {
  // A whale rolls up at the surface and blows; the spout falls back as it sinks, its tail lifting behind it.
  const up = pose(u, [1.5, 3.5], [0, -18, 0], 0.5), blow = clamp((u - 1.9) / 1.3), tail = pose(u, [2.6, 3.8], [0, 0.32, 0], 0.5);
  const w = (pts: P[]) => X(pts, { y: up });
  const [hole] = w([[304, 160]]), [root] = w([[130, 214]]), fl = (pts: P[]) => X(pts, { r: tail, ox: root[0], oy: root[1] });
  const [e] = w([[334, 204]]);
  const belly = w([[244, 226], [316, 216], [362, 208], [342, 240], [280, 254], [226, 250]]);
  let s = blob(belly, { fill: BLUE, w: 0 }) + stripes(belly, 0, 10);
  s += blob(w([[126, 214], [164, 176], [232, 150], [304, 152], [362, 186], [372, 208], [342, 242], [270, 258], [190, 246]]));
  s += shape(fl([[root[0] + 8, root[1] + 2], [root[0] - 46, root[1] - 36], [root[0] - 26, root[1] + 4], [root[0] - 70, root[1] + 14], [root[0] - 18, root[1] + 26]]), { w: FINE });
  s += curve(w([[250, 228], [268, 248], [302, 240]]), { w: FINE }) + eye(e[0], e[1]);
  if (blow > 0 && blow < 1) for (const [dx, h] of [[-24, 0.82], [0, 1], [24, 0.82]] as P[]) {
    const k = Math.sin(blow * Math.PI) * h;
    s += curve([[hole[0], hole[1] - 2], [hole[0] + dx * 0.25, hole[1] - 44 * k], [hole[0] + dx, hole[1] - 76 * k], [hole[0] + dx * 1.7, hole[1] - 64 * k]], { w: FINE, opacity: 1 - blow * 0.35 });
  }
  return s + wavy(286, 96, 390, Math.floor(u * 6) * 0.2, 4);
}

function sprig(u: number) {
  // A sprig sways in the air. Its lowest leaf lets go and falls, turning, and a new bud opens at the tip.
  const sway = pose(u, [1, 2, 3, 4], [0, 0.05, -0.04, 0.03, 0], 0.5), s0 = (pts: P[]) => X(pts, { r: sway, ox: 236, oy: 306 });
  const stem = s0([[236, 306], [232, 248], [240, 190], [236, 112]]), fall = clamp((u - 1.7) / 1.8), bud = pop(u, 3.5, 0.5), onTree = u < 1.7, back = u >= 4.2 ? pop(u, 4.2, 0.4) : 0;
  let s = curve([[152, 310], [236, 300], [326, 310]]) + curve(stem);
  const pair = (base: P, tip: P, fill?: string) => shape(s0(leaf(base, tip, 15)), { w: FINE, ...(fill ? { fill } : {}) });
  s += pair([234, 214], [168, 184]) + pair([238, 196], [304, 160]) + pair([238, 158], [188, 118]);
  if (onTree || back > 0) { const a = onTree ? 1 : back; const lower = X(s0(leaf([232, 254], [292, 232], 16)), { s: a, ox: 232, oy: 254 }); s += shape(lower, { fill: GREEN }) + stripes(lower, 0.5, 11); }
  else { const x = 292 + Math.sin(fall * 6) * 22 + fall * 14, y = 232 + fall * fall * 68, l = X(leaf([x - 30, y], [x + 30, y], 15), { r: Math.sin(fall * 6) * 0.7, ox: x, oy: y }); s += shape(l, { fill: GREEN }) + stripes(l, 0.5, 11); }
  return s + shape(X(s0(leaf([236, 114], [250, 66], 11)), { s: u < 3.5 ? 1 : bud, ox: 236, oy: 114 }), { w: FINE });
}

export const avatarFilms: AvatarFilm[] = [
  { id: "pip", name: "Finch", seconds: 5, crop: [238, 200, 322], draw: finch },
  { id: "moth", name: "Moth", seconds: 5, crop: [240, 192, 352], draw: moth },
  { id: "pebble", name: "Snail", seconds: 5, crop: [248, 196, 356], draw: snail },
  { id: "comet", name: "Koi", seconds: 5, crop: [240, 190, 330], draw: koi },
  { id: "cloudlet", name: "Jellyfish", seconds: 5.5, crop: [240, 214, 310], draw: jellyfish },
  { id: "noodle", name: "Bee", seconds: 5.5, crop: [262, 196, 316], draw: bee },
  { id: "finch", name: "Whale", seconds: 5, crop: [228, 188, 386], draw: whale },
  { id: "sprig", name: "Sprig", seconds: 5.5, crop: [238, 192, 338], draw: sprig },
];

/** One drawing of a film at `seconds`: the line boils on twos, as in the illustrations. */
export function avatarFrame(film: AvatarFilm, seconds: number) {
  penFrame(seconds);
  return film.draw(seconds % film.seconds);
}
