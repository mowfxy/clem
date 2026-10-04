// The plates seen through the eyepiece. Each painter returns a canvas, built once before rendering:
// hand-coloured engravings on laid paper, maps, micrographs and photographs, all procedural.

const PLATES = {};

// ---------------------------------------------------------------- paper

const PAPER_FS = `
uniform vec2 res; uniform vec3 base; uniform float seed, age, edge;
void main(){
  vec2 px = uv * res;
  float big = fbm(px / 520. + seed), mid = fbm(px / 90. + seed * 2.3), fine = vnoise(px / 2.2 + seed);
  vec3 c = base * (0.955 + 0.05 * big + 0.025 * mid);
  // laid-paper fibres in both directions
  float f1 = gnoise(vec2(px.x / 1.6, px.y / 48.) + seed * 3.), f2 = gnoise(vec2(px.x / 55., px.y / 1.8) + seed * 5.);
  c *= 1. - 0.035 * smoothstep(.35, .7, f1) - 0.03 * smoothstep(.4, .75, f2);
  c *= 1. + 0.02 * smoothstep(.45, .8, -f1);
  c *= 0.988 + 0.024 * fine;
  // foxing and age
  float fox = fbm(px / 140. + seed * 7.);
  c = mix(c, c * vec3(.92, .84, .7), smoothstep(.38, .62, fox) * .28 * age);
  float spot = vnoise(px / 9. + seed * 11.);
  c = mix(c, c * vec3(.86, .76, .62), smoothstep(.93, .99, spot) * .5 * age);
  vec2 q = uv - .5;
  c *= 1. - edge * pow(length(q * vec2(1.05, 1.)) * 1.35, 3.);
  o = vec4(c, 1);
}`;
function paper(w, h, base = [0.94, 0.915, 0.86], { seed = 1, age = 1, edge = 0.18 } = {}) {
  return bake(PAPER_FS, w, h, { base, seed, age, edge });
}
const MOTTLE_FS = `
uniform vec2 res;
void main(){ vec2 px = uv * res; float n = fbm(px / 60.) * .6 + fbm(px / 14. + 9.) * .4; float v = 0.86 + 0.14 * smoothstep(-.5, .6, n); o = vec4(vec3(v), 1); }`;

/** Script caption in the copperplate of old herbals. */
function caption(ctx, text, x, y, size, { font = "'Palace Script MT'", color = "#1d1712", align = "left", alpha = 0.92, rot = 0 } = {}) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = color; ctx.globalAlpha = alpha; ctx.textAlign = align;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// ---------------------------------------------------------------- botanical parts

/** A leaf from base (x, y) along `angle`: lit and shaded halves, pale veins, engraved shadow. */
function leaf(ctx, x, y, len, wid, angle, { color = "#5f8a3a", dark = "#2f5524", pale = "#a9c27a", curl = 0, serrate = 0, seed = 1, veins = 7, flip = false } = {}) {
  const r = RNG(seed), ca = Math.cos(angle), sa = Math.sin(angle);
  const P = (u, v) => [x + ca * u - sa * v, y + sa * u + ca * v];
  const N = 52, left = [], right = [], mid = [];
  for (let i = 0; i <= N; i++) {
    const k = i / N, bend = curl * len * k * k;
    let w = wid * Math.pow(Math.sin(Math.PI * Math.pow(k, 0.75)), 0.85) * (1 - 0.12 * k);
    if (serrate && i % 2 === 1 && k > 0.08 && k < 0.95) w *= 1 + serrate;
    mid.push(P(k * len, bend));
    left.push(P(k * len, bend - w));
    right.push(P(k * len, bend + w * (0.92 + 0.08 * r())));
  }
  const [litSide, shadeSide] = flip ? [right, left] : [left, right];
  const outline = left.concat(right.slice().reverse()), path = polyPath(outline), box = boxOf(outline);
  const lit = polyPath(mid.concat(litSide.slice().reverse())), shd = polyPath(mid.concat(shadeSide.slice().reverse()));
  ctx.save(); ctx.fillStyle = UNDER; ctx.fill(path); ctx.restore();
  const across = (a, b) => { const p0 = P(len * 0.5, curl * len * 0.25 + a * wid), p1 = P(len * 0.5, curl * len * 0.25 + b * wid); return ctx.createLinearGradient(...p0, ...p1); };
  const sgn = flip ? 1 : -1;
  const g1 = across(sgn * 1, 0); g1.addColorStop(0, pale); g1.addColorStop(0.55, color); g1.addColorStop(1, color);
  const g2 = across(0, -sgn * 1); g2.addColorStop(0, color); g2.addColorStop(0.5, dark); g2.addColorStop(1, dark);
  wash(ctx, lit, g1, { alpha: 0.92, edge: 0 });
  wash(ctx, shd, g2, { alpha: 0.92, edge: 0 });
  // tip and base deepen
  const gl2 = ctx.createLinearGradient(...P(0, 0), ...P(len, 0)); gl2.addColorStop(0, dark); gl2.addColorStop(0.25, "rgba(0,0,0,0)"); gl2.addColorStop(0.85, "rgba(0,0,0,0)"); gl2.addColorStop(1, dark);
  wash(ctx, path, gl2, { alpha: 0.35, edge: 0, mottle: 0 });
  hatch(ctx, shd, box, { angle: angle + (flip ? -1 : 1) * 0.9, spacing: 3.4, maxW: 1.9, seed, alpha: 0.55, shade: (px, py) => { const u = ((px - x) * ca + (py - y) * sa) / len; return 0.25 + 0.55 * Math.sin(u * Math.PI); } });
  // veins: pale ridge with a dark lower edge
  const vp = new Path2D();
  for (let i = 1; i <= veins; i++) {
    const k = i / (veins + 1), m = mid[Math.round(k * N)];
    for (const side of [-1, 1]) {
      const k2 = Math.min(1, k + 0.17), e = P(k2 * len, curl * len * k2 * k2 + side * wid * 0.8 * Math.sin(Math.PI * Math.pow(k2, 0.75)));
      vp.moveTo(m[0], m[1]);
      vp.quadraticCurveTo((m[0] + e[0]) / 2 + side * -sa * 5, (m[1] + e[1]) / 2 + side * ca * 5, e[0], e[1]);
    }
  }
  ctx.save(); ctx.clip(path);
  ctx.translate(0.9, 1.1); inkLine(ctx, vp, 1.3, dark, 0.55); ctx.translate(-0.9, -1.1);
  inkLine(ctx, vp, 1.1, pale, 0.75);
  ctx.restore();
  inkLine(ctx, polyPath(mid, false), 2.6, pale, 0.9);
  inkLine(ctx, polyPath(mid.map(([a, b]) => [a + 1.2, b + 1.4]), false), 1, dark, 0.7);
  inkLine(ctx, path, 1.4, "#1f2a14", 0.85);
}

/** A tapered stem from a list of points. */
function stem(ctx, line, w0, w1, { color = "#5c7f36", dark = "#2c4a1e", seed = 3 } = {}) {
  const outline = ribbon(line, w0, w1), path = polyPath(outline), box = boxOf(outline);
  wash(ctx, path, color, { alpha: 0.9, edge: 0.4, under: UNDER });
  hatch(ctx, path, box, { angle: 0.2, spacing: 3.6, maxW: 2, seed, alpha: 0.5, shade: (x) => 0.2 });
  // shaded right edge
  const right = ribbon(line.map(([x, y]) => [x + w0 * 0.22, y]), w0 * 0.45, w1 * 0.45);
  wash(ctx, polyPath(right), dark, { alpha: 0.35, edge: 0 });
  inkLine(ctx, path, 1.3);
}

const PETAL = new Path2D("M64 11 C87 4 104 20 103 42 C103 57 94 70 84 72 C78 73 79 65 81 61 C85 48 75 43 65 48 C55 52 49 43 49 31 C49 22 54 15 64 11Z");
/** Mowr's own flower: four of the logo's petals, painted like a herbal plate (tilted for depth). */
function mowrFlower(ctx, x, y, r, rot, tilt, { c0 = "#f2b3a4", c1 = "#c8392f", c2 = "#7d1f1a", seed = 5 } = {}) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, tilt); ctx.scale(r / 72, r / 72); ctx.translate(-72, -72);
  const rr = RNG(seed);
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.translate(72, 72); ctx.rotate(k * Math.PI / 2 + rr.range(-0.05, 0.05)); ctx.translate(-72, -72);
    const g = ctx.createRadialGradient(72, 72, 4, 80, 40, 52);
    g.addColorStop(0, c2); g.addColorStop(0.35, c1); g.addColorStop(1, c0);
    wash(ctx, PETAL, g, { alpha: 0.95, edge: 0.7, edgeW: 2, under: UNDER });
    const hl = ctx.createRadialGradient(88, 30, 2, 88, 30, 26); hl.addColorStop(0, "rgba(255,246,236,.75)"); hl.addColorStop(1, "rgba(255,246,236,0)");
    ctx.save(); ctx.clip(PETAL); ctx.fillStyle = hl; ctx.fillRect(40, 0, 80, 80); ctx.restore();
    hatch(ctx, PETAL, [44, 0, 108, 78], { angle: 0.9, spacing: 2.6, maxW: 1.2, seed: seed + k, alpha: 0.5, shade: (px, py) => clamp(0.85 - Math.hypot(px - 84, py - 28) / 50) });
    const v = new Path2D();
    for (let i = 0; i < 6; i++) { const a = -1.25 + i * 0.22; v.moveTo(74, 66); v.quadraticCurveTo(74 + Math.cos(a) * 18, 66 + Math.sin(a) * 22, 74 + Math.cos(a) * 30, 66 + Math.sin(a) * 40); }
    inkLine(ctx, v, 0.55, c2, 0.5);
    inkLine(ctx, PETAL, 1.25);
    ctx.restore();
  }
  // stamens
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + rr() * 0.3, d = rr.range(5, 12);
    ctx.beginPath(); ctx.arc(72 + Math.cos(a) * d, 72 + Math.sin(a) * d, 2.6, 0, TAU);
    ctx.fillStyle = "#d9a72e"; ctx.fill(); ctx.lineWidth = 0.8; ctx.strokeStyle = INK; ctx.stroke();
  }
  ctx.restore();
}
function bud(ctx, x, y, s, angle, { c1 = "#c8392f", c0 = "#e9a090", green = "#5f8a3a" } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  const b = new Path2D(); b.moveTo(0, 0); b.bezierCurveTo(s * 0.55, -s * 0.15, s * 0.6, -s * 0.95, 0, -s * 1.25); b.bezierCurveTo(-s * 0.6, -s * 0.95, -s * 0.55, -s * 0.15, 0, 0);
  const g = ctx.createLinearGradient(-s * .5, 0, s * .5, 0); g.addColorStop(0, c0); g.addColorStop(1, c1);
  wash(ctx, b, g, { alpha: 0.95, under: UNDER });
  hatch(ctx, b, [-s, -s * 1.3, s, 0], { angle: 1, spacing: 2.6, maxW: 1.3, alpha: 0.55, shade: (px) => clamp(px / s + 0.3) });
  inkLine(ctx, b, 1.2);
  const sep = new Path2D(); sep.moveTo(0, 2); sep.bezierCurveTo(s * 0.5, -s * 0.1, s * 0.4, -s * 0.5, s * 0.15, -s * 0.55); sep.bezierCurveTo(s * 0.2, -s * 0.2, -s * 0.2, -s * 0.2, -s * 0.15, -s * 0.55); sep.bezierCurveTo(-s * 0.4, -s * 0.5, -s * 0.5, -s * 0.1, 0, 2);
  wash(ctx, sep, green, { alpha: 0.9, under: UNDER }); inkLine(ctx, sep, 1.1);
  ctx.restore();
}
/** A foxglove bell hanging from (x, y). */
function bell(ctx, x, y, len, angle, { c0 = "#e8b5c8", c1 = "#a5466f", c2 = "#5c1d3c", seed = 1 } = {}) {
  const r = RNG(seed);
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  const w0 = len * 0.13, w1 = len * 0.36;
  const tube = new Path2D();
  tube.moveTo(0, -w0); tube.bezierCurveTo(len * 0.4, -w0 * 1.1, len * 0.75, -w1 * 0.8, len, -w1);
  tube.bezierCurveTo(len * 1.05, -w1 * 0.3, len * 1.04, w1 * 0.4, len * 0.98, w1 * 1.05);
  tube.bezierCurveTo(len * 0.72, w1 * 0.75, len * 0.38, w0 * 1.15, 0, w0); tube.closePath();
  const g = ctx.createLinearGradient(0, -w1, 0, w1); g.addColorStop(0, c0); g.addColorStop(0.55, c1); g.addColorStop(1, c2);
  wash(ctx, tube, g, { alpha: 0.95, under: UNDER });
  hatch(ctx, tube, [-4, -w1 - 4, len * 1.1, w1 + 4], { angle: 0.25, spacing: 2.8, maxW: 1.6, seed, alpha: 0.55, shade: (px, py) => clamp(0.15 + py / w1 * 0.6) });
  // spotted lip
  const lip = new Path2D(); lip.ellipse(len * 0.99, 0, w1 * 0.22, w1 * 1.0, 0, 0, TAU);
  wash(ctx, lip, "#f3dfe6", { alpha: 0.9 });
  for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(len * r.range(0.9, 1.02), r.range(-w1 * 0.7, w1 * 0.7), r.range(1.4, 3), 0, TAU); ctx.fillStyle = c2; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1; }
  inkLine(ctx, lip, 1.1); inkLine(ctx, tube, 1.3);
  ctx.restore();
}
function cloverHead(ctx, x, y, r, seed = 9) {
  const rr = RNG(seed);
  const base = new Path2D(); base.ellipse(x, y, r, r * 1.1, 0, 0, TAU);
  wash(ctx, base, "#c26b8a", { alpha: 0.7, under: UNDER });
  for (let i = 0; i < 120; i++) {
    const a = rr() * TAU, d = Math.sqrt(rr()) * r, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d * 1.1 - 4;
    const fl = new Path2D(); fl.ellipse(px, py, 3.2, 8, Math.atan2(py - y, px - x) + Math.PI / 2, 0, TAU);
    const shadeV = clamp(0.3 + (px - x + py - y) / (2 * r));
    wash(ctx, fl, shadeV > 0.6 ? "#8b3355" : "#d88aa6", { alpha: 0.8, edge: 0.3, mottle: 0 });
    inkLine(ctx, fl, 0.6, "#4a1a2c", 0.6);
  }
  inkLine(ctx, base, 0.8, INK, 0.3);
}
function trifoliate(ctx, x, y, s, angle, seed) {
  for (let k = -1; k <= 1; k++) leaf(ctx, x, y, s, s * 0.32, angle + k * 0.95, { seed: seed + k, veins: 5, color: "#6b9446", dark: "#30562a" });
}

// ---------------------------------------------------------------- plate 1: the herbal

function plateHerbal() {
  const W = 3000, H = 1900, c = paper(W, H, [0.945, 0.925, 0.875], { seed: 2 }), x = c.getContext("2d");
  // Mowra quadripetala (centre-right): the logo flower
  const s1 = bez([1780, 1900], [1760, 1500], [1840, 1100], [1800, 560], 60);
  stem(x, s1, 16, 7);
  const leaves1 = [[0.08, -2.5, 300], [0.18, -0.55, 280], [0.3, -2.7, 250], [0.42, -0.4, 230], [0.55, -2.8, 190], [0.66, -0.35, 160]];
  leaves1.forEach(([k, a, l], i) => { const p = s1[Math.round(k * 60)]; leaf(x, p[0], p[1], l, l * 0.3, a, { seed: 20 + i, serrate: 0.12, curl: i % 2 ? 0.08 : -0.08, flip: i % 2 === 1 }); });
  const top = s1[60];
  stem(x, bez(top, [top[0] - 60, top[1] - 80], [top[0] - 160, top[1] - 120], [top[0] - 230, top[1] - 120], 20), 7, 4);
  stem(x, bez(top, [top[0] + 50, top[1] - 90], [top[0] + 140, top[1] - 130], [top[0] + 210, top[1] - 160], 20), 7, 4);
  mowrFlower(x, top[0] - 240, top[1] - 150, 118, -0.3, 0.8, { seed: 2 });
  mowrFlower(x, top[0] + 215, top[1] - 200, 104, 0.4, 0.62, { seed: 3 });
  mowrFlower(x, top[0] + 10, top[1] - 120, 132, 0.12, 0.9, { seed: 4 });
  bud(x, top[0] + 120, top[1] + 90, 42, 0.9); bud(x, top[0] - 110, top[1] + 140, 36, -0.8);
  caption(x, "Mowra quadripetala", 1500, 300, 120);
  caption(x, "Linn.", 2440, 300, 64);

  // Digitalis (left)
  const s2 = bez([820, 1900], [840, 1500], [760, 900], [860, 330], 60);
  stem(x, s2, 18, 6, { seed: 8 });
  [[0.06, -2.4, 330], [0.12, -0.7, 340], [0.2, -2.6, 260], [0.28, -0.5, 240]].forEach(([k, a, l], i) => { const p = s2[Math.round(k * 60)]; leaf(x, p[0], p[1], l, l * 0.34, a, { seed: 40 + i, color: "#6e8f45", veins: 9 }); });
  for (let i = 0; i < 11; i++) {
    const k = 0.42 + i * 0.052, p = s2[Math.min(60, Math.round(k * 60))], size = lerp(190, 70, i / 10);
    bell(x, p[0] + 6, p[1], size, 1.15 - i * 0.03 + (i % 2) * 0.2, { seed: 60 + i });
  }
  for (let i = 0; i < 5; i++) { const p = s2[Math.min(60, 54 + i)]; bud(x, p[0] + 4, p[1], 20 - i * 2, 0.6 + i * 0.1, { c1: "#a5466f", c0: "#e8b5c8" }); }
  caption(x, "Digitalis purpurea", 560, 190, 104);

  // Trifolium (between)
  const s3 = bez([1320, 1900], [1300, 1600], [1350, 1300], [1300, 1060], 40);
  stem(x, s3, 9, 5, { seed: 11 });
  trifoliate(x, s3[14][0], s3[14][1], 120, -2.3, 70); trifoliate(x, s3[24][0], s3[24][1], 110, -0.7, 80);
  cloverHead(x, 1300, 1010, 62);
  caption(x, "Trifolium pratense", 1170, 820, 58, { rot: -0.02 });

  // a far specimen at right (Rosa-like, small)
  const s4 = bez([2600, 1900], [2580, 1500], [2660, 1200], [2620, 900], 40);
  stem(x, s4, 12, 6, { seed: 14 });
  [[0.15, -2.5, 170], [0.25, -0.6, 160], [0.45, -2.6, 150], [0.6, -0.5, 140]].forEach(([k, a, l], i) => { const p = s4[Math.round(k * 40)]; leaf(x, p[0], p[1], l, l * 0.42, a, { seed: 90 + i, serrate: 0.18, veins: 6, color: "#557f3d" }); });
  mowrFlower(x, 2620, 860, 96, 0.7, 0.75, { seed: 9, c0: "#f6d6c8", c1: "#e07a5f", c2: "#8c2d22" });
  caption(x, "Rosa Pomponia", 2420, 620, 88);
  PLATES.herbal = printify(c, { seed: 2 });
}

// ---------------------------------------------------------------- plate 2: fern

function pinnule(ctx, x, y, s, a, seed) {
  const r = RNG(seed), ca = Math.cos(a), sa = Math.sin(a), pts = [];
  for (let i = 0; i <= 18; i++) {
    const t = (i / 18) * TAU, rr = s * (0.55 + 0.45 * Math.cos(t)) * (1 + 0.06 * Math.sin(t * 5));
    const u = Math.cos(t) * rr * 1.0 + s * 0.45, v = Math.sin(t) * s * 0.52 * (1 + 0.12 * Math.sin(t * 3 + seed));
    pts.push([x + ca * u - sa * v, y + sa * u + ca * v]);
  }
  return pts;
}
function frond(ctx, base, tip, curve, len, seed, { color = "#4f7f35", dark = "#24461b" } = {}) {
  const r = RNG(seed), N = 90, rach = bez(base, [base[0] + curve[0], base[1] + curve[1]], [tip[0] + curve[2], tip[1] + curve[3]], tip, N);
  const all = new Path2D(), shadow = new Path2D(), pinnules = [];
  for (let i = 6; i < N - 2; i += 2) {
    const k = i / N, p = rach[i], q = rach[i + 1], ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const pl = len * Math.sin(Math.PI * Math.pow(1 - k, 0.85)) * (1 - 0.1 * k) * 0.42;
    for (const side of [-1, 1]) {
      const pa = ang + side * (1.0 - 0.3 * k), cnt = Math.max(3, Math.round(pl / 24));
      const pin = [p];
      for (let j = 0; j <= cnt; j++) { const d = (j / cnt) * pl; pin.push([p[0] + Math.cos(pa) * d, p[1] + Math.sin(pa) * d]); }
      for (let j = 1; j < cnt; j++) {
        const d = (j / cnt) * pl, ps = (pl / cnt) * 1.25 * (1 - 0.55 * (j / cnt)), px = p[0] + Math.cos(pa) * d, py = p[1] + Math.sin(pa) * d;
        for (const s2 of [-1, 1]) pinnules.push({ pts: pinnule(ctx, px, py, ps, pa + s2 * 1.0 + side * 0.35, seed + i * 7 + j), lit: s2 * side > 0, k: j / cnt });
      }
      pinnules.push({ pts: pinnule(ctx, pin[pin.length - 1][0], pin[pin.length - 1][1], (pl / cnt) * 0.5, pa, seed + i), lit: true });
      all.addPath(polyPath(pin, false));
    }
  }
  for (const pn of pinnules) {
    const path = polyPath(pn.pts);
    wash(ctx, path, pn.lit ? color : dark, { alpha: 0.92, mottle: 0, edge: 0.6, under: UNDER });
    const c0 = pn.pts[0], c9 = pn.pts[9], mx = (c0[0] + c9[0]) / 2, my = (c0[1] + c9[1]) / 2;
    const hl = ctx.createRadialGradient(mx, my, 0, mx, my, Math.hypot(c0[0] - c9[0], c0[1] - c9[1]) * 0.6);
    hl.addColorStop(0, pn.lit ? "rgba(214,226,160,.55)" : "rgba(120,150,80,.3)"); hl.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save(); ctx.fillStyle = hl; ctx.fill(path); ctx.restore();
    inkLine(ctx, polyPath([c9, [mx, my]], false), 0.7, "#1f3315", 0.5);
    inkLine(ctx, path, 0.9, "#1b2612", 0.85);
  }
  inkLine(ctx, all, 1.1, dark, 0.8);
  stem(ctx, rach, 11, 2.5, { color: "#6d6a35", dark: "#3e3b1c" });
}
function fiddlehead(ctx, x, y, r, seed) {
  const pts = [];
  for (let i = 0; i <= 160; i++) { const t = i / 160 * 3.2 * TAU, rr = r * Math.exp(-t * 0.18); pts.push([x + Math.cos(t) * rr, y + Math.sin(t) * rr]); }
  const line = pts.reverse(), outline = ribbon(line, 3, 22);
  const p = polyPath(outline);
  wash(ctx, p, "#7d8b3e", { alpha: 0.9 });
  hatch(ctx, p, boxOf(outline), { angle: 0.7, spacing: 3, maxW: 1.6, seed, alpha: 0.6, shade: roundShade(x, y, r) });
  inkLine(ctx, p, 1.2);
}
function plateFern() {
  const W = 2200, H = 2200, c = paper(W, H, [0.935, 0.915, 0.86], { seed: 4 }), x = c.getContext("2d");
  frond(x, [520, 2250], [1650, 260], [100, -700, -500, 300], 1000, 3);
  frond(x, [1200, 2250], [1900, 900], [-50, -500, -300, 200], 700, 17, { color: "#5d8a3e" });
  fiddlehead(x, 520, 820, 150, 8);
  stem(x, bez([600, 2250], [620, 1700], [690, 1200], [670, 828], 40), 16, 18, { color: "#7d8b3e", dark: "#3e4a1c" });
  caption(x, "Polypodium vulgare", 1240, 2080, 104);
  caption(x, "Tab. XIV", 160, 170, 70, { font: "'Baskerville Old Face'" });
  PLATES.fern = printify(c, { seed: 3 });
}

// ---------------------------------------------------------------- plate 3: nautilus

function plateNautilus() {
  const W = 2200, H = 2200, c = paper(W, H, [0.93, 0.91, 0.865], { seed: 6 }), x = c.getContext("2d");
  const cx = 1150, cy = 1080, a = 26, b = 0.1775, turns = 3.1;
  const spiral = (t) => { const r = a * Math.exp(b * t); return [cx + Math.cos(t) * r, cy + Math.sin(t) * r]; };
  const T = turns * TAU, outer = [];
  for (let t = 0; t <= T; t += 0.02) outer.push(spiral(t));
  // the inner whorl offset by one turn
  // shell body: region between spiral(t) and spiral(t + TAU) for the last turn
  const body = [];
  for (let t = T - TAU; t <= T; t += 0.02) body.push(spiral(t));
  const shellPts = []; for (let t = T; t >= T - TAU; t -= 0.02) shellPts.push(spiral(t));
  const whole = polyPath(outer.slice(Math.floor((T - TAU) / 0.02)));
  // fill the whole disc first: pearly inside
  const disc = new Path2D(); disc.moveTo(...spiral(T));
  for (let t = T; t > T - TAU; t -= 0.02) disc.lineTo(...spiral(t));
  disc.closePath();
  const g = x.createRadialGradient(cx - 120, cy - 120, 40, cx, cy, 900);
  g.addColorStop(0, "#f4ece2"); g.addColorStop(0.6, "#e8d9cc"); g.addColorStop(1, "#c9b4a6");
  wash(x, disc, g, { alpha: 0.9 });
  // chambers: septa between whorl t and t + TAU
  const septa = new Path2D(), chambers = [];
  const step = 0.36;
  for (let t = 0.6; t < T - TAU + 0.2; t += step) {
    const p0 = spiral(t), p1 = spiral(t + TAU * 0.999), m = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], bow = 0.28;
    const ctl = [m[0] - dy * bow, m[1] + dx * bow];
    septa.moveTo(...p0); septa.quadraticCurveTo(...ctl, ...p1);
    chambers.push({ t, p0, p1, ctl });
  }
  // shade each chamber with alternating nacre tints
  for (let i = 0; i < chambers.length - 1; i++) {
    const A = chambers[i], B = chambers[i + 1], path = new Path2D();
    path.moveTo(...A.p0); path.quadraticCurveTo(...A.ctl, ...A.p1);
    for (let t = A.t + TAU; t <= B.t + TAU; t += 0.02) path.lineTo(...spiral(t));
    path.lineTo(...B.p1); path.quadraticCurveTo(...B.ctl, ...B.p0);
    for (let t = B.t; t >= A.t; t -= 0.02) path.lineTo(...spiral(t));
    path.closePath();
    const k = i / chambers.length;
    const cg = x.createLinearGradient(...A.p1, ...B.p0);
    cg.addColorStop(0, i % 2 ? "#efe3d6" : "#eadbd2"); cg.addColorStop(1, i % 2 ? "#cdb7aa" : "#d5c0b8");
    wash(x, path, cg, { alpha: 0.7, edge: 0.8, edgeW: 3 });
    const mid = spiral(A.t + TAU * 0.5 + step / 2);
    hatch(x, path, [mid[0] - 400, mid[1] - 400, mid[0] + 400, mid[1] + 400], { angle: A.t + 0.4, spacing: 3.4, maxW: 1.6, seed: i, alpha: 0.5, shade: (px, py) => clamp(0.15 + 0.6 * (1 - Math.hypot(px - A.p1[0], py - A.p1[1]) / (60 + 40 * k * 6))) });
  }
  inkLine(x, septa, 2.2, "#3d2d22", 0.85);
  // siphuncle: a dotted tube through the chambers
  const siph = new Path2D();
  chambers.forEach((ch, i) => { const s = spiral(ch.t + TAU * 0.5); const p = [(ch.p0[0] * 0.55 + ch.p1[0] * 0.45), (ch.p0[1] * 0.55 + ch.p1[1] * 0.45)]; i ? siph.lineTo(...p) : siph.moveTo(...p); });
  inkLine(x, siph, 5, "#8a6a55", 0.5);
  // outer wall with flame stripes on the last half turn
  const wall = ribbon(outer.slice(Math.floor((T - TAU * 1.0) / 0.02)), 4, 30);
  const wp = polyPath(wall);
  wash(x, wp, "#efe6dc", { alpha: 0.9 });
  const stripes = new Path2D();
  for (let t = T - TAU * 0.75; t < T - 0.3; t += 0.33) {
    const p = spiral(t), q = spiral(t - TAU * 0.25), m = [lerp(p[0], q[0], 0.35), lerp(p[1], q[1], 0.35)];
    stripes.moveTo(...p); stripes.quadraticCurveTo(m[0] + 30, m[1] + 30, ...spiral(t - TAU * 0.06));
  }
  x.save(); x.clip(disc); inkLine(x, stripes, 26, "#b0562e", 0.35); x.restore();
  inkLine(x, polyPath(outer, false), 2.8, "#3a2a20");
  inkLine(x, disc, 3, "#3a2a20");
  hatch(x, disc, [cx - 1000, cy - 1000, cx + 1000, cy + 1000], { angle: -0.6, spacing: 4.5, maxW: 1.4, seed: 77, alpha: 0.35, shade: roundShade(cx, cy, 900, { bias: -0.2 }) });
  caption(x, "Nautilus pompilius", 700, 2060, 110);
  caption(x, "Fig. 3", 1900, 210, 70, { font: "'Baskerville Old Face'" });
  PLATES.nautilus = printify(c, { seed: 4 });
}
